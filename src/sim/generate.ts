import type { World } from './types';
import { drop, nextId } from './world';
import { dropSeed } from './agriculture';
import { emit } from './events';
import { randomFrom } from './random';
import { initializeWildForage, seedWildlife } from './ecology';
import { generateLandscape, populateNaturalResources } from './landscape';
import { MAX_LIFESPAN, MIN_LIFESPAN, YEAR_TICKS } from './health';
import { DEFAULT_AGING_ONSET } from './health';
import { createPsychology } from './psychology';
export { randomFrom } from './random';
export function generateWorld(seed = Date.now() >>> 0): World {
  const random = randomFrom(seed);
  const w: World = {
    seed,
    landscape: { kind: 'river-valley', name: 'River valley', description: '' },
    width: 80,
    height: 80,
    tick: 0,
    nextId: 1,
    terrain: [],
    nodes: [],
    animals: [],
    wildForage: [],
    crops: [],
    growingZones: [],
    agriculture: [],
    waterSalinity: [],
    items: [],
    buildings: [],
    blueprints: [],
    stockpiles: [],
    dumpZones: [],
    pawns: [],
    events: [],
    jobPosts: [],
    housingProjects: [],
    completedGoals: [],
    weather: 'clear',
    weatherStartedAt: 0,
    weatherUntil: 1800,
  };
  w.landscape = generateLandscape(w);
  populateNaturalResources(w, random);
  for (const [x, y, kind] of [
    [34, 38, 'tree'],
    [34, 41, 'tree'],
    [35, 44, 'berries'],
    [45, 36, 'tree'],
    [44, 45, 'stone'],
  ] as const) {
    w.nodes = w.nodes.filter((n) => n.x !== x || n.y !== y);
    w.nodes.push({
      id: nextId(w, 'node'),
      x,
      y,
      kind,
      designated: kind === 'tree' && x === 34,
      work: 0,
    });
    w.terrain[y * w.width + x] = 'soil';
  }
  const colors = ['#f0bd76', '#a9c8c7', '#d89c87'];
  w.pawns = [
    'Rowan',
    'Ada',
    'Kit',
    'Mira',
    'Eli',
    'Nora',
    'Jules',
    'Iris',
    'Ash',
    'Sage',
    'Finn',
    'Wren',
    'Leo',
    'Hazel',
    'Remy',
  ].map((name, i) => {
    const id = nextId(w, 'pawn');
    return {
      id,
      name,
      x: 36 + (i % 5) * 2,
      y: 37 + Math.floor(i / 5) * 2,
      color: colors[i % colors.length]!,
      health: 100,
      ageTicks: (20 + Math.floor(random() * 21)) * YEAR_TICKS,
      lifespanYears: MIN_LIFESPAN + Math.floor(random() * (MAX_LIFESPAN - MIN_LIFESPAN + 1)),
      sex: i % 2 === 0 ? 'male' : 'female',
      orientation: i % 10 === 8 ? 'homosexual' : i % 10 === 9 ? 'bisexual' : 'heterosexual',
      agingOnsetYears: DEFAULT_AGING_ONSET,
      parentIds: [],
      ancestorIds: [],
      nextConceptionAt: 0,
      care: 100,
      injuries: [],
      relationships: [],
      hunger: 83 - (i % 3) * 9,
      rest: 88 - (i % 3) * 7,
      mood: 85,
      psychology: createPsychology(seed, id),
      skills: { plants: i === 0 ? 7 : 3, build: i === 1 ? 8 : 3, haul: i === 2 ? 6 : 3, cook: 3 },
      knowledge: {
        agriculture: i === 0 ? 16 : i === 1 ? 3 : 8,
        building: i === 1 ? 16 : i === 0 ? 3 : 8,
      },
      priorities: {
        plants: i === 0 ? 1 : 3,
        build: i === 1 ? 1 : 3,
        haul: i === 2 ? 1 : 2,
        cook: 2,
      },
      job: null,
      carrying: null,
      moodBias: 0,
      productivity: 1,
      wetness: 0,
    };
  });
  for (let y = 42; y <= 44; y++) for (let x = 38; x <= 42; x++) w.stockpiles.push(y * w.width + x);
  drop(w, { x: 39, y: 42 }, 'food', 240);
  drop(w, { x: 41, y: 42 }, 'wood', 18);
  drop(w, { x: 42, y: 43 }, 'stone', 8);
  dropSeed(w, { x: 38, y: 42 }, 'potato', 20);
  dropSeed(w, { x: 40, y: 42 }, 'grain', 12);
  drop(w, { x: 38, y: 43 }, 'fertilizer', 8);
  w.blueprints.push({
    id: nextId(w, 'blueprint'),
    kind: 'bed',
    x: 41,
    y: 37,
    delivered: 0,
    work: 0,
  });
  emit(w, 'Fifteen settlers, a few supplies, and a place to begin.');
  initializeWildForage(w);
  seedWildlife(w, random);
  return w;
}
