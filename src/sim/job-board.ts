import { BUILDINGS, COOKING_INPUT } from './definitions';
import type { Job, Pawn, Point, WorkType, World } from './types';
import {
  distance,
  tileKey,
  sameTile,
  foodType,
  freshPoints,
  spoiledPoints,
  isFoodSpoiled,
  isDumpTile,
  requiresFoodSeparation,
  effectiveCarryCapacity,
  compatibleStacks,
  stackCapacity,
} from './world';

export interface Candidate {
  kind: Job['kind'];
  sourceId?: string;
  targetId?: string;
  destination: Point;
  source?: Point;
  adjacent: boolean;
  keys: string[];
  work?: WorkType;
  amount?: number;
  score: number;
  personalFoodPlan?: boolean;
}
export function workCandidates(w: World): Candidate[] {
  const candidates: Candidate[] = [];
  for (const node of w.nodes)
    if (node.designated)
      candidates.push({
        kind: node.kind === 'tree' ? 'chop' : 'gather',
        targetId: node.id,
        destination: node,
        adjacent: true,
        keys: [node.id],
        work: 'plants',
        score: 0,
      });
  for (const key of w.growingZones) {
    const tile = { x: key % w.width, y: Math.floor(key / w.width) };
    const crop = w.crops.find((c) => sameTile(c, tile));
    if (!crop)
      candidates.push({
        kind: 'sow',
        targetId: `zone:${key}`,
        destination: tile,
        adjacent: false,
        keys: [`grow:${key}`],
        work: 'plants',
        score: 2,
      });
    else if (crop.growth >= 1)
      candidates.push({
        kind: 'harvest',
        targetId: crop.id,
        destination: crop,
        adjacent: false,
        keys: [crop.id],
        work: 'plants',
        score: -2,
      });
  }
  for (const bp of w.blueprints) {
    if (bp.delivered >= BUILDINGS[bp.kind].cost)
      candidates.push({
        kind: 'build',
        targetId: bp.id,
        destination: bp,
        adjacent: true,
        keys: [bp.id],
        work: 'build',
        score: -3,
      });
    else
      for (const item of w.items)
        if (item.resource === 'wood' && item.quantity > 0)
          candidates.push({
            kind: 'deliver',
            sourceId: item.id,
            targetId: bp.id,
            source: item,
            destination: bp,
            adjacent: true,
            keys: [bp.id, item.id],
            work: 'build',
            score: distance(item, bp) * 0.3,
          });
  }
  for (const building of w.buildings) {
    if (building.deconstructing)
      candidates.push({
        kind: 'deconstruct',
        targetId: building.id,
        destination: building,
        adjacent: true,
        keys: [building.id],
        work: 'build',
        score: 1,
      });
  }
  for (const station of w.buildings.filter((b) => b.kind === 'cooking')) {
    const meals = w.items
      .filter((item) => item.resource === 'food' && foodType(item) === 'meal')
      .reduce((total, item) => total + item.quantity, 0);
    if (meals >= 6) continue;
    const sources = w.items
      .filter(
        (item) =>
          item.resource === 'food' &&
          foodType(item) === 'raw' &&
          freshPoints(item) >= 1 &&
          !requiresFoodSeparation(item) &&
          !station.reservedBy,
      )
      .sort((a, b) => {
        const score = (item: typeof a) => {
          const useful = Math.min(freshPoints(item), effectiveCarryCapacity('food'), 100);
          return distance(item, station) * 0.5 - useful * 2;
        };
        return score(a) - score(b);
      });
    for (const item of sources.slice(0, 1)) {
      const useful = Math.min(freshPoints(item), effectiveCarryCapacity('food'), 100);
      candidates.push({
        kind: 'cook',
        sourceId: item.id,
        targetId: station.id,
        source: item,
        destination: station,
        adjacent: true,
        keys: [item.id, station.id],
        work: 'cook',
        score: distance(item, station) * 0.5 - useful * 2,
      });
    }
  }
  const stored = new Set(w.stockpiles);
  const dumps = w.dumpZones.map((key) => ({ x: key % w.width, y: Math.floor(key / w.width) }));
  for (const item of w.items)
    if (item.resource === 'waste' && dumps.length && !isDumpTile(w, item)) {
      const destination = dumps.sort((a, b) => distance(item, a) - distance(item, b))[0]!;
      candidates.push({
        kind: 'haul',
        sourceId: item.id,
        source: item,
        destination,
        adjacent: true,
        keys: [item.id, `dump:${tileKey(w, destination)}`],
        work: 'haul',
        score: -20 + distance(item, destination) * 0.2,
      });
    }
  const space = w.stockpiles
    .map((k) => ({ x: k % w.width, y: Math.floor(k / w.width) }))
    .filter(
      (p) =>
        !w.blueprints.some((b) => sameTile(b, p)) &&
        !w.buildings.some((b) => sameTile(b, p)) &&
        true,
    );
  for (const item of w.items)
    if (
      item.quantity > 1e-6 &&
      !stored.has(tileKey(w, item)) &&
      (item.resource !== 'food' ||
        foodType(item) !== 'raw' ||
        (freshPoints(item) > 1e-6 && !requiresFoodSeparation(item))) &&
      !(item.resource === 'waste' && isDumpTile(w, item))
    ) {
      const destinations = [...space]
        .map((destination) => {
          const compatible = w.items.filter(
            (candidate) => sameTile(candidate, destination) && compatibleStacks(candidate, item),
          );
          const room = compatible.reduce(
            (n, candidate) => n + Math.max(0, stackCapacity(candidate) - candidate.quantity),
            0,
          );
          return { destination, room, compatible };
        })
        .filter(({ room, compatible }) => room > 1e-6 || compatible.length === 0)
        .sort((a, b) =>
          b.room > a.room ? -1 : distance(a.destination, item) - distance(b.destination, item),
        )
        .slice(0, 1);
      for (const { destination } of destinations)
        candidates.push({
          kind: 'haul',
          sourceId: item.id,
          source: item,
          destination,
          adjacent: true,
          keys: [item.id, `store:${tileKey(w, destination)}`],
          work: 'haul',
          score: distance(item, destination) * 0.2,
        });
    }
  // Low-priority stockpile tidy-up. A job is offered only when it removes a
  // whole source stack and the destination has real capacity.
  const activeSources = new Set(
    w.pawns.flatMap((pawn) => [pawn.job?.sourceId, pawn.job?.targetId]).filter(Boolean),
  );
  for (const source of w.items) {
    if (!w.stockpiles.includes(tileKey(w, source)) || activeSources.has(source.id)) continue;
    const target = w.items
      .filter(
        (candidate) =>
          candidate.id !== source.id &&
          w.stockpiles.includes(tileKey(w, candidate)) &&
          compatibleStacks(candidate, source) &&
          stackCapacity(candidate) - candidate.quantity >= source.quantity - 1e-6 &&
          candidate.quantity >= source.quantity,
      )
      .sort((a, b) => b.quantity - a.quantity)[0];
    if (!target || sameTile(source, target)) continue;
    candidates.push({
      kind: 'haul',
      sourceId: source.id,
      targetId: target.id,
      source,
      destination: target,
      adjacent: true,
      keys: [source.id, target.id],
      work: 'haul',
      score: 40 + distance(source, target) * 0.4,
    });
  }
  for (const item of w.items)
    if (requiresFoodSeparation(item))
      candidates.push({
        kind: 'separate',
        sourceId: item.id,
        targetId: item.id,
        source: item,
        destination: item,
        adjacent: true,
        keys: [item.id],
        work: 'haul',
        score: 50,
      });
  return candidates;
}
export function needCandidates(w: World, pawn: Pawn): Candidate[] {
  const candidates: Candidate[] = [];
  if (pawn.hunger < 38)
    for (const item of w.items)
      if (
        item.resource === 'food' &&
        (foodType(item) === 'meal' || item.foodKind === 'berries' || pawn.hunger <= 18) &&
        item.quantity > 1e-6 &&
        !isFoodSpoiled(w, item)
      )
        candidates.push({
          kind: 'eat',
          sourceId: item.id,
          destination: item,
          adjacent: true,
          keys: [item.id],
          score:
            -1000 +
            distance(pawn, item) +
            (foodType(item) === 'meal' ? -40 : item.foodKind === 'berries' ? -10 : 20),
        });
  // Food in the wild remains an autonomous fallback when stores are exhausted.
  if (pawn.hunger < 30 && !w.items.some((i) => i.resource === 'food'))
    for (const node of w.nodes)
      if (node.kind === 'berries')
        candidates.push({
          kind: 'gather',
          targetId: node.id,
          destination: node,
          adjacent: true,
          keys: [node.id],
          score: -900 + distance(pawn, node),
        });
  if (pawn.rest < 28 && pawn.hunger > 12) {
    for (const bed of w.buildings)
      if (bed.kind === 'bed')
        candidates.push({
          kind: 'sleep',
          targetId: bed.id,
          destination: bed,
          adjacent: false,
          keys: [bed.id],
          score:
            -800 + distance(pawn, bed) + (bed.ownerId === pawn.id ? -35 : bed.ownerId ? 10 : 0),
        });
    candidates.push({
      kind: 'sleep',
      destination: { x: Math.round(pawn.x), y: Math.round(pawn.y) },
      adjacent: false,
      keys: [`sleep:${tileKey(w, pawn)}`],
      score: -500,
    });
  }
  if (pawn.hunger < 35) {
    for (const station of w.buildings) {
      if (station.kind !== 'cooking' || station.reservedBy) continue;
      const sources = w.items
        .filter((i) => i.resource === 'food' && foodType(i) === 'raw' && freshPoints(i) >= 1)
        .sort(
          (a, b) =>
            distance(a, station) * 0.5 -
            Math.min(freshPoints(a), 100) * 2 -
            (distance(b, station) * 0.5 - Math.min(freshPoints(b), 100) * 2),
        );
      const enoughForEmergencyRecipe =
        w.items
          .filter((item) => item.resource === 'food' && foodType(item) === 'raw')
          .reduce((total, item) => total + freshPoints(item), 0) >= COOKING_INPUT;
      for (const raw of enoughForEmergencyRecipe ? sources : [])
        candidates.push({
          kind: 'cook',
          sourceId: raw.id,
          targetId: station.id,
          source: raw,
          destination: station,
          adjacent: true,
          keys: [station.id, raw.id],
          score: -1100,
          personalFoodPlan: true,
        });
    }
  }
  return candidates;
}
export function rankCandidate(pawn: Pawn, candidate: Candidate) {
  if (!candidate.work) return candidate.score;
  const priority = pawn.priorities[candidate.work];
  return priority === 0
    ? Infinity
    : priority * 100 +
        distance(pawn, candidate.source ?? candidate.destination) +
        candidate.score -
        pawn.skills[candidate.work] * 2;
}
