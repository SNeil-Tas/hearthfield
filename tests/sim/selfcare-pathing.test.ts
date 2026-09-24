import { ensureAgricultureTile } from '../../src/sim/agriculture';
import { describe, it, expect } from 'vitest';
import { flatWorld } from './fixtures';
import { Simulation } from '../../src/sim/simulation';
import { findPath, navigationGrid } from '../../src/sim/pathfinding';
import {
  drop,
  dropFood,
  nextId,
  tileKey,
  resourceTotal,
  dropWaste,
  advanceFoodSpoilage,
  advanceWasteDecay,
  depositStack,
  walkable,
} from '../../src/sim/world';
import { buildDebugReport } from '../../src/sim/diagnostics';
import { encode, decode } from '../../src/persistence/serialization';

describe('v0.5.3 self-care and traversal', () => {
  it('escapes four cardinal resource stacks', () => {
    const w = flatWorld();
    for (const [x, y, resource] of [
      [1, 3, 'wood'],
      [3, 3, 'stone'],
      [2, 2, 'food'],
      [2, 4, 'waste'],
    ] as const)
      drop(w, { x, y }, resource, 10);
    expect(findPath(w, w.pawns[0]!, { x: 8, y: 3 })).not.toBeNull();
    for (const item of w.items) expect(navigationGrid(w)[item.y * w.width + item.x]).toBe(1);
  });
  it('selects a prepared meal before cooking or generic separation', () => {
    const w = flatWorld();
    w.pawns = [w.pawns[0]!];
    w.pawns[0]!.hunger = 8;
    w.buildings.push({ id: nextId(w, 'building'), x: 8, y: 5, kind: 'cooking' });
    dropFood(w, { x: 5, y: 3 }, 100);
    dropFood(w, { x: 4, y: 4 }, 1, 'meal');
    dropFood(w, { x: 5, y: 4 }, 50);
    Object.assign(w.items[2]!, { freshPoints: 35, spoiledPoints: 15 });
    for (const [x, y] of [
      [1, 3],
      [3, 3],
      [2, 2],
      [2, 4],
      [3, 4],
      [4, 3],
      [4, 5],
      [5, 4],
    ])
      drop(w, { x: x!, y: y! }, 'wood', 12);
    const sim = new Simulation(w);
    for (let i = 0; i < 10; i++) sim.step();
    expect(w.pawns[0]!.job?.kind).toBe('eat');
    for (let i = 0; i < 60 && w.pawns[0]!.hunger < 80; i++) sim.step();
    expect(w.pawns[0]!.hunger).toBeGreaterThan(80);
    expect(sim.diagnostics.snapshot().some((e) => e.type === 'FOOD_PLAN_COOK_SELECTED')).toBe(
      false,
    );
  });
  it('continues personal cooking directly into eating its own output', () => {
    const w = flatWorld();
    w.pawns = [w.pawns[0]!];
    const pawn = w.pawns[0]!;
    pawn.hunger = 25;
    pawn.priorities = { plants: 0, build: 0, haul: 0, cook: 0 };
    w.buildings.push({ id: nextId(w, 'building'), x: 4, y: 3, kind: 'cooking' });
    dropFood(w, { x: 3, y: 3 }, 100);
    const sim = new Simulation(w);
    for (let i = 0; i < 500; i++) {
      sim.step();
      if (sim.diagnostics.snapshot().some((e) => e.type === 'MEAL_CREATED')) break;
    }
    expect(pawn.job?.kind).toBe('eat');
    expect(sim.reservations.owner(pawn.job!.sourceId!)).toBe(pawn.id);
    for (let i = 0; i < 100 && pawn.job; i++) {
      expect(pawn.job?.kind).toBe('eat');
      sim.step();
    }
    expect(pawn.hunger).toBeGreaterThan(90);
  });

  it('ignores reserved and unreachable meals while finding another reachable meal', () => {
    const w = flatWorld();
    w.pawns = [w.pawns[0]!];
    const pawn = w.pawns[0]!;
    pawn.hunger = 25;
    dropFood(w, { x: 10, y: 10 }, 1, 'meal');
    for (const [x, y] of [
      [9, 10],
      [11, 10],
      [10, 9],
      [10, 11],
    ])
      w.terrain[y! * w.width + x!] = 'water';
    dropFood(w, { x: 3, y: 3 }, 1, 'meal');
    dropFood(w, { x: 6, y: 3 }, 1, 'meal');
    const meal = w.items[2]!;
    const sim = new Simulation(w);
    sim.reservations.claim([w.items[1]!.id], 'other');
    for (let i = 0; i < 10; i++) sim.step();
    expect(pawn.job?.sourceId).toBe(meal.id);
    const report = buildDebugReport(w, sim.reservations, sim.diagnostics, {}, 1);
    expect(report.colonists[0]!.preparedMeals[0]!.reachable).toBe(false);
  });

  it('preempts ordinary hauling and conserves cargo before eating', () => {
    const w = flatWorld();
    w.pawns = [w.pawns[0]!];
    const pawn = w.pawns[0]!;
    pawn.hunger = 19.01;
    pawn.carrying = { resource: 'wood', quantity: 7 };
    pawn.job = {
      kind: 'haul',
      destination: { x: 9, y: 9 },
      path: [],
      phase: 'target',
      progress: 0,
      keys: ['cargo'],
    };
    dropFood(w, { x: 3, y: 3 }, 1, 'meal');
    const sim = new Simulation(w);
    w.tick = 9;
    sim.step();
    expect(pawn.job?.kind).toBe('eat');
    expect(resourceTotal(w, 'wood')).toBe(7);
    expect(sim.reservations.owner('cargo')).toBeUndefined();
    for (let i = 0; i < 40; i++) sim.step();
    expect(pawn.hunger).toBeGreaterThan(90);
  });

  it('refunds 82 buffered plus carried ingredients when a critical cook claims a ready meal', () => {
    const w = flatWorld();
    w.pawns = [w.pawns[0]!];
    const pawn = w.pawns[0]!;
    pawn.hunger = 8;
    pawn.priorities = { plants: 0, haul: 0, build: 0, cook: 0 };
    const station = {
      id: nextId(w, 'building'),
      kind: 'cooking' as const,
      x: 9,
      y: 8,
      ingredientFresh: 82,
      reservedBy: pawn.id,
    };
    w.buildings.push(station);
    dropFood(w, { x: 10, y: 8 }, 50);
    const source = w.items[0]!;
    pawn.carrying = { resource: 'food', quantity: 7.47, foodType: 'raw' };
    pawn.job = {
      kind: 'cook',
      personalFoodPlan: true,
      targetId: station.id,
      sourceId: source.id,
      destination: station,
      path: [],
      phase: 'source',
      progress: 0,
      keys: [station.id, source.id],
    };
    const sim = new Simulation(w);
    dropFood(w, { x: 3, y: 3 }, 1, 'meal');
    const meal = w.items.at(-1)!;
    w.tick = 9;
    sim.step();
    expect(pawn.job?.sourceId).toBe(meal.id);
    expect(station.ingredientFresh).toBe(0);
    expect(station.reservedBy).toBeUndefined();
    expect(sim.reservations.owner(source.id)).toBeUndefined();
    expect(sim.reservations.owner(station.id)).toBeUndefined();
    expect(
      w.items.filter((i) => i.foodType === 'raw').reduce((n, i) => n + i.quantity, 0),
    ).toBeCloseTo(139.47);
    for (let i = 0; i < 40; i++) sim.step();
    expect(pawn.hunger).toBeGreaterThan(80);
    expect(w.items.some((i) => i.id === meal.id)).toBe(false);
  });

  it('separates required mixed ingredients inside the personal cooking plan', () => {
    const w = flatWorld();
    w.pawns = [w.pawns[0]!];
    const pawn = w.pawns[0]!;
    pawn.hunger = 25;
    pawn.priorities = { plants: 0, haul: 0, build: 0, cook: 0 };
    w.buildings.push({ id: nextId(w, 'building'), kind: 'cooking', x: 4, y: 3 });
    dropFood(w, { x: 3, y: 3 }, 100);
    Object.assign(w.items[0]!, { freshPoints: 85, spoiledPoints: 15 });
    dropFood(w, { x: 3, y: 4 }, 30);
    const sim = new Simulation(w);
    for (let i = 0; i < 10; i++) sim.step();
    expect(pawn.job?.kind).toBe('cook');
    for (let i = 0; i < 500 && pawn.hunger < 70; i++) {
      expect(['cook', 'eat']).toContain(pawn.job?.kind);
      sim.step();
    }
    expect(pawn.hunger).toBeGreaterThan(70);
    expect(
      sim.diagnostics.snapshot().some((e) => e.type === 'FOOD_SEPARATED' && e.jobType === 'cook'),
    ).toBe(true);
    expect(w.items.some((i) => i.resource === 'waste')).toBe(true);
  });

  it('crosses a full stockpile and reaches farm sow, harvest, food and storage tiles', () => {
    const w = flatWorld();
    w.pawns = [w.pawns[0]!];
    for (let y = 0; y < w.height; y++) {
      drop(w, { x: 5, y }, 'wood', 12);
      w.stockpiles.push(tileKey(w, { x: 5, y }));
    }
    const path = findPath(w, w.pawns[0]!, { x: 8, y: 3 })!;
    expect(path.some((p) => p.x === 5)).toBe(true);
    w.growingZones.push(tileKey(w, { x: 8, y: 4 }), tileKey(w, { x: 8, y: 5 }));
    w.crops.push({ id: nextId(w, 'crop'), x: 8, y: 5, growth: 1, kind: 'grain' });
    w.pawns[0]!.priorities = { plants: 1, haul: 2, build: 0, cook: 0 };
    for (const key of w.growingZones) ensureAgricultureTile(w, key, 'grain');
    const sim = new Simulation(w);
    for (let i = 0; i < 600; i++) sim.step();
    expect(w.events.some((e) => e.text.includes('planted'))).toBe(true);
    expect(w.events.some((e) => e.text.includes('harvested'))).toBe(true);
    expect(sim.diagnostics.snapshot().filter((e) => e.type === 'PATH_FAILED')).toHaveLength(0);
  });

  it('retains wall, water and solid-node collision, with doors and crops passable', () => {
    const w = flatWorld();
    for (let y = 0; y < w.height; y++)
      w.buildings.push({ id: nextId(w, 'building'), kind: 'wall', x: 5, y });
    expect(findPath(w, { x: 2, y: 3 }, { x: 8, y: 3 })).toBeNull();
    w.buildings.find((b) => b.y === 3)!.kind = 'door';
    expect(findPath(w, { x: 2, y: 3 }, { x: 8, y: 3 })).not.toBeNull();
    w.terrain[3 * w.width + 5] = 'water';
    expect(findPath(w, { x: 2, y: 3 }, { x: 8, y: 3 })).toBeNull();
    w.terrain[3 * w.width + 5] = 'soil';
    w.nodes.push({ id: nextId(w, 'node'), kind: 'tree', x: 5, y: 3, designated: false, work: 0 });
    expect(walkable(w, { x: 5, y: 3 })).toBe(false);
    w.nodes = [];
    w.crops.push({ id: nextId(w, 'crop'), x: 5, y: 3, kind: 'grain', growth: 1 });
    expect(walkable(w, { x: 5, y: 3 })).toBe(true);
  });

  it('keeps merging, reservations, spoilage and expiry physical on walkable tiles', () => {
    const w = flatWorld();
    const tile = { x: 5, y: 5 };
    w.stockpiles.push(tileKey(w, tile));
    dropFood(w, tile, 60);
    depositStack(w, tile, { resource: 'food', foodType: 'raw', quantity: 40, freshPoints: 40 });
    expect(w.items).toHaveLength(1);
    expect(w.items[0]!.quantity).toBe(100);
    const sim = new Simulation(w);
    const id = w.items[0]!.id;
    sim.reservations.claim([id], 'one');
    expect(sim.reservations.claim([id], 'two')).toBe(false);
    advanceFoodSpoilage(w, w.items[0]!, new Set());
    expect(w.items[0]!.freshPoints).toBeLessThan(100);
    expect(w.items[0]!.quantity).toBeCloseTo(100);
    dropWaste(w, { x: 6, y: 5 }, 35);
    expect(w.items.filter((i) => i.resource === 'waste').map((i) => i.quantity)).toEqual([30, 5]);
    w.tick = 3001;
    advanceWasteDecay(w);
    expect(w.items).toHaveLength(1);
    expect(navigationGrid(w)[tileKey(w, tile)]).toBe(1);
    expect(sim.command({ type: 'blueprint', kind: 'wall', points: [tile] })).toBe(0);
  });

  it('keeps a genuinely enclosed meal on retry cooldown without blocking other food', () => {
    const w = flatWorld();
    w.pawns = [w.pawns[0]!];
    w.pawns[0]!.hunger = 25;
    w.pawns[0]!.priorities = { plants: 0, haul: 0, build: 0, cook: 0 };
    dropFood(w, { x: 8, y: 8 }, 1, 'meal');
    for (const [x, y] of [
      [7, 8],
      [9, 8],
      [8, 7],
      [8, 9],
    ])
      w.buildings.push({ id: nextId(w, 'building'), kind: 'wall', x: x!, y: y! });
    const sim = new Simulation(w);
    for (let i = 0; i < 99; i++) sim.step();
    expect(sim.diagnostics.snapshot().filter((e) => e.type === 'PATH_FAILED')).toHaveLength(1);
    dropFood(w, { x: 3, y: 3 }, 1, 'meal');
    for (let i = 0; i < 40; i++) sim.step();
    expect(w.pawns[0]!.hunger).toBeGreaterThan(90);
    expect(w.items.some((i) => i.x === 8 && i.y === 8)).toBe(true);
  });

  it('loads dense schema-6 storage in place and rebuilds passable navigation', () => {
    const w = flatWorld();
    for (const [x, y] of [
      [1, 3],
      [3, 3],
      [2, 2],
      [2, 4],
    ])
      drop(w, { x: x!, y: y! }, 'wood', 12);
    const saved = encode(w);
    expect(saved.version).toBe(6);
    const loaded = decode(saved).world;
    expect(loaded.items).toEqual(w.items);
    expect(findPath(loaded, loaded.pawns[0]!, { x: 8, y: 3 })).not.toBeNull();
  });

  it('does not deliver materials through a true terrain barrier', () => {
    const w = flatWorld();
    w.pawns = [w.pawns[0]!];
    for (let y = 0; y < w.height; y++) w.terrain[y * w.width + 5] = 'water';
    drop(w, { x: 8, y: 3 }, 'wood', 10);
    const sim = new Simulation(w);
    sim.command({ type: 'blueprint', kind: 'bed', points: [{ x: 3, y: 5 }] });
    for (let i = 0; i < 400; i++) sim.step();
    expect(w.blueprints[0]!.delivered).toBe(0);
    expect(resourceTotal(w, 'wood')).toBe(10);
  });
});
