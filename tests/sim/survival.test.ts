import { advanceAgriculture, dropSeed } from '../../src/sim/agriculture';
import { describe, expect, it } from 'vitest';
import { checksum, decode, encode } from '../../src/persistence/serialization';
import { Simulation } from '../../src/sim/simulation';
import { interruptJob } from '../../src/sim/jobs';
import { nextId, drop, shelteredTiles, tileKey } from '../../src/sim/world';
import { flatWorld } from './fixtures';

describe('survival loop primitives', () => {
  it('sows, grows, harvests and creates physical raw food', () => {
    const w = flatWorld();
    const sim = new Simulation(w);
    const tile = { x: 6, y: 6 };
    expect(sim.command({ type: 'growing', points: [tile] })).toBe(1);
    dropSeed(w, { x: 3, y: 3 }, 'potato', 1);
    for (let i = 0; i < 300; i++) sim.step();
    expect(w.crops).toHaveLength(1);
    // Accelerate growth in small, maintained-soil steps without changing crop definitions.
    for (let i = 0; i < 1000 && w.crops[0]!.growth < 1; i++) {
      w.agriculture[0]!.moisture = 60;
      w.agriculture[0]!.nutrients = 82;
      advanceAgriculture(w, 100);
    }
    expect(w.crops[0]!.growth).toBe(1);
    for (let i = 0; i < 300; i++) sim.step();
    expect(w.growingZones).toContain(tileKey(w, tile));
    expect(
      w.items.some(
        (item) => item.resource === 'food' && item.quantity >= 8 && item.foodType === 'raw',
      ),
    ).toBe(true);
  });

  it('cooks 100 raw food points into one physical meal', () => {
    const w = flatWorld();
    w.buildings.push({ id: nextId(w, 'building'), x: 8, y: 5, kind: 'cooking' });
    drop(w, { x: 6, y: 5 }, 'food', 100);
    for (const pawn of w.pawns) pawn.priorities.cook = 1;
    const sim = new Simulation(w);
    for (let i = 0; i < 1000; i++) sim.step();
    expect(w.items.some((item) => item.resource === 'food' && item.foodType === 'meal')).toBe(true);
    expect(
      w.items.filter((item) => item.foodType === 'raw').reduce((n, i) => n + i.quantity, 0),
    ).toBe(0);
  });

  it('releases cooking reservations and returns ingredients when interrupted', () => {
    const w = flatWorld();
    w.buildings.push({ id: nextId(w, 'building'), x: 8, y: 5, kind: 'cooking' });
    drop(w, { x: 6, y: 5 }, 'food', 4);
    for (const pawn of w.pawns) pawn.priorities.cook = 1;
    const sim = new Simulation(w);
    for (let i = 0; i < 20; i++) sim.step();
    const cook = w.pawns.find((pawn) => pawn.job?.kind === 'cook');
    expect(cook).toBeDefined();
    interruptJob(w, cook!, sim.reservations);
    expect(sim.reservations.size).toBe(0);
    expect(
      w.items.filter((item) => item.foodType === 'raw').reduce((n, i) => n + i.quantity, 0),
    ).toBe(4);
  });

  it('deconstructs a completed building and returns physical material', () => {
    const w = flatWorld();
    const wall = { id: nextId(w, 'building'), x: 6, y: 5, kind: 'wall' as const };
    w.buildings.push(wall);
    w.pawns[1]!.priorities = { plants: 0, build: 1, haul: 0, cook: 0 };
    const sim = new Simulation(w);
    expect(sim.command({ type: 'deconstruct', points: [wall] })).toBe(1);
    for (let i = 0; i < 500; i++) sim.step();
    expect(w.buildings).toHaveLength(0);
    expect(w.items.some((item) => item.resource === 'wood' && item.quantity === 3)).toBe(true);
  });

  it('recognises an enclosed sleeping area without treating the outside as sheltered', () => {
    const w = flatWorld();
    for (const [x, y] of [
      [4, 4],
      [5, 4],
      [6, 4],
      [4, 6],
      [5, 6],
      [6, 6],
      [4, 5],
      [6, 5],
    ] as const)
      w.buildings.push({ id: nextId(w, 'building'), x, y, kind: 'wall' });
    const sheltered = shelteredTiles(w);
    expect(sheltered.has(tileKey(w, { x: 5, y: 5 }))).toBe(true);
    expect(sheltered.has(tileKey(w, { x: 2, y: 2 }))).toBe(false);
  });

  it('migrates a v1 save without agriculture or cooking fields', () => {
    const w = flatWorld();
    drop(w, { x: 3, y: 3 }, 'food', 2);
    const current = encode(w);
    const world = JSON.parse(current.payload);
    delete world.crops;
    delete world.growingZones;
    for (const pawn of world.pawns) {
      delete pawn.skills.cook;
      delete pawn.priorities.cook;
    }
    delete world.items[0].foodType;
    const payload = JSON.stringify(world);
    const loaded = decode({
      version: 1,
      savedAt: current.savedAt,
      checksum: checksum(payload),
      payload,
    });
    expect(loaded.world.crops).toEqual([]);
    expect(loaded.world.growingZones).toEqual([]);
    expect(loaded.world.pawns[0]!.priorities.cook).toBe(2);
    expect(loaded.world.items[0]!.foodType).toBe('raw');
  });

  it('keeps a three-colonist food chain active across two simulated days', () => {
    const w = flatWorld();
    w.buildings.push({ id: nextId(w, 'building'), x: 8, y: 5, kind: 'cooking' });
    // Starter food bridges the multi-day first crop cycle.
    drop(w, { x: 6, y: 5 }, 'food', 300);
    dropSeed(w, { x: 3, y: 3 }, 'potato', 1);
    w.stockpiles.push(tileKey(w, { x: 8, y: 5 }) + 1);
    const sim = new Simulation(w);
    expect(sim.command({ type: 'growing', points: [{ x: 6, y: 6 }] })).toBe(1);
    for (let i = 0; i < 12000; i++) sim.step();
    expect(w.pawns.every((pawn) => pawn.health > 50)).toBe(true);
    expect(w.pawns.every((pawn) => Number.isFinite(pawn.hunger + pawn.rest))).toBe(true);
    expect(w.events.some((event) => /harvested|prepared a simple meal/.test(event.text))).toBe(
      true,
    );
  });
});
