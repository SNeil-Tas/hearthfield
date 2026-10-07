import { DAY_TICKS } from './definitions';
import { emit } from './events';
import { isAdult } from './health';
import { randomFrom } from './random';
import { roomTopology } from './topology';
import type {
  EmotionalMemory,
  EmotionalNeed,
  JobKind,
  Pawn,
  PersonalityTrait,
  Point,
  Psychology,
  WorkType,
  World,
} from './types';
import { distance } from './world';

export const TRAITS: PersonalityTrait[] = [
  'sociability',
  'resilience',
  'diligence',
  'curiosity',
  'sensitivity',
  'empathy',
];
export const EMOTIONAL_NEEDS: EmotionalNeed[] = [
  'belonging',
  'recreation',
  'privacy',
  'purpose',
  'security',
  'comfort',
];
export const MEMORY_LIMIT = 12;
export const NEED_LABELS: Record<EmotionalNeed, string> = {
  belonging: 'Belonging',
  recreation: 'Recreation',
  privacy: 'Privacy',
  purpose: 'Purpose',
  security: 'Security',
  comfort: 'Comfort',
};
export const NEED_HELP: Record<EmotionalNeed, string> = {
  belonging: 'Friendly conversations and attentive care help them feel connected.',
  recreation: 'Free time and short recreation breaks relieve a demanding routine.',
  privacy: 'Time away from crowds provides space to think.',
  purpose: 'Useful work, especially their preferred work, provides a sense of progress.',
  security: 'Food, rest, health, shelter, and reliable care help them feel safe.',
  comfort: 'Dry shelter and a proper bed help; wet clothes and nearby waste hurt.',
};
const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));

/** Room boundaries provide privacy even when beds in different rooms are close together. */
export function sharesSocialSpace(w: World, first: Point, second: Point) {
  const topology = roomTopology(w);
  return topology.getRoomAt(first)?.id === topology.getRoomAt(second)?.id;
}

/** Separate identity seed: adding psychology never consumes landscape or family randomness. */
export function createPsychology(seed: number, id: string): Psychology {
  let hash = seed ^ 0x505359;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const random = randomFrom(hash >>> 0);
  const traits = Object.fromEntries(
    TRAITS.map((trait) => [trait, 15 + Math.floor(random() * 71)]),
  ) as Psychology['traits'];
  return {
    traits,
    needs: { belonging: 72, recreation: 78, privacy: 75, purpose: 70, security: 70, comfort: 70 },
    preferredWork: (['plants', 'build', 'haul', 'cook'] as const)[Math.floor(random() * 4)]!,
    stress: 8,
    overwhelmed: false,
    nextCopingAt: 0,
    memories: [],
  };
}

/** Repeated experiences refresh one thought instead of permanently stacking mood. */
export function remember(
  w: World,
  pawn: Pawn,
  key: string,
  text: string,
  impact: number,
  duration = DAY_TICKS,
) {
  const psych = pawn.psychology;
  const memory: EmotionalMemory = {
    key,
    text,
    impact: clamp(impact, -20, 20),
    createdAt: w.tick,
    expiresAt: w.tick + duration,
  };
  psych.memories = psych.memories.filter((m) => m.key !== key && m.expiresAt > w.tick);
  psych.memories.push(memory);
  if (psych.memories.length > MEMORY_LIMIT) {
    // Preserve meaningful losses and milestones ahead of small everyday experiences.
    const least = psych.memories.reduce((best, m) =>
      Math.abs(memoryEffect(m, w.tick)) < Math.abs(memoryEffect(best, w.tick)) ? m : best,
    );
    psych.memories.splice(psych.memories.indexOf(least), 1);
  }
}
export function memoryEffect(memory: EmotionalMemory, tick: number) {
  return (
    memory.impact * clamp((memory.expiresAt - tick) / (memory.expiresAt - memory.createdAt), 0, 1)
  );
}
export function needImportance(pawn: Pawn, need: EmotionalNeed) {
  const t = pawn.psychology.traits;
  switch (need) {
    case 'belonging':
      return 0.6 + t.sociability / 100;
    case 'privacy':
      return 1.6 - t.sociability / 100;
    case 'recreation':
      return 0.6 + t.curiosity / 100;
    case 'purpose':
      return 0.6 + t.diligence / 100;
    case 'security':
      return 1.4 - t.resilience / 125;
    case 'comfort':
      return 0.6 + t.sensitivity / 100;
  }
}
export function psychologicalMood(w: World, pawn: Pawn) {
  const p = pawn.psychology;
  const needs =
    EMOTIONAL_NEEDS.reduce(
      (sum, need) => sum + (p.needs[need] - 75) * needImportance(pawn, need),
      0,
    ) / 18;
  const memories = clamp(
    p.memories.reduce((sum, m) => sum + memoryEffect(m, w.tick), 0),
    -20,
    15,
  );
  return clamp(needs + memories - p.stress * 0.13, -35, 20);
}
export function psychologicalWorkMultiplier(pawn: Pawn) {
  return 1 - pawn.psychology.stress * 0.0015 - (pawn.psychology.overwhelmed ? 0.08 : 0);
}
export function workTypeForJob(kind?: JobKind): WorkType | undefined {
  if (!kind) return;
  if (['sow', 'water', 'fertilize', 'harvest', 'gather', 'chop'].includes(kind)) return 'plants';
  if (['design', 'build', 'deconstruct'].includes(kind)) return 'build';
  if (['haul', 'deliver', 'separate'].includes(kind)) return 'haul';
  if (kind === 'cook') return 'cook';
}
export function psychologicalWorkPreference(pawn: Pawn, work: WorkType) {
  return pawn.psychology.preferredWork === work ? 8 + pawn.psychology.traits.diligence / 10 : 0;
}

/** One-second update; only actual surroundings and activity satisfy needs. */
export function updatePsychology(w: World, pawn: Pawn) {
  const p = pawn.psychology,
    t = p.traits,
    n = p.needs;
  p.memories = p.memories.filter((m) => m.expiresAt > w.tick);
  const nearby = w.pawns.filter(
    (other) =>
      other.id !== pawn.id && distance(pawn, other) <= 4 && sharesSocialSpace(w, pawn, other),
  );
  const crowd = nearby.length;
  const indoors = roomTopology(w).isIndoors(pawn);
  const sleeping = pawn.job?.kind === 'sleep' && !pawn.job.path.length;
  const working = !!workTypeForJob(pawn.job?.kind) || pawn.job?.kind === 'care';
  const child = !isAdult(pawn);
  const caredFor = child && pawn.care >= 55 && nearby.some((other) => isAdult(other));
  const adjust = (need: EmotionalNeed, delta: number) => {
    n[need] = clamp(n[need] + delta);
  };
  adjust('belonging', caredFor ? 0.1 : -(0.018 + t.sociability * 0.0003));
  adjust('recreation', sleeping ? 0 : working ? -(0.025 + t.curiosity * 0.0003) : 0.09);
  adjust('privacy', crowd >= 3 ? -(0.02 + (100 - t.sociability) * 0.0005) : 0.1);
  adjust(
    'purpose',
    child
      ? caredFor
        ? 0.05
        : -0.01
      : working
        ? workTypeForJob(pawn.job?.kind) === p.preferredWork
          ? 0.16
          : 0.06
        : sleeping
          ? 0
          : -0.025,
  );
  const danger = w.animals.some((a) => a.huntTargetId === pawn.id && distance(a, pawn) <= 8);
  const safetyTarget = clamp(
    Math.min(pawn.hunger, pawn.rest, pawn.health) * 0.7 +
      (indoors ? 30 : 10) -
      (danger ? 60 : 0) -
      (child && pawn.care < 30 ? 25 : 0),
  );
  const bed = sleeping && w.buildings.some((b) => b.id === pawn.job?.targetId && b.kind === 'bed');
  const comfortTarget = clamp(
    (indoors ? 80 : 50) +
      (bed ? 20 : 0) -
      (pawn.wetness ?? 0) * 0.5 -
      (pawn.rotExposure ?? 0) * 0.3 -
      (sleeping && !bed ? 20 : 0),
  );
  adjust('security', clamp(safetyTarget - n.security, -0.18, 0.12));
  adjust('comfort', clamp(comfortTarget - n.comfort, -0.2, 0.12));
  const unmet = EMOTIONAL_NEEDS.reduce(
    (sum, need) => sum + Math.max(0, 45 - n[need]) * needImportance(pawn, need),
    0,
  );
  const memoryBurden = p.memories.reduce((sum, m) => sum + memoryEffect(m, w.tick), 0);
  const strain = clamp(
    unmet / 3 +
      Math.max(0, 35 - pawn.hunger) * 0.8 +
      Math.max(0, 25 - pawn.rest) * 0.6 -
      clamp(memoryBurden, -20, 12) +
      (danger ? 30 : 0),
  );
  const targetStress = strain * (1.2 - t.resilience / 200);
  const recovery = (sleeping || pawn.job?.kind === 'relax' ? 0.18 : 0.07) + t.resilience * 0.001;
  p.stress = clamp(
    p.stress + clamp(targetStress - p.stress, -recovery, 0.07 + (100 - t.resilience) * 0.001),
  );
  // Hysteresis prevents repeated state changes around a single threshold.
  if (!p.overwhelmed && p.stress >= 75) {
    p.overwhelmed = true;
    emit(w, `${pawn.name} feels overwhelmed and needs time to recover.`, 'warning');
  } else if (p.overwhelmed && p.stress <= 40) {
    p.overwhelmed = false;
    emit(w, `${pawn.name} is feeling steadier again.`, 'success');
  }
  // Old saves' accumulated mood bias dissipates; new events use finite memories.
  if (pawn.moodBias)
    pawn.moodBias = Math.sign(pawn.moodBias) * Math.max(0, Math.abs(pawn.moodBias) - 0.01);
}

export function recordConversation(w: World, observer: Pawn, target: Pawn, delta: number) {
  const p = observer.psychology;
  const trusted = observer.relationships.find((r) => r.targetId === target.id);
  if (delta >= 0) {
    p.needs.belonging = clamp(
      p.needs.belonging +
        5 +
        p.traits.sociability / 20 +
        (trusted && trusted.opinion >= 30 ? 3 : 0),
    );
    p.stress = clamp(p.stress - 1 - target.psychology.traits.empathy / 50);
    remember(
      w,
      observer,
      'conversation',
      `A good conversation with ${target.name}`,
      2,
      DAY_TICKS / 2,
    );
  } else {
    p.needs.belonging = clamp(p.needs.belonging - 2);
    remember(
      w,
      observer,
      'argument',
      `A tense exchange with ${target.name}`,
      -2 - p.traits.sensitivity / 40,
      DAY_TICKS / 2,
    );
  }
}
export function recordLoss(w: World, deceased: Pawn) {
  for (const survivor of w.pawns) {
    if (survivor.id === deceased.id) continue;
    const bond = survivor.relationships.find((r) => r.targetId === deceased.id);
    const family =
      survivor.partnerId === deceased.id ||
      survivor.parentIds.includes(deceased.id) ||
      deceased.parentIds.includes(survivor.id);
    if (!family && (!bond || bond.opinion < 30)) continue;
    remember(
      w,
      survivor,
      `loss:${deceased.id}`,
      `Grieving ${deceased.name}`,
      family ? -16 : -9,
      DAY_TICKS * 4,
    );
    survivor.psychology.needs.belonging = clamp(
      survivor.psychology.needs.belonging - (family ? 25 : 12),
    );
  }
}
