import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/sim/simulation';
import {
  drop,
  dropWaste,
  freshPoints,
  spoiledPoints,
  shelteredTiles,
  tileKey,
} from '../../src/sim/world';
import { nextId } from '../../src/sim/world';
import { flatWorld } from './fixtures';

describe('v0.4 food pressure', () => {
  it('caps raw stacks at 100 points and keeps fresh plus spoiled totals', () => {
    const w = flatWorld();
    drop(w, { x: 4, y: 4 }, 'food', 260);
    expect(w.items.map((item) => item.quantity)).toEqual([100, 100, 60]);
    expect(w.items.every((item) => freshPoints(item) + spoiledPoints(item) === item.quantity)).toBe(
      true,
    );
  });

  it('creates capped physical waste and makes adjacent spoilage a single bounded multiplier', () => {
    const w = flatWorld();
    drop(w, { x: 4, y: 4 }, 'food', 100);
    dropWaste(w, { x: 5, y: 4 }, 60);
    expect(
      w.items.filter((item) => item.resource === 'waste').map((item) => item.quantity),
    ).toEqual([25, 25, 10]);
    const before = freshPoints(w.items[0]!);
    const sim = new Simulation(w);
    for (let i = 0; i < 100; i++) sim.step();
    expect(freshPoints(w.items[0]!)).toBeLessThan(before);
    expect(spoiledPoints(w.items[0]!)).toBeGreaterThan(0);
  });

  it('lets a hungry colonist self-cook a full meal without Cook priority', () => {
    const w = flatWorld();
    w.buildings.push({ id: nextId(w, 'building'), x: 8, y: 5, kind: 'cooking' });
    drop(w, { x: 6, y: 5 }, 'food', 100);
    w.pawns[0]!.hunger = 25;
    w.pawns[0]!.priorities.cook = 0;
    const sim = new Simulation(w);
    for (let i = 0; i < 1500; i++) sim.step();
    expect(w.events.some((event) => event.text.includes('prepared a simple meal'))).toBe(true);
  });
});
