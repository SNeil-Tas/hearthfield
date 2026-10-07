import { roomTopology } from './topology';
import { advanceWeather, updateWetness } from './weather';
import { applyCommand } from './commands';
import { assignJob } from './job-assignment';
import { workCandidates, type Candidate } from './job-board';
import { advanceJob, interruptJob } from './jobs';
import { shouldInterrupt, updateNeeds } from './needs';
import { navigationGrid } from './pathfinding';
import { Reservations } from './reservations';
import type { Command, World } from './types';
import { BUILDINGS } from './definitions';
import {
  advanceAgriculture,
  advanceSeedSpoilage,
  SAFE_IRRIGATION_SALINITY,
  OBVIOUS_SALTWATER_SALINITY,
} from './agriculture';
import { advanceFoodSpoilage, advanceWasteDecay, inside, sameTile, tileKey } from './world';
import { emit } from './events';
import { DiagnosticLog, point } from './diagnostics';
import { reachableMeal } from './selfcare';
import { completeColonyGoals } from './goals';
import {
  JOB_POST_COOLDOWN,
  linkJobPosts,
  postSeenWork,
  synchronizeJobPosts,
  postHousingWork,
} from './posted-jobs';
import { advanceHousing, HOUSING_INTERVAL } from './housing';
import { advanceEcology } from './ecology';
import { advanceColonistHealth, colonistDeathCause } from './health';
import { advanceRelationships, ensureRelationships } from './relationships';
import { advanceFamilies, initializeFamily, updateChildNeeds } from './family';
import { isAdult } from './health';
import { recordLoss, remember } from './psychology';
import { DAY_TICKS } from './definitions';

export interface WorldFeedback {
  entityId: string;
  text: string;
  expiresAt: number;
}

export class Simulation {
  readonly diagnostics = new DiagnosticLog();
  readonly feedback: WorldFeedback[] = [];
  readonly reservations: Reservations;
  private grid: Uint8Array;
  private board: Candidate[] = [];
  private dirty = true;
  private retries = new Map<string, number>();
  private lastThought = new Map<string, number>();
  private lastJobPost = new Map<string, number>();
  constructor(public world: World) {
    this.reservations = new Reservations((action, key, owner) =>
      this.diagnostics.record(world, `RESERVATION_${action.toUpperCase()}`, {
        entityId: owner,
        targetId: key,
        reason: action,
      }),
    );
    this.grid = navigationGrid(world);
    const topology = roomTopology(world);
    topology.onRebuild = (state) =>
      this.diagnostics.record(world, 'ROOM_TOPOLOGY_REBUILT', {
        reason: state.lastChange.reasons.join(', '),
        values: {
          rooms: state.rooms.length,
          created: state.lastChange.created,
          removed: state.lastChange.removed,
          merged: state.lastChange.merged,
          split: state.lastChange.split,
          roofedArea: state.rooms.reduce((n, r) => n + r.roofedArea, 0),
        },
      });
    topology.ensure();
    world.pawns.forEach(initializeFamily);
    ensureRelationships(world);
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
    this.retries.clear();
    return changed;
  }
  step() {
    const w = this.world;
    while (this.feedback.length && this.feedback[0]!.expiresAt <= w.tick) this.feedback.shift();
    roomTopology(w).ensure();
    w.tick++;
    advanceWeather(w, this.diagnostics);
    if (w.tick % 10 === 0) advanceEcology(w, 10, this.diagnostics);
    if (w.tick % 10 === 0) advanceAgriculture(w, 10, this.diagnostics);
    if (w.tick % 100 === 0) {
      advanceSeedSpoilage(w, this.diagnostics);
      let spoiled = 0;
      let affectedStacks = 0;
      const recordLoss = (amount: number) => {
        spoiled += amount;
        affectedStacks++;
      };
      for (const item of [...w.items]) {
        const normalized = advanceFoodSpoilage(w, item, undefined, recordLoss);
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
      if (spoiled > 0)
        this.diagnostics.record(w, 'FOOD_SPOILED', {
          reason: 'periodic spoilage pass',
          values: { spoiled, affectedStacks },
        });
      const compost = advanceWasteDecay(w);
      if (compost.fertilizerProduced > 0) {
        emit(
          w,
          `A Dump zone produced ${compost.fertilizerProduced} fertilizer from aged waste.`,
          'success',
        );
        this.diagnostics.record(w, 'COMPOST_PRODUCED', {
          reason: 'waste matured in Dump zones',
          values: compost,
        });
      }
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
    if (w.tick % HOUSING_INTERVAL === 0) advanceHousing(w, this.grid);
    if (this.dirty || w.tick % 10 === 0) {
      const candidates = workCandidates(w);
      synchronizeJobPosts(w, candidates);
      for (const post of postHousingWork(w, candidates)) {
        this.diagnostics.record(w, 'JOB_POSTED', {
          entityId: post.postedBy,
          targetId: post.targetId,
          jobId: post.id,
          jobType: post.kind,
          reason: 'household housing need',
        });
      }
      for (const pawn of w.pawns) {
        if (!pawn.job || w.tick - (this.lastJobPost.get(pawn.id) ?? -Infinity) < JOB_POST_COOLDOWN)
          continue;
        const post = postSeenWork(w, pawn, candidates, this.reservations);
        if (!post) continue;
        this.lastJobPost.set(pawn.id, w.tick);
        this.feedback.push({
          entityId: pawn.id,
          text: 'I’ll post that job.',
          expiresAt: w.tick + 35,
        });
        this.diagnostics.record(w, 'JOB_POSTED', {
          entityId: pawn.id,
          entityName: pawn.name,
          targetId: post.targetId ?? post.sourceId,
          jobId: post.id,
          jobType: post.kind,
          position: point(pawn),
        });
      }
      this.board = linkJobPosts(w, candidates);
      this.grid = navigationGrid(w);
      this.dirty = false;
    }
    if (w.tick % 100 === 0)
      for (const [key, tick] of this.retries) if (tick <= w.tick) this.retries.delete(key);
    for (let i = 0; i < w.pawns.length; i++) {
      const pawn = w.pawns[i]!;
      if (w.tick % 10 === 0) {
        const hungerBefore = pawn.hunger,
          restBefore = pawn.rest;
        updateWetness(w, pawn, 1, this.diagnostics);
        updateNeeds(w, pawn);
        advanceColonistHealth(w, pawn, 10);
        for (const injury of pawn.injuries)
          if (injury.inflictedAt > w.tick - 10)
            remember(
              w,
              pawn,
              'injury',
              `Recovering from a ${injury.kind}`,
              -4 - injury.severity / 10,
              DAY_TICKS * 2,
            );
        updateChildNeeds(w, pawn);
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
          isAdult(pawn) && pawn.hunger < 20 && pawn.job && pawn.job.kind !== 'eat'
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
      if (!pawn.job && (w.tick + i * 3) % 10 === 0) {
        const assigned = assignJob(
          w,
          pawn,
          this.board,
          this.reservations,
          this.grid,
          this.retries,
          this.diagnostics,
        );
        if (assigned?.kind === 'water') this.addIrrigationThought(pawn, assigned);
        if (assigned?.postId) {
          this.feedback.push({
            entityId: pawn.id,
            text: 'I can take that.',
            expiresAt: w.tick + 35,
          });
          this.diagnostics.record(w, 'JOB_POST_CLAIMED', {
            entityId: pawn.id,
            entityName: pawn.name,
            targetId: assigned.targetId ?? assigned.sourceId,
            jobId: assigned.postId,
            jobType: assigned.kind,
            position: point(pawn),
          });
        }
      }
      if (
        isAdult(pawn) &&
        !pawn.job &&
        w.blueprints.some((b) => BUILDINGS[b.kind].blocks && sameTile(b, pawn))
      ) {
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
      if (advanceJob(w, pawn, this.reservations, this.grid, undefined, this.diagnostics)) {
        this.grid = navigationGrid(w);
        this.dirty = true;
      }
    }
    for (const interaction of advanceRelationships(w)) {
      const text = interaction.positive ? 'Good talk.' : 'That was tense.';
      this.feedback.push(
        { entityId: interaction.first.id, text, expiresAt: w.tick + 35 },
        { entityId: interaction.second.id, text, expiresAt: w.tick + 35 },
      );
      if (interaction.newMutualTier === 'friend')
        emit(
          w,
          `${interaction.first.name} and ${interaction.second.name} became friends.`,
          'success',
        );
      else if (interaction.newMutualTier === 'close-friend')
        emit(
          w,
          `${interaction.first.name} and ${interaction.second.name} became close friends.`,
          'success',
        );
      else if (interaction.newMutualTier === 'rival')
        emit(
          w,
          `${interaction.first.name} and ${interaction.second.name} became rivals.`,
          'warning',
        );
    }
    for (const pawn of [...w.pawns]) {
      const cause = colonistDeathCause(pawn);
      if (!cause) continue;
      recordLoss(w, pawn);
      interruptJob(w, pawn, this.reservations, this.diagnostics, `death: ${cause}`);
      for (const bed of w.buildings) if (bed.ownerId === pawn.id) bed.ownerId = undefined;
      w.jobPosts = w.jobPosts.filter(
        (post) => post.postedBy !== pawn.id && post.claimedBy !== pawn.id,
      );
      w.pawns = w.pawns.filter((candidate) => candidate.id !== pawn.id);
      for (const survivor of w.pawns)
        survivor.relationships = survivor.relationships.filter((r) => r.targetId !== pawn.id);
      emit(w, `${pawn.name} died from ${cause}.`, 'warning');
      this.diagnostics.record(w, 'COLONIST_DIED', {
        entityId: pawn.id,
        entityName: pawn.name,
        reason: cause,
      });
      this.dirty = true;
    }
    advanceFamilies(w);
    roomTopology(w).ensure();
    if (w.tick % 10 === 0) {
      const goals = completeColonyGoals(w);
      if (goals.length) {
        for (const goal of goals) {
          for (const pawn of w.pawns)
            remember(w, pawn, `milestone:${goal.id}`, goal.completedText, 3, DAY_TICKS * 2);
          emit(w, `Milestone: ${goal.completedText}`, 'success');
          this.diagnostics.record(w, 'COLONY_GOAL_COMPLETED', {
            reason: goal.id,
            values: { title: goal.title, completed: w.completedGoals?.length ?? 0 },
          });
        }
        this.feedback.push(
          ...w.pawns.map((pawn) => ({
            entityId: pawn.id,
            text: 'We did it!',
            expiresAt: w.tick + 35,
          })),
        );
      }
    }
  }

  private addIrrigationThought(pawn: World['pawns'][number], candidate: Candidate) {
    const ambiguous = (candidate.irrigationEvaluation ?? []).filter(
      (entry) =>
        entry.actualSalinity > SAFE_IRRIGATION_SALINITY &&
        entry.actualSalinity < OBVIOUS_SALTWATER_SALINITY,
    );
    const judgement =
      candidate.waterSourceClass === 'brackish'
        ? ambiguous.find((entry) => entry.sourceId === candidate.sourceId && entry.suitable)
        : ambiguous.find((entry) => !entry.suitable);
    const text =
      candidate.waterSourceClass === 'brackish' ? 'Looks fine.' : judgement ? 'Too salty.' : '';
    if (!text || !judgement) return;
    if (widenedTickDistance(this.world.tick, this.lastThought.get(pawn.id)) < 300) return;
    this.lastThought.set(pawn.id, this.world.tick);
    this.feedback.push({ entityId: pawn.id, text, expiresAt: this.world.tick + 40 });
    this.diagnostics.record(this.world, 'IRRIGATION_JUDGEMENT', {
      entityId: pawn.id,
      entityName: pawn.name,
      targetId: judgement.sourceId,
      jobType: 'water',
      position: point(pawn),
      values: {
        message: text,
        sourceClass: judgement.sourceClass,
        actualSalinity: judgement.actualSalinity,
        perceivedSalinity: judgement.perceivedSalinity,
        suitable: judgement.suitable,
      },
    });
  }
}

function widenedTickDistance(tick: number, previous?: number) {
  return previous === undefined ? Infinity : tick - previous;
}
