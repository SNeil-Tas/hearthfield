import { expect, it } from 'vitest';
import { flatWorld } from './fixtures';
import { Simulation } from '../../src/sim/simulation';
import { dropFood, nextId, tileKey, resourceTotal } from '../../src/sim/world';
import { ensureAgricultureTile } from '../../src/sim/agriculture';

it('sorts a small mixed raw stack inside emergency eating when no recipe is possible', () => {
  const w = flatWorld();
  w.pawns = [w.pawns[0]!];
  const p = w.pawns[0]!;
  p.hunger = 8;
  p.priorities = { plants: 0, cook: 0, build: 0, haul: 0 };
  dropFood(w, { x: 3, y: 3 }, 15);
  Object.assign(w.items[0]!, { freshPoints: 13, spoiledPoints: 2, spoiled: true, spoilsAt: 0 });
  const sim = new Simulation(w);
  for (let i = 0; i < 80; i++) sim.step();
  expect(p.hunger).toBeGreaterThan(60);
  expect(resourceTotal(w, 'food')).toBe(12);
  expect(resourceTotal(w, 'waste')).toBe(2);
  expect(
    sim.diagnostics.snapshot().some((e) => e.type === 'FOOD_SEPARATED' && e.jobType === 'eat'),
  ).toBe(true);
});

it('does not start ordinary cooking with less than one reachable recipe', () => {
  const w = flatWorld();
  w.buildings.push({ id: nextId(w, 'building'), kind: 'cooking', x: 3, y: 4 });
  dropFood(w, { x: 3, y: 3 }, 48);
  const sim = new Simulation(w);
  for (let i = 0; i < 100; i++) sim.step();
  expect(w.pawns.some((p) => p.job?.kind === 'cook')).toBe(false);
  expect(w.buildings[0]!.ingredientFresh ?? 0).toBe(0);
});

it('releases a starving cook and refunds a partial recipe for emergency eating', () => {
  const w = flatWorld();
  w.pawns = [w.pawns[0]!];
  const p = w.pawns[0]!;
  p.hunger = 19;
  const b = {
    id: nextId(w, 'building'),
    kind: 'cooking' as const,
    x: 3,
    y: 3,
    ingredientFresh: 48,
    reservedBy: p.id,
  };
  w.buildings.push(b);
  p.job = {
    kind: 'cook',
    targetId: b.id,
    destination: b,
    path: [],
    phase: 'target',
    progress: 0,
    keys: [b.id],
  };
  const sim = new Simulation(w);
  for (let i = 0; i < 600; i++) sim.step();
  expect(p.hunger).toBeGreaterThan(40);
  expect(b.reservedBy).toBeUndefined();
  expect(resourceTotal(w, 'food')).toBeCloseTo(47);
  expect(
    sim.diagnostics
      .snapshot()
      .some((e) => e.type === 'JOB_INTERRUPTED' && e.reason?.includes('incomplete recipe')),
  ).toBe(true);
});

it('forages despite unreachable and reserved food instead of treating stack presence as a meal', () => {
  const w = flatWorld();
  w.pawns = [w.pawns[0]!];
  const p = w.pawns[0]!;
  p.hunger = 25;
  dropFood(w, { x: 10, y: 10 }, 1, 'meal');
  w.nodes.push({ id: nextId(w, 'node'), kind: 'berries', x: 3, y: 3, work: 0, designated: false });
  const sim = new Simulation(w);
  sim.reservations.claim([w.items[0]!.id], 'other');
  for (let i = 0; i < 150; i++) sim.step();
  expect(p.hunger).toBeGreaterThan(60);
});

it('completes emergency harvesting at zero hunger with Plants disabled', () => {
  const w = flatWorld();
  w.pawns = [w.pawns[0]!];
  const p = w.pawns[0]!;
  p.hunger = 0;
  p.priorities = { plants: 0, cook: 0, build: 0, haul: 0 };
  const key = tileKey(w, { x: 4, y: 3 });
  w.growingZones.push(key);
  ensureAgricultureTile(w, key);
  w.crops.push({ id: nextId(w, 'crop'), kind: 'potato', growth: 1, x: 4, y: 3 });
  const sim = new Simulation(w);
  for (let i = 0; i < 200; i++) sim.step();
  expect(p.hunger).toBeGreaterThan(40);
  expect(w.crops).toHaveLength(0);
  expect(sim.diagnostics.snapshot().some((e) => e.type === 'CROP_HARVEST')).toBe(true);
});

for (const resource of ['seed', 'fertilizer'] as const)
  it(`refunds carried ${resource} when critical hunger preempts agriculture`, () => {
    const w = flatWorld();
    w.pawns = [w.pawns[0]!];
    const p = w.pawns[0]!;
    p.hunger = 8;
    p.carrying = {
      resource,
      quantity: 1,
      ...(resource === 'seed' ? { seedType: 'potato' as const, spoilsAt: 10000 } : {}),
    };
    p.job = {
      kind: resource === 'seed' ? 'sow' : 'fertilize',
      destination: { x: 8, y: 8 },
      path: [],
      phase: 'target',
      progress: 0,
      keys: ['grow:104'],
    };
    dropFood(w, { x: 3, y: 3 }, 1, 'meal');
    const sim = new Simulation(w);
    w.tick = 9;
    sim.step();
    expect(p.job?.kind).toBe('eat');
    expect(p.carrying).toBeNull();
    expect(sim.reservations.owner('grow:104')).toBeUndefined();
    expect(resourceTotal(w, resource)).toBe(1);
    for (let i = 0; i < 40; i++) sim.step();
    expect(p.hunger).toBeGreaterThan(70);
  });
