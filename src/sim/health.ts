import { DAY_TICKS } from './definitions';
import { emit } from './events';
import type { Injury, InjuryKind, LifeStage, Pawn, World } from './types';
import { nextId } from './world';

/** One game year is deliberately compressed so a colony can visibly grow old. */
export const YEAR_DAYS = 60;
export const YEAR_TICKS = YEAR_DAYS * DAY_TICKS;
export const MIN_LIFESPAN = 72;
export const MAX_LIFESPAN = 92;
export const DEFAULT_AGING_ONSET = 55;
export const ADULTHOOD_YEARS = 18;

export function lifeStage(pawn: Pawn): LifeStage {
  const age = pawn.ageTicks / YEAR_TICKS;
  return age < 2
    ? 'infancy'
    : age < 10
      ? 'early-childhood'
      : age < 14
        ? 'pubescence'
        : age < 18
          ? 'post-pubescence'
          : 'adulthood';
}
export const LIFE_STAGE_LABELS: Record<LifeStage, string> = {
  infancy: 'Infancy',
  'early-childhood': 'Early childhood',
  pubescence: 'Pubescence',
  'post-pubescence': 'Post-pubescence',
  adulthood: 'Adulthood',
};
export function isAdult(pawn: Pawn) {
  return pawn.ageTicks >= ADULTHOOD_YEARS * YEAR_TICKS;
}
export function agingProgress(pawn: Pawn) {
  return Math.max(0, Math.min(1, (pawn.ageTicks / YEAR_TICKS - pawn.agingOnsetYears) / 35));
}
export function agingWorkMultiplier(pawn: Pawn) {
  return 1 - agingProgress(pawn) * 0.45;
}
export function agingMovementMultiplier(pawn: Pawn) {
  return 1 - agingProgress(pawn) * 0.35;
}
export function lifeStageScale(pawn: Pawn) {
  return {
    infancy: 0.45,
    'early-childhood': 0.62,
    pubescence: 0.8,
    'post-pubescence': 0.92,
    adulthood: 1,
  }[lifeStage(pawn)];
}

export function ageYears(pawn: Pawn) {
  return Math.floor(pawn.ageTicks / YEAR_TICKS);
}

export function injuryLabel(injury: Injury) {
  return `${injury.kind} (${injury.bodyPart})`;
}

export function injuryWorkMultiplier(pawn: Pawn) {
  const burden = pawn.injuries.reduce((total, injury) => total + injury.severity, 0);
  return Math.max(0.45, 1 - burden / 180);
}

export function inflictInjury(
  world: World,
  pawn: Pawn,
  kind: InjuryKind,
  bodyPart: Injury['bodyPart'],
  severity: number,
  source?: string,
) {
  const safeSeverity = Math.max(1, Math.min(40, Math.round(severity)));
  const injury: Injury = {
    id: nextId(world, 'injury'),
    kind,
    bodyPart,
    severity: safeSeverity,
    inflictedAt: world.tick,
    healsAt: world.tick + (2 + safeSeverity / 4) * DAY_TICKS,
  };
  pawn.injuries.push(injury);
  pawn.health = Math.max(0, pawn.health - safeSeverity);
  emit(
    world,
    source
      ? `${pawn.name} was attacked by ${source} and suffered a ${injuryLabel(injury)}.`
      : `${pawn.name} suffered a ${injuryLabel(injury)}.`,
    'warning',
  );
  return injury;
}

function accidentRoll(world: World, pawn: Pawn, salt = 0) {
  // A stateless hash keeps accidents deterministic across saves and test runs.
  let value = (world.seed ^ (world.tick + salt) ^ Number(pawn.id.split('-')[1])) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
}

function maybeWorkAccident(world: World, pawn: Pawn) {
  const chance =
    pawn.activity === 'heavy-work'
      ? 0.025
      : pawn.activity === 'hauling'
        ? 0.015
        : pawn.activity === 'working'
          ? 0.01
          : 0;
  if (accidentRoll(world, pawn) >= chance) return;
  const kinds: InjuryKind[] = ['bruise', 'cut', 'sprain', 'burn'];
  const parts: Injury['bodyPart'][] = ['head', 'torso', 'arm', 'leg'];
  const detail = accidentRoll(world, pawn, 7919);
  inflictInjury(
    world,
    pawn,
    kinds[Math.floor(detail * kinds.length)]!,
    parts[Math.floor(((detail * 7) % 1) * parts.length)]!,
    5 + Math.floor(((detail * 13) % 1) * 16),
  );
}

/** Advances age, healing, recovery, and daily occupational accident checks. */
export function advanceColonistHealth(world: World, pawn: Pawn, elapsedTicks = 10) {
  const previousStage = lifeStage(pawn);
  pawn.ageTicks += elapsedTicks;
  if (lifeStage(pawn) !== previousStage)
    emit(
      world,
      `${pawn.name} reached ${LIFE_STAGE_LABELS[lifeStage(pawn)].toLowerCase()}.`,
      'success',
    );
  const recovered = pawn.injuries.filter((injury) => injury.healsAt <= world.tick);
  if (recovered.length) {
    pawn.injuries = pawn.injuries.filter((injury) => injury.healsAt > world.tick);
    for (const injury of recovered)
      emit(world, `${pawn.name}'s ${injuryLabel(injury)} has healed.`, 'success');
  }
  if (world.tick > 0 && world.tick % DAY_TICKS === 0) maybeWorkAccident(world, pawn);
}

export function colonistDeathCause(pawn: Pawn) {
  if (pawn.health <= 0)
    return pawn.injuries.length
      ? 'their injuries'
      : pawn.hunger <= 0
        ? 'starvation'
        : 'poor health';
  if (ageYears(pawn) >= pawn.lifespanYears) return 'old age';
  return undefined;
}
