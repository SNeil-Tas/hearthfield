import { describe, expect, it } from 'vitest';
import { checksum, decode, encode, validateWorld } from '../../src/persistence/serialization';
import {
  advanceRelationships,
  ensureRelationships,
  relationshipMoodEffect,
  SOCIAL_INTERVAL,
} from '../../src/sim/relationships';
import { flatWorld } from './fixtures';

describe('colonist relationships', () => {
  it('maintains a directed relationship for every other living colonist', () => {
    const w = flatWorld();
    ensureRelationships(w);
    expect(w.pawns.every((pawn) => pawn.relationships.length === 2)).toBe(true);
    expect(w.pawns[0]!.relationships.map((relationship) => relationship.targetId).sort()).toEqual(
      w.pawns
        .slice(1)
        .map((pawn) => pawn.id)
        .sort(),
    );
    expect(() => validateWorld(w)).not.toThrow();
  });

  it('builds familiarity through nearby awake encounters but not at a distance', () => {
    const w = flatWorld();
    w.pawns = w.pawns.slice(0, 2);
    ensureRelationships(w);
    w.tick = SOCIAL_INTERVAL;
    expect(advanceRelationships(w)).toHaveLength(1);
    expect(w.pawns[0]!.relationships[0]!.familiarity).toBe(5);
    expect(w.pawns[1]!.relationships[0]!.interactions).toBe(1);

    w.pawns[1]!.x = 11;
    w.pawns[1]!.y = 11;
    w.tick += SOCIAL_INTERVAL;
    expect(advanceRelationships(w)).toHaveLength(0);
    expect(w.pawns[0]!.relationships[0]!.interactions).toBe(1);
  });

  it('turns established affection and hostility into bounded mood effects', () => {
    const w = flatWorld();
    ensureRelationships(w);
    const pawn = w.pawns[0]!;
    for (const relationship of pawn.relationships) {
      relationship.familiarity = 100;
      relationship.opinion = 100;
    }
    expect(relationshipMoodEffect(pawn)).toBe(8);
    for (const relationship of pawn.relationships) relationship.opinion = -100;
    expect(relationshipMoodEffect(pawn)).toBe(-8);
  });

  it('round-trips relationships and migrates version 7 saves', () => {
    const w = flatWorld();
    ensureRelationships(w);
    w.pawns[0]!.relationships[0]!.opinion = 23;
    expect(decode(encode(w)).world.pawns[0]!.relationships[0]!.opinion).toBe(23);

    const legacy = structuredClone(w) as any;
    for (const pawn of legacy.pawns) delete pawn.relationships;
    const payload = JSON.stringify(legacy);
    const loaded = decode({ version: 7, savedAt: 1, payload, checksum: checksum(payload) }).world;
    expect(loaded.pawns.every((pawn) => pawn.relationships.length === 2)).toBe(true);
  });
});
