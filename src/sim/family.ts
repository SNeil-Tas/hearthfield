import { DAY_TICKS } from './definitions';
import { emit } from './events';
import {
  DEFAULT_AGING_ONSET,
  isAdult,
  lifeStage,
  MAX_LIFESPAN,
  MIN_LIFESPAN,
  YEAR_TICKS,
} from './health';
import { findPath } from './pathfinding';
import { randomFrom } from './random';
import { ensureRelationships, relationshipBetween, SOCIAL_INTERVAL } from './relationships';
import type { Reservations } from './reservations';
import { roomTopology } from './topology';
import type { Pawn, World } from './types';
import { distance, foodType, freshPoints, isFoodSpoiled, nextId } from './world';

export const GESTATION_TICKS = Math.round(YEAR_TICKS * 0.75);
export const BIRTH_SPACING_TICKS = YEAR_TICKS;
export const MAX_COLONISTS = 500;
const CHILD_NAMES = [
  'Nova',
  'Ember',
  'River',
  'Willow',
  'Avery',
  'Robin',
  'Skye',
  'Morgan',
  'Ellis',
  'Cedar',
  'Linden',
  'Quinn',
];

/** Only used for new settlers and legacy saves; existing family state is preserved. */
export function initializeFamily(pawn: Pawn, index = 0) {
  pawn.sex ??= index % 2 === 0 ? 'male' : 'female';
  pawn.orientation ??=
    index % 10 === 8 ? 'homosexual' : index % 10 === 9 ? 'bisexual' : 'heterosexual';
  pawn.agingOnsetYears ??= DEFAULT_AGING_ONSET;
  pawn.parentIds ??= [];
  pawn.ancestorIds ??= [...pawn.parentIds];
  pawn.nextConceptionAt ??= 0;
  pawn.care ??= 100;
}

function attractedTo(first: Pawn, second: Pawn) {
  return (
    first.orientation === 'bisexual' ||
    (first.orientation === 'heterosexual' ? first.sex !== second.sex : first.sex === second.sex)
  );
}
export function closeKin(first: Pawn, second: Pawn) {
  return (
    first.ancestorIds.includes(second.id) ||
    second.ancestorIds.includes(first.id) ||
    first.ancestorIds.some((id) => second.ancestorIds.includes(id))
  );
}
export function canPartner(first: Pawn, second: Pawn) {
  return (
    first.id !== second.id &&
    isAdult(first) &&
    isAdult(second) &&
    first.health > 0 &&
    second.health > 0 &&
    !first.partnerId &&
    !second.partnerId &&
    !closeKin(first, second) &&
    attractedTo(first, second) &&
    attractedTo(second, first)
  );
}

export function advanceFamilies(w: World) {
  for (const pawn of [...w.pawns]) {
    if (pawn.partnerId && !w.pawns.some((other) => other.id === pawn.partnerId))
      pawn.partnerId = undefined;
    if (pawn.caregiverId && !w.pawns.some((other) => other.id === pawn.caregiverId))
      pawn.caregiverId = undefined;
    if (!pawn.pregnancy || pawn.pregnancy.dueAt > w.tick || pawn.health <= 0) continue;
    const other = w.pawns.find((p) => p.id === pawn.pregnancy!.partnerId);
    const random = randomFrom(w.seed ^ w.tick ^ w.nextId);
    const id = nextId(w, 'pawn');
    const child: Pawn = {
      id,
      name: CHILD_NAMES[Math.floor(random() * CHILD_NAMES.length)]!,
      x: pawn.x,
      y: pawn.y,
      color: random() < 0.5 && other ? other.color : pawn.color,
      health: 100,
      ageTicks: 0,
      lifespanYears: MIN_LIFESPAN + Math.floor(random() * (MAX_LIFESPAN - MIN_LIFESPAN + 1)),
      sex: random() < 0.5 ? 'female' : 'male',
      orientation: random() < 0.8 ? 'heterosexual' : random() < 0.5 ? 'homosexual' : 'bisexual',
      agingOnsetYears: DEFAULT_AGING_ONSET,
      parentIds: [pawn.id, pawn.pregnancy.partnerId],
      ancestorIds: [
        ...new Set([
          pawn.id,
          pawn.pregnancy.partnerId,
          ...pawn.ancestorIds,
          ...(other?.ancestorIds ?? []),
        ]),
      ],
      nextConceptionAt: 0,
      care: 100,
      caregiverId: pawn.id,
      injuries: [],
      relationships: [],
      hunger: 85,
      rest: 90,
      mood: 90,
      skills: { plants: 0, build: 0, haul: 0, cook: 0 },
      knowledge: { agriculture: 0 },
      priorities: { plants: 3, build: 3, haul: 3, cook: 3 },
      job: null,
      carrying: null,
    };
    w.pawns.push(child);
    pawn.pregnancy = undefined;
    pawn.nextConceptionAt = w.tick + BIRTH_SPACING_TICKS;
    emit(
      w,
      `${pawn.name} gave birth to ${child.name}. The infant needs food, shelter, and adult care.`,
      'success',
    );
    ensureRelationships(w);
  }
  if (w.tick === 0 || w.tick % SOCIAL_INTERVAL !== 0) return;
  for (const first of w.pawns) {
    if (first.partnerId || !isAdult(first)) continue;
    const second = w.pawns.find((candidate) => {
      if (!canPartner(first, candidate) || distance(first, candidate) > 4) return false;
      const a = relationshipBetween(first, candidate.id),
        b = relationshipBetween(candidate, first.id);
      return (
        !!a &&
        !!b &&
        a.opinion >= 60 &&
        b.opinion >= 60 &&
        a.familiarity >= 65 &&
        b.familiarity >= 65
      );
    });
    if (!second) continue;
    first.partnerId = second.id;
    second.partnerId = first.id;
    emit(w, `${first.name} and ${second.name} became romantic partners.`, 'success');
  }
  if (w.tick % DAY_TICKS !== 0) return;
  let expectedPopulation = w.pawns.length + w.pawns.filter((p) => p.pregnancy).length;
  for (const mother of w.pawns) {
    const partner = w.pawns.find((p) => p.id === mother.partnerId);
    if (
      !partner ||
      partner.partnerId !== mother.id ||
      mother.sex !== 'female' ||
      partner.sex !== 'male' ||
      !isAdult(mother) ||
      !isAdult(partner) ||
      mother.ageTicks >= 45 * YEAR_TICKS ||
      partner.ageTicks >= 65 * YEAR_TICKS ||
      mother.pregnancy ||
      mother.nextConceptionAt > w.tick ||
      expectedPopulation >= MAX_COLONISTS ||
      mother.health < 60 ||
      partner.health < 60 ||
      mother.hunger < 50 ||
      partner.hunger < 50 ||
      distance(mother, partner) > 4
    )
      continue;
    const random = randomFrom(w.seed ^ w.tick ^ Number(mother.id.split('-')[1]));
    if (random() >= 0.12) continue;
    mother.pregnancy = {
      partnerId: partner.id,
      conceivedAt: w.tick,
      dueAt: w.tick + GESTATION_TICKS,
    };
    expectedPopulation++;
    emit(w, `${mother.name} and ${partner.name} are expecting a child.`, 'success');
  }
}

/** Dependents recover only with shelter and care; neglect has actual health consequences. */
export function updateChildNeeds(w: World, child: Pawn) {
  if (isAdult(child)) return;
  child.care = Math.max(0, child.care - (lifeStage(child) === 'infancy' ? 0.08 : 0.04));
  const sheltered = roomTopology(w).isIndoors(child);
  if (!sheltered || child.care < 20)
    child.health = Math.max(
      0,
      child.health - (!sheltered ? 0.015 : 0) - (child.care < 20 ? 0.08 : 0),
    );
  child.rest = Math.min(100, child.rest + (sheltered ? 0.08 : 0.02));
  child.mood = Math.max(0, child.mood - (sheltered ? 0 : 12) - (child.care < 30 ? 15 : 0));
}

export function childShelter(w: World, child: Pawn, grid: Uint8Array) {
  const topology = roomTopology(w);
  const places = topology.rooms
    .flatMap((room) => room.tiles)
    .map((key) => ({ x: key % w.width, y: Math.floor(key / w.width) }))
    .filter((point) => topology.isIndoors(point))
    .sort((a, b) => distance(child, a) - distance(child, b));
  for (const destination of places) {
    const path = findPath(w, child, destination, false, grid);
    if (path !== null) return { destination, path };
  }
  return undefined;
}

/** Adult care jobs physically fetch food and visit children, then escort them indoors. */
export function assignCareJob(w: World, adult: Pawn, reservations: Reservations, grid: Uint8Array) {
  if (adult.job || !isAdult(adult) || adult.health <= 0 || adult.hunger < 30 || adult.rest < 20)
    return false;
  const children = w.pawns
    .filter(
      (p) => !isAdult(p) && p.health > 0 && reservations.available([`care:${p.id}`], adult.id),
    )
    .filter(
      (p) =>
        p.care < 65 ||
        p.hunger < 60 ||
        (!roomTopology(w).isIndoors(p) && roomTopology(w).rooms.length > 0),
    )
    .sort(
      (a, b) =>
        a.hunger + a.care - (b.hunger + b.care) ||
        Number(b.parentIds.includes(adult.id)) - Number(a.parentIds.includes(adult.id)) ||
        distance(adult, a) - distance(adult, b),
    );
  for (const child of children) {
    const visit = findPath(w, adult, child, false, grid);
    if (visit === null) continue;
    const food =
      child.hunger < 60
        ? w.items
            .filter(
              (item) =>
                item.resource === 'food' &&
                (foodType(item) === 'meal' ? !isFoodSpoiled(w, item) : freshPoints(item) > 0) &&
                reservations.available([item.id], adult.id),
            )
            .sort((a, b) => distance(adult, a) - distance(adult, b))
            .find(
              (item) =>
                findPath(w, adult, item, true, grid) !== null &&
                findPath(w, item, child, false, grid) !== null,
            )
        : undefined;
    if (
      !food &&
      child.care >= 65 &&
      (roomTopology(w).isIndoors(child) || !childShelter(w, child, grid))
    )
      continue;
    const keys = [`care:${child.id}`, ...(food ? [food.id] : [])];
    if (!reservations.claim(keys, adult.id)) continue;
    adult.job = {
      kind: 'care',
      targetId: child.id,
      sourceId: food?.id,
      destination: { x: Math.round(child.x), y: Math.round(child.y) },
      path: food ? findPath(w, adult, food, true, grid)! : visit,
      phase: food ? 'source' : 'target',
      progress: 0,
      keys,
      amount: 1,
    };
    child.caregiverId = adult.id;
    return true;
  }
  return false;
}
