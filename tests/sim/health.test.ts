import { describe, expect, it } from 'vitest';
import { checksum, decode, encode, validateWorld } from '../../src/persistence/serialization';
import {
  YEAR_TICKS,
  ageYears,
  advanceColonistHealth,
  inflictInjury,
  injuryWorkMultiplier,
} from '../../src/sim/health';
import { Simulation } from '../../src/sim/simulation';
import { flatWorld } from './fixtures';

describe('colonist health and lifespan', () => {
  it('starts colonists at deterministic random ages from 20 through 40', () => {
    const first = flatWorld();
    const second = flatWorld();
    expect(first.pawns.map(ageYears)).toEqual(second.pawns.map(ageYears));
    expect(first.pawns.every((pawn) => ageYears(pawn) >= 20 && ageYears(pawn) <= 40)).toBe(true);
  });

  it('tracks injuries, health loss, work impairment, and healing', () => {
    const world = flatWorld();
    const pawn = world.pawns[0]!;
    const injury = inflictInjury(world, pawn, 'sprain', 'leg', 18);
    expect(pawn.health).toBe(82);
    expect(injuryWorkMultiplier(pawn)).toBeLessThan(1);
    world.tick = injury.healsAt;
    advanceColonistHealth(world, pawn, 10);
    expect(pawn.injuries).toEqual([]);
  });

  it('ages colonists and removes them at their lifespan while cleaning ownership', () => {
    const world = flatWorld();
    const pawn = world.pawns[0]!;
    world.pawns = [pawn];
    pawn.ageTicks = pawn.lifespanYears * YEAR_TICKS;
    world.buildings.push({ id: 'building-999', kind: 'bed', x: 5, y: 5, ownerId: pawn.id });
    world.nextId = 1000;
    new Simulation(world).step();
    expect(world.pawns).toEqual([]);
    expect(world.buildings[0]!.ownerId).toBeUndefined();
    expect(world.events.at(-1)?.text).toContain('died from old age');
    expect(() => validateWorld(world)).not.toThrow();
  });

  it('migrates legacy saves with a neutral age and empty injury history', () => {
    const world = flatWorld();
    const envelope = encode(world);
    const payloadWorld = JSON.parse(envelope.payload);
    for (const pawn of payloadWorld.pawns) {
      delete pawn.ageTicks;
      delete pawn.lifespanYears;
      delete pawn.injuries;
    }
    const payload = JSON.stringify(payloadWorld);
    const loaded = decode({ version: 7, savedAt: 1, payload, checksum: checksum(payload) });
    expect(loaded.world.pawns.every((pawn) => ageYears(pawn) === 30)).toBe(true);
    expect(loaded.world.pawns.every((pawn) => pawn.injuries.length === 0)).toBe(true);
  });
});
