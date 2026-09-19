import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/sim/simulation';
import { advanceJob } from '../../src/sim/jobs';
import { navigationGrid } from '../../src/sim/pathfinding';
import {
  drop,
  dropWaste,
  foodPoints,
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
    ).toEqual([30, 30]);
    const before = freshPoints(w.items[0]!);
    const sim = new Simulation(w);
    for (let i = 0; i < 100; i++) sim.step();
    expect(freshPoints(w.items[0]!)).toBeLessThan(before);
    expect(spoiledPoints(w.items[0]!)).toBeGreaterThan(0);
  });

  it('removes depleted raw-food entities before they can become haul candidates', () => {
    const w = flatWorld();
    w.items.push({
      id: nextId(w, 'item'),
      x: 4,
      y: 4,
      resource: 'food',
      foodType: 'raw',
      quantity: 1,
      freshPoints: 0,
      spoiledPoints: 0,
    });
    const sim = new Simulation(w);
    for (let i = 0; i < 100; i++) sim.step();
    expect(w.items).toHaveLength(0);
    expect(sim.diagnostics.snapshot().some((event) => event.reason === 'source item missing')).toBe(
      false,
    );
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

  it('cooks and eats a meal from many small raw-food stacks', () => {
    const w = flatWorld();
    w.buildings.push({ id: nextId(w, 'building'), x: 8, y: 5, kind: 'cooking' });
    for (let i = 0; i < 10; i++)
      w.items.push({
        id: nextId(w, 'item'),
        x: 7,
        y: 5,
        resource: 'food',
        foodType: 'raw',
        foodKind: 'staple',
        quantity: 10,
        freshPoints: 10,
        spoiledPoints: 0,
      });
    w.pawns[0]!.hunger = 25;
    w.pawns[0]!.x = 6;
    w.pawns[0]!.y = 5;
    w.pawns[0]!.priorities.cook = 0;
    for (const pawn of w.pawns.slice(1))
      pawn.priorities = { plants: 0, build: 0, haul: 0, cook: 0 };
    const sim = new Simulation(w);
    const station = w.buildings[0]!;
    const first = w.items[0]!;
    w.pawns[0]!.job = {
      kind: 'cook',
      sourceId: first.id,
      targetId: station.id,
      destination: station,
      path: [],
      phase: 'source',
      progress: 0,
      keys: [station.id, first.id],
      amount: 12,
    };
    sim.reservations.claim(w.pawns[0]!.job.keys, w.pawns[0]!.id);
    const grid = navigationGrid(w);
    let sawDelivery = false;
    for (let i = 0; i < 100 && !sawDelivery; i++) {
      advanceJob(w, w.pawns[0]!, sim.reservations, grid, new Set(), sim.diagnostics);
      sawDelivery = sim.diagnostics
        .snapshot()
        .some((event) => event.type === 'ITEM_DELIVERED_TO_BUFFER');
    }
    expect(sawDelivery).toBe(true);
    expect(station.reservedBy).toBe(w.pawns[0]!.id);
    expect(sim.reservations.owner(station.id)).toBe(w.pawns[0]!.id);
    for (let i = 0; i < 300 && w.pawns[0]!.job; i++)
      advanceJob(w, w.pawns[0]!, sim.reservations, grid, new Set(), sim.diagnostics);
    expect(w.events.some((event) => event.text.includes('prepared a simple meal'))).toBe(true);
    expect(w.items.some((item) => item.foodType === 'meal' && item.quantity === 1)).toBe(true);
    expect(w.items.reduce((total, item) => total + foodPoints(item), 0)).toBe(80);
    for (let i = 0; i < 200; i++) sim.step();
    expect(w.events.some((event) => event.text.includes('stopped for a meal'))).toBe(true);
  });
});
