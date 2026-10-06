import {
  BUILDINGS,
  JOB_LABELS,
  NODES,
  SPOILED_FOOD_LIFETIME,
  TERRAIN,
  WORK,
} from '../sim/definitions';
import type { CropType, WeatherKind } from '../sim/types';
import { Reservations } from '../sim/reservations';
import { interruptJob } from '../sim/jobs';
import { CROPS, dropSeed, ensureAgricultureTile, SEED_LIFETIME } from '../sim/agriculture';
import { dropFood, FOOD_LIFETIME, tileKey } from '../sim/world';
import type { World } from '../sim/types';
import { COLONY_GOALS } from '../sim/goals';
import { ANIMALS, forageCapacity, initializeWildForage, seedWildlife } from '../sim/ecology';
import { randomFrom } from '../sim/random';
import { LANDSCAPES } from '../sim/landscape';
import { MAX_LIFESPAN, MIN_LIFESPAN, YEAR_TICKS } from '../sim/health';
import { ensureRelationships, relationshipTier } from '../sim/relationships';
import { initializeFamily, MAX_COLONISTS, GESTATION_TICKS, closeKin } from '../sim/family';
import { isAdult } from '../sim/health';

export interface SaveEnvelope {
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  savedAt: number;
  checksum: string;
  payload: string;
}
export function checksum(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
export function encode(w: World): SaveEnvelope {
  const payload = JSON.stringify(w);
  return { version: 9, savedAt: Date.now(), checksum: checksum(payload), payload };
}
function migrate(world: any, version: SaveEnvelope['version']) {
  const needsWildlife = !Array.isArray(world.animals);
  world.landscape ??= {
    kind: 'river-valley',
    name: 'Legacy woodland',
    description: 'A landscape generated before named landforms were recorded.',
  };
  world.animals ??= [];
  if (!Array.isArray(world.wildForage) || world.wildForage.length !== world.terrain?.length)
    initializeWildForage(world as World);
  else
    world.wildForage = world.wildForage.map((value: unknown, key: number) =>
      Math.max(
        0,
        Math.min(
          forageCapacity(world as World, key),
          typeof value === 'number' && Number.isFinite(value) ? value : 0,
        ),
      ),
    );
  world.dumpZones ??= [];
  world.weather ??= 'clear';
  world.weatherUntil ??= world.tick + 1800;
  world.weatherStartedAt ??= world.tick;
  world.jobPosts ??= [];
  world.completedGoals ??= [];
  if (version === 1) {
    world.crops ??= [];
    world.growingZones ??= [];
    for (const pawn of world.pawns ?? []) {
      pawn.skills ??= {};
      pawn.priorities ??= {};
      pawn.skills.cook ??= 3;
      pawn.priorities.cook ??= 2;
    }
    for (const item of world.items ?? []) if (item.resource === 'food') item.foodType ??= 'raw';
  }
  for (const item of world.items ?? []) {
    if (item.resource === 'food') {
      item.foodType ??= 'raw';
      if (item.foodType === 'raw') {
        item.spoiledPoints ??= item.spoiled ? item.quantity : 0;
        item.freshPoints ??= Math.max(0, item.quantity - item.spoiledPoints);
        item.foodKind ??= 'staple';
      }
    }
    if (item.resource === 'seed') item.spoilsAt ??= (world.tick ?? 0) + SEED_LIFETIME;
    if (item.resource === 'waste' && !item.expiryBatches)
      item.expiryBatches = [
        { quantity: item.quantity, expiresAt: (world.tick ?? 0) + SPOILED_FOOD_LIFETIME },
      ];
  }
  world.items = (world.items ?? []).filter((item: any) => {
    if (item.resource !== 'food' || item.foodType !== 'raw') return true;
    const fresh = item.freshPoints ?? item.quantity;
    const spoiled = item.spoiledPoints ?? 0;
    if (fresh <= 1e-6 && spoiled <= 1e-6) return false;
    if (fresh <= 1e-6 && spoiled > 0) {
      item.resource = 'waste';
      delete item.foodType;
      delete item.foodKind;
      item.quantity = spoiled;
      item.expiryBatches = [
        { quantity: spoiled, expiresAt: (world.tick ?? 0) + SPOILED_FOOD_LIFETIME },
      ];
    }
    return true;
  });
  for (const building of world.buildings ?? []) {
    building.ingredientFresh ??= 0;
    building.cookingProgress ??= 0;
  }
  if (version <= 2) {
    world.weather ??= 'clear';
    world.weatherUntil ??= world.tick + 1800;
    for (const item of world.items ?? [])
      if (item.resource === 'food')
        item.spoilsAt ??= world.tick + (item.foodType === 'meal' ? 9000 : 18000);
    for (const pawn of world.pawns ?? []) {
      pawn.moodBias ??= 0;
      pawn.productivity ??= 1;
    }
  }
  for (const pawn of world.pawns ?? []) {
    pawn.rotExposure ??= 0;
    pawn.wetness ??= 0;
    pawn.rotHandledPenalty ??= 0;
    pawn.knowledge ??= {};
    pawn.knowledge.agriculture ??= 8;
    pawn.ageTicks ??= 30 * YEAR_TICKS;
    pawn.lifespanYears ??= 82;
    pawn.injuries ??= [];
    if (version <= 7) pawn.relationships = [];
  }
  if (version <= 8) (world.pawns ?? []).forEach(initializeFamily);
  ensureRelationships(world as World);
  for (const animal of world.animals ?? []) {
    const definition = ANIMALS[animal.species as keyof typeof ANIMALS];
    if (!definition) continue;
    animal.health ??= definition.maxHealth;
    animal.nextAttackAt ??= world.tick ?? 0;
  }

  world.agriculture ??= [];
  world.waterSalinity ??= [];
  world.growingZones ??= [];
  world.crops ??= [];
  for (const crop of world.crops) {
    crop.kind = Object.hasOwn(CROPS, crop.kind) ? crop.kind : 'grain';
    crop.growth = Math.max(0, Math.min(1, crop.growth ?? 0));
    delete crop.stallReason;
  }
  if (version <= 6)
    world.agriculture = world.agriculture.filter((soil: any) =>
      world.growingZones.includes(soil.key),
    );
  for (const key of world.growingZones) {
    const crop = world.crops.find(
      (candidate: any) => Math.round(candidate.y) * world.width + Math.round(candidate.x) === key,
    );
    const selected = (
      crop?.kind && Object.hasOwn(CROPS, crop.kind) ? crop.kind : 'potato'
    ) as CropType;
    const soil = ensureAgricultureTile(world as World, key, selected);
    soil.cropType = Object.hasOwn(CROPS, soil.cropType) ? soil.cropType : selected;
    soil.moisture = Number.isFinite(soil.moisture)
      ? Math.max(0, Math.min(100, soil.moisture))
      : world.terrain[key] === 'fertile'
        ? 68
        : 60;
    soil.nutrients = Number.isFinite(soil.nutrients)
      ? Math.max(0, Math.min(100, soil.nutrients))
      : world.terrain[key] === 'fertile'
        ? 95
        : 82;
    soil.salinity = Number.isFinite(soil.salinity) ? Math.max(0, Math.min(100, soil.salinity)) : 0;
  }
  if (version <= 5 && !(world.items ?? []).some((item: any) => item.resource === 'seed')) {
    const key = world.stockpiles?.[0];
    const fallback = world.pawns?.[0] ?? { x: 0, y: 0 };
    const location =
      key === undefined ? fallback : { x: key % world.width, y: Math.floor(key / world.width) };
    const legacySeeds = Math.max(
      6,
      Math.min(18, Math.ceil((world.growingZones.length || 6) * 0.5)),
    );
    dropSeed(world as World, location, 'grain', legacySeeds);
  }
  if (needsWildlife) seedWildlife(world as World, randomFrom((world.seed ^ 0xa71a1) >>> 0));
  return world;
}
export function validateWorld(value: unknown): asserts value is World {
  if (!value || typeof value !== 'object') throw new Error('Save has no world.');
  const w = value as World;
  const finite = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const integer = (v: unknown, min: number, max: number) =>
    finite(v, min, max) && Number.isInteger(v);
  if (
    !integer(w.width, 8, 160) ||
    !integer(w.height, 8, 160) ||
    !integer(w.tick, 0, Number.MAX_SAFE_INTEGER) ||
    !integer(w.nextId, 1, Number.MAX_SAFE_INTEGER) ||
    !integer(w.seed, 0, 4294967295)
  )
    throw new Error('Invalid world metadata.');
  if (
    !w.landscape ||
    !Object.hasOwn(LANDSCAPES, w.landscape.kind) ||
    typeof w.landscape.name !== 'string' ||
    w.landscape.name.length < 1 ||
    w.landscape.name.length > 80 ||
    typeof w.landscape.description !== 'string' ||
    w.landscape.description.length > 240
  )
    throw new Error('Invalid landscape.');
  for (const name of [
    'terrain',
    'nodes',
    'animals',
    'wildForage',
    'crops',
    'growingZones',
    'agriculture',
    'waterSalinity',
    'items',
    'buildings',
    'blueprints',
    'stockpiles',
    'dumpZones',
    'pawns',
    'events',
    'jobPosts',
  ] as const)
    if (!Array.isArray(w[name]) || w[name].length > 50000) throw new Error(`Invalid ${name}.`);
  if (w.terrain.length !== w.width * w.height || w.terrain.some((t) => !Object.hasOwn(TERRAIN, t)))
    throw new Error('Invalid terrain.');
  if (
    w.wildForage.length !== w.terrain.length ||
    w.wildForage.some((value, key) => !finite(value, 0, forageCapacity(w, key)))
  )
    throw new Error('Invalid wild forage.');
  const ids = new Set<string>();
  for (const e of [...w.nodes, ...w.items, ...w.buildings, ...w.blueprints])
    if (!e || !Number.isInteger(e.x) || !Number.isInteger(e.y))
      throw new Error('Invalid tile position.');
  const entities = [
    ...w.nodes,
    ...w.animals,
    ...w.crops,
    ...w.items,
    ...w.buildings,
    ...w.blueprints,
    ...w.pawns,
  ];
  for (const e of entities) {
    if (
      !e ||
      typeof e.id !== 'string' ||
      !/^[a-z]+-\d+$/.test(e.id) ||
      ids.has(e.id) ||
      !finite(e.x, 0, w.width - 1) ||
      !finite(e.y, 0, w.height - 1)
    )
      throw new Error('Invalid entity.');
    if (Number(e.id.split('-')[1]) >= w.nextId) throw new Error('Invalid entity sequence.');
    ids.add(e.id);
  }
  for (const n of w.nodes)
    if (
      !Object.hasOwn(NODES, n.kind) ||
      typeof n.designated !== 'boolean' ||
      !finite(n.work, 0, 1000)
    )
      throw new Error('Invalid resource node.');
  const wildlifeTargetIds = new Set([
    ...w.animals.map((animal) => animal.id),
    ...w.pawns.map((pawn) => pawn.id),
  ]);
  if (
    w.animals.length > 120 ||
    w.animals.some(
      (animal) =>
        !/^animal-\d+$/.test(animal.id) ||
        !Object.hasOwn(ANIMALS, animal.species) ||
        !['female', 'male'].includes(animal.sex) ||
        !integer(animal.ageTicks, 0, ANIMALS[animal.species].maxAgeTicks) ||
        !finite(animal.energy, 0, 100) ||
        !finite(animal.health, 0, ANIMALS[animal.species].maxHealth) ||
        !['roaming', 'foraging', 'hunting', 'fleeing', 'feeding', 'resting'].includes(
          animal.state,
        ) ||
        !integer(animal.nextMoveAt, 0, Number.MAX_SAFE_INTEGER) ||
        !integer(animal.nextBreedAt, 0, Number.MAX_SAFE_INTEGER) ||
        !integer(animal.nextAttackAt, 0, Number.MAX_SAFE_INTEGER) ||
        (animal.huntTargetId !== undefined && !wildlifeTargetIds.has(animal.huntTargetId)),
    )
  )
    throw new Error('Invalid wildlife.');
  if (
    w.crops.some(
      (c) =>
        !/^crop-\d+$/.test(c.id) ||
        !Number.isInteger(c.x) ||
        !Number.isInteger(c.y) ||
        !Object.hasOwn(CROPS, c.kind) ||
        !finite(c.growth, 0, 1),
    ) ||
    w.growingZones.some((k) => !integer(k, 0, w.width * w.height - 1)) ||
    w.agriculture.some(
      (soil) =>
        !integer(soil.key, 0, w.width * w.height - 1) ||
        !Object.hasOwn(CROPS, soil.cropType) ||
        !finite(soil.moisture, 0, 100) ||
        !finite(soil.nutrients, 0, 100) ||
        !finite(soil.salinity, 0, 100),
    )
  )
    throw new Error('Invalid agriculture.');
  if (new Set(w.agriculture.map((soil) => soil.key)).size !== w.agriculture.length)
    throw new Error('Duplicate agriculture tile.');
  if (
    w.agriculture.some(
      (soil) =>
        (soil.lastWateredBy !== undefined &&
          (typeof soil.lastWateredBy !== 'string' || soil.lastWateredBy.length > 100)) ||
        (soil.lastWaterSalinity !== undefined && !finite(soil.lastWaterSalinity, 0, 100)),
    )
  )
    throw new Error('Invalid irrigation history.');
  if (
    w.waterSalinity.some(
      (entry) =>
        !integer(entry.key, 0, w.width * w.height - 1) ||
        w.terrain[entry.key] !== 'water' ||
        !finite(entry.salinity, 0, 100) ||
        entry.salinity === 0,
    ) ||
    new Set(w.waterSalinity.map((entry) => entry.key)).size !== w.waterSalinity.length
  )
    throw new Error('Invalid water salinity.');
  for (const b of [...w.buildings, ...w.blueprints])
    if (!Object.hasOwn(BUILDINGS, b.kind)) throw new Error('Invalid building.');
  for (const b of w.blueprints)
    if (!integer(b.delivered, 0, BUILDINGS[b.kind].cost) || !finite(b.work, 0, 1000000))
      throw new Error('Invalid blueprint.');
  const validStack = (i: {
    resource: string;
    quantity: number;
    foodType?: string;
    seedType?: string;
    freshPoints?: number;
    spoiledPoints?: number;
    spoilsAt?: number;
  }) =>
    ['wood', 'stone', 'food', 'waste', 'seed', 'fertilizer'].includes(i.resource) &&
    ((i.resource === 'food' && i.foodType === 'raw') || i.resource === 'waste'
      ? finite(i.quantity, 0, 100000) && i.quantity > 0
      : integer(i.quantity, 1, 100000)) &&
    (i.resource !== 'food' || !i.foodType || ['raw', 'meal'].includes(i.foodType)) &&
    (i.resource !== 'seed' || (!!i.seedType && Object.hasOwn(CROPS, i.seedType))) &&
    (i.freshPoints === undefined || finite(i.freshPoints, 0, 100000)) &&
    (i.spoiledPoints === undefined || finite(i.spoiledPoints, 0, 100000)) &&
    (i.spoilsAt === undefined || integer(i.spoilsAt, 0, Number.MAX_SAFE_INTEGER));
  if (
    w.items.some((i) => !validStack(i)) ||
    w.stockpiles.some((k) => !integer(k, 0, w.width * w.height - 1)) ||
    w.dumpZones.some((k) => !integer(k, 0, w.width * w.height - 1))
  )
    throw new Error('Invalid inventory.');
  if (
    !['clear', 'rain', 'heavy-rain', 'storm'].includes(w.weather) ||
    !integer(w.weatherUntil, w.tick, Number.MAX_SAFE_INTEGER) ||
    (w.weatherStartedAt !== undefined && !integer(w.weatherStartedAt, 0, w.tick))
  )
    throw new Error('Invalid weather.');
  if (w.pawns.length > MAX_COLONISTS) throw new Error('Invalid colonist count.');
  for (const p of w.pawns) {
    const ancestry = (ids: unknown): ids is string[] =>
      Array.isArray(ids) &&
      ids.length <= MAX_COLONISTS * 10 &&
      new Set(ids).size === ids.length &&
      ids.every((id) => typeof id === 'string' && /^pawn-\d+$/.test(id) && id !== p.id);
    if (
      !['female', 'male'].includes(p.sex) ||
      !['heterosexual', 'homosexual', 'bisexual'].includes(p.orientation) ||
      !finite(p.agingOnsetYears, 18, 120) ||
      !finite(p.care, 0, 100) ||
      !integer(p.nextConceptionAt, 0, Number.MAX_SAFE_INTEGER) ||
      !ancestry(p.parentIds) ||
      p.parentIds.length > 2 ||
      !ancestry(p.ancestorIds) ||
      !p.parentIds.every((id) => p.ancestorIds.includes(id))
    )
      throw new Error('Invalid colonist family data.');
    if (p.partnerId !== undefined) {
      const partner = w.pawns.find((other) => other.id === p.partnerId);
      if (
        !partner ||
        partner.id === p.id ||
        partner.partnerId !== p.id ||
        !isAdult(p) ||
        !isAdult(partner) ||
        closeKin(p, partner)
      )
        throw new Error('Invalid romantic partnership.');
    }
    if (
      p.caregiverId !== undefined &&
      !w.pawns.some((other) => other.id === p.caregiverId && isAdult(other) && other.id !== p.id)
    )
      throw new Error('Invalid caregiver.');
    if (
      p.pregnancy &&
      (!isAdult(p) ||
        p.sex !== 'female' ||
        !/^pawn-\d+$/.test(p.pregnancy.partnerId) ||
        p.pregnancy.partnerId === p.id ||
        !integer(p.pregnancy.conceivedAt, 0, w.tick) ||
        !integer(p.pregnancy.dueAt, p.pregnancy.conceivedAt, Number.MAX_SAFE_INTEGER) ||
        p.pregnancy.dueAt - p.pregnancy.conceivedAt !== GESTATION_TICKS)
    )
      throw new Error('Invalid pregnancy.');
    if (p.wetness !== undefined && !finite(p.wetness, 0, 100)) throw new Error('Invalid wetness.');
    if (typeof p.name !== 'string' || p.name.length > 60 || !/^#[0-9a-f]{6}$/i.test(p.color))
      throw new Error('Invalid colonist identity.');
    if (['health', 'hunger', 'rest', 'mood'].some((k) => !finite(p[k as 'health'], 0, 100)))
      throw new Error('Invalid needs.');
    if (
      !integer(p.ageTicks, 0, MAX_LIFESPAN * YEAR_TICKS) ||
      !integer(p.lifespanYears, MIN_LIFESPAN, MAX_LIFESPAN) ||
      !Array.isArray(p.injuries) ||
      p.injuries.length > 20 ||
      p.injuries.some(
        (injury) =>
          !injury ||
          typeof injury.id !== 'string' ||
          !/^injury-\d+$/.test(injury.id) ||
          !['bruise', 'cut', 'sprain', 'burn'].includes(injury.kind) ||
          !['head', 'torso', 'arm', 'leg'].includes(injury.bodyPart) ||
          !integer(injury.severity, 1, 40) ||
          !integer(injury.inflictedAt, 0, w.tick) ||
          !finite(injury.healsAt, injury.inflictedAt, Number.MAX_SAFE_INTEGER),
      )
    )
      throw new Error('Invalid colonist health history.');
    for (const type of ['plants', 'build', 'haul', 'cook'] as const)
      if (
        !p.skills ||
        !p.priorities ||
        !integer(p.skills[type], 0, 20) ||
        !integer(p.priorities[type], 0, 4)
      )
        throw new Error('Invalid work profile.');
    if (!p.knowledge || !integer(p.knowledge.agriculture, 0, 20))
      throw new Error('Invalid knowledge profile.');
    if (p.carrying !== null && (!p.carrying || !validStack(p.carrying)))
      throw new Error('Invalid carried item.');
  }
  for (const e of w.events)
    if (
      !e ||
      !integer(e.tick, 0, w.tick) ||
      typeof e.text !== 'string' ||
      e.text.length > 300 ||
      !['info', 'success', 'warning'].includes(e.kind)
    )
      throw new Error('Invalid event.');
  const pawnIds = new Set(w.pawns.map((pawn) => pawn.id));
  for (const pawn of w.pawns) {
    if (
      !Array.isArray(pawn.relationships) ||
      pawn.relationships.length !== Math.max(0, w.pawns.length - 1) ||
      new Set(pawn.relationships.map((relationship) => relationship.targetId)).size !==
        pawn.relationships.length ||
      pawn.relationships.some(
        (relationship) =>
          !relationship ||
          relationship.targetId === pawn.id ||
          !pawnIds.has(relationship.targetId) ||
          !finite(relationship.opinion, -100, 100) ||
          !finite(relationship.familiarity, 0, 100) ||
          !integer(relationship.interactions, 0, Number.MAX_SAFE_INTEGER) ||
          !integer(relationship.lastInteractionAt, 0, w.tick) ||
          !['rival', 'acquaintance', 'friend', 'close-friend'].includes(relationship.tier) ||
          relationship.tier !== relationshipTier(relationship.opinion, relationship.familiarity),
      )
    )
      throw new Error('Invalid relationships.');
  }
  if (
    w.jobPosts.length > 30 ||
    new Set(w.jobPosts.map((post) => post.id)).size !== w.jobPosts.length ||
    w.jobPosts.some(
      (post) =>
        !post ||
        !/^post-\d+$/.test(post.id) ||
        Number(post.id.split('-')[1]) >= w.nextId ||
        typeof post.key !== 'string' ||
        post.key.length > 300 ||
        !Object.hasOwn(JOB_LABELS, post.kind) ||
        !Object.hasOwn(WORK, post.work) ||
        !pawnIds.has(post.postedBy) ||
        (post.claimedBy !== undefined && !pawnIds.has(post.claimedBy)) ||
        !integer(post.postedAt, 0, w.tick) ||
        !post.destination ||
        !integer(post.destination.x, 0, w.width - 1) ||
        !integer(post.destination.y, 0, w.height - 1),
    )
  )
    throw new Error('Invalid job board.');
  const goalIds = new Set(COLONY_GOALS.map((goal) => goal.id));
  if (
    w.completedGoals !== undefined &&
    (!Array.isArray(w.completedGoals) ||
      new Set(w.completedGoals).size !== w.completedGoals.length ||
      w.completedGoals.some((goal) => !goalIds.has(goal)))
  )
    throw new Error('Invalid colony goals.');
}
export function decode(raw: unknown): { world: World; savedAt: number } {
  if (!raw || typeof raw !== 'object') throw new Error('Unrecognised save.');
  const e = raw as SaveEnvelope;
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9].includes(e.version))
    throw new Error('This save needs a different game version.');
  if (
    typeof e.payload !== 'string' ||
    e.payload.length > 10000000 ||
    e.checksum !== checksum(e.payload) ||
    !Number.isFinite(e.savedAt)
  )
    throw new Error('Save integrity check failed.');
  const world: unknown = migrate(JSON.parse(e.payload), e.version);
  validateWorld(world);
  const growing = new Set([...world.growingZones, ...world.crops.map((c) => tileKey(world, c))]);
  world.stockpiles = world.stockpiles.filter((key) => !growing.has(key));
  for (const pawn of world.pawns)
    if (pawn.carrying?.resource === 'food')
      pawn.carrying.spoilsAt ??= world.tick + FOOD_LIFETIME[pawn.carrying.foodType ?? 'raw'];
  const reservations = new Reservations();
  for (const pawn of world.pawns) interruptJob(world, pawn, reservations);
  for (const station of world.buildings) {
    if (station.kind !== 'cooking') continue;
    if (station.ingredientFresh) dropFood(world, station, station.ingredientFresh);
    station.ingredientFresh = 0;
    station.cookingProgress = 0;
    station.reservedBy = undefined;
  }
  return { world, savedAt: e.savedAt };
}
