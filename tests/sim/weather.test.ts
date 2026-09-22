import { describe, expect, it } from 'vitest';
import { flatWorld } from './fixtures';
import {
  WEATHER,
  advanceWeather,
  updateWetness,
  wetnessBand,
  isRainExposed,
  rainSpoilageMultiplier,
  exposedFieldWorkMultiplier,
  weatherSnapshot,
  wetnessMoodPenalty,
} from '../../src/sim/weather';
import { roomTopology } from '../../src/sim/topology';
import { nextId, drop, advanceFoodSpoilage } from '../../src/sim/world';
import { checksum, decode, encode, validateWorld } from '../../src/persistence/serialization';
import { Simulation } from '../../src/sim/simulation';
import { DiagnosticLog, buildDebugReport } from '../../src/sim/diagnostics';
import { updateNeeds } from '../../src/sim/needs';
import { advanceJob } from '../../src/sim/jobs';
import { navigationGrid } from '../../src/sim/pathfinding';
import type { WeatherKind, World } from '../../src/sim/types';

function indoors(w: World) {
  for (let x = 1; x <= 5; x++)
    for (let y = 1; y <= 5; y++)
      if (x === 1 || x === 5 || y === 1 || y === 5)
        w.buildings.push({
          id: nextId(w, 'building'),
          x,
          y,
          kind: x === 3 && y === 1 ? 'door' : 'wall',
        });
  roomTopology(w).invalidate('test enclosure');
}
function setup(weather: WeatherKind = 'rain') {
  const w = flatWorld();
  w.weather = weather;
  w.weatherUntil = 10000;
  const pawn = w.pawns[0]!;
  pawn.x = pawn.y = 3;
  return { w, pawn, topology: roomTopology(w) };
}

describe('rain exposure and wetness', () => {
  it.each(['clear', 'rain', 'heavy-rain', 'storm'] as const)(
    '%s gains wetness only at its defined exposed rate',
    (kind) => {
      const { w, pawn } = setup(kind);
      updateWetness(w, pawn, 10);
      expect(pawn.wetness).toBeCloseTo(4.5 * WEATHER[kind].precipitation);
      expect(isRainExposed(w, pawn)).toBe(kind !== 'clear');
    },
  );
  it.each(['outdoor roof', 'indoors'])(
    '%s prevents wetness while the world rains',
    (protection) => {
      const { w, pawn, topology } = setup('storm');
      if (protection === 'indoors') indoors(w);
      else topology.setRoof(pawn, true);
      updateWetness(w, pawn, 60);
      expect(pawn.wetness).toBe(0);
      expect(isRainExposed(w, pawn)).toBe(false);
      expect(topology.isIndoors(pawn)).toBe(protection === 'indoors');
    },
  );
  it('dries in shelter and after clear weather; entering shelter does not instantly remove wetness', () => {
    const { w, pawn, topology } = setup();
    pawn.wetness = 80;
    topology.setRoof(pawn, true);
    updateWetness(w, pawn, 10);
    expect(pawn.wetness).toBeCloseTo(74);
    topology.setRoof(pawn, undefined);
    w.weather = 'clear';
    updateWetness(w, pawn, 10);
    expect(pawn.wetness).toBeCloseTo(70.5);
    indoors(w);
    updateWetness(w, pawn, 10);
    expect(pawn.wetness).toBeCloseTo(62.5);
  });
  it('a pawn moving into a completed room switches from wetting to drying', () => {
    const { w, pawn } = setup();
    indoors(w);
    pawn.x = 8;
    updateWetness(w, pawn, 30);
    const wet = pawn.wetness!;
    pawn.x = 3;
    updateWetness(w, pawn, 5);
    expect(pawn.wetness).toBeCloseTo(wet - 4);
  });
  it('clamps wetness and never reverses time for a negative update duration', () => {
    const { w, pawn } = setup('storm');
    updateWetness(w, pawn, 10000);
    expect(pawn.wetness).toBe(100);
    w.weather = 'clear';
    updateWetness(w, pawn, -10);
    expect(pawn.wetness).toBe(100);
    updateWetness(w, pawn, 10000);
    expect(pawn.wetness).toBe(0);
  });
  it.each([
    [0, 'Dry'],
    [0.99, 'Dry'],
    [1, 'Damp'],
    [39.99, 'Damp'],
    [40, 'Wet'],
    [74.99, 'Wet'],
    [75, 'Soaked'],
    [100, 'Soaked'],
  ] as const)('classifies wetness %s as %s', (value, expected) =>
    expect(wetnessBand(value)).toBe(expected),
  );
  it('uses the existing mood system for modest discomfort without changing health or adding a speed multiplier', () => {
    const { w, pawn } = setup();
    const dry = structuredClone(pawn),
      wet = structuredClone(pawn),
      soaked = structuredClone(pawn);
    wet.wetness = 50;
    soaked.wetness = 90;
    updateNeeds(w, dry);
    updateNeeds(w, wet);
    updateNeeds(w, soaked);
    expect(wet.mood).toBe(dry.mood - 2);
    expect(soaked.mood).toBe(dry.mood - 4);
    expect(soaked.health).toBe(dry.health);
    expect(soaked.productivity).toBe(dry.productivity);
    expect(wetnessMoodPenalty({ ...pawn, wetness: 20 })).toBe(0);
  });
  it('updates once per simulated second', () => {
    const { w, pawn } = setup();
    pawn.job = {
      kind: 'move',
      path: [],
      destination: pawn,
      progress: 0,
      phase: 'target',
      keys: [],
    };
    const sim = new Simulation(w);
    for (const p of w.pawns) p.priorities = { plants: 0, haul: 0, build: 0, cook: 0 };
    for (let i = 0; i < 9; i++) sim.step();
    expect(pawn.wetness).toBe(0);
    sim.step();
    expect(pawn.wetness).toBeCloseTo(0.45);
  });
  it('keeps indoor and roofed colonists dry while an outdoor colonist gets soaked, then dries indoors', () => {
    const { w, topology } = setup('storm');
    indoors(w);
    const [indoor, roofed, outside] = w.pawns;
    Object.assign(indoor!, { x: 3, y: 3 });
    Object.assign(roofed!, { x: 8, y: 8 });
    Object.assign(outside!, { x: 9, y: 9 });
    topology.setRoof(roofed!, true);
    for (const p of w.pawns) p.priorities = { plants: 0, haul: 0, build: 0, cook: 0 };
    const sim = new Simulation(w);
    for (let i = 0; i < 600; i++) sim.step();
    expect(indoor!.wetness).toBe(0);
    expect(roofed!.wetness).toBe(0);
    expect(outside!.wetness).toBeCloseTo(81);
    Object.assign(outside!, { x: 3, y: 3 });
    for (let i = 0; i < 100; i++) sim.step();
    expect(outside!.wetness).toBeCloseTo(73);
  });
  it('door passage preserves roofs, breach changes exposure, repair restores it', () => {
    const { w, pawn, topology } = setup();
    indoors(w);
    expect(isRainExposed(w, pawn)).toBe(false);
    // Doors always allow pawn passage; there is no persistent open/closed flag.
    expect(navigationGrid(w)[1 * w.width + 3]).toBe(1);
    expect(isRainExposed(w, pawn)).toBe(false);
    const wall = w.buildings.find((b) => b.x === 1 && b.y === 3)!;
    w.buildings = w.buildings.filter((b) => b !== wall);
    topology.invalidate('breach');
    expect(isRainExposed(w, pawn)).toBe(true);
    w.buildings.push(wall);
    topology.invalidate('repair');
    expect(isRainExposed(w, pawn)).toBe(false);
  });
});

describe('weather persistence and transitions', () => {
  it('holds each period until its deadline and makes deterministic, bounded transitions', () => {
    const a = setup().w,
      b = structuredClone(a);
    const seen = new Set<WeatherKind>(),
      counts = { clear: 0, rain: 0, 'heavy-rain': 0, storm: 0 };
    for (let i = 0; i < 500; i++) {
      a.tick = a.weatherUntil - 1;
      const before = weatherSnapshot(a);
      advanceWeather(a);
      expect(weatherSnapshot(a)).toEqual(before);
      a.tick++;
      b.tick = a.tick;
      advanceWeather(a);
      advanceWeather(b);
      expect(weatherSnapshot(a)).toEqual(weatherSnapshot(b));
      const duration = a.weatherUntil - a.tick,
        bounds = WEATHER[a.weather].duration;
      expect(duration).toBeGreaterThanOrEqual(bounds[0]);
      expect(duration).toBeLessThanOrEqual(bounds[1]);
      expect(duration).toBeGreaterThanOrEqual(600);
      expect(a.weatherStartedAt).toBe(a.tick);
      seen.add(a.weather);
      counts[a.weather]++;
    }
    expect(seen.size).toBe(4);
    expect(counts.clear).toBeGreaterThan(counts.storm);
    expect(counts.rain).toBeGreaterThan(counts.storm);
  });
  it('different seeds yield different weather sequences', () => {
    const sequence = (seed: number) => {
      const w = setup().w;
      w.seed = seed;
      return Array.from({ length: 10 }, () => {
        w.tick = w.weatherUntil;
        advanceWeather(w);
        return weatherSnapshot(w);
      });
    };
    expect(sequence(1)).not.toEqual(sequence(2));
  });
  it.each(['rain', 'storm'] as const)(
    'schema 5 roundtrip preserves %s, wetness and the next transition',
    (kind) => {
      const { w, pawn } = setup(kind);
      w.tick = 320;
      w.weatherStartedAt = 100;
      pawn.wetness = 63.25;
      const saved = encode(w),
        loaded = decode(saved).world;
      expect(saved.version).toBe(5);
      expect(weatherSnapshot(loaded)).toEqual(weatherSnapshot(w));
      expect(loaded.pawns[0]!.wetness).toBe(63.25);
      loaded.tick = w.tick = w.weatherUntil;
      advanceWeather(w);
      advanceWeather(loaded);
      expect(weatherSnapshot(loaded)).toEqual(weatherSnapshot(w));
    },
  );
  it('old schema 5 fields default without rewriting valid existing weather timers', () => {
    const { w } = setup('heavy-rain');
    w.tick = 200;
    delete w.weatherStartedAt;
    for (const pawn of w.pawns) delete pawn.wetness;
    const loaded = decode(encode(w)).world;
    expect(loaded.weather).toBe('heavy-rain');
    expect(loaded.weatherUntil).toBe(10000);
    expect(loaded.weatherStartedAt).toBe(200);
    expect(loaded.pawns.every((p) => p.wetness === 0)).toBe(true);
    expect(() => validateWorld(loaded)).not.toThrow();
  });
  it('defaults missing legacy weather, but rejects malformed present wetness/timers', () => {
    const w = setup().w,
      save = encode(w),
      raw = JSON.parse(save.payload);
    delete raw.weather;
    delete raw.weatherUntil;
    delete raw.weatherStartedAt;
    const payload = JSON.stringify(raw);
    const loaded = decode({ ...save, payload, checksum: checksum(payload) }).world;
    expect(loaded.weather).toBe('clear');
    expect(loaded.weatherUntil).toBe(1800);
    for (const wetness of [-1, 101, NaN, 'Wet']) {
      (w.pawns[0] as any).wetness = wetness;
      expect(() => validateWorld(w)).toThrow('Invalid wetness');
    }
    w.pawns[0]!.wetness = 0;
    w.weatherStartedAt = w.tick + 1;
    expect(() => validateWorld(w)).toThrow('Invalid weather');
  });
});

describe('weather gameplay and diagnostics', () => {
  it.each(['rain', 'heavy-rain', 'storm'] as const)(
    '%s applies spoilage only to exposed raw food',
    (kind) => {
      function loss(protection: 'none' | 'roof' | 'indoors') {
        const { w, pawn, topology } = setup(kind);
        if (protection === 'roof') topology.setRoof(pawn, true);
        if (protection === 'indoors') indoors(w);
        w.stockpiles = [pawn.y * w.width + pawn.x];
        drop(w, pawn, 'food', 100);
        advanceFoodSpoilage(w, w.items[0]!);
        return 100 - w.items[0]!.freshPoints!;
      }
      expect(loss('none') / loss('roof')).toBeCloseTo(WEATHER[kind].spoilage);
      expect(loss('indoors') / loss('roof')).toBeCloseTo(0.78);
    },
  );
  it('transient buffers, carried food, meals and waste keep their existing decay rules', () => {
    const { w, pawn } = setup('storm');
    pawn.carrying = { resource: 'food', foodType: 'raw', quantity: 50, freshPoints: 50 };
    w.buildings.push({
      id: nextId(w, 'building'),
      kind: 'cooking',
      x: 4,
      y: 4,
      ingredientFresh: 50,
    });
    drop(w, pawn, 'food', 1, 'meal');
    const meal = structuredClone(w.items[0]!);
    w.items.push({ id: nextId(w, 'item'), x: 5, y: 5, resource: 'waste', quantity: 10 });
    for (const item of w.items) advanceFoodSpoilage(w, item);
    expect(w.items[0]).toEqual(meal);
    expect(w.items[1]!.quantity).toBe(10);
    expect(pawn.carrying.freshPoints).toBe(50);
    expect(w.buildings[0]!.ingredientFresh).toBe(50);
    // Once placed on the ground, raw food is subject to that tile's exposure.
    drop(w, pawn, 'food', 50);
    const dropped = w.items.at(-1)!;
    advanceFoodSpoilage(w, dropped);
    expect(dropped.freshPoints).toBeLessThan(50);
  });
  it.each(['clear', 'rain', 'heavy-rain', 'storm'] as const)(
    '%s has one exposed field-work modifier; shelter avoids it',
    (kind) => {
      const { w, pawn, topology } = setup(kind);
      expect(exposedFieldWorkMultiplier(w, pawn)).toBe(WEATHER[kind].fieldWork);
      expect(rainSpoilageMultiplier(w, pawn)).toBe(WEATHER[kind].spoilage);
      topology.setRoof(pawn, true);
      expect(exposedFieldWorkMultiplier(w, pawn)).toBe(1);
      expect(rainSpoilageMultiplier(w, pawn)).toBe(1);
    },
  );
  it('exposure penalties reach actual gathering work, with no global penalty for a sheltered pawn', () => {
    function work(roofed: boolean) {
      const { w, pawn, topology } = setup('storm');
      topology.setRoof(pawn, roofed);
      const node = {
        id: nextId(w, 'node'),
        x: 4,
        y: 3,
        kind: 'berries' as const,
        work: 0,
        designated: true,
      };
      w.nodes.push(node);
      const sim = new Simulation(w);
      pawn.job = {
        kind: 'gather',
        targetId: node.id,
        destination: node,
        path: [],
        progress: 0,
        phase: 'target',
        keys: [],
      };
      advanceJob(w, pawn, sim.reservations, navigationGrid(w));
      return node.work;
    }
    expect(work(false) / work(true)).toBeCloseTo(0.6);
  });
  it('logs thresholds/exposure changes, not every wetness update, and exports coherent state', () => {
    const { w, pawn, topology } = setup();
    const log = new DiagnosticLog();
    for (let i = 0; i < 200; i++) updateWetness(w, pawn, 1, log);
    expect(log.snapshot().filter((e) => e.type === 'WETNESS_BAND_CHANGED')).toHaveLength(3);
    topology.setRoof(pawn, true);
    updateWetness(w, pawn, 1, log);
    expect(log.snapshot().filter((e) => e.type === 'RAIN_EXPOSURE_CHANGED')).toHaveLength(1);
    const sim = new Simulation(w),
      report = buildDebugReport(w, sim.reservations, log, {}, 1);
    expect(report.simulation.weatherState.kind).toBe('rain');
    expect(report.colonists[0]!.rainExposed).toBe(false);
    expect(report.colonists[0]!.wetnessBand).toBe('Soaked');
    w.tick = w.weatherUntil;
    advanceWeather(w, log);
    expect(log.snapshot().at(-1)!.type).toBe('WEATHER_TRANSITION');
  });
});
