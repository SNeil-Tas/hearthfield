import type { World, NodeKind, Terrain } from './types';
import { drop, nextId } from './world';
import { emit } from './events';

import { randomFrom } from './random';
export { randomFrom } from './random';
export function generateWorld(seed = Date.now() >>> 0): World {
  const random = randomFrom(seed);
  const w: World = {
    seed,
    width: 80,
    height: 80,
    tick: 0,
    nextId: 1,
    terrain: [],
    nodes: [],
    crops: [],
    growingZones: [],
    items: [],
    buildings: [],
    blueprints: [],
    stockpiles: [],
    dumpZones: [],
    pawns: [],
    events: [],
    weather: 'clear',
    weatherStartedAt: 0,
    weatherUntil: 1800,
  };
  for (let y = 0; y < w.height; y++)
    for (let x = 0; x < w.width; x++) {
      const clearing = Math.hypot(x - 40, y - 40) < 7;
      const river = Math.abs(x - (57 + Math.sin(y / 9 + (seed % 5)) * 4)) < 2.2 && y > 9 && y < 68;
      const patch = Math.sin(x / 6) + Math.cos(y / 5);
      const terrain: Terrain =
        !clearing && river ? 'water' : patch > 1 ? 'fertile' : patch < -1.35 ? 'rock' : 'soil';
      w.terrain.push(terrain);
      if (!clearing && terrain !== 'water' && random() < 0.115) {
        const kind: NodeKind = terrain === 'rock' ? 'stone' : random() < 0.18 ? 'berries' : 'tree';
        w.nodes.push({ id: nextId(w, 'node'), x, y, kind, designated: false, work: 0 });
      }
    }
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
  w.pawns = ['Rowan', 'Ada', 'Kit'].map((name, i) => ({
    id: nextId(w, 'pawn'),
    name,
    x: 39 + i,
    y: 40,
    color: colors[i]!,
    health: 100,
    hunger: 83 - i * 9,
    rest: 88 - i * 7,
    mood: 85,
    skills: { plants: i === 0 ? 7 : 3, build: i === 1 ? 8 : 3, haul: i === 2 ? 6 : 3, cook: 3 },
    priorities: { plants: i === 0 ? 1 : 3, build: i === 1 ? 1 : 3, haul: i === 2 ? 1 : 2, cook: 2 },
    job: null,
    carrying: null,
    moodBias: 0,
    productivity: 1,
    wetness: 0,
  }));
  for (let y = 42; y <= 44; y++) for (let x = 38; x <= 42; x++) w.stockpiles.push(y * w.width + x);
  drop(w, { x: 39, y: 42 }, 'food', 48);
  drop(w, { x: 41, y: 42 }, 'wood', 18);
  drop(w, { x: 42, y: 43 }, 'stone', 8);
  w.blueprints.push({
    id: nextId(w, 'blueprint'),
    kind: 'bed',
    x: 41,
    y: 37,
    delivered: 0,
    work: 0,
  });
  emit(w, 'Three settlers, a few supplies, and a place to begin.');
  return w;
}
