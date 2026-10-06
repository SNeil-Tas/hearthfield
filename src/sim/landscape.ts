import { BRACKISH_WATER_SALINITY, SALTWATER_SALINITY } from './agriculture';
import type { Landscape, LandscapeKind, NodeKind, Point, Terrain, World } from './types';
import { nextId } from './world';

interface LandscapeDefinition {
  name: string;
  description: string;
  rockBias: number;
  fertilityBias: number;
  forestBias: number;
}

export const LANDSCAPES: Record<LandscapeKind, LandscapeDefinition> = {
  'river-valley': {
    name: 'River valley',
    description: 'A broad green valley beside a winding river and tidal mouth.',
    rockBias: -0.05,
    fertilityBias: 0.12,
    forestBias: 0,
  },
  'twin-lakes': {
    name: 'Twin lakes',
    description: 'Two distinct watersheds joined by low, fertile country.',
    rockBias: 0,
    fertilityBias: 0.08,
    forestBias: 0.02,
  },
  'marsh-edge': {
    name: 'Marsh edge',
    description: 'Rich wet ground gives way to brackish pools and a salt coast.',
    rockBias: -0.12,
    fertilityBias: 0.2,
    forestBias: -0.015,
  },
  'highland-creek': {
    name: 'Highland creek',
    description: 'Rocky uplands are cut by a narrow creek descending to the lowlands.',
    rockBias: 0.16,
    fertilityBias: -0.05,
    forestBias: -0.01,
  },
  'wooded-basin': {
    name: 'Wooded basin',
    description: 'Dense woodland surrounds a sheltered basin, spring, and reed lake.',
    rockBias: 0.03,
    fertilityBias: 0.04,
    forestBias: 0.035,
  },
};

const kinds = Object.keys(LANDSCAPES) as LandscapeKind[];
const smooth = (value: number) => value * value * (3 - 2 * value);
const lerp = (a: number, b: number, amount: number) => a + (b - a) * amount;

function hash(seed: number, x: number, y: number) {
  let value = (seed ^ Math.imul(x, 0x1f123bb5) ^ Math.imul(y, 0x5f356495)) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x2c1b3c6d);
  value ^= value >>> 12;
  return (value >>> 0) / 4294967296;
}

function valueNoise(seed: number, x: number, y: number, scale: number) {
  const gx = Math.floor(x / scale),
    gy = Math.floor(y / scale),
    tx = smooth(x / scale - gx),
    ty = smooth(y / scale - gy);
  return lerp(
    lerp(hash(seed, gx, gy), hash(seed, gx + 1, gy), tx),
    lerp(hash(seed, gx, gy + 1), hash(seed, gx + 1, gy + 1), tx),
    ty,
  );
}

export function layeredNoise(seed: number, x: number, y: number) {
  return (
    valueNoise(seed, x, y, 30) * 0.5 +
    valueNoise(seed ^ 0x9e3779b9, x, y, 14) * 0.32 +
    valueNoise(seed ^ 0x85ebca6b, x, y, 6) * 0.18
  );
}

function ellipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number) {
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
}

function waterAt(
  kind: LandscapeKind,
  seed: number,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const warp = (layeredNoise(seed ^ 0x51f15e, x, y) - 0.5) * 8;
  if (kind === 'river-valley') {
    const center = width * 0.72 + Math.sin(y / 9 + (seed % 17)) * 4 + warp * 0.35;
    return y > 4 && y < height - 3 && Math.abs(x - center) < 1.25 + valueNoise(seed, 0, y, 11);
  }
  if (kind === 'twin-lakes') {
    const lakeA = ellipse(x, y, width * 0.76 + warp * 0.15, height * 0.25, 8.5, 6.2) < 1;
    const lakeB = ellipse(x, y, width * 0.23, height * 0.73 + warp * 0.12, 7.2, 9.2) < 1;
    const outlet = y > height * 0.7 && Math.abs(x - (width * 0.23 + Math.sin(y / 5) * 2)) < 1;
    return lakeA || lakeB || outlet;
  }
  if (kind === 'marsh-edge') {
    const coast = width * 0.79 + Math.sin(y / 7 + seed) * 3 + warp * 0.45;
    const pool = x > width * 0.63 && layeredNoise(seed ^ 0xba5eba11, x, y) > 0.61;
    const spring = ellipse(x, y, width * 0.26, height * 0.3, 4.3, 3.6) < 1;
    return x > coast || pool || spring;
  }
  if (kind === 'highland-creek') {
    const creek = width * 0.2 + y * 0.56 + Math.sin(y / 6 + seed) * 2.5 + warp * 0.22;
    const tarn = ellipse(x, y, width * 0.22, height * 0.18, 5.5, 4.2) < 1;
    return tarn || (y > height * 0.14 && Math.abs(x - creek) < 0.9);
  }
  const spring = ellipse(x, y, width * 0.25, height * 0.28, 4.5, 3.8) < 1;
  const basin = ellipse(x, y, width * 0.76 + warp * 0.15, height * 0.72, 9.5, 7.5) < 1;
  const runnel =
    x > width * 0.72 &&
    y > height * 0.7 &&
    Math.abs(y - (height * 0.72 + Math.sin(x / 4) * 2)) < 0.8;
  return spring || basin || runnel;
}

function waterSalinity(kind: LandscapeKind, x: number, y: number, width: number, height: number) {
  if (kind === 'marsh-edge') {
    if (ellipse(x, y, width * 0.26, height * 0.3, 4.8, 4.1) < 1) return 0;
    if (x > width * 0.9) return SALTWATER_SALINITY;
    return BRACKISH_WATER_SALINITY;
  }
  if (kind === 'twin-lakes') {
    if (y > height * 0.83) return SALTWATER_SALINITY;
    if (y > height * 0.62 && x < width * 0.4) return BRACKISH_WATER_SALINITY;
    return 0;
  }
  if (kind === 'wooded-basin') {
    if (x > width * 0.7 && y > height * 0.64) return BRACKISH_WATER_SALINITY;
    return 0;
  }
  if (y > height * 0.86) return SALTWATER_SALINITY;
  if (y > height * 0.68) return BRACKISH_WATER_SALINITY;
  return 0;
}

export function generateLandscape(world: World): Landscape {
  const kind = kinds[world.seed % kinds.length]!;
  const def = LANDSCAPES[kind];
  world.terrain = [];
  world.waterSalinity = [];
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) {
      const key = y * world.width + x;
      const clearing = Math.hypot(x - world.width / 2, y - world.height / 2) < 7;
      if (!clearing && waterAt(kind, world.seed, x, y, world.width, world.height)) {
        world.terrain.push('water');
        const salinity = waterSalinity(kind, x, y, world.width, world.height);
        if (salinity > 0) world.waterSalinity.push({ key, salinity });
        continue;
      }
      const elevation = layeredNoise(world.seed ^ 0xe1e7a710, x, y);
      const moisture = layeredNoise(world.seed ^ 0xa401b4, x, y);
      const ridge = Math.abs(layeredNoise(world.seed ^ 0x71d63, x * 1.25, y * 1.25) - 0.5);
      let terrain: Terrain =
        elevation + def.rockBias > 0.71 || (ridge < 0.055 && elevation > 0.53)
          ? 'rock'
          : moisture + def.fertilityBias > 0.59 && elevation < 0.69
            ? 'fertile'
            : 'soil';
      if (clearing) terrain = moisture > 0.48 ? 'fertile' : 'soil';
      world.terrain.push(terrain);
    }
  return { kind, name: def.name, description: def.description };
}

function nodeChance(world: World, kind: LandscapeKind, x: number, y: number) {
  const terrain = world.terrain[y * world.width + x]!;
  const habitat = layeredNoise(world.seed ^ 0xc1a55e, x, y);
  const def = LANDSCAPES[kind];
  const tree =
    (terrain === 'fertile' ? 0.13 : terrain === 'soil' ? 0.085 : 0.018) +
    def.forestBias +
    Math.max(0, habitat - 0.55) * 0.12;
  const berries = terrain === 'fertile' ? 0.027 + Math.max(0, habitat - 0.5) * 0.04 : 0.006;
  const stone = terrain === 'rock' ? 0.17 : 0.012 + Math.max(0, 0.35 - habitat) * 0.03;
  return { tree, berries, stone };
}

export function populateNaturalResources(world: World, random: () => number) {
  world.nodes = [];
  for (let y = 1; y < world.height - 1; y++)
    for (let x = 1; x < world.width - 1; x++) {
      if (Math.hypot(x - world.width / 2, y - world.height / 2) < 7) continue;
      if (world.terrain[y * world.width + x] === 'water') continue;
      const chance = nodeChance(world, world.landscape.kind, x, y);
      const roll = random();
      let kind: NodeKind | undefined;
      if (roll < chance.stone) kind = 'stone';
      else if (roll < chance.stone + chance.berries) kind = 'berries';
      else if (roll < chance.stone + chance.berries + chance.tree) kind = 'tree';
      if (kind)
        world.nodes.push({ id: nextId(world, 'node'), x, y, kind, designated: false, work: 0 });
    }
}

export function nearestWaterDistance(world: World, origin: Point) {
  let nearest = Infinity;
  for (let key = 0; key < world.terrain.length; key++)
    if (world.terrain[key] === 'water') {
      const x = key % world.width,
        y = Math.floor(key / world.width);
      nearest = Math.min(nearest, Math.abs(x - origin.x) + Math.abs(y - origin.y));
    }
  return nearest;
}
