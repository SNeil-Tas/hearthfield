import { describe, expect, it } from 'vitest';
import { findPath, navigationGrid } from '../../src/sim/pathfinding';
import { Reservations } from '../../src/sim/reservations';
import { SimulationClock } from '../../src/sim/clock';
import { Simulation } from '../../src/sim/simulation';
import { nextId, drop, resourceTotal, tileKey, sameTile } from '../../src/sim/world';
import { decode, encode, checksum } from '../../src/persistence/serialization';
import { generateWorld } from '../../src/sim/generate';
import { interruptJob } from '../../src/sim/jobs';
import { flatWorld } from './fixtures';

describe('navigation and reservation primitives', () => {
  it('finds a shortest four-way path around water and respects walls', () => {
    const w = flatWorld();
    w.terrain[3 * 12 + 3] = 'water';
    w.buildings.push({ id: nextId(w, 'building'), x: 3, y: 2, kind: 'wall' });
    const path = findPath(w, { x: 2, y: 3 }, { x: 4, y: 3 });
    expect(path).toHaveLength(4);
    expect(path!.at(-1)).toEqual({ x: 4, y: 3 });
    expect(path!.every((p) => navigationGrid(w)[tileKey(w, p)] === 1)).toBe(true);
  });
  it('returns null for an enclosed goal and permits an adjacent work tile', () => {
    const w = flatWorld();
    w.nodes.push({ id: nextId(w, 'node'), kind: 'tree', x: 5, y: 5, designated: true, work: 0 });
    expect(findPath(w, { x: 2, y: 2 }, { x: 5, y: 5 })).toBeNull();
    expect(findPath(w, { x: 2, y: 2 }, { x: 5, y: 5 }, true)).not.toBeNull();
    for (const p of [
      { x: 4, y: 5 },
      { x: 6, y: 5 },
      { x: 5, y: 4 },
      { x: 5, y: 6 },
    ])
      w.terrain[tileKey(w, p)] = 'water';
    expect(findPath(w, { x: 2, y: 2 }, { x: 5, y: 5 }, true)).toBeNull();
  });
  it('claims all keys atomically and releases every lock owned by a pawn', () => {
    const r = new Reservations();
    expect(r.claim(['wood', 'blueprint'], 'ada')).toBe(true);
    expect(r.claim(['free', 'wood'], 'kit')).toBe(false);
    expect(r.owner('free')).toBeUndefined();
    r.release('ada');
    expect(r.size).toBe(0);
    expect(r.claim(['wood'], 'kit')).toBe(true);
  });
  it('has seed-stable world generation', () => {
    expect(generateWorld(127)).toEqual(generateWorld(127));
    expect(generateWorld(128).terrain).not.toEqual(generateWorld(127).terrain);
  });
});

describe('autonomous physical logistics', () => {
  it('chops a tree, delivers wood, builds a bed and hauls the remaining wood', () => {
    const w = flatWorld();
    const sim = new Simulation(w);
    w.nodes.push({ id: nextId(w, 'node'), kind: 'tree', x: 6, y: 4, designated: false, work: 0 });
    sim.command({
      type: 'stockpile',
      points: [
        { x: 2, y: 7 },
        { x: 3, y: 7 },
      ],
    });
    sim.command({ type: 'blueprint', kind: 'bed', points: [{ x: 8, y: 4 }] });
    sim.command({ type: 'designate', points: [{ x: 6, y: 4 }] });
    expect(w.blueprints[0]!.delivered).toBe(0);
    expect(resourceTotal(w, 'wood')).toBe(0);
    for (let i = 0; i < 1000; i++) sim.step();
    expect(w.nodes).toHaveLength(0);
    expect(w.buildings.map((b) => b.kind)).toContain('bed');
    expect(w.blueprints).toHaveLength(0);
    expect(resourceTotal(w, 'wood')).toBe(6);
    expect(w.items.every((i) => w.stockpiles.includes(tileKey(w, i)))).toBe(true);
    expect(sim.reservations.size).toBe(0);
  });
  it('refunds delivered wood and drops carried wood when a blueprint is cancelled', () => {
    const w = flatWorld();
    w.pawns = [w.pawns[0]!];
    const sim = new Simulation(w);
    drop(w, { x: 3, y: 3 }, 'wood', 16);
    sim.command({ type: 'blueprint', kind: 'bed', points: [{ x: 9, y: 9 }] });
    for (let i = 0; i < 300 && !w.pawns[0]!.carrying; i++) sim.step();
    expect(w.pawns[0]!.carrying?.quantity).toBe(10);
    sim.command({ type: 'designate', cancel: true, points: [{ x: 9, y: 9 }] });
    expect(resourceTotal(w, 'wood')).toBe(16);
    expect(w.blueprints).toHaveLength(0);
    expect(sim.reservations.size).toBe(0);
    sim.command({ type: 'blueprint', kind: 'bed', points: [{ x: 9, y: 9 }] });
    for (let i = 0; i < 300 && !w.blueprints[0]!.delivered; i++) sim.step();
    expect(w.blueprints[0]!.delivered).toBeGreaterThan(0);
    sim.command({ type: 'designate', cancel: true, points: [{ x: 9, y: 9 }] });
    expect(resourceTotal(w, 'wood')).toBe(16);
    expect(sim.reservations.size).toBe(0);
  });
  it('interrupts hauling for urgent food, releases locks and consumes one physical ration', () => {
    const w = flatWorld();
    w.pawns = [w.pawns[2]!];
    const p = w.pawns[0]!;
    const sim = new Simulation(w);
    drop(w, { x: 4, y: 3 }, 'wood', 12);
    drop(w, { x: 5, y: 3 }, 'food', 3);
    sim.command({ type: 'stockpile', points: [{ x: 10, y: 10 }] });
    for (let i = 0; i < 100 && !p.carrying; i++) sim.step();
    expect(p.carrying).not.toBeNull();
    const oldKeys = [...p.job!.keys];
    p.hunger = 10;
    for (let i = 0; i < 10; i++) sim.step();
    expect(p.carrying).toBeNull();
    expect(oldKeys.every((k) => sim.reservations.owner(k) !== p.id)).toBe(true);
    for (let i = 0; i < 100; i++) sim.step();
    expect(p.hunger).toBeGreaterThan(60);
    expect(resourceTotal(w, 'food')).toBe(2);
    expect(resourceTotal(w, 'wood')).toBe(12);
  });
  it('sleeps in a reserved bed and recovers from exhaustion', () => {
    const w = flatWorld();
    const p = w.pawns[0]!;
    w.pawns = [p];
    p.rest = 8;
    const bed = { id: nextId(w, 'building'), x: 3, y: 3, kind: 'bed' as const };
    w.buildings.push(bed);
    const sim = new Simulation(w);
    for (let i = 0; i < 40; i++) sim.step();
    expect(p.job?.kind).toBe('sleep');
    expect(p.job?.targetId).toBe(bed.id);
    expect(sim.reservations.owner(bed.id)).toBe(p.id);
    for (let i = 0; i < 400; i++) sim.step();
    expect(p.rest).toBeGreaterThan(90);
    expect(sim.reservations.size).toBe(0);
  });
  it('allows fallback sleep without a bed, and autonomous berry gathering without stored food', () => {
    const w = flatWorld();
    const p = w.pawns[0]!;
    w.pawns = [p];
    p.hunger = 20;
    w.nodes.push({
      id: nextId(w, 'node'),
      kind: 'berries',
      x: 5,
      y: 3,
      designated: false,
      work: 0,
    });
    const sim = new Simulation(w);
    for (let i = 0; i < 300; i++) sim.step();
    expect(p.hunger).toBeGreaterThan(60);
    expect(resourceTotal(w, 'food')).toBe(13);
    p.rest = 2;
    for (let i = 0; i < 40; i++) sim.step();
    expect(p.job?.kind).toBe('sleep');
    expect(p.rest).toBeGreaterThan(2);
  });
  it('respects disabled work and releases claims when priorities change', () => {
    const w = flatWorld();
    w.pawns = [w.pawns[0]!];
    const p = w.pawns[0]!;
    const sim = new Simulation(w);
    const node = {
      id: nextId(w, 'node'),
      kind: 'tree' as const,
      x: 7,
      y: 3,
      designated: true,
      work: 0,
    };
    w.nodes.push(node);
    for (let i = 0; i < 20; i++) sim.step();
    expect(p.job?.kind).toBe('chop');
    sim.command({ type: 'priority', pawnId: p.id, work: 'plants', value: 0 });
    for (let i = 0; i < 100; i++) sim.step();
    expect(p.job).toBeNull();
    expect(sim.reservations.size).toBe(0);
    expect(w.nodes).toHaveLength(1);
  });
  it('does not interrupt unrelated work when cancelling an empty tile', () => {
    const w = flatWorld();
    drop(w, { x: 9, y: 8 }, 'food', 4);
    w.pawns[0]!.hunger = 15;
    const sim = new Simulation(w);
    for (let i = 0; i < 10; i++) sim.step();
    const job = w.pawns[0]!.job;
    expect(job?.kind).toBe('eat');
    sim.command({ type: 'designate', cancel: true, points: [{ x: 0, y: 0 }] });
    expect(w.pawns[0]!.job).toBe(job);
  });
  it('moves an idle colonist out of a wall blueprint so construction can complete', () => {
    const w = flatWorld();
    const sim = new Simulation(w);
    const occupant = w.pawns[0]!;
    occupant.priorities = { plants: 0, build: 0, haul: 0 };
    const location = { x: occupant.x, y: occupant.y };
    drop(w, { x: 6, y: 5 }, 'wood', 5);
    sim.command({ type: 'blueprint', kind: 'wall', points: [location] });
    for (let i = 0; i < 400; i++) sim.step();
    expect(w.buildings.some((b) => b.kind === 'wall' && sameTile(b, location))).toBe(true);
    expect(w.pawns.every((p) => !sameTile(p, location))).toBe(true);
    expect(resourceTotal(w, 'wood')).toBe(0);
  });
  it('survives 15 simulated minutes with finite state and consistent locks', () => {
    const w = generateWorld(771);
    const sim = new Simulation(w);
    sim.command({
      type: 'designate',
      points: w.nodes.filter((n) => Math.hypot(n.x - 40, n.y - 40) < 15),
    });
    sim.command({
      type: 'blueprint',
      kind: 'bed',
      points: [
        { x: 39, y: 37 },
        { x: 40, y: 37 },
      ],
    });
    for (let i = 0; i < 9000; i++) sim.step();
    expect(w.buildings.filter((b) => b.kind === 'bed')).toHaveLength(3);
    for (const p of w.pawns) {
      expect(Number.isFinite(p.x + p.y + p.hunger + p.rest)).toBe(true);
      for (const key of p.job?.keys ?? []) expect(sim.reservations.owner(key)).toBe(p.id);
    }
    expect(w.items.every((i) => i.quantity > 0)).toBe(true);
    for (const p of w.pawns) interruptJob(w, p, sim.reservations);
    expect(sim.reservations.size).toBe(0);
    expect(decode(encode(w)).world.tick).toBe(9000);
  });
});

describe('time and persistence', () => {
  it('advances fixed ticks independently of frame size and honours 0/1/2/4x', () => {
    for (const speed of [0, 1, 2, 4] as const) {
      const a = new SimulationClock(),
        b = new SimulationClock();
      a.speed = b.speed = speed;
      let ticksA = 0,
        ticksB = 0;
      for (let i = 0; i < 60; i++) a.advance(1 / 60, () => ticksA++);
      for (let i = 0; i < 20; i++) b.advance(1 / 20, () => ticksB++);
      expect(ticksA).toBe(speed * 10);
      expect(ticksB).toBe(ticksA);
    }
  });
  it('round-trips world state, retains partial construction and conserves carried resources', () => {
    const w = flatWorld();
    w.pawns[0]!.carrying = { resource: 'wood', quantity: 8 };
    w.pawns[0]!.x = 3.25;
    w.blueprints.push({
      id: nextId(w, 'blueprint'),
      x: 8,
      y: 8,
      kind: 'bed',
      delivered: 2,
      work: 1.2,
    });
    const loaded = decode(encode(w)).world;
    expect(resourceTotal(loaded, 'wood')).toBe(resourceTotal(w, 'wood'));
    expect(loaded.blueprints).toEqual(w.blueprints);
    expect(loaded.pawns[0]!.carrying).toBeNull();
    expect(loaded.items.some((i) => sameTile(i, { x: 3, y: 3 }))).toBe(true);
    expect(w.pawns[0]!.carrying?.quantity).toBe(8);
  });
  it('rejects corruption, incompatible versions and malformed world data', () => {
    const save = encode(flatWorld());
    expect(() => decode({ ...save, payload: save.payload + ' ' })).toThrow('integrity');
    expect(() => decode({ ...save, version: 9 })).toThrow('different game version');
    const world = flatWorld();
    world.pawns[0]!.health = NaN;
    const bad = encode(world);
    expect(() => decode(bad)).toThrow('needs');
    const payload = JSON.stringify({ ...flatWorld(), nextId: 1 });
    expect(() => decode({ ...save, payload, checksum: checksum(payload) })).toThrow('sequence');
  });
});
