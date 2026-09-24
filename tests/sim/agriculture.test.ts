import { describe, expect, it } from 'vitest';
import { flatWorld } from './fixtures';
import {
  CROPS,
  FERTILIZER_RESTORE,
  SEED_LIFETIME,
  advanceAgriculture,
  advanceSeedSpoilage,
  agricultureAt,
  applyFertilizer,
  applyWatering,
  cropStage,
  dropSeed,
  growthSuitability,
  temperatureSuitability,
} from '../../src/sim/agriculture';
import { DAY_TICKS } from '../../src/sim/definitions';
import { workCandidates } from '../../src/sim/job-board';
import { advanceJob, interruptJob } from '../../src/sim/jobs';
import { navigationGrid } from '../../src/sim/pathfinding';
import { Reservations } from '../../src/sim/reservations';
import { roomTopology } from '../../src/sim/topology';
import { checksum, decode, encode } from '../../src/persistence/serialization';
import {
  depositStack,
  dropFood,
  nextId,
  resourceTotal,
  tileKey,
  usefulResourceTotal,
} from '../../src/sim/world';
import type { CropType, World } from '../../src/sim/types';

function addZone(
  w: World,
  x = 3,
  y = 3,
  cropType: CropType = 'potato',
  growth: number | null = null,
) {
  const key = y * w.width + x;
  w.growingZones.push(key);
  w.agriculture.push({ key, cropType, moisture: 60, nutrients: 82 });
  if (growth !== null) w.crops.push({ id: `crop-${w.nextId++}`, x, y, kind: cropType, growth });
  return w.agriculture.at(-1)!;
}
function seedTotal(w: World, cropType: CropType) {
  return (
    w.items
      .filter((item) => item.resource === 'seed' && item.seedType === cropType)
      .reduce((n, item) => n + item.quantity, 0) +
    w.pawns.reduce(
      (n, pawn) =>
        n +
        (pawn.carrying?.resource === 'seed' && pawn.carrying.seedType === cropType
          ? pawn.carrying.quantity
          : 0),
      0,
    )
  );
}
function finishJob(w: World, seconds = 5) {
  const pawn = w.pawns[0]!;
  const reservations = new Reservations();
  const grid = navigationGrid(w);
  for (let i = 0; i < seconds * 10 + 10 && pawn.job; i++) advanceJob(w, pawn, reservations, grid);
}

describe('v0.8 physical seeds', () => {
  it('planting requires the selected crop seed', () => {
    const w = flatWorld();
    addZone(w, 3, 3, 'potato');
    dropSeed(w, { x: 2, y: 2 }, 'grain', 2);
    expect(workCandidates(w).some((candidate) => candidate.kind === 'sow')).toBe(false);
  });
  it('no seed means no planting job', () => {
    const w = flatWorld();
    addZone(w);
    expect(workCandidates(w).some((c) => c.kind === 'sow')).toBe(false);
  });
  it('planting consumes a seed exactly once', () => {
    const w = flatWorld();
    addZone(w);
    dropSeed(w, { x: 3, y: 3 }, 'potato', 1);
    const candidate = workCandidates(w).find((c) => c.kind === 'sow')!;
    const pawn = w.pawns[0]!;
    pawn.job = { ...candidate, path: [], phase: 'source', progress: 0 };
    finishJob(w);
    expect(w.crops).toHaveLength(1);
    expect(seedTotal(w, 'potato')).toBe(0);
    finishJob(w);
    expect(w.crops).toHaveLength(1);
  });
  it('interrupted planting preserves seed accounting', () => {
    const w = flatWorld();
    addZone(w);
    dropSeed(w, { x: 3, y: 3 }, 'potato', 3);
    const candidate = workCandidates(w).find((c) => c.kind === 'sow')!;
    const pawn = w.pawns[0]!,
      reservations = new Reservations();
    pawn.job = { ...candidate, path: [], phase: 'source', progress: 0 };
    const before = seedTotal(w, 'potato');
    advanceJob(w, pawn, reservations, navigationGrid(w));
    interruptJob(w, pawn, reservations);
    expect(seedTotal(w, 'potato')).toBe(before);
  });
  it('harvest returns replacement seed', () => {
    const w = flatWorld();
    addZone(w, 3, 3, 'potato', 1);
    const crop = w.crops[0]!,
      pawn = w.pawns[0]!;
    pawn.job = {
      kind: 'harvest',
      targetId: crop.id,
      destination: crop,
      path: [],
      phase: 'target',
      progress: 2.9,
      keys: [crop.id],
    };
    finishJob(w, 1);
    expect(seedTotal(w, 'potato')).toBe(CROPS.potato.seedYield);
  });
  it('seed stacks haul and merge only with the same species', () => {
    const w = flatWorld();
    w.stockpiles = [3 * w.width + 3];
    dropSeed(w, { x: 3, y: 3 }, 'potato', 4);
    const item = w.items[0]!;
    const originalExpiry = item.spoilsAt!;
    expect(
      depositStack(w, item, {
        resource: 'seed',
        seedType: 'potato',
        quantity: 3,
        spoilsAt: originalExpiry - 10,
      }),
    ).toBe(0);
    expect(item.quantity).toBe(7);
    expect(item.spoilsAt).toBe(originalExpiry - 10);
    expect(
      depositStack(w, item, {
        resource: 'seed',
        seedType: 'grain',
        quantity: 2,
        spoilsAt: originalExpiry,
      }),
    ).toBe(2);
  });
  it('indoor storage slows seed spoilage', () => {
    const w = flatWorld();
    dropSeed(w, { x: 3, y: 3 }, 'potato', 1);
    const seed = w.items[0]!;
    seed.spoilsAt = 150;
    w.tick = 100;
    roomTopology(w).setRoof(seed, true);
    advanceSeedSpoilage(w);
    expect(seed.spoilsAt).toBeGreaterThan(150);
  });
  it('rain exposure accelerates seed spoilage', () => {
    const w = flatWorld();
    dropSeed(w, { x: 3, y: 3 }, 'potato', 1);
    const seed = w.items[0]!;
    seed.spoilsAt = 200;
    w.tick = 100;
    w.weather = 'heavy-rain';
    w.weatherUntil = 1000;
    advanceSeedSpoilage(w);
    expect(w.items.some((item) => item.id === seed.id)).toBe(false);
  });
});

describe('crop growth and environment', () => {
  it('has deterministic lifecycle stages', () => {
    expect([0, 0.08, 0.2, 0.45, 1].map(cropStage)).toEqual([
      'seeded',
      'germinating',
      'seedling',
      'growing',
      'mature',
    ]);
  });
  it('uses multi-day growth durations', () => {
    expect(CROPS.berry.growthTicks).toBe(3 * DAY_TICKS);
    expect(CROPS.potato.growthTicks).toBe(6 * DAY_TICKS);
    expect(CROPS.grain.growthTicks).toBe(9 * DAY_TICKS);
  });
  it('grows normally with suitable moisture and nutrients', () => {
    const w = flatWorld(),
      soil = addZone(w, 3, 3, 'potato', 0);
    const before = w.crops[0]!.growth;
    advanceAgriculture(w, 10);
    expect(w.crops[0]!.growth).toBeGreaterThan(before);
    expect(growthSuitability(CROPS.potato, soil).effective).toBeGreaterThan(0.9);
  });
  it('severe dryness stops growth', () => {
    const w = flatWorld(),
      soil = addZone(w, 3, 3, 'potato', 0.3);
    soil.moisture = 5;
    const before = w.crops[0]!.growth;
    advanceAgriculture(w, 100);
    expect(w.crops[0]!.growth).toBe(before);
  });
  it('excessive moisture stops growth outside tolerance', () => {
    const w = flatWorld(),
      soil = addZone(w, 3, 3, 'grain', 0.3);
    soil.moisture = 100;
    const before = w.crops[0]!.growth;
    advanceAgriculture(w, 100);
    expect(w.crops[0]!.growth).toBe(before);
  });
  it('nutrient deficiency stops growth', () => {
    const w = flatWorld(),
      soil = addZone(w, 3, 3, 'grain', 0.3);
    soil.moisture = 50;
    soil.nutrients = 0;
    const before = w.crops[0]!.growth;
    advanceAgriculture(w, 100);
    expect(w.crops[0]!.growth).toBe(before);
  });
  it('keeps temperature neutral until an authoritative temperature exists', () => {
    for (const def of Object.values(CROPS)) expect(temperatureSuitability(def)).toBe(1);
  });
});

describe('soil moisture', () => {
  it('rain increases exposed soil moisture', () => {
    const w = flatWorld(),
      soil = addZone(w);
    w.weather = 'rain';
    w.weatherUntil = 1000;
    soil.moisture = 40;
    advanceAgriculture(w, 100);
    expect(soil.moisture).toBeGreaterThan(40);
  });
  it('heavy rain raises moisture faster than normal rain', () => {
    const a = flatWorld(),
      b = flatWorld(),
      sa = addZone(a),
      sb = addZone(b);
    sa.moisture = sb.moisture = 40;
    a.weather = 'rain';
    b.weather = 'heavy-rain';
    a.weatherUntil = b.weatherUntil = 1000;
    advanceAgriculture(a, 100);
    advanceAgriculture(b, 100);
    expect(sb.moisture).toBeGreaterThan(sa.moisture);
  });
  it('roofed soil does not receive rainfall', () => {
    const w = flatWorld(),
      soil = addZone(w);
    soil.moisture = 40;
    w.weather = 'rain';
    w.weatherUntil = 1000;
    roomTopology(w).setRoof({ x: 3, y: 3 }, true);
    advanceAgriculture(w, 100);
    expect(soil.moisture).toBeLessThan(40);
  });
  it('clear weather evaporates soil moisture', () => {
    const w = flatWorld(),
      soil = addZone(w);
    const before = soil.moisture;
    advanceAgriculture(w, 100);
    expect(soil.moisture).toBeLessThan(before);
  });
  it('crop growth consumes moisture', () => {
    const w = flatWorld(),
      soil = addZone(w, 3, 3, 'potato', 0);
    const control = flatWorld(),
      bare = addZone(control);
    advanceAgriculture(w, 1000);
    advanceAgriculture(control, 1000);
    expect(soil.moisture).toBeLessThan(bare.moisture);
  });
  it('manual watering increases moisture', () => {
    const w = flatWorld(),
      soil = addZone(w, 3, 3, 'potato', 0.2);
    soil.moisture = 25;
    expect(applyWatering(w, { x: 3, y: 3 })).toBe(1);
    expect(soil.moisture).toBeGreaterThan(25);
  });
  it('batches adjacent watering into one candidate', () => {
    const w = flatWorld();
    w.terrain[8 * w.width + 8] = 'water';
    for (const x of [3, 4, 5]) {
      const soil = addZone(w, x, 3, 'potato', 0.2);
      soil.moisture = 25;
    }
    expect(workCandidates(w).filter((candidate) => candidate.kind === 'water')).toHaveLength(1);
  });
});

describe('soil nutrients and fertilizer', () => {
  it('growth depletes nutrients', () => {
    const w = flatWorld(),
      soil = addZone(w, 3, 3, 'grain', 0);
    soil.moisture = 50;
    const before = soil.nutrients;
    advanceAgriculture(w, 1000);
    expect(soil.nutrients).toBeLessThan(before);
  });
  it('fertilizer restores a predictable amount', () => {
    const w = flatWorld(),
      soil = addZone(w);
    soil.nutrients = 10;
    applyFertilizer(w, { x: 3, y: 3 });
    expect(soil.nutrients).toBe(10 + FERTILIZER_RESTORE);
  });
  it('fertilizer is consumed once', () => {
    const w = flatWorld(),
      soil = addZone(w, 3, 3, 'potato', 0.2);
    soil.nutrients = 10;
    const pawn = w.pawns[0]!;
    pawn.carrying = { resource: 'fertilizer', quantity: 1 };
    pawn.job = {
      kind: 'fertilize',
      targetId: `zone:${soil.key}`,
      destination: { x: 3, y: 3 },
      path: [],
      phase: 'target',
      progress: 1.4,
      keys: [`grow:${soil.key}`],
    };
    finishJob(w, 1);
    expect(resourceTotal(w, 'fertilizer')).toBe(0);
    expect(soil.nutrients).toBe(50);
  });
  it('interrupted fertilizing preserves fertilizer accounting', () => {
    const w = flatWorld(),
      soil = addZone(w, 3, 3, 'potato', 0.2);
    soil.nutrients = 10;
    w.items.push({ id: `item-${w.nextId++}`, x: 3, y: 3, resource: 'fertilizer', quantity: 3 });
    const candidate = workCandidates(w).find((c) => c.kind === 'fertilize')!;
    const pawn = w.pawns[0]!,
      reservations = new Reservations();
    pawn.job = { ...candidate, path: [], phase: 'source', progress: 0 };
    const before = resourceTotal(w, 'fertilizer');
    advanceJob(w, pawn, reservations, navigationGrid(w));
    interruptJob(w, pawn, reservations);
    expect(resourceTotal(w, 'fertilizer')).toBe(before);
  });
});

describe('harvest, replanting and wild acquisition', () => {
  it('harvest fires exactly once and reconciles outputs', () => {
    const w = flatWorld();
    addZone(w, 3, 3, 'grain', 1);
    const crop = w.crops[0]!,
      pawn = w.pawns[0]!;
    pawn.job = {
      kind: 'harvest',
      targetId: crop.id,
      destination: crop,
      path: [],
      phase: 'target',
      progress: 2.9,
      keys: [crop.id],
    };
    finishJob(w, 1);
    expect(w.crops).toHaveLength(0);
    expect(usefulResourceTotal(w, 'food')).toBe(CROPS.grain.foodYield);
    expect(seedTotal(w, 'grain')).toBe(CROPS.grain.seedYield);
    const food = usefulResourceTotal(w, 'food'),
      seeds = seedTotal(w, 'grain');
    finishJob(w, 1);
    expect(usefulResourceTotal(w, 'food')).toBe(food);
    expect(seedTotal(w, 'grain')).toBe(seeds);
  });
  it('replanting requires another physical seed', () => {
    const w = flatWorld();
    addZone(w);
    expect(workCandidates(w).some((c) => c.kind === 'sow')).toBe(false);
    dropSeed(w, { x: 2, y: 2 }, 'potato', 1);
    expect(workCandidates(w).some((c) => c.kind === 'sow')).toBe(true);
  });
  it('wild berries produce berry seed', () => {
    const w = flatWorld();
    w.nodes.push({
      id: `node-${w.nextId++}`,
      x: 3,
      y: 3,
      kind: 'berries',
      designated: true,
      work: 2.99,
    });
    const node = w.nodes[0]!,
      pawn = w.pawns[0]!;
    pawn.job = {
      kind: 'gather',
      targetId: node.id,
      destination: node,
      path: [],
      phase: 'target',
      progress: 0,
      keys: [node.id],
    };
    finishJob(w, 1);
    expect(seedTotal(w, 'berry')).toBe(1);
  });
  it('wild berry seed becomes valid cultivated input', () => {
    const w = flatWorld();
    addZone(w, 3, 3, 'berry');
    dropSeed(w, { x: 2, y: 2 }, 'berry', 1);
    expect(workCandidates(w).find((c) => c.kind === 'sow')?.sourceId).toBeTruthy();
  });
});

describe('save compatibility and accounting', () => {
  it('migrates a schema 5 colony without duplicating supplies and remains stable in schema 6', () => {
    const w = flatWorld();
    addZone(w, 3, 3, 'grain', 0.5);
    w.growingZones.push(3 * w.width + 4);
    dropFood(w, { x: 2, y: 2 }, 123);
    for (let y = 6; y <= 8; y++)
      for (let x = 6; x <= 8; x++)
        if (x !== 7 || y !== 7) w.buildings.push({ id: nextId(w, 'building'), x, y, kind: 'wall' });
    w.weather = 'heavy-rain';
    w.weatherUntil = 10000;
    w.pawns[0]!.wetness = 45;
    const rooms = roomTopology(w).summary();
    const { agriculture: _, ...legacy } = w;
    const payload = JSON.stringify(legacy);
    const envelope = { version: 5 as const, savedAt: 1, payload, checksum: checksum(payload) };
    const loaded = decode(envelope).world;
    expect(loaded.crops).toEqual(w.crops);
    expect(loaded.agriculture).toHaveLength(2);
    expect(loaded.agriculture.every((soil) => soil.moisture === 60 && soil.nutrients === 82)).toBe(
      true,
    );
    expect(loaded.items.filter((item) => item.resource !== 'seed')).toEqual(w.items);
    expect(seedTotal(loaded, 'grain')).toBe(6);
    expect(roomTopology(loaded).summary()).toEqual(rooms);
    expect(loaded.weather).toBe(w.weather);
    expect(loaded.weatherUntil).toBe(w.weatherUntil);
    expect(loaded.pawns[0]!.wetness).toBe(45);
    expect(decode(envelope).world).toEqual(loaded);
    const reloaded = decode(encode(loaded)).world;
    expect(reloaded).toEqual(loaded);
    expect(seedTotal(reloaded, 'grain')).toBe(6);
  });
  it('does not add recovery seeds when a legacy colony already has seed stock', () => {
    const w = flatWorld();
    dropSeed(w, { x: 2, y: 2 }, 'grain', 2);
    expect(decode({ ...encode(w), version: 5 }).world.items).toEqual(w.items);
  });
  it('schema 6 roundtrips persistent agriculture and seed state', () => {
    const w = flatWorld();
    addZone(w, 3, 3, 'potato', 0.43);
    dropSeed(w, { x: 2, y: 2 }, 'potato', 3);
    const saved = encode(w);
    expect(saved.version).toBe(6);
    const loaded = decode(saved).world;
    expect(loaded.agriculture[0]!.cropType).toBe('potato');
    expect(loaded.crops[0]!.growth).toBe(0.43);
    expect(seedTotal(loaded, 'potato')).toBe(3);
  });
  it('migrates schema 5 grain crops, initializes soil and provides a recovery seed cache', () => {
    const w: any = flatWorld();
    const key = 3 * w.width + 3;
    w.growingZones = [key];
    w.crops = [{ id: `crop-${w.nextId++}`, x: 3, y: 3, kind: 'grain', growth: 0.5 }];
    delete w.agriculture;
    const payload = JSON.stringify(w);
    const loaded = decode({ version: 5, savedAt: 1, payload, checksum: checksum(payload) }).world;
    expect(agricultureAt(loaded, key)?.cropType).toBe('grain');
    expect(seedTotal(loaded, 'grain')).toBeGreaterThanOrEqual(6);
  });
  it('uses multiplicative constraints so excellent nutrients cannot overcome no water', () => {
    expect(
      growthSuitability(CROPS.potato, { key: 1, cropType: 'potato', moisture: 0, nutrients: 100 })
        .effective,
    ).toBe(0);
  });
  it('gives seeds a conventional long expiry rather than viability percentages', () => {
    expect(SEED_LIFETIME).toBe(24 * DAY_TICKS);
  });
});
