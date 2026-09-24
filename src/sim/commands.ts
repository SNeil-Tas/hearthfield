import { BUILDINGS } from './definitions';
import { interruptJob } from './jobs';
import { CROPS, ensureAgricultureTile } from './agriculture';
import type { Command, World } from './types';
import { drop, inside, nextId, sameTile, tileKey, walkable } from './world';
import { Reservations } from './reservations';

function connectedGrowingZone(w: World, origin: number) {
  const zones = new Set(w.growingZones);
  if (!zones.has(origin)) return [];
  const result: number[] = [];
  const queue = [origin];
  const seen = new Set<number>();
  while (queue.length) {
    const key = queue.shift()!;
    if (seen.has(key) || !zones.has(key)) continue;
    seen.add(key);
    result.push(key);
    const x = key % w.width;
    const y = Math.floor(key / w.width);
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const)
      if (nx >= 0 && ny >= 0 && nx < w.width && ny < w.height) queue.push(ny * w.width + nx);
  }
  return result;
}

export function applyCommand(w: World, command: Command, reservations: Reservations): number {
  if (command.type === 'priority') {
    const pawn = w.pawns.find((p) => p.id === command.pawnId);
    if (!pawn || !Number.isInteger(command.value) || command.value < 0 || command.value > 4)
      return 0;
    pawn.priorities[command.work] = command.value;
    if (pawn.job && !['eat', 'sleep'].includes(pawn.job.kind)) interruptJob(w, pawn, reservations);
    return 1;
  }
  if (command.type === 'crop') {
    if (!Object.hasOwn(CROPS, command.cropType) || !inside(w, command.point)) return 0;
    const origin = tileKey(w, command.point);
    let changed = 0;
    for (const key of connectedGrowingZone(w, origin)) {
      const soil = ensureAgricultureTile(w, key);
      if (soil.cropType !== command.cropType) {
        soil.cropType = command.cropType;
        changed++;
      }
    }
    return changed;
  }
  let changed = 0;
  for (const p of command.points) {
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y) || !inside(w, p)) continue;
    if (command.type === 'growing') {
      const key = tileKey(w, p);
      const valid =
        walkable(w, p) &&
        ['soil', 'fertile'].includes(w.terrain[key]!) &&
        !w.nodes.some((n) => sameTile(n, p)) &&
        !w.buildings.some((b) => sameTile(b, p)) &&
        !w.blueprints.some((b) => sameTile(b, p)) &&
        !w.items.some((item) => sameTile(item, p)) &&
        !w.stockpiles.includes(key);
      if (command.cancel) {
        if (w.growingZones.includes(key)) {
          w.growingZones = w.growingZones.filter((k) => k !== key);
          w.agriculture = w.agriculture.filter((soil) => soil.key !== key);
          const crop = w.crops.find((c) => sameTile(c, p));
          if (crop) w.crops = w.crops.filter((c) => c.id !== crop.id);
          for (const pawn of w.pawns)
            if (pawn.job?.keys.includes(`grow:${key}`)) interruptJob(w, pawn, reservations);
          changed++;
        }
      } else if (valid && !w.growingZones.includes(key)) {
        w.growingZones.push(key);
        ensureAgricultureTile(w, key, 'potato');
        changed++;
      }
    } else if (command.type === 'dump') {
      const key = tileKey(w, p);
      const valid =
        inside(w, p) &&
        !w.buildings.some((b) => sameTile(b, p)) &&
        !w.blueprints.some((b) => sameTile(b, p)) &&
        w.terrain[key] !== 'water';
      if (command.cancel) {
        if (w.dumpZones.includes(key)) {
          w.dumpZones = w.dumpZones.filter((dumpKey) => dumpKey !== key);
          changed++;
        }
      } else if (valid && !w.dumpZones.includes(key)) {
        w.dumpZones.push(key);
        changed++;
      }
    } else if (command.type === 'deconstruct') {
      const building = w.buildings.find((b) => sameTile(b, p));
      if (building && !building.deconstructing) {
        building.deconstructing = true;
        changed++;
      }
    } else if (command.type === 'designate') {
      const node = w.nodes.find((n) => sameTile(n, p));
      if (node && node.designated !== !command.cancel) {
        node.designated = !command.cancel;
        changed++;
      }
      if (command.cancel) {
        const bp = w.blueprints.find((b) => sameTile(b, p));
        for (const pawn of w.pawns)
          if ((node && pawn.job?.targetId === node.id) || (bp && pawn.job?.targetId === bp.id)) {
            if (pawn.job) interruptJob(w, pawn, reservations);
          }
        if (bp) {
          drop(w, bp, 'wood', bp.delivered);
          w.blueprints = w.blueprints.filter((b) => b.id !== bp.id);
          changed++;
        }
        const key = tileKey(w, p);
        if (w.stockpiles.includes(key)) {
          w.stockpiles = w.stockpiles.filter((k) => k !== key);
          changed++;
          for (const pawn of w.pawns)
            if (pawn.job?.kind === 'haul' && sameTile(pawn.job.destination, p))
              interruptJob(w, pawn, reservations);
        }
        if (w.dumpZones.includes(key)) {
          w.dumpZones = w.dumpZones.filter((dumpKey) => dumpKey !== key);
          changed++;
        }
        if (w.growingZones.includes(key)) {
          w.growingZones = w.growingZones.filter((k) => k !== key);
          w.agriculture = w.agriculture.filter((soil) => soil.key !== key);
          const crop = w.crops.find((c) => sameTile(c, p));
          if (crop) w.crops = w.crops.filter((c) => c.id !== crop.id);
          changed++;
        }
      }
    } else if (command.type === 'stockpile') {
      if (
        walkable(w, p) &&
        !w.buildings.some((b) => sameTile(b, p)) &&
        !w.blueprints.some((b) => sameTile(b, p)) &&
        !w.stockpiles.includes(tileKey(w, p)) &&
        !w.growingZones.includes(tileKey(w, p)) &&
        !w.crops.some((c) => sameTile(c, p))
      ) {
        w.stockpiles.push(tileKey(w, p));
        changed++;
      }
    } else if (command.type === 'blueprint') {
      if (
        !BUILDINGS[command.kind] ||
        !walkable(w, p) ||
        w.buildings.some((b) => sameTile(b, p)) ||
        w.blueprints.some((b) => sameTile(b, p)) ||
        w.items.some((i) => sameTile(i, p))
      )
        continue;
      w.blueprints.push({
        id: nextId(w, 'blueprint'),
        kind: command.kind,
        x: p.x,
        y: p.y,
        delivered: 0,
        work: 0,
      });
      w.stockpiles = w.stockpiles.filter((k) => k !== tileKey(w, p));
      changed++;
    }
  }
  return changed;
}
