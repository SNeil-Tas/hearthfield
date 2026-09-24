import { describe, expect, it, vi } from 'vitest';
import { flatWorld } from './fixtures';
import { roomTopology } from '../../src/sim/topology';
import { nextId, advanceFoodSpoilage, drop } from '../../src/sim/world';
import { findPath, navigationGrid } from '../../src/sim/pathfinding';
import { Simulation } from '../../src/sim/simulation';
import { advanceJob } from '../../src/sim/jobs';
import { BUILDINGS } from '../../src/sim/definitions';
import { decode, encode } from '../../src/persistence/serialization';
import { buildDebugReport, colonistDebugText } from '../../src/sim/diagnostics';
import type { World, BuildingKind } from '../../src/sim/types';
import { contextHTML } from '../../src/ui/panels';
import { initialUI } from '../../src/ui/state';

vi.mock('../../src/build', () => ({ APP_VERSION: 'test', BUILD_ID: 'test' }));

function put(w: World, x: number, y: number, kind: BuildingKind = 'wall') {
  const b = { id: nextId(w, 'building'), x, y, kind };
  w.buildings.push(b);
  return b;
}
function box(w: World, x = 2, y = 2, width = 5, height = 5) {
  for (let dx = 0; dx < width; dx++)
    for (let dy = 0; dy < height; dy++)
      if (!dx || !dy || dx === width - 1 || dy === height - 1) put(w, x + dx, y + dy);
}
function remove(w: World, x: number, y: number) {
  w.buildings = w.buildings.filter((b) => b.x !== x || b.y !== y);
  roomTopology(w).invalidate('test removal');
}
function layout(rows: string[]) {
  const w = flatWorld();
  rows.forEach((row, y) =>
    [...row].forEach((cell, x) => {
      if (cell === '#' || cell === 'D') put(w, x + 1, y + 1, cell === 'D' ? 'door' : 'wall');
    }),
  );
  return w;
}
const center = { x: 4, y: 4 };

describe('room geometry and roofs', () => {
  it('assigns the nine interior tiles of a completed box, excluding boundaries and outside', () => {
    const w = flatWorld();
    box(w);
    const t = roomTopology(w),
      r = t.getRoomAt(center)!;
    expect(r.area).toBe(9);
    expect(r.tiles).toHaveLength(9);
    expect(t.getRoomAt({ x: 3, y: 3 })).toBe(r);
    expect(t.isIndoors(center)).toBe(true);
    expect(t.isOutside({ x: 1, y: 1 })).toBe(true);
    expect(t.getRoomAt({ x: 1, y: 1 })).toBeUndefined();
    expect(t.getRoomAt({ x: 2, y: 2 })).toBeUndefined();
    expect(t.isSheltered({ x: 2, y: 2 })).toBe(false);
    expect(t.isOutside({ x: 2, y: 2 })).toBe(false);
    expect(r.doorIds).toEqual([]); // Accessibility is not enclosure.
  });

  it.each(['gap', 'blueprint wall', 'unfinished wall', 'blueprint door', 'unfinished door'])(
    '%s cannot seal a room',
    (state) => {
      const w = flatWorld();
      box(w);
      remove(w, 4, 2);
      if (state !== 'gap')
        w.blueprints.push({
          id: nextId(w, 'blueprint'),
          x: 4,
          y: 2,
          kind: state.includes('door') ? 'door' : 'wall',
          delivered: state.startsWith('unfinished') ? 5 : 0,
          work: state.startsWith('unfinished') ? 1 : 0,
        });
      const t = roomTopology(w);
      expect(t.isOutside(center)).toBe(true);
      expect(t.rooms).toHaveLength(0);
    },
  );

  it('completed doors seal topology while remaining traversable', () => {
    const w = flatWorld();
    box(w);
    remove(w, 4, 2);
    const door = put(w, 4, 2, 'door');
    const t = roomTopology(w);
    expect(t.getRoomAt(center)?.doorIds).toEqual([door.id]);
    expect(t.getRoomAt(center)?.connectsOutside).toBe(true);
    expect(findPath(w, center, { x: 4, y: 1 })).not.toBeNull();
    const before = t.rebuildCount;
    // Doors have no persistent open/closed state: pawns always open them automatically.
    w.pawns[0]!.x = 4;
    w.pawns[0]!.y = 2;
    expect(t.isIndoors(center)).toBe(true);
    expect(t.rebuildCount).toBe(before);
  });

  it('separates internal rooms, records door links, merges and splits deterministically', () => {
    const w = layout(['#######', '#..#..#', '#..D..#', '#..#..#', '#######']);
    const t = roomTopology(w);
    expect(t.rooms.map((r) => r.area)).toEqual([6, 6]);
    const [a, b] = t.rooms;
    expect(a!.neighbours).toEqual([b!.id]);
    expect(b!.neighbours).toEqual([a!.id]);
    expect(a!.connectsOutside).toBe(false);
    remove(w, 4, 2);
    expect(t.rooms).toHaveLength(1);
    expect(t.rooms[0]!.area).toBe(13);
    expect(t.lastChange.merged).toBe(1);
    put(w, 4, 2);
    t.invalidate('partition completed');
    expect(t.rooms).toHaveLength(2);
    expect(t.lastChange.split).toBe(1);
  });

  it('breaching one room does not erase its neighbour behind a completed door', () => {
    const w = layout(['#######', '#..#..#', '#..D..#', '#..#..#', '#######']);
    const t = roomTopology(w);
    t.ensure();
    remove(w, 1, 2);
    expect(t.isOutside({ x: 2, y: 2 })).toBe(true);
    expect(t.isIndoors({ x: 5, y: 2 })).toBe(true);
    expect(t.rooms).toHaveLength(1);
    expect(t.rooms[0]!.connectsOutside).toBe(true);
  });

  it('recognises an L-shaped interior', () => {
    const w = layout(['#####', '#...#', '#.###', '#.#..', '###..']);
    expect(roomTopology(w).rooms.map((r) => r.area)).toEqual([5]);
  });
  it('recognises a one-tile corridor', () => {
    const w = layout(['#######', '#.....#', '#######']);
    expect(roomTopology(w).rooms.map((r) => r.area)).toEqual([5]);
  });
  it('a closed structure on the map edge encloses, but an unblocked edge seeds outside', () => {
    const w = flatWorld();
    box(w, 0, 0);
    const t = roomTopology(w);
    expect(t.isIndoors({ x: 1, y: 1 })).toBe(true);
    remove(w, 0, 2);
    expect(t.isOutside({ x: 1, y: 1 })).toBe(true);
  });
  it('an edge door is a portal to outside, without becoming an outside seed', () => {
    const w = flatWorld();
    box(w, 0, 0);
    remove(w, 0, 2);
    put(w, 0, 2, 'door');
    expect(roomTopology(w).rooms[0]!.connectsOutside).toBe(true);
    expect(roomTopology(w).isIndoors({ x: 1, y: 1 })).toBe(true);
  });
  it('keeps disconnected buildings separate and preserves unaffected room IDs', () => {
    const w = flatWorld();
    box(w, 1, 1, 4, 4);
    box(w, 7, 7, 4, 4);
    const t = roomTopology(w);
    const id = t.getRoomAt({ x: 8, y: 8 })!.id;
    expect(t.rooms).toHaveLength(2);
    remove(w, 1, 2);
    expect(t.rooms).toHaveLength(1);
    expect(t.getRoomAt({ x: 8, y: 8 })!.id).toBe(id);
  });
  it('recognises nested enclosures; a courtyard can independently be unroofed', () => {
    const w = flatWorld();
    box(w, 1, 1, 9, 9);
    box(w, 4, 4, 3, 3);
    const t = roomTopology(w);
    expect(t.rooms.map((r) => r.area).sort((a, b) => a - b)).toEqual([1, 40]);
    t.setRoof({ x: 5, y: 5 }, false);
    expect(t.environmentAt({ x: 5, y: 5 }).location).toBe('Enclosed, unroofed');
    expect(t.getRoomAt({ x: 5, y: 5 })!.roofedArea).toBe(0);
  });
  it('cardinal movement and enclosure agree on sealed diagonal corners', () => {
    const w = flatWorld();
    for (const [x, y] of [
      [4, 3],
      [3, 4],
      [5, 4],
      [4, 5],
    ])
      put(w, x!, y!);
    const t = roomTopology(w);
    expect(t.getRoomAt(center)!.area).toBe(1);
    expect(findPath(w, center, { x: 3, y: 3 })).toBeNull();
    remove(w, 4, 3);
    expect(t.isOutside(center)).toBe(true);
    expect(findPath(w, center, { x: 3, y: 3 })).not.toBeNull();
  });
  it('water, trees and stone resources do not become structural walls', () => {
    const w = flatWorld();
    box(w);
    remove(w, 4, 2);
    w.terrain[2 * w.width + 4] = 'water';
    w.nodes.push({ id: nextId(w, 'node'), x: 4, y: 2, kind: 'stone', work: 0, designated: false });
    expect(roomTopology(w).isOutside(center)).toBe(true);
  });
  it('supports all four enclosure/roof combinations and partial coverage', () => {
    const w = flatWorld();
    box(w);
    const t = roomTopology(w),
      outside = { x: 0, y: 0 };
    expect(t.environmentAt(outside).location).toBe('Outdoors');
    t.setRoof(outside, true);
    expect(t.environmentAt(outside).location).toBe('Sheltered outdoors');
    expect(t.getRoomAt(outside)).toBeUndefined();
    expect(t.isIndoors(center)).toBe(true);
    t.setRoof(center, false);
    expect(t.isEnclosed(center)).toBe(true);
    expect(t.isIndoors(center)).toBe(false);
    expect(t.getRoomAt(center)!.roofedArea).toBe(8);
    const count = t.rebuildCount;
    t.setRoof(center, undefined);
    expect(t.isIndoors(center)).toBe(true);
    expect(t.rebuildCount).toBe(count);
  });
  it('removes automatic roofs on breach and reapplies them when repaired', () => {
    const w = flatWorld();
    box(w);
    const t = roomTopology(w);
    expect(t.isRoofed(center)).toBe(true);
    remove(w, 4, 2);
    expect(t.isRoofed(center)).toBe(false);
    expect(t.lastChange.removed).toBe(1);
    put(w, 4, 2);
    t.invalidate('repair');
    expect(t.isIndoors(center)).toBe(true);
    expect(t.lastChange.created).toBe(1);
  });
  it('coalesces invalidations and does no rebuild for repeated queries', () => {
    const w = flatWorld();
    const t = roomTopology(w);
    t.ensure();
    box(w);
    t.invalidate('wall 1');
    t.invalidate('wall 2');
    expect(t.isIndoors(center)).toBe(true);
    for (let i = 0; i < 100; i++) t.environmentAt(center);
    expect(t.rebuildCount).toBe(2);
    expect(t.lastChange.reasons).toEqual(['wall 1', 'wall 2']);
  });
  it('treats out-of-map queries as neither rooms nor outside tiles', () => {
    const t = roomTopology(flatWorld());
    expect(t.getRoomAt({ x: -1, y: 2 })).toBeUndefined();
    expect(t.isOutside({ x: 12, y: 0 })).toBe(false);
    expect(t.isRoofed({ x: 0, y: 12 })).toBe(false);
  });
});

describe('topology lifecycle and gameplay', () => {
  it('inspects colonists, beds and empty tiles using the same cached environment', () => {
    const w = flatWorld();
    box(w);
    Object.assign(w.pawns[0]!, center);
    const bed = put(w, 4, 4, 'bed'),
      t = roomTopology(w),
      ui = initialUI();
    ui.selectedId = w.pawns[0]!.id;
    expect(contextHTML(w, ui)).toContain('Location: Indoors');
    ui.selectedId = bed.id;
    expect(contextHTML(w, ui)).toContain('Indoor bed');
    ui.selectedId = null;
    ui.selectedTile = { x: 0, y: 0 };
    expect(contextHTML(w, ui)).toContain('Location: Outdoors');
    expect(t.rebuildCount).toBe(1);
  });
  it('coalesces multiple completed boundaries during one rainy simulation step', () => {
    const w = flatWorld();
    box(w);
    remove(w, 4, 2);
    remove(w, 5, 2);
    w.weather = 'rain';
    for (let i = 0; i < 2; i++) {
      const bp = {
        id: nextId(w, 'blueprint'),
        x: 4 + i,
        y: 2,
        kind: 'wall' as const,
        delivered: 5,
        work: 4,
      };
      w.blueprints.push(bp);
      w.pawns[i]!.job = {
        kind: 'build',
        targetId: bp.id,
        destination: bp,
        path: [],
        phase: 'target',
        progress: 0,
        keys: [],
      };
    }
    const sim = new Simulation(w);
    sim.step();
    expect(roomTopology(w).isIndoors(center)).toBe(true);
    expect(roomTopology(w).rebuildCount).toBe(2);
  });
  it.each(['wall', 'door'] as const)(
    'rebuilds when a %s actually completes and is demolished',
    (kind) => {
      const w = flatWorld();
      box(w);
      remove(w, 4, 2);
      const bp = {
        id: nextId(w, 'blueprint'),
        x: 4,
        y: 2,
        kind,
        delivered: BUILDINGS[kind].cost,
        work: BUILDINGS[kind].work,
      };
      w.blueprints.push(bp);
      const sim = new Simulation(w),
        t = roomTopology(w),
        pawn = w.pawns[0]!;
      expect(t.isOutside(center)).toBe(true);
      pawn.job = {
        kind: 'build',
        targetId: bp.id,
        destination: bp,
        path: [],
        phase: 'target',
        progress: 0,
        keys: [],
      };
      sim.step();
      expect(t.isIndoors(center)).toBe(true);
      expect(t.rebuildCount).toBe(2);
      const completed = w.buildings.find((b) => b.x === 4 && b.y === 2)!;
      pawn.job = {
        kind: 'deconstruct',
        targetId: completed.id,
        destination: completed,
        path: [],
        phase: 'target',
        progress: 100,
        keys: [],
      };
      sim.step();
      expect(t.isOutside(center)).toBe(true);
      expect(t.isRoofed(center)).toBe(false);
      expect(
        sim.diagnostics.snapshot().filter((e) => e.type === 'ROOM_TOPOLOGY_REBUILT'),
      ).toHaveLength(3);
    },
  );
  it('blueprint commands, deconstruction designation and normal ticks do not rebuild rooms', () => {
    const w = flatWorld();
    box(w);
    const sim = new Simulation(w),
      t = roomTopology(w);
    for (const p of w.pawns) p.priorities = { plants: 0, haul: 0, cook: 0, build: 0 };
    sim.command({ type: 'blueprint', kind: 'wall', points: [{ x: 8, y: 8 }] });
    sim.command({ type: 'deconstruct', points: [{ x: 2, y: 2 }] });
    for (let i = 0; i < 30; i++) sim.step();
    expect(t.rebuildCount).toBe(1);
    expect(t.isIndoors(center)).toBe(true);
  });
  it('reconstructs derived topology and automatic roofs from schema 6 saves', () => {
    const w = flatWorld();
    box(w);
    const before = roomTopology(w).summary();
    const save = encode(w);
    expect(save.version).toBe(6);
    expect(save.payload).not.toContain('roof');
    const loaded = decode(save).world;
    new Simulation(loaded);
    expect(roomTopology(loaded).summary().rooms).toEqual(before.rooms);
    expect(roomTopology(loaded).isIndoors(center)).toBe(true);
  });
  it('owned outdoor beds receive the same modest penalty as unowned outdoor beds', () => {
    function recovery(indoor: boolean) {
      const w = flatWorld();
      if (indoor) box(w);
      const bed = put(w, 4, 4, 'bed'),
        pawn = w.pawns[0]!;
      Object.assign(bed, { ownerId: pawn.id });
      Object.assign(pawn, { x: 4, y: 4, rest: 40 });
      pawn.job = {
        kind: 'sleep',
        targetId: bed.id,
        destination: bed,
        path: [],
        phase: 'target',
        progress: 1,
        keys: [],
      };
      const sim = new Simulation(w);
      advanceJob(w, pawn, sim.reservations, navigationGrid(w));
      return pawn.rest - 40;
    }
    expect(recovery(true)).toBeCloseTo(0.52);
    expect(recovery(false)).toBeCloseTo(0.52 * 0.85);
  });
  it('only genuine indoors gets the storage bonus; outdoor roofs only prevent rain exposure', () => {
    function loss(enclosed: boolean, roofed: boolean) {
      const w = flatWorld();
      if (enclosed) box(w);
      w.weather = 'heavy-rain';
      roomTopology(w).setRoof(center, roofed);
      drop(w, center, 'food', 100);
      advanceFoodSpoilage(w, w.items[0]!);
      return 100 - w.items[0]!.freshPoints!;
    }
    expect(loss(true, true) / loss(false, true)).toBeCloseTo(0.78);
    expect(loss(false, false) / loss(false, true)).toBeCloseTo(1.35);
    expect(loss(true, false)).toBeCloseTo(loss(false, false));
  });
  it('shelter protects exposed outdoor work from rain slowdown', () => {
    function work(roofed: boolean) {
      const w = flatWorld(),
        pawn = w.pawns[0]!;
      w.weather = 'heavy-rain';
      roomTopology(w).setRoof(pawn, roofed);
      const node = {
        id: nextId(w, 'node'),
        x: 3,
        y: 3,
        kind: 'berries' as const,
        work: 0,
        designated: true,
      };
      w.nodes.push(node);
      pawn.job = {
        kind: 'gather',
        targetId: node.id,
        destination: node,
        path: [],
        phase: 'target',
        progress: 0,
        keys: [],
      };
      const sim = new Simulation(w);
      advanceJob(w, pawn, sim.reservations, navigationGrid(w));
      return node.work;
    }
    expect(work(false) / work(true)).toBeCloseTo(0.65);
  });
  it('exports room metadata and colonist environment without per-tile dumps', () => {
    const w = flatWorld();
    box(w);
    Object.assign(w.pawns[0]!, center);
    const sim = new Simulation(w);
    const report = buildDebugReport(w, sim.reservations, sim.diagnostics, {}, 1);
    expect(report.topology.rooms[0]!.area).toBe(9);
    expect(report.topology.rooms[0]).not.toHaveProperty('tiles');
    expect(report.colonists[0]!.environment.location).toBe('Indoors');
    expect(colonistDebugText(w, w.pawns[0]!, sim.reservations)).toContain('Indoors');
  });
});
