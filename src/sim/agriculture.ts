import { DAY_TICKS } from './definitions';
import type { AgricultureTile, Crop, CropStage, CropType, Item, Point, World } from './types';
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
  },
};

export const SEED_LIFETIME = 24 * DAY_TICKS;
export const FERTILIZER_RESTORE = 40;
export const WATERING_AMOUNT = 34;
export const WATERING_WORK_SECONDS = 1.5;
export const FERTILIZING_WORK_SECONDS = 1.5;
export const PLANTING_WORK_SECONDS = 1.2;
export const HARVEST_WORK_SECONDS = 3;

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
  return {
    moisture,
    nutrients,
    temperature,
    effective: clamp(moisture * nutrients * temperature, 0, 1),
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
  if (suitability.effective < 0.65) return { text: 'Growing slowly', stalled: false };
  return { text: 'Growing normally', stalled: false };
}

function stallReason(def: CropDefinition, soil: AgricultureTile) {
  if (soil.moisture < def.toleratedMoisture[0]) return 'dry' as const;
  if (soil.moisture > def.toleratedMoisture[1]) return 'wet' as const;
  if (nutrientSuitability(def, soil.nutrients) <= 0.05) return 'nutrients' as const;
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
    soil.moisture = clamp(soil.moisture + rainGain - evaporation);
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
        },
      });
    const reason = stallReason(def, soil);
    if (reason !== crop.stallReason) {
      if (reason)
        diagnostics?.record(
          w,
          reason === 'nutrients' ? 'CROP_STALLED_NUTRIENTS' : 'CROP_STALLED_MOISTURE',
          {
            targetId: crop.id,
            reason,
            position: p,
            values: {
              crop: crop.kind,
              growth: crop.growth,
              moisture: soil.moisture,
              nutrients: soil.nutrients,
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
    soil.moisture = clamp(soil.moisture + WATERING_AMOUNT);
    soil.lastWateredAt = w.tick;
    watered++;
    diagnostics?.record(w, 'CROP_WATERED', {
      entityId: pawnId,
      targetId: crop.id,
      position: { x: key % w.width, y: Math.floor(key / w.width) },
      values: { crop: crop.kind, before, after: soil.moisture },
    });
  }
  return watered;
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

export function waterAccessPoints(w: World) {
  const result: Point[] = [];
  const seen = new Set<number>();
  for (let y = 0; y < w.height; y++)
    for (let x = 0; x < w.width; x++) {
      const key = y * w.width + x;
      if (w.terrain[key] !== 'water') continue;
      for (const p of [
        { x: x - 1, y },
        { x: x + 1, y },
        { x, y: y - 1 },
        { x, y: y + 1 },
      ]) {
        if (!walkable(w, p)) continue;
        const accessKey = tileKey(w, p);
        if (seen.has(accessKey)) continue;
        seen.add(accessKey);
        result.push(p);
      }
    }
  return result;
}

export function nearestWaterAccess(w: World, target: Point) {
  return waterAccessPoints(w).sort((a, b) => distance(a, target) - distance(b, target))[0];
}
