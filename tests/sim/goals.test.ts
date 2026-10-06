import { describe, expect, it } from 'vitest';
import { checksum, decode, encode } from '../../src/persistence/serialization';
import { completeColonyGoals, currentColonyGoal } from '../../src/sim/goals';
import { Simulation } from '../../src/sim/simulation';
import { nextId } from '../../src/sim/world';
import { flatWorld } from './fixtures';

describe('colony goals', () => {
  it('records reached milestones once and gives the colony a bounded morale lift', () => {
    const world = flatWorld();
    world.buildings.push({ id: nextId(world, 'building'), x: 5, y: 5, kind: 'bed' });
    const simulation = new Simulation(world);

    for (let tick = 0; tick < 10; tick++) simulation.step();

    expect(world.completedGoals).toContain('first-bed');
    expect(world.events.filter((event) => event.text.startsWith('Milestone:'))).toHaveLength(1);
    expect(world.pawns.every((pawn) => (pawn.moodBias ?? 0) === 3)).toBe(true);
    expect(simulation.feedback.map((entry) => entry.text)).toContain('We did it!');

    for (let tick = 0; tick < 20; tick++) simulation.step();
    expect(world.events.filter((event) => event.text.startsWith('Milestone:'))).toHaveLength(1);
    expect(world.pawns.every((pawn) => (pawn.moodBias ?? 0) === 3)).toBe(true);
  });

  it('remembers goals completed out of order and advances to the earliest unfinished goal', () => {
    const world = flatWorld();
    world.items.push({
      id: nextId(world, 'item'),
      x: 4,
      y: 4,
      resource: 'food',
      foodType: 'meal',
      quantity: 1,
    });

    const completed = completeColonyGoals(world);

    expect(completed.map((goal) => goal.id)).toEqual(['food-buffer', 'first-meal']);
    expect(currentColonyGoal(world)?.id).toBe('first-bed');
    expect(completeColonyGoals(world)).toEqual([]);
  });

  it('persists completed goals and migrates saves that predate them', () => {
    const world = flatWorld();
    world.completedGoals = ['first-bed', 'food-buffer'];
    expect(decode(encode(world)).world.completedGoals).toEqual(world.completedGoals);

    const legacy = JSON.parse(encode(world).payload);
    delete legacy.completedGoals;
    const payload = JSON.stringify(legacy);
    const loaded = decode({ ...encode(world), payload, checksum: checksum(payload) });
    expect(loaded.world.completedGoals).toEqual([]);
  });
});
