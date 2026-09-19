import { describe, expect, it } from 'vitest';
import { advanceJob } from '../../src/sim/jobs';
import { navigationGrid } from '../../src/sim/pathfinding';
import { updateNeeds } from '../../src/sim/needs';
import { Simulation } from '../../src/sim/simulation';
import {
  addSpoiledFood,
  advanceWasteDecay,
  dropWaste,
  requiresFoodSeparation,
  tileKey,
} from '../../src/sim/world';
import { nextId, freshPoints, spoiledPoints } from '../../src/sim/world';
import { workCandidates } from '../../src/sim/job-board';
import { checksum, decode, encode } from '../../src/persistence/serialization';
import { flatWorld } from './fixtures';

describe('v0.5 rot and waste systems', () => {
  it('uses an absolute ten-point separation threshold', () => {
    expect(requiresFoodSeparation({ resource: 'food', spoiledPoints: 0 })).toBe(false);
    expect(requiresFoodSeparation({ resource: 'food', spoiledPoints: 9 })).toBe(false);
    expect(requiresFoodSeparation({ resource: 'food', spoiledPoints: 10 })).toBe(false);
    expect(requiresFoodSeparation({ resource: 'food', spoiledPoints: 10.01 })).toBe(true);
  });

  it('physically separates spoiled points without losing fresh food', () => {
    const w = flatWorld();
    const pawn = w.pawns[0]!;
    const item = {
      id: nextId(w, 'item'),
      x: 3,
      y: 3,
      resource: 'food' as const,
      foodType: 'raw' as const,
      foodKind: 'staple' as const,
      quantity: 100,
      freshPoints: 83,
      spoiledPoints: 17,
    };
    w.items.push(item);
    pawn.x = 2;
    pawn.y = 3;
    pawn.job = {
      kind: 'separate',
      sourceId: item.id,
      targetId: item.id,
      destination: item,
      path: [],
      phase: 'source',
      progress: 0,
      keys: [item.id],
    };
    const sim = new Simulation(w);
    sim.reservations.claim([item.id], pawn.id);
    const grid = navigationGrid(w);
    for (let i = 0; i < 50 && pawn.job; i++)
      advanceJob(w, pawn, sim.reservations, grid, new Set(), sim.diagnostics);
    const raw = w.items.find((candidate) => candidate.id === item.id);
    const waste = w.items.filter((candidate) => candidate.resource === 'waste');
    expect(raw && freshPoints(raw)).toBe(83);
    expect(raw && spoiledPoints(raw)).toBe(0);
    expect(waste.reduce((total, candidate) => total + candidate.quantity, 0)).toBe(17);
    expect(sim.diagnostics.snapshot().some((event) => event.type === 'FOOD_SEPARATED')).toBe(true);
  });

  it('stacks spoiled food at thirty points and preserves expiry cohorts', () => {
    const w = flatWorld();
    dropWaste(w, { x: 4, y: 4 }, 47);
    expect(
      w.items.filter((item) => item.resource === 'waste').map((item) => item.quantity),
    ).toEqual([30, 17]);
    w.items = [];
    addSpoiledFood(w, { x: 4, y: 4 }, 12, 100);
    addSpoiledFood(w, { x: 4, y: 4 }, 8, 200);
    w.tick = 100;
    advanceWasteDecay(w);
    expect(w.items[0]!.quantity).toBe(8);
    expect(w.items[0]!.expiryBatches).toEqual([{ quantity: 8, expiresAt: 200 }]);
  });

  it('prefers a dump zone and applies bounded sustained rot exposure', () => {
    const w = flatWorld();
    const dump = { x: 6, y: 5 };
    w.dumpZones.push(tileKey(w, dump));
    dropWaste(w, { x: 3, y: 3 }, 5);
    const candidate = workCandidates(w).find((entry) => entry.kind === 'haul');
    expect(candidate?.destination).toEqual(dump);
    const pawn = w.pawns[0]!;
    pawn.x = 3;
    pawn.y = 3;
    for (let i = 0; i < 50; i++) updateNeeds(w, pawn);
    expect(pawn.mood).toBeLessThan(100);
    expect(pawn.rotExposure).toBeLessThanOrEqual(100);
    pawn.x = 10;
    pawn.y = 10;
    for (let i = 0; i < 60; i++) updateNeeds(w, pawn);
    expect(pawn.rotExposure).toBe(0);
  });

  it('separates rot before cooking and resumes the persistent recipe', () => {
    const w = flatWorld();
    w.buildings.push({ id: nextId(w, 'building'), x: 8, y: 5, kind: 'cooking' });
    w.dumpZones.push(tileKey(w, { x: 4, y: 5 }));
    w.items.push(
      {
        id: nextId(w, 'item'),
        x: 7,
        y: 5,
        resource: 'food',
        foodType: 'raw',
        foodKind: 'staple',
        quantity: 100,
        freshPoints: 83,
        spoiledPoints: 17,
      },
      {
        id: nextId(w, 'item'),
        x: 7,
        y: 5,
        resource: 'food',
        foodType: 'raw',
        foodKind: 'staple',
        quantity: 100,
        freshPoints: 100,
        spoiledPoints: 0,
      },
    );
    const pawn = w.pawns[0]!;
    pawn.x = 6;
    pawn.y = 5;
    pawn.hunger = 25;
    pawn.priorities.cook = 0;
    for (const other of w.pawns.slice(1))
      other.priorities = { plants: 0, build: 0, haul: 0, cook: 0 };
    const sim = new Simulation(w);
    for (let i = 0; i < 1200; i++) sim.step();
    expect(w.events.some((event) => event.text.includes('prepared a simple meal'))).toBe(true);
    expect(
      w.items.some(
        (item) => item.resource === 'waste' && tileKey(w, item) === tileKey(w, { x: 4, y: 5 }),
      ),
    ).toBe(true);
  });

  it('persists Dump zones and fractional spoiled-food batches', () => {
    const w = flatWorld();
    w.dumpZones.push(tileKey(w, { x: 5, y: 5 }));
    addSpoiledFood(w, { x: 5, y: 5 }, 2.5, 1000);
    const saved = encode(w);
    expect(saved.version).toBe(5);
    const loaded = decode(saved).world;
    expect(loaded.dumpZones).toEqual(w.dumpZones);
    expect(loaded.items.find((item) => item.resource === 'waste')?.quantity).toBe(2.5);
    const legacy = JSON.parse(saved.payload);
    delete legacy.dumpZones;
    const migrated = decode({
      ...saved,
      version: 4,
      payload: JSON.stringify(legacy),
      checksum: checksum(JSON.stringify(legacy)),
    }).world;
    expect(migrated.dumpZones).toEqual([]);
  });
});
