import { DAY_TICKS } from './definitions';
import type {
  AgricultureTile,
  Crop,
  CropStage,
  CropType,
  Item,
  Point,
  WaterSourceClass,
  World,
} from './types';
import { roomTopology } from './topology';
import { isRainExposed, precipitationIntensity } from './weather';
import { distance, nextId, sameTile, tileKey, walkable } from './world';
import type { DiagnosticLog } from './diagnostics';

export interface CropDefinition {
  id: CropType;
  name: string;
  growthTicks: number;
  foodYield: number;
  seedCost: number;
  seedYield: number;
  preferredMoisture: readonly [number, number];
  toleratedMoisture: readonly [number, number];
  nutrientDemand: number;
  waterUse: number;
  minTemperature: number;
  preferredTemperature: readonly [number, number];
  maxTemperature: number;
  preferredMaxSalinity: number;
  toleratedMaxSalinity: number;
}

export const CROPS: Record<CropType, CropDefinition> = {
  potato: {
    id: 'potato',
    name: 'Potato',
    growthTicks: 6 * DAY_TICKS,
    foodYield: 48,
    seedCost: 1,
    seedYield: 2,
    preferredMoisture: [45, 72],
    toleratedMoisture: [22, 90],
    nutrientDemand: 35,
    waterUse: 42,
    minTemperature: 5,
    preferredTemperature: [12, 22],
    maxTemperature: 32,
    preferredMaxSalinity: 8,
    toleratedMaxSalinity: 32,
  },
  grain: {
    id: 'grain',
    name: 'Grain',
    growthTicks: 9 * DAY_TICKS,
    foodYield: 72,
    seedCost: 1,
    seedYield: 2,
    preferredMoisture: [36, 62],
    toleratedMoisture: [16, 82],
    nutrientDemand: 45,
    waterUse: 34,
    minTemperature: 4,
    preferredTemperature: [10, 24],
    maxTemperature: 34,
    preferredMaxSalinity: 6,
    toleratedMaxSalinity: 25,
  },
  berry: {
    id: 'berry',
    name: 'Berry',
    growthTicks: 3 * DAY_TICKS,
    foodYield: 20,
    seedCost: 1,
    seedYield: 2,
    preferredMoisture: [55, 78],
    toleratedMoisture: [30, 94],
    nutrientDemand: 25,
    waterUse: 48,
    minTemperature: 7,
    preferredTemperature: [14, 24],
    maxTemperature: 31,
    preferredMaxSalinity: 10,
    toleratedMaxSalinity: 38,
  },
};

export const SEED_LIFETIME = 24 * DAY_TICKS;
export const FERTILIZER_RESTORE = 40;
export const WATERING_AMOUNT = 34;
export const WATERING_WORK_SECONDS = 1.5;
export const FERTILIZING_WORK_SECONDS = 1.5;
export const PLANTING_WORK_SECONDS = 1.2;
export const HARVEST_WORK_SECONDS = 3;
export const FRESH_WATER_SALINITY = 0;
export const BRACKISH_WATER_SALINITY = 32;
export const SALTWATER_SALINITY = 85;
export const SAFE_IRRIGATION_SALINITY = 20;
export const OBVIOUS_SALTWATER_SALINITY = 70;

export interface IrrigationAccess {
  point: Point;
  key: number;
  waterKey: number;
}
export interface IrrigationSource {
  id: string;
  salinity: number;
  sourceClass: WaterSourceClass;
  accessPoints: IrrigationAccess[];
}
export interface IrrigationPerception {
  actualSalinity: number;
  perceivedSalinity: number;
  suitable: boolean;
  reason: 'fresh' | 'acceptable' | 'ambiguous' | 'obviously-saline';
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

export function cropStage(growth: number): CropStage {
  if (growth >= 1) return 'mature';
  if (growth < 0.08) return 'seeded';
  if (growth < 0.2) return 'germinating';
  if (growth < 0.45) return 'seedling';
  return 'growing';
}

export function rangeSuitability(
  value: number,
  preferred: readonly [number, number],
  tolerated: readonly [number, number],
) {
  if (value < tolerated[0] || value > tolerated[1]) return 0;
  if (value >= preferred[0] && value <= preferred[1]) return 1;
  if (value < preferred[0])
    return (value - tolerated[0]) / Math.max(1e-6, preferred[0] - tolerated[0]);
  return (tolerated[1] - value) / Math.max(1e-6, tolerated[1] - preferred[1]);
}

export function moistureSuitability(def: CropDefinition, moisture: number) {
  return clamp(rangeSuitability(moisture, def.preferredMoisture, def.toleratedMoisture), 0, 1);
}

export function nutrientSuitability(def: CropDefinition, nutrients: number) {
  const fullAt = Math.max(18, def.nutrientDemand * 0.55);
  return clamp(nutrients / fullAt, 0, 1);
}

export function salinitySuitability(def: CropDefinition, salinity: number) {
  if (salinity <= def.preferredMaxSalinity) return 1;
  if (salinity >= def.toleratedMaxSalinity) return 0;
  return clamp(
    (def.toleratedMaxSalinity - salinity) /
      Math.max(1e-6, def.toleratedMaxSalinity - def.preferredMaxSalinity),
    0,
    1,
  );
}

/** Future hook: undefined means there is no authoritative temperature system yet. */
export function temperatureSuitability(def: CropDefinition, temperature?: number) {
  if (temperature === undefined) return 1;
  if (temperature < def.minTemperature || temperature > def.maxTemperature) return 0;
  if (temperature >= def.preferredTemperature[0] && temperature <= def.preferredTemperature[1])
    return 1;
  if (temperature < def.preferredTemperature[0])
    return (
      (temperature - def.minTemperature) /
      Math.max(1e-6, def.preferredTemperature[0] - def.minTemperature)
    );
  return (
    (def.maxTemperature - temperature) /
    Math.max(1e-6, def.maxTemperature - def.preferredTemperature[1])
  );
}

export function growthSuitability(def: CropDefinition, soil: AgricultureTile) {
  const moisture = moistureSuitability(def, soil.moisture);
  const nutrients = nutrientSuitability(def, soil.nutrients);
  const temperature = temperatureSuitability(def, undefined);
  const salinity = salinitySuitability(def, soil.salinity);
  return {
    moisture,
    nutrients,
    temperature,
    salinity,
    effective: clamp(moisture * nutrients * temperature * salinity, 0, 1),
  };
}

export function agricultureAt(w: World, p: Point | number) {
  const key = typeof p === 'number' ? p : tileKey(w, p);
  return w.agriculture.find((soil) => soil.key === key);
}

export function ensureAgricultureTile(w: World, key: number, cropType: CropType = 'potato') {
  let soil = agricultureAt(w, key);
  if (!soil) {
    soil = {
      key,
      cropType,
      moisture: w.terrain[key] === 'fertile' ? 68 : 60,
      nutrients: w.terrain[key] === 'fertile' ? 95 : 82,
      salinity: 0,
    };
    w.agriculture.push(soil);
  }
  return soil;
}

export function cropStatus(w: World, crop: Crop) {
  if (crop.growth >= 1) return { text: 'Ready to harvest', stalled: false };
  const soil = agricultureAt(w, crop);
  if (!soil) return { text: 'No growing soil', stalled: true };
  const def = CROPS[crop.kind];
  const suitability = growthSuitability(def, soil);
  if (suitability.moisture <= 0)
    return {
      text: soil.moisture < def.toleratedMoisture[0] ? 'Too dry' : 'Too wet',
      stalled: true,
    };
  if (suitability.nutrients <= 0.05) return { text: 'Nutrient deficient', stalled: true };
  if (suitability.salinity <= 0.05) return { text: 'Salinity stressed', stalled: true };
  if (suitability.effective < 0.65) return { text: 'Growing slowly', stalled: false };
  return { text: 'Growing normally', stalled: false };
}

function stallReason(def: CropDefinition, soil: AgricultureTile) {
  if (soil.moisture < def.toleratedMoisture[0]) return 'dry' as const;
  if (soil.moisture > def.toleratedMoisture[1]) return 'wet' as const;
  if (nutrientSuitability(def, soil.nutrients) <= 0.05) return 'nutrients' as const;
  if (salinitySuitability(def, soil.salinity) <= 0.05) return 'salinity' as const;
  return undefined;
}

export function advanceAgriculture(w: World, elapsedTicks: number, diagnostics?: DiagnosticLog) {
  const precipitation = precipitationIntensity(w);
  for (const soil of w.agriculture) {
    const p = { x: soil.key % w.width, y: Math.floor(soil.key / w.width) };
    const crop = w.crops.find((candidate) => sameTile(candidate, p));
    const rainGain =
      precipitation > 0 && isRainExposed(w, p) ? precipitation * 0.0018 * elapsedTicks : 0;
    const evaporation = (precipitation === 0 ? 0.0012 : 0.0003) * elapsedTicks;
    if (rainGain > 0) applyWaterToSoil(soil, rainGain, FRESH_WATER_SALINITY);
    soil.moisture = clamp(soil.moisture - evaporation);
    if (!crop || crop.growth >= 1) continue;
    const def = CROPS[crop.kind];
    const previousStage = cropStage(crop.growth);
    const suitability = growthSuitability(def, soil);
    const delta = (elapsedTicks / def.growthTicks) * suitability.effective;
    if (delta > 0) {
      crop.growth = clamp(crop.growth + delta, 0, 1);
      soil.moisture = clamp(soil.moisture - def.waterUse * delta);
      soil.nutrients = clamp(soil.nutrients - def.nutrientDemand * delta);
    }
    const nextStage = cropStage(crop.growth);
    if (nextStage !== previousStage)
      diagnostics?.record(w, 'CROP_STAGE_CHANGED', {
        targetId: crop.id,
        position: p,
        values: {
          crop: crop.kind,
          before: previousStage,
          after: nextStage,
          growth: crop.growth,
          moisture: soil.moisture,
          nutrients: soil.nutrients,
          salinity: soil.salinity,
          salinitySuitability: suitability.salinity,
        },
      });
    const reason = stallReason(def, soil);
    if (reason !== crop.stallReason) {
      if (reason)
        diagnostics?.record(
          w,
          reason === 'nutrients'
            ? 'CROP_STALLED_NUTRIENTS'
            : reason === 'salinity'
              ? 'CROP_STALLED_SALINITY'
              : 'CROP_STALLED_MOISTURE',
          {
            targetId: crop.id,
            reason,
            position: p,
            values: {
              crop: crop.kind,
              growth: crop.growth,
              moisture: soil.moisture,
              nutrients: soil.nutrients,
              salinity: soil.salinity,
            },
          },
        );
      else if (crop.stallReason)
        diagnostics?.record(w, 'CROP_RESUMED', {
          targetId: crop.id,
          position: p,
          values: {
            crop: crop.kind,
            growth: crop.growth,
            moisture: soil.moisture,
            nutrients: soil.nutrients,
            salinity: soil.salinity,
          },
        });
      crop.stallReason = reason;
    }
  }
}

export function seedItems(w: World, cropType?: CropType) {
  return w.items.filter(
    (item): item is Item =>
      item.resource === 'seed' && item.quantity > 0 && (!cropType || item.seedType === cropType),
  );
}

export function dropSeed(w: World, p: Point, cropType: CropType, quantity: number) {
  let remaining = Math.max(0, Math.floor(quantity));
  while (remaining > 0) {
    const amount = Math.min(100, remaining);
    w.items.push({
      id: nextId(w, 'item'),
      x: Math.round(p.x),
      y: Math.round(p.y),
      resource: 'seed',
      seedType: cropType,
      quantity: amount,
      spoilsAt: w.tick + SEED_LIFETIME,
    });
    remaining -= amount;
  }
}

export function advanceSeedSpoilage(w: World, diagnostics?: DiagnosticLog) {
  for (const item of [...w.items]) {
    if (item.resource !== 'seed') continue;
    item.spoilsAt ??= w.tick + SEED_LIFETIME;
    const topology = roomTopology(w);
    const indoors = topology.isIndoors(item);
    const sheltered = topology.isSheltered(item);
    const rain = isRainExposed(w, item) ? precipitationIntensity(w) : 0;
    // Keep a conventional absolute expiry deadline. Protected storage advances it,
    // while direct rain shortens it, producing effective ageing rates without a
    // second viability/decay state machine.
    if (indoors) item.spoilsAt += 75;
    else if (sheltered) item.spoilsAt += 45;
    if (rain > 0) item.spoilsAt -= 100 * (1 + rain * 0.65);
    if (w.tick < item.spoilsAt) continue;
    w.items = w.items.filter((candidate) => candidate.id !== item.id);
    diagnostics?.record(w, 'SEED_SPOILED', {
      targetId: item.id,
      position: item,
      values: { crop: item.seedType ?? null, quantity: item.quantity, indoors, sheltered, rain },
    });
  }
}

export function needsWatering(def: CropDefinition, soil: AgricultureTile) {
  return soil.moisture < def.preferredMoisture[0] - 8;
}

export function applyWatering(
  w: World,
  target: Point,
  waterSalinity = FRESH_WATER_SALINITY,
  diagnostics?: DiagnosticLog,
  pawnId?: string,
) {
  const center = tileKey(w, target);
  const keys = [center, center - 1, center + 1, center - w.width, center + w.width];
  let watered = 0;
  for (const key of keys) {
    const soil = agricultureAt(w, key);
    if (!soil) continue;
    const crop = w.crops.find((candidate) => tileKey(w, candidate) === key);
    if (!crop) continue;
    const def = CROPS[crop.kind];
    if (!needsWatering(def, soil)) continue;
    const before = soil.moisture;
    const salinityBefore = soil.salinity;
    applyWaterToSoil(soil, WATERING_AMOUNT, waterSalinity);
    soil.lastWateredAt = w.tick;
    watered++;
    diagnostics?.record(w, 'CROP_WATERED', {
      entityId: pawnId,
      targetId: crop.id,
      position: { x: key % w.width, y: Math.floor(key / w.width) },
      values: {
        crop: crop.kind,
        before,
        after: soil.moisture,
        waterSalinity,
        salinityBefore,
        salinityAfter: soil.salinity,
      },
    });
  }
  return watered;
}

export function applyWaterToSoil(
  soil: AgricultureTile,
  moistureAmount: number,
  waterSalinity: number,
) {
  const added = Math.max(0, Math.min(moistureAmount, 100 - soil.moisture));
  if (added <= 0) return;
  const existingWater = Math.max(10, soil.moisture);
  soil.salinity = clamp(
    (soil.salinity * existingWater + clamp(waterSalinity) * added) / (existingWater + added),
  );
  soil.moisture = clamp(soil.moisture + added);
}

export function applyFertilizer(
  w: World,
  target: Point,
  diagnostics?: DiagnosticLog,
  pawnId?: string,
) {
  const soil = agricultureAt(w, target);
  if (!soil) return false;
  const before = soil.nutrients;
  soil.nutrients = clamp(soil.nutrients + FERTILIZER_RESTORE);
  soil.lastFertilizedAt = w.tick;
  diagnostics?.record(w, 'FERTILIZER_APPLIED', {
    entityId: pawnId,
    targetId: `grow:${soil.key}`,
    position: target,
    values: { before, after: soil.nutrients, amount: FERTILIZER_RESTORE },
  });
  return true;
}

export function waterSalinityAt(w: World, key: number) {
  return w.waterSalinity.find((entry) => entry.key === key)?.salinity ?? FRESH_WATER_SALINITY;
}

export function waterSourceClass(salinity: number): WaterSourceClass {
  if (salinity >= OBVIOUS_SALTWATER_SALINITY) return 'saltwater';
  if (salinity > SAFE_IRRIGATION_SALINITY) return 'brackish';
  return 'fresh';
}

export function perceiveIrrigationSource(
  source: Pick<IrrigationSource, 'salinity'>,
  agricultureKnowledge: number,
): IrrigationPerception {
  const actualSalinity = clamp(source.salinity);
  if (actualSalinity >= OBVIOUS_SALTWATER_SALINITY)
    return {
      actualSalinity,
      perceivedSalinity: actualSalinity,
      suitable: false,
      reason: 'obviously-saline',
    };
  if (actualSalinity <= SAFE_IRRIGATION_SALINITY)
    return {
      actualSalinity,
      perceivedSalinity: actualSalinity,
      suitable: true,
      reason: 'fresh',
    };
  const knowledge = clamp(agricultureKnowledge, 0, 20);
  const perceivedSalinity = actualSalinity * (0.5 + knowledge / 40);
  return {
    actualSalinity,
    perceivedSalinity,
    suitable: perceivedSalinity <= SAFE_IRRIGATION_SALINITY,
    reason: perceivedSalinity <= SAFE_IRRIGATION_SALINITY ? 'acceptable' : 'ambiguous',
  };
}

const sourceCache = new WeakMap<
  World,
  { terrain: TerrainReference; salinity: World['waterSalinity']; sources: IrrigationSource[] }
>();
type TerrainReference = World['terrain'];

export function irrigationSources(w: World): IrrigationSource[] {
  const cached = sourceCache.get(w);
  if (cached?.terrain === w.terrain && cached.salinity === w.waterSalinity) return cached.sources;
  const visited = new Uint8Array(w.width * w.height);
  const sources: IrrigationSource[] = [];
  const salinityByKey = new Map(w.waterSalinity.map((entry) => [entry.key, entry.salinity]));
  const salinityAt = (key: number) => salinityByKey.get(key) ?? FRESH_WATER_SALINITY;
  const neighbours = (key: number) => {
    const x = key % w.width;
    const y = Math.floor(key / w.width);
    return [
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y - 1 },
      { x, y: y + 1 },
    ];
  };
  for (let start = 0; start < w.terrain.length; start++) {
    if (visited[start] || w.terrain[start] !== 'water') continue;
    const salinity = salinityAt(start);
    const queue = [start];
    const access = new Map<number, IrrigationAccess>();
    let minimumKey = start;
    visited[start] = 1;
    while (queue.length) {
      const key = queue.shift()!;
      minimumKey = Math.min(minimumKey, key);
      for (const point of neighbours(key)) {
        if (point.x < 0 || point.y < 0 || point.x >= w.width || point.y >= w.height) continue;
        const neighbourKey = tileKey(w, point);
        if (w.terrain[neighbourKey] === 'water') {
          if (!visited[neighbourKey] && salinityAt(neighbourKey) === salinity) {
            visited[neighbourKey] = 1;
            queue.push(neighbourKey);
          }
        } else if (walkable(w, point) && !access.has(neighbourKey)) {
          access.set(neighbourKey, { point, key: neighbourKey, waterKey: key });
        }
      }
    }
    if (access.size)
      sources.push({
        id: `water:${minimumKey}`,
        salinity,
        sourceClass: waterSourceClass(salinity),
        accessPoints: [...access.values()],
      });
  }
  sourceCache.set(w, { terrain: w.terrain, salinity: w.waterSalinity, sources });
  return sources;
}

export function waterAccessPoints(w: World) {
  return irrigationSources(w).flatMap((source) => source.accessPoints.map((entry) => entry.point));
}

export function nearestWaterAccess(w: World, target: Point) {
  return waterAccessPoints(w).sort((a, b) => distance(a, target) - distance(b, target))[0];
}
