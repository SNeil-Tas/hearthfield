import {
  agricultureAt,
  CROPS,
  cropStage,
  cropStatus,
  growthSuitability,
  salinitySuitability,
  seedItems,
  waterSourceClass,
} from '../sim/agriculture';
import type { Crop, Point, World } from '../sim/types';
import { resourceTotal, tileKey } from '../sim/world';
import { escapeHTML } from './icons';

function band(
  value: number,
  preferred: readonly [number, number],
  tolerated: readonly [number, number],
) {
  if (value < tolerated[0]) return 'Too dry';
  if (value > tolerated[1]) return 'Too wet';
  if (value >= preferred[0] && value <= preferred[1]) return 'Suitable';
  return 'Marginal';
}
export function agricultureContextHTML(w: World, point: Point, crop?: Crop) {
  const key = tileKey(w, point);
  if (!w.growingZones.includes(key)) return '';
  const soil = agricultureAt(w, key);
  if (!soil) return '';
  const actualCrop = crop ?? w.crops.find((candidate) => tileKey(w, candidate) === key);
  const planned = CROPS[soil.cropType];
  const current = actualCrop ? CROPS[actualCrop.kind] : planned;
  const status = actualCrop
    ? cropStatus(w, actualCrop).text
    : seedItems(w, soil.cropType).length
      ? 'Ready to plant'
      : 'No seed available';
  const factors = growthSuitability(current, soil);
  const stage = actualCrop ? cropStage(actualCrop.growth) : 'unplanted';
  const stageName = stage === 'unplanted' ? 'Unplanted' : stage[0]!.toUpperCase() + stage.slice(1);
  const choices = (Object.keys(CROPS) as Array<keyof typeof CROPS>)
    .map((type) => {
      const def = CROPS[type];
      const selected = soil.cropType === type ? ' aria-pressed="true"' : '';
      const seeds = seedItems(w, type).reduce((n, item) => n + item.quantity, 0);
      return `<button class="text-button" data-action="crop" data-value="${key}:${type}"${selected}>${def.name} <span>${seeds} seed</span></button>`;
    })
    .join('');
  const saltSuitability = salinitySuitability(current, soil.salinity);
  const irrigator = soil.lastWateredBy
    ? w.pawns.find((pawn) => pawn.id === soil.lastWateredBy)?.name
    : undefined;
  const irrigationHistory =
    soil.lastWateredAt === undefined
      ? ''
      : `<br>Last irrigation: ${waterSourceClass(soil.lastWaterSalinity ?? 0)} water${irrigator ? ` · ${escapeHTML(irrigator)}` : ''}`;
  return `<span class="eyebrow">GROWING ZONE · ${current.name.toUpperCase()}</span><h3>${stageName}</h3><p>Crop: ${current.name}<br>Stage: ${stageName}${actualCrop ? `<br>Growth: ${Math.round(actualCrop.growth * 100)}%` : ''}<br>Moisture: ${Math.round(soil.moisture)} / ${band(soil.moisture, current.preferredMoisture, current.toleratedMoisture)}<br>Nutrients: ${Math.round(soil.nutrients)} / ${factors.nutrients >= 0.95 ? 'Suitable' : factors.nutrients <= 0.05 ? 'Deficient' : 'Low'} · ${resourceTotal(w, 'fertilizer')} fertilizer available<br>Soil salinity: ${soil.salinity.toFixed(1)} / ${saltSuitability >= 0.95 ? 'Suitable' : saltSuitability <= 0.05 ? 'Stressed' : 'Marginal'}${irrigationHistory}<br>Temperature: Not simulated / Suitable<br>Status: ${status}</p><div class="crop-choice">${choices}</div>`;
}
