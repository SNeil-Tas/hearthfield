import { BUILDINGS, NODES, TICK_SECONDS } from './definitions';
import { emit } from './events';
import { findPath } from './pathfinding';
import { Reservations } from './reservations';
import type { Pawn, World } from './types';
import { drop, nextId, sameTile, tileKey } from './world';

export function interruptJob(w: World, pawn: Pawn, reservations: Reservations) {
  if (pawn.carrying) {
    drop(w, pawn, pawn.carrying.resource, pawn.carrying.quantity);
    pawn.carrying = null;
  }
  pawn.x = Math.round(pawn.x);
  pawn.y = Math.round(pawn.y);
  pawn.job = null;
  reservations.release(pawn.id);
}
export function advanceJob(
  w: World,
  pawn: Pawn,
  reservations: Reservations,
  grid: Uint8Array,
): boolean {
  const job = pawn.job;
  if (!job) return false;
  const finish = () => {
    pawn.job = null;
    reservations.release(pawn.id);
  };
  const cancel = () => interruptJob(w, pawn, reservations);
  const node = w.nodes.find((n) => n.id === job.targetId);
  const bp = w.blueprints.find((b) => b.id === job.targetId);
  if (
    (['build', 'deliver'].includes(job.kind) && !bp) ||
    (['chop', 'gather'].includes(job.kind) && !node)
  ) {
    cancel();
    return false;
  }
  if (job.path.length) {
    const next = job.path[0]!;
    if (!grid[tileKey(w, next)]) {
      cancel();
      return false;
    }
    const dx = next.x - pawn.x,
      dy = next.y - pawn.y,
      length = Math.hypot(dx, dy);
    const step = TICK_SECONDS * (pawn.rest < 15 ? 1.4 : 2.5);
    if (length <= step) {
      pawn.x = next.x;
      pawn.y = next.y;
      job.path.shift();
    } else {
      pawn.x += (dx / length) * step;
      pawn.y += (dy / length) * step;
    }
    return false;
  }
  if (job.phase === 'source') {
    const item = w.items.find((i) => i.id === job.sourceId);
    if (!item) {
      cancel();
      return false;
    }
    const amount = Math.min(12, item.quantity, bp ? BUILDINGS[bp.kind].cost - bp.delivered : 12);
    if (amount <= 0) {
      cancel();
      return false;
    }
    const path = findPath(w, pawn, job.destination, job.kind === 'deliver', grid);
    if (path === null) {
      cancel();
      return false;
    }
    pawn.carrying = { resource: item.resource, quantity: amount };
    item.quantity -= amount;
    if (!item.quantity) w.items = w.items.filter((i) => i.id !== item.id);
    job.path = path;
    job.phase = 'target';
    return false;
  }
  job.progress += TICK_SECONDS;
  switch (job.kind) {
    case 'move':
      finish();
      break;
    case 'chop':
    case 'gather': {
      if (!node) break;
      node.work += TICK_SECONDS * (1 + pawn.skills.plants * 0.06);
      if (node.work >= NODES[node.kind].work) {
        const def = NODES[node.kind];
        drop(w, node, def.resource, def.yield);
        w.nodes = w.nodes.filter((n) => n.id !== node.id);
        emit(w, `${pawn.name} gathered ${def.yield} ${def.resource}.`, 'success');
        finish();
        return true;
      }
      break;
    }
    case 'haul': {
      if (pawn.carrying) {
        drop(w, job.destination, pawn.carrying.resource, pawn.carrying.quantity);
        pawn.carrying = null;
      }
      finish();
      break;
    }
    case 'deliver': {
      if (bp && pawn.carrying) {
        bp.delivered += pawn.carrying.quantity;
        pawn.carrying = null;
      }
      finish();
      break;
    }
    case 'build': {
      if (!bp) break;
      bp.work += TICK_SECONDS * (1 + pawn.skills.build * 0.06);
      if (bp.work >= BUILDINGS[bp.kind].work) {
        // Never seal a moving colonist into a newly completed wall.
        if (BUILDINGS[bp.kind].blocks && w.pawns.some((p) => sameTile(p, bp))) break;
        w.buildings.push({ id: nextId(w, 'building'), x: bp.x, y: bp.y, kind: bp.kind });
        w.blueprints = w.blueprints.filter((b) => b.id !== bp.id);
        emit(w, `${pawn.name} completed a ${BUILDINGS[bp.kind].label.toLowerCase()}.`, 'success');
        finish();
        return true;
      }
      break;
    }
    case 'eat': {
      const food = w.items.find((i) => i.id === job.sourceId);
      if (!food) {
        cancel();
        break;
      }
      if (job.progress >= 2) {
        food.quantity--;
        if (!food.quantity) w.items = w.items.filter((i) => i.id !== food.id);
        pawn.hunger = Math.min(100, pawn.hunger + 65);
        emit(w, `${pawn.name} stopped for a meal.`);
        finish();
      }
      break;
    }
    case 'sleep': {
      pawn.rest = Math.min(100, pawn.rest + TICK_SECONDS * (job.targetId ? 3.2 : 1.3));
      if (pawn.rest >= 95 || pawn.hunger < 18) finish();
      break;
    }
  }
  return false;
}
