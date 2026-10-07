import type { Pawn, Relationship, RelationshipTier, World } from './types';
import { distance } from './world';
import { recordConversation, sharesSocialSpace } from './psychology';

export const SOCIAL_INTERVAL = 300;
export const SOCIAL_DISTANCE = 4;

export interface SocialInteraction {
  first: Pawn;
  second: Pawn;
  positive: boolean;
  newMutualTier?: RelationshipTier;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function hash(seed: number, text: string) {
  let value = seed ^ 0x9e3779b9;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  value ^= value >>> 16;
  return value >>> 0;
}

function compatibility(w: World, observer: Pawn, target: Pawn) {
  const first = observer.psychology.traits,
    second = target.psychology.traits;
  const sharedOutlook =
    1 -
    (Math.abs(first.sociability - second.sociability) +
      Math.abs(first.curiosity - second.curiosity)) /
      100;
  return (
    (hash(w.seed, `${observer.id}>${target.id}`) % 101) / 100 -
    0.5 +
    sharedOutlook * 0.25 +
    (second.empathy - 50) / 180
  );
}

export function relationshipTier(opinion: number, familiarity: number): RelationshipTier {
  if (familiarity >= 30 && opinion <= -30) return 'rival';
  if (familiarity >= 65 && opinion >= 60) return 'close-friend';
  if (familiarity >= 30 && opinion >= 30) return 'friend';
  return 'acquaintance';
}

function newRelationship(w: World, observer: Pawn, target: Pawn): Relationship {
  const opinion = Math.round(compatibility(w, observer, target) * 8);
  return {
    targetId: target.id,
    opinion,
    familiarity: 0,
    interactions: 0,
    lastInteractionAt: 0,
    tier: 'acquaintance',
  };
}

/** Keeps the relationship graph complete as colonists arrive, die, or old saves are loaded. */
export function ensureRelationships(w: World) {
  const living = new Set(w.pawns.map((pawn) => pawn.id));
  for (const pawn of w.pawns) {
    const unique = new Map<string, Relationship>();
    for (const relationship of pawn.relationships ?? [])
      if (
        relationship.targetId !== pawn.id &&
        living.has(relationship.targetId) &&
        !unique.has(relationship.targetId)
      )
        unique.set(relationship.targetId, relationship);
    pawn.relationships = [...unique.values()];
    for (const target of w.pawns)
      if (target.id !== pawn.id && !unique.has(target.id))
        pawn.relationships.push(newRelationship(w, pawn, target));
  }
}

export function relationshipBetween(pawn: Pawn, targetId: string) {
  return pawn.relationships.find((relationship) => relationship.targetId === targetId);
}

function updateOpinion(w: World, observer: Pawn, target: Pawn, cycle: number) {
  const relationship = relationshipBetween(observer, target.id)!;
  const jitter = (hash(w.seed ^ cycle, `${observer.id}:${target.id}`) % 5) - 2;
  const disposition = compatibility(w, observer, target) * 2.4;
  const strain =
    ((observer.mood + target.mood) / 2 < 35 ? -1 : 0) - (observer.psychology.stress > 65 ? 0.8 : 0);
  const delta = clamp(Math.round(disposition + jitter + 0.45 + strain), -3, 3);
  relationship.opinion = clamp(relationship.opinion + delta, -100, 100);
  relationship.familiarity = clamp(relationship.familiarity + 5, 0, 100);
  relationship.interactions++;
  relationship.lastInteractionAt = w.tick;
  relationship.tier = relationshipTier(relationship.opinion, relationship.familiarity);
  return delta;
}

/** Advances at most one nearby social encounter per colonist each interval. */
export function advanceRelationships(w: World): SocialInteraction[] {
  if (w.tick === 0 || w.tick % SOCIAL_INTERVAL !== 0) return [];
  ensureRelationships(w);
  const cycle = Math.floor(w.tick / SOCIAL_INTERVAL);
  const available = new Set(w.pawns.filter((pawn) => pawn.job?.kind !== 'sleep').map((p) => p.id));
  const interactions: SocialInteraction[] = [];
  for (const first of w.pawns) {
    if (!available.has(first.id)) continue;
    const second = w.pawns
      .filter(
        (candidate) =>
          candidate.id !== first.id &&
          available.has(candidate.id) &&
          sharesSocialSpace(w, first, candidate) &&
          distance(first, candidate) <= SOCIAL_DISTANCE,
      )
      .sort((a, b) => distance(first, a) - distance(first, b) || a.id.localeCompare(b.id))[0];
    if (!second) continue;
    available.delete(first.id);
    available.delete(second.id);
    const before = mutualTier(first, second);
    const firstDelta = updateOpinion(w, first, second, cycle);
    const secondDelta = updateOpinion(w, second, first, cycle);
    recordConversation(w, first, second, firstDelta);
    recordConversation(w, second, first, secondDelta);
    const after = mutualTier(first, second);
    interactions.push({
      first,
      second,
      positive: firstDelta + secondDelta >= 0,
      newMutualTier: after !== before && after !== 'acquaintance' ? after : undefined,
    });
  }
  return interactions;
}

function mutualTier(first: Pawn, second: Pawn): RelationshipTier {
  const a = relationshipBetween(first, second.id);
  const b = relationshipBetween(second, first.id);
  if (!a || !b) return 'acquaintance';
  if (a.tier === 'rival' && b.tier === 'rival') return 'rival';
  if (a.tier === 'close-friend' && b.tier === 'close-friend') return 'close-friend';
  if (['friend', 'close-friend'].includes(a.tier) && ['friend', 'close-friend'].includes(b.tier))
    return 'friend';
  return 'acquaintance';
}

/** Established bonds affect mood; unfamiliar colonists have essentially no effect. */
export function relationshipMoodEffect(pawn: Pawn) {
  const total = pawn.relationships.reduce(
    (sum, relationship) => sum + (relationship.opinion * relationship.familiarity) / 100,
    0,
  );
  return clamp(total / 12, -8, 8);
}
