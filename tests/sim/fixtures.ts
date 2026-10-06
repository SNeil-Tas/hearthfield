import { generateWorld } from '../../src/sim/generate';
import type { World } from '../../src/sim/types';
export function flatWorld(): World {
  const w = generateWorld(42);
  // Small unit-test arena deliberately keeps three adults; generation has its own population test.
  w.pawns = w.pawns.slice(0, 3);
  w.width = w.height = 12;
  w.terrain = Array(144).fill('soil');
  w.nodes = [];
  w.animals = [];
  w.wildForage = Array(144).fill(70);
  w.crops = [];
  w.growingZones = [];
  w.agriculture = [];
  w.waterSalinity = [];
  w.items = [];
  w.buildings = [];
  w.blueprints = [];
  w.stockpiles = [];
  w.events = [];
  for (const [i, p] of w.pawns.entries()) {
    p.x = 2 + i;
    p.y = 3;
    p.hunger = p.rest = p.health = p.mood = 100;
    p.job = null;
    p.carrying = null;
  }
  return w;
}
