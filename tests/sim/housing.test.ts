import { describe, expect, it } from 'vitest';
import { checksum, decode, encode, validateWorld } from '../../src/persistence/serialization';
import { BUILDINGS, DAY_TICKS } from '../../src/sim/definitions';
import { assignCareJob, childShelter, updateChildNeeds } from '../../src/sim/family';
import {
  advanceHousing,
  finishHousingDesign,
  housingDesignFor,
  HOUSING_INTERVAL,
} from '../../src/sim/housing';
import { assignJob } from '../../src/sim/job-assignment';
import { needCandidates, workCandidates } from '../../src/sim/job-board';
import { advanceJob } from '../../src/sim/jobs';
import { findPath, navigationGrid } from '../../src/sim/pathfinding';
import { linkJobPosts, postHousingWork, synchronizeJobPosts } from '../../src/sim/posted-jobs';
import { ensureRelationships } from '../../src/sim/relationships';
import { Reservations } from '../../src/sim/reservations';
import { Simulation } from '../../src/sim/simulation';
import { roomTopology } from '../../src/sim/topology';
import type { World } from '../../src/sim/types';
import { drop, dropFood, nextId, resourceTotal } from '../../src/sim/world';
import { flatWorld } from './fixtures';

function housingWorld(count = 1) {
  const w = flatWorld();
  w.width = w.height = 28;
  w.terrain = Array(28 * 28).fill('soil');
  w.wildForage = Array(28 * 28).fill(70);
  w.dumpZones = [];
  w.pawns = w.pawns.slice(0, count);
  for (const p of w.pawns) {
    p.nextHousingAttempt = 0;
    p.skills.build = p.knowledge.building = 3;
    p.priorities = { plants: 3, build: 3, haul: 0, cook: 0 };
  }
  ensureRelationships(w);
  return w;
}
function trees(w: World, count = 10) {
  for (let i = 0; i < count; i++)
    w.nodes.push({
      id: nextId(w, 'node'),
      kind: 'tree',
      x: 24,
      y: i * 2 + 2,
      designated: false,
      work: 0,
    });
}
function room(w: World) {
  for (let y = 6; y <= 10; y++)
    for (let x = 6; x <= 10; x++)
      if (x === 6 || x === 10 || y === 6 || y === 10)
        w.buildings.push({
          id: nextId(w, 'building'),
          x,
          y,
          kind: x === 7 && y === 10 ? 'door' : 'wall',
        });
  roomTopology(w).invalidate('test room');
}

describe('household initiative', () => {
  it('starts designing its own home without a posted job or player order', () => {
    const w = housingWorld();
    const p = w.pawns[0]!;
    const sim = new Simulation(w);
    for (let i = 0; i < HOUSING_INTERVAL; i++) sim.step();
    expect(w.housingProjects).toHaveLength(1);
    expect(p.job?.kind).toBe('design');
    expect(p.job?.personalHousingPlan).toBe(true);
    expect(p.job?.postedJobId).toBeUndefined();
    expect(w.jobPosts).toHaveLength(0);
    expect(w.blueprints).toHaveLength(0);
    for (let i = 0; i < 100; i++) sim.step();
    expect(w.housingProjects[0]?.design).toBe('shelter');
    expect(w.blueprints.some((b) => b.kind === 'bed' && b.ownerId === p.id)).toBe(true);
  });

  it('requires both building knowledge and skill, and delegates design when either is lacking', () => {
    const w = housingWorld(2);
    const [requester, helper] = w.pawns;
    helper!.nextHousingAttempt = Number.MAX_SAFE_INTEGER;
    requester!.skills.build = 0;
    requester!.knowledge.building = 20;
    expect(housingDesignFor(requester!)).toBeUndefined();
    requester!.skills.build = 20;
    requester!.knowledge.building = 0;
    expect(housingDesignFor(requester!)).toBeUndefined();
    helper!.skills.build = helper!.knowledge.building = 12;
    advanceHousing(w);
    const candidates = workCandidates(w);
    const posts = postHousingWork(w, candidates);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.postedBy).toBe(requester!.id);
    const reservations = new Reservations(),
      grid = navigationGrid(w);
    expect(assignJob(w, requester!, candidates, reservations, grid, new Map())).toBeUndefined();
    assignJob(w, helper!, linkJobPosts(w, candidates), reservations, grid, new Map());
    expect(helper!.job?.postedJobId).toBe(posts[0]!.id);
    for (let i = 0; i < 150 && helper!.job; i++) advanceJob(w, helper!, reservations, grid);
    expect(w.housingProjects[0]!.design).toBe('house');
    expect(w.housingProjects[0]!.designerId).toBe(helper!.id);
  });

  it.each([
    [3, 'shelter', 1],
    [8, 'cottage', 1],
    [15, 'house', 2],
  ] as const)('uses ability %s to design a %s with %s enclosed rooms', (ability, design, rooms) => {
    const w = housingWorld();
    const p = w.pawns[0]!;
    p.skills.build = p.knowledge.building = ability;
    advanceHousing(w);
    expect(finishHousingDesign(w, w.housingProjects[0]!, p, navigationGrid(w))).toBe(true);
    expect(w.housingProjects[0]!.design).toBe(design);
    // Inspect the proposed completed structure, independently of construction order.
    const future = { ...w, buildings: w.blueprints.map((b) => ({ ...b })) };
    expect(roomTopology(future).rooms).toHaveLength(rooms);
    const bed = future.buildings.find((b) => b.kind === 'bed')!;
    expect(roomTopology(future).isIndoors(bed)).toBe(true);
    expect(findPath(future, p, bed, false)).not.toBeNull();
  });

  it('parents jointly recognize missing child beds and reuse their existing room', () => {
    const w = housingWorld(3);
    const [father, mother, child] = w.pawns;
    father!.partnerId = mother!.id;
    mother!.partnerId = father!.id;
    child!.ageTicks = 0;
    child!.parentIds = child!.ancestorIds = [father!.id, mother!.id];
    room(w);
    w.buildings.push(
      { id: nextId(w, 'building'), kind: 'bed', x: 7, y: 7, ownerId: father!.id },
      { id: nextId(w, 'building'), kind: 'bed', x: 8, y: 7, ownerId: mother!.id },
    );
    advanceHousing(w);
    advanceHousing(w);
    expect(w.housingProjects).toHaveLength(1);
    const project = w.housingProjects[0]!;
    expect(project.memberIds).toEqual([child!.id]);
    finishHousingDesign(w, project, father!, navigationGrid(w));
    expect(project.design).toBe('beds');
    expect(w.blueprints).toHaveLength(1);
    expect(w.blueprints[0]!.ownerId).toBe(child!.id);
    advanceHousing(w);
    expect(w.housingProjects).toHaveLength(1);
  });

  it('claims spare and player-planned indoor beds without duplicating housing', () => {
    const w = housingWorld(2);
    room(w);
    w.buildings.push({ id: nextId(w, 'building'), kind: 'bed', x: 7, y: 7 });
    w.blueprints.push({
      id: nextId(w, 'blueprint'),
      kind: 'bed',
      x: 8,
      y: 7,
      work: 0,
      delivered: 0,
    });
    advanceHousing(w);
    expect(w.housingProjects).toHaveLength(0);
    expect(w.blueprints).toHaveLength(1);
    expect(
      new Set([...w.buildings, ...w.blueprints].filter((b) => b.ownerId).map((b) => b.ownerId))
        .size,
    ).toBe(2);
  });

  it('retires a pending design request when the player supplies a suitable bed', () => {
    const w = housingWorld();
    w.pawns[0]!.skills.build = 0;
    advanceHousing(w);
    postHousingWork(w, workCandidates(w));
    expect(w.housingProjects).toHaveLength(1);
    room(w);
    w.buildings.push({ id: nextId(w, 'building'), kind: 'bed', x: 7, y: 7 });
    advanceHousing(w);
    expect(w.housingProjects).toHaveLength(0);
    expect(w.jobPosts).toHaveLength(0);
    expect(w.buildings.find((b) => b.kind === 'bed')!.ownerId).toBe(w.pawns[0]!.id);
  });

  it.each([3, 15])(
    'completes a family home at ability %s, carries the child indoors, and preserves all three bed owners',
    (ability) => {
      const w = housingWorld(3);
      const [father, mother, child] = w.pawns;
      father!.partnerId = mother!.id;
      mother!.partnerId = father!.id;
      child!.ageTicks = 0;
      child!.parentIds = child!.ancestorIds = [father!.id, mother!.id];
      child!.care = 100;
      father!.skills.build = father!.knowledge.building = ability;
      mother!.skills.build = mother!.knowledge.building = ability;
      trees(w);
      dropFood(w, { x: 3, y: 2 }, 100, 'raw', 'berries');
      const sim = new Simulation(w);
      for (let i = 0; i < 8000; i++) {
        sim.step();
        if (
          w.buildings.filter((b) => b.kind === 'bed').length === 3 &&
          roomTopology(w).isIndoors(child!)
        )
          break;
      }
      expect(roomTopology(w).isIndoors(child!)).toBe(true);
      expect(new Set(w.buildings.filter((b) => b.kind === 'bed').map((b) => b.ownerId))).toEqual(
        new Set(w.pawns.map((p) => p.id)),
      );
      expect(roomTopology(w).rooms).toHaveLength(ability >= 12 ? 2 : 1);
      expect(w.pawns).toHaveLength(3);
      expect(() => validateWorld(w)).not.toThrow();
    },
  );

  it('budgets missing wood once, posts timber and construction help, and ignores unreachable wood', () => {
    const w = housingWorld();
    trees(w);
    // In-transit resources on fractional pawn positions must be counted safely.
    w.pawns[0]!.x = 2.25;
    w.pawns[0]!.carrying = { resource: 'wood', quantity: 12 };
    advanceHousing(w);
    finishHousingDesign(w, w.housingProjects[0]!, w.pawns[0]!, navigationGrid(w));
    const cost = w.blueprints.reduce((n, b) => n + BUILDINGS[b.kind].cost, 0);
    expect(w.nodes.filter((n) => n.designated)).toHaveLength(Math.ceil((cost - 12) / 16));
    const ids = w.nodes.filter((n) => n.designated).map((n) => n.id);
    advanceHousing(w);
    expect(w.nodes.filter((n) => n.designated).map((n) => n.id)).toEqual(ids);
    expect(postHousingWork(w, workCandidates(w)).some((p) => p.kind === 'chop')).toBe(true);
    drop(w, { x: 5, y: 3 }, 'wood', 10);
    w.jobPosts = [];
    // Demonstrate the next dependency becomes a real delivery request.
    w.housingProjects[0]!.timberIds = [];
    const posts = postHousingWork(w, workCandidates(w));
    expect(posts.some((p) => p.kind === 'deliver')).toBe(true);
    for (let y = 0; y < w.height; y++) w.terrain[y * w.width + 20] = 'water';
    for (const n of w.nodes) n.designated = false;
    advanceHousing(w);
    expect(w.nodes.every((n) => !n.designated)).toBe(true);
  });

  it('builds a usable home from unmarked trees with physical materials and no player commands', () => {
    const w = housingWorld();
    trees(w);
    dropFood(w, { x: 3, y: 2 }, 100, 'raw', 'berries');
    const sim = new Simulation(w);
    for (let i = 0; i < 10000; i++) {
      sim.step();
      if (
        w.buildings.some((b) => b.kind === 'bed' && roomTopology(w).isIndoors(b)) &&
        !w.blueprints.length
      )
        break;
    }
    const bed = w.buildings.find((b) => b.kind === 'bed')!;
    expect(bed).toBeDefined();
    expect(bed.ownerId).toBe(w.pawns[0]!.id);
    expect(roomTopology(w).isIndoors(bed)).toBe(true);
    expect(findPath(w, w.pawns[0]!, bed, false)).not.toBeNull();
    const spent =
      w.buildings.reduce((n, b) => n + BUILDINGS[b.kind].cost, 0) +
      w.blueprints.reduce((n, b) => n + b.delivered, 0);
    expect(resourceTotal(w, 'wood') + spent).toBe((10 - w.nodes.length) * 16);
    expect(
      sim.diagnostics.snapshot().some((e) => e.type === 'JOB_POSTED' && e.jobType === 'chop'),
    ).toBe(true);
    advanceHousing(w);
    expect(w.housingProjects).toHaveLength(0);
    expect(() => validateWorld(w)).not.toThrow();
  }, 15000);

  it('takes a tired child to their reserved bed and protects it from adult sleep jobs', () => {
    const w = housingWorld(2);
    const [adult, child] = w.pawns;
    child!.ageTicks = 0;
    child!.rest = 20;
    room(w);
    const bed = { id: nextId(w, 'building'), kind: 'bed' as const, x: 8, y: 8, ownerId: child!.id };
    w.buildings.push(bed);
    const grid = navigationGrid(w);
    expect(childShelter(w, child!, grid)?.destination).toEqual({ x: 8, y: 8 });
    expect(assignCareJob(w, adult!, new Reservations(), grid)).toBe(true);
    const reservations = new Reservations();
    for (let i = 0; i < 200 && adult!.job; i++) advanceJob(w, adult!, reservations, grid);
    expect({ x: child!.x, y: child!.y }).toEqual({ x: 8, y: 8 });
    const rest = child!.rest;
    updateChildNeeds(w, child!);
    expect(child!.rest - rest).toBeCloseTo(0.3);
    adult!.rest = 5;
    expect(needCandidates(w, adult!).some((c) => c.targetId === bed.id)).toBe(false);
  });

  it('defers when no safe site exists, keeps projects bounded, and respects cancelled plans', () => {
    const w = housingWorld();
    advanceHousing(w);
    w.stockpiles = w.terrain.map((_, key) => key);
    const p = w.pawns[0]!,
      project = w.housingProjects[0]!;
    expect(finishHousingDesign(w, project, p, navigationGrid(w))).toBe(false);
    expect(project.retryAt).toBeGreaterThan(w.tick);
    expect(w.blueprints).toHaveLength(0);
    w.stockpiles = [];
    finishHousingDesign(w, project, p, navigationGrid(w));
    const sim = new Simulation(w),
      bp = w.blueprints[0]!;
    bp.delivered = 5;
    sim.command({ type: 'designate', cancel: true, points: [bp] });
    expect(w.housingProjects).toHaveLength(0);
    expect(resourceTotal(w, 'wood')).toBe(5);
    expect(p.nextHousingAttempt).toBe(DAY_TICKS);
    advanceHousing(w);
    expect(w.housingProjects).toHaveLength(0);
  });

  it('persists designs, ownership and resources, migrates legacy saves, and validates new data', () => {
    const w = housingWorld();
    advanceHousing(w);
    finishHousingDesign(w, w.housingProjects[0]!, w.pawns[0]!, navigationGrid(w));
    w.blueprints[0]!.delivered = 5;
    w.pawns[0]!.carrying = { resource: 'wood', quantity: 4 };
    const loaded = decode(encode(w)).world;
    expect(loaded.housingProjects).toEqual(w.housingProjects);
    expect(loaded.blueprints).toEqual(w.blueprints);
    expect(resourceTotal(loaded, 'wood')).toBe(4);
    advanceHousing(loaded);
    expect(loaded.housingProjects).toHaveLength(1);
    loaded.pawns[0]!.knowledge.building = 21;
    expect(() => validateWorld(loaded)).toThrow('knowledge');
    loaded.pawns[0]!.knowledge.building = 3;
    loaded.housingProjects[0]!.memberIds.push(loaded.pawns[0]!.id);
    expect(() => validateWorld(loaded)).toThrow('housing');
    const old = JSON.parse(encode(housingWorld()).payload);
    delete old.housingProjects;
    delete old.pawns[0].knowledge.building;
    const payload = JSON.stringify(old);
    const migrated = decode({ version: 9, payload, checksum: checksum(payload), savedAt: 1 }).world;
    expect(migrated.housingProjects).toEqual([]);
    expect(migrated.pawns[0]!.knowledge.building).toBe(migrated.pawns[0]!.skills.build);
  });

  it('reopens interrupted design requests and removes them once blueprints exist', () => {
    const w = housingWorld();
    w.pawns[0]!.priorities.build = 0;
    advanceHousing(w);
    postHousingWork(w, workCandidates(w));
    expect(w.jobPosts[0]?.kind).toBe('design');
    finishHousingDesign(w, w.housingProjects[0]!, w.pawns[0]!, navigationGrid(w));
    synchronizeJobPosts(w, workCandidates(w));
    expect(w.jobPosts).toHaveLength(0);
  });
});
