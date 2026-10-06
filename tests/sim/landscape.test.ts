import { describe, expect, it } from 'vitest';
import { checksum, decode, encode } from '../../src/persistence/serialization';
import { generateWorld } from '../../src/sim/generate';
import { nearestWaterDistance } from '../../src/sim/landscape';

describe('procedural landscapes', () => {
  it('selects five recognizable landform families deterministically', () => {
    const worlds = Array.from({ length: 5 }, (_, seed) => generateWorld(seed));
    expect(new Set(worlds.map((world) => world.landscape.kind)).size).toBe(5);
    expect(generateWorld(3)).toEqual(generateWorld(3));
    expect(new Set(worlds.map((world) => world.terrain.join(','))).size).toBe(5);
  });

  it('keeps every start viable while varying the surrounding terrain', () => {
    for (let seed = 0; seed < 25; seed++) {
      const world = generateWorld(seed);
      const water = world.terrain.filter((terrain) => terrain === 'water').length;
      const saline = new Set(world.waterSalinity.map((entry) => entry.key));
      const freshWater = world.terrain.some(
        (terrain, key) => terrain === 'water' && !saline.has(key),
      );
      const nearestFreshWater = world.terrain.reduce(
        (nearest, terrain, key) =>
          terrain === 'water' && !saline.has(key)
            ? Math.min(
                nearest,
                Math.abs((key % world.width) - 40) + Math.abs(Math.floor(key / world.width) - 40),
              )
            : nearest,
        Infinity,
      );
      expect(water / world.terrain.length).toBeGreaterThan(0.005);
      expect(water / world.terrain.length).toBeLessThan(0.3);
      expect(freshWater).toBe(true);
      expect(nearestFreshWater).toBeLessThanOrEqual(35);
      expect(world.waterSalinity.some((entry) => entry.salinity === 32)).toBe(true);
      expect(nearestWaterDistance(world, { x: 40, y: 40 })).toBeLessThanOrEqual(35);
      for (let y = 34; y <= 46; y++)
        for (let x = 34; x <= 46; x++)
          if (Math.hypot(x - 40, y - 40) < 6)
            expect(world.terrain[y * world.width + x]).not.toBe('water');
      expect(world.waterSalinity.every((entry) => world.terrain[entry.key] === 'water')).toBe(true);
    }
  });

  it('places resources according to habitat while preserving onboarding supplies', () => {
    let rockTiles = 0,
      otherTiles = 0,
      rockStones = 0,
      otherStones = 0;
    for (let seed = 10; seed < 30; seed++) {
      const world = generateWorld(seed);
      for (const terrain of world.terrain)
        if (terrain === 'rock') rockTiles++;
        else if (terrain !== 'water') otherTiles++;
      for (const node of world.nodes)
        if (node.kind === 'stone') {
          if (world.terrain[node.y * world.width + node.x] === 'rock') rockStones++;
          else otherStones++;
        }
      expect(world.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ x: 34, y: 38, kind: 'tree', designated: true }),
          expect.objectContaining({ x: 34, y: 41, kind: 'tree', designated: true }),
          expect.objectContaining({ x: 35, y: 44, kind: 'berries' }),
          expect.objectContaining({ x: 44, y: 45, kind: 'stone' }),
        ]),
      );
    }
    expect(rockStones / rockTiles).toBeGreaterThan(otherStones / otherTiles);
  });

  it('round-trips landscape identity and migrates older saves', () => {
    const world = generateWorld(4);
    expect(decode(encode(world)).world.landscape).toEqual(world.landscape);

    const envelope = encode(world);
    const legacy = JSON.parse(envelope.payload);
    delete legacy.landscape;
    const payload = JSON.stringify(legacy);
    const loaded = decode({ ...envelope, payload, checksum: checksum(payload) }).world;
    expect(loaded.landscape).toMatchObject({
      kind: 'river-valley',
      name: 'Legacy woodland',
    });
  });
});
