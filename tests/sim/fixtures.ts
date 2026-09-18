import { generateWorld } from '../../src/sim/generate';
import type { World } from '../../src/sim/types';
export function flatWorld(): World {
  const w = generateWorld(42);
  w.width = w.height = 12;
  w.terrain = Array(144).fill('soil');
  w.nodes = [];
  w.crops = [];
  w.growingZones = [];
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
