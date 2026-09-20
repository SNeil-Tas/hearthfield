import { applyCommand } from './commands';
import { assignJob } from './job-assignment';
import { workCandidates, type Candidate } from './job-board';
import { advanceJob, interruptJob } from './jobs';
import { shouldInterrupt, updateNeeds } from './needs';
import { navigationGrid } from './pathfinding';
import { Reservations } from './reservations';
import type { Command, World } from './types';
import { BUILDINGS, CROP_GROWTH_TICKS } from './definitions';
import {
  advanceFoodSpoilage,
  advanceWasteDecay,
  inside,
  sameTile,
  shelteredTiles,
  tileKey,
} from './world';
import { emit } from './events';
import { DiagnosticLog, point } from './diagnostics';
import { reachableMeal } from './selfcare';

export class Simulation {
  readonly diagnostics = new DiagnosticLog();
  readonly reservations: Reservations;
  private grid: Uint8Array;
  private board: Candidate[] = [];
  private dirty = true;
  private topologyDirty = true;
  private retries = new Map<string, number>();
  private sheltered: Set<number>;
  constructor(public world: World) {
    this.reservations = new Reservations((action, key, owner) =>
      this.diagnostics.record(world, `RESERVATION_${action.toUpperCase()}`, {
        entityId: owner,
        targetId: key,
        reason: action,
      }),
    );
    this.grid = navigationGrid(world);
    this.sheltered = shelteredTiles(world);
    for (const pawn of world.pawns)
      if (pawn.job && !this.reservations.claim(pawn.job.keys, pawn.id))
        interruptJob(
          world,
          pawn,
          this.reservations,
          this.diagnostics,
          'save reservation could not be restored',
        );
  }
  command(command: Command) {
    const changed = applyCommand(this.world, command, this.reservations);
    this.dirty = true;
    if (command.type === 'blueprint' || command.type === 'deconstruct') this.topologyDirty = true;
    this.retries.clear();
    return changed;
  }
  step() {
    const w = this.world;
    w.tick++;
    if (w.tick >= w.weatherUntil) {
      w.weather = w.weather === 'clear' ? 'rain' : w.weather === 'rain' ? 'heavy-rain' : 'clear';
      w.weatherUntil = w.tick + (w.weather === 'heavy-rain' ? 900 : 1800);
      emit(
        w,
        `Weather changed to ${w.weather === 'heavy-rain' ? 'heavy rain' : w.weather}.`,
        'info',
      );
    }
    if (w.tick % 100 === 0) {
      for (const item of [...w.items]) {
        const normalized = advanceFoodSpoilage(w, item, this.sheltered);
        if (normalized)
          this.diagnostics.record(w, 'RAW_FOOD_NORMALIZED_TO_WASTE', {
            targetId: normalized.itemId,
            values: {
              freshBefore: normalized.freshBefore,
              spoiledBefore: normalized.spoiledBefore,
              spoiledFoodCreated: normalized.spoiledFoodCreated,
            },
          });
      }
      advanceWasteDecay(w);
      for (const pawn of w.pawns) {
        if (pawn.illnessUntil !== undefined && pawn.illnessUntil <= w.tick) {
          pawn.illnessUntil = undefined;
          emit(w, `${pawn.name} recovered from a mild illness.`, 'success');
        }
        if (
          pawn.illnessUntil === undefined &&
          (w.tick + w.seed + pawn.id.length * 17) % 24000 === 0
        ) {
          pawn.illnessUntil = w.tick + 900;
          emit(w, `${pawn.name} is mildly ill and will recover naturally.`, 'warning');
        }
      }
    }
    if (this.dirty || w.tick % 10 === 0) {
      this.board = workCandidates(w);
      this.grid = navigationGrid(w);
      this.dirty = false;
    }
    if (this.topologyDirty) {
      this.sheltered = shelteredTiles(w);
      this.topologyDirty = false;
    }
    if (w.tick % 10 === 0)
      for (const crop of w.crops)
        if (crop.growth < 1) crop.growth = Math.min(1, crop.growth + 10 / CROP_GROWTH_TICKS);
    if (w.tick % 100 === 0)
      for (const [key, tick] of this.retries) if (tick <= w.tick) this.retries.delete(key);
    for (let i = 0; i < w.pawns.length; i++) {
      const pawn = w.pawns[i]!;
      if (w.tick % 10 === 0) {
        const hungerBefore = pawn.hunger;
        const restBefore = pawn.rest;
        updateNeeds(w, pawn);
        if (hungerBefore >= 35 && pawn.hunger < 35)
          this.diagnostics.record(w, 'HUNGER_THRESHOLD_CROSSED', {
            entityId: pawn.id,
            entityName: pawn.name,
            reason: 'hungry',
            values: { before: hungerBefore, after: pawn.hunger, threshold: 35 },
          });
        if (hungerBefore >= 18 && pawn.hunger < 18)
          this.diagnostics.record(w, 'HUNGER_THRESHOLD_CROSSED', {
            entityId: pawn.id,
            entityName: pawn.name,
            reason: 'critical',
            values: { before: hungerBefore, after: pawn.hunger, threshold: 18 },
          });
        if (restBefore >= 28 && pawn.rest < 28)
          this.diagnostics.record(w, 'REST_THRESHOLD_CROSSED', {
            entityId: pawn.id,
            entityName: pawn.name,
            reason: 'critical rest',
            values: { before: restBefore, after: pawn.rest, threshold: 28 },
          });
        const readyMeal =
          pawn.hunger < 20 && pawn.job && pawn.job.kind !== 'eat'
            ? reachableMeal(w, pawn, this.reservations, this.grid)
            : undefined;
        if (readyMeal) {
          const previousJob = pawn.job!.kind;
          interruptJob(
            w,
            pawn,
            this.reservations,
            this.diagnostics,
            'critical hunger: prepared meal',
          );
          this.reservations.claim([readyMeal.item.id], pawn.id);
          pawn.job = {
            kind: 'eat',
            sourceId: readyMeal.item.id,
            destination: readyMeal.item,
            path: readyMeal.path!,
            phase: 'target',
            progress: 0,
            keys: [readyMeal.item.id],
            personalFoodPlan: true,
          };
          this.diagnostics.record(w, 'SELFCARE_PREEMPTED_JOB', {
            entityId: pawn.id,
            targetId: readyMeal.item.id,
            jobType: previousJob,
            values: { hunger: pawn.hunger, selectedPlan: 'eat' },
          });
        } else if (shouldInterrupt(pawn))
          interruptJob(w, pawn, this.reservations, this.diagnostics, 'need threshold');
      }
      if (!pawn.job && (w.tick + i * 3) % 10 === 0)
        assignJob(
          w,
          pawn,
          this.board,
          this.reservations,
          this.grid,
          this.retries,
          this.diagnostics,
        );
      if (!pawn.job && w.blueprints.some((b) => BUILDINGS[b.kind].blocks && sameTile(b, pawn))) {
        const x = Math.round(pawn.x),
          y = Math.round(pawn.y);
        const destination = [
          { x: x + 1, y },
          { x: x - 1, y },
          { x, y: y + 1 },
          { x, y: y - 1 },
        ].find(
          (p) =>
            inside(w, p) && this.grid[tileKey(w, p)] && !w.blueprints.some((b) => sameTile(b, p)),
        );
        if (destination)
          pawn.job = {
            kind: 'move',
            destination,
            path: [destination],
            phase: 'target',
            progress: 0,
            keys: [],
          };
      }
      const jobKind = pawn.job?.kind;
      if (advanceJob(w, pawn, this.reservations, this.grid, this.sheltered, this.diagnostics)) {
        this.grid = navigationGrid(w);
        this.dirty = true;
        if (jobKind === 'build' || jobKind === 'deconstruct') this.topologyDirty = true;
      }
    }
  }
}
