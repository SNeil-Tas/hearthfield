import type { Pawn, Point, WeatherKind, World } from './types';
import type { DiagnosticLog } from './diagnostics';
import { roomTopology } from './topology';
import { randomFrom } from './random';
import { emit } from './events';

// Durations are fixed simulation ticks; wetting/drying rates are points per second.
export const WEATHER = {
  clear: { label: 'Clear', precipitation: 0, duration: [1800, 3600], spoilage: 1, fieldWork: 1 },
  rain: {
    label: 'Rain',
    precipitation: 1,
    duration: [1800, 3000],
    spoilage: 1.12,
    fieldWork: 0.82,
  },
  'heavy-rain': {
    label: 'Heavy rain',
    precipitation: 2,
    duration: [900, 1800],
    spoilage: 1.35,
    fieldWork: 0.65,
  },
  storm: {
    label: 'Storm',
    precipitation: 3,
    duration: [600, 1200],
    spoilage: 1.45,
    fieldWork: 0.6,
  },
} as const;
const KINDS: WeatherKind[] = ['clear', 'rain', 'heavy-rain', 'storm'];
// Clear spells are common; storms usually develop out of heavier rain and ease afterwards.
const WEIGHTS: Record<WeatherKind, number[]> = {
  clear: [45, 48, 7, 0],
  rain: [55, 20, 22, 3],
  'heavy-rain': [30, 45, 15, 10],
  storm: [20, 50, 30, 0],
};

export function precipitationIntensity(w: World) {
  return WEATHER[w.weather].precipitation;
}
export function isRainExposed(w: World, p: Point) {
  const x = Math.round(p.x),
    y = Math.round(p.y);
  return (
    precipitationIntensity(w) > 0 &&
    x >= 0 &&
    y >= 0 &&
    x < w.width &&
    y < w.height &&
    !roomTopology(w).isSheltered(p)
  );
}
export function rainSpoilageMultiplier(w: World, p: Point) {
  return isRainExposed(w, p) ? WEATHER[w.weather].spoilage : 1;
}
export function exposedFieldWorkMultiplier(w: World, p: Point) {
  return isRainExposed(w, p) ? WEATHER[w.weather].fieldWork : 1;
}
export function weatherSnapshot(w: World) {
  return {
    kind: w.weather,
    precipitation: precipitationIntensity(w),
    startedAt: w.weatherStartedAt ?? 0,
    elapsedTicks: Math.max(0, w.tick - (w.weatherStartedAt ?? 0)),
    endsAt: w.weatherUntil,
    remainingTicks: Math.max(0, w.weatherUntil - w.tick),
  };
}
export function advanceWeather(w: World, diagnostics?: DiagnosticLog) {
  if (w.tick < w.weatherUntil) return;
  const previous = w.weather;
  // Independent of pawn count, rendering and other random draws; saved deadline and
  // kind reproduce the next transition without storing a mutable random generator.
  const random = randomFrom(
    w.seed ^ Math.imul(w.weatherUntil, 0x45d9f3b) ^ KINDS.indexOf(previous),
  );
  let roll = random() * 100;
  let next: WeatherKind = 'clear';
  for (let i = 0; i < KINDS.length; i++) {
    roll -= WEIGHTS[previous][i]!;
    if (roll < 0) {
      next = KINDS[i]!;
      break;
    }
  }
  const [min, max] = WEATHER[next].duration;
  w.weather = next;
  w.weatherStartedAt = w.tick;
  w.weatherUntil = w.tick + min + Math.floor(random() * (max - min + 1));
  diagnostics?.record(w, 'WEATHER_TRANSITION', {
    values: {
      previous,
      current: next,
      endsAt: w.weatherUntil,
      durationTicks: w.weatherUntil - w.tick,
    },
  });
  if (previous !== next)
    emit(w, `Weather changed to ${WEATHER[next].label.toLowerCase()}.`, 'info');
}

export type WetnessBand = 'Dry' | 'Damp' | 'Wet' | 'Soaked';
export function wetnessBand(value = 0): WetnessBand {
  return value < 1 ? 'Dry' : value < 40 ? 'Damp' : value < 75 ? 'Wet' : 'Soaked';
}
export function wetnessMoodPenalty(pawn: Pawn) {
  const band = wetnessBand(pawn.wetness);
  return band === 'Soaked' ? -4 : band === 'Wet' ? -2 : 0;
}
export function pawnWeatherSnapshot(w: World, pawn: Pawn) {
  return {
    wetness: pawn.wetness ?? 0,
    wetnessBand: wetnessBand(pawn.wetness),
    rainExposed: isRainExposed(w, pawn),
    wetnessMoodPenalty: wetnessMoodPenalty(pawn),
  };
}
const exposure = new WeakMap<Pawn, boolean>();
export function updateWetness(w: World, pawn: Pawn, seconds: number, diagnostics?: DiagnosticLog) {
  const before = wetnessBand(pawn.wetness),
    exposed = isRainExposed(w, pawn);
  const topology = roomTopology(w);
  const rate = exposed
    ? 0.45 * precipitationIntensity(w)
    : topology.isIndoors(pawn)
      ? -0.8
      : topology.isSheltered(pawn)
        ? -0.6
        : -0.35;
  pawn.wetness = Math.max(0, Math.min(100, (pawn.wetness ?? 0) + rate * Math.max(0, seconds)));
  const after = wetnessBand(pawn.wetness),
    previousExposure = exposure.get(pawn);
  if (before !== after)
    diagnostics?.record(w, 'WETNESS_BAND_CHANGED', {
      entityId: pawn.id,
      entityName: pawn.name,
      values: { before, after, wetness: pawn.wetness, rainExposed: exposed },
    });
  if (previousExposure !== undefined && previousExposure !== exposed)
    diagnostics?.record(w, 'RAIN_EXPOSURE_CHANGED', {
      entityId: pawn.id,
      entityName: pawn.name,
      values: { rainExposed: exposed, roofed: topology.isRoofed(pawn) },
    });
  exposure.set(pawn, exposed);
}
