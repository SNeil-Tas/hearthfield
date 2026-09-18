import { BUILDINGS } from './definitions';
import { interruptJob } from './jobs';
import type { Command, World } from './types';
import { drop, inside, nextId, sameTile, tileKey, walkable } from './world';
import { Reservations } from './reservations';

export function applyCommand(w: World, command: Command, reservations: Reservations): number {
  if (command.type === 'priority') {
    const pawn = w.pawns.find((p) => p.id === command.pawnId);
    if (!pawn || !Number.isInteger(command.value) || command.value < 0 || command.value > 4)
      return 0;
    pawn.priorities[command.work] = command.value;
    if (pawn.job && !['eat', 'sleep'].includes(pawn.job.kind)) interruptJob(w, pawn, reservations);
    return 1;
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
        !w.items.some((item) => sameTile(item, p));
      if (command.cancel) {
        if (w.growingZones.includes(key)) {
          w.growingZones = w.growingZones.filter((k) => k !== key);
          const crop = w.crops.find((c) => sameTile(c, p));
          if (crop) w.crops = w.crops.filter((c) => c.id !== crop.id);
          changed++;
        }
      } else if (valid && !w.growingZones.includes(key)) {
        w.growingZones.push(key);
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
        if (w.growingZones.includes(key)) {
          w.growingZones = w.growingZones.filter((k) => k !== key);
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
        !w.stockpiles.includes(tileKey(w, p))
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
