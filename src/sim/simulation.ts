import { applyCommand } from './commands';
import { assignJob } from './job-assignment';
import { workCandidates, type Candidate } from './job-board';
import { advanceJob, interruptJob } from './jobs';
import { shouldInterrupt, updateNeeds } from './needs';
import { navigationGrid } from './pathfinding';
import { Reservations } from './reservations';
import type { Command, World } from './types';
import { BUILDINGS, CROP_GROWTH_TICKS } from './definitions';
import { inside, sameTile, shelteredTiles, tileKey } from './world';

export class Simulation {
  readonly reservations = new Reservations();
  private grid: Uint8Array;
  private board: Candidate[] = [];
  private dirty = true;
  private topologyDirty = true;
  private retries = new Map<string, number>();
  private sheltered: Set<number>;
  constructor(public world: World) {
    this.grid = navigationGrid(world);
    this.sheltered = shelteredTiles(world);
    for (const pawn of world.pawns)
      if (pawn.job && !this.reservations.claim(pawn.job.keys, pawn.id))
        interruptJob(world, pawn, this.reservations);
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
        updateNeeds(pawn);
        if (shouldInterrupt(pawn)) interruptJob(w, pawn, this.reservations);
      }
      if (!pawn.job && (w.tick + i * 3) % 10 === 0)
        assignJob(w, pawn, this.board, this.reservations, this.grid, this.retries);
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
      if (advanceJob(w, pawn, this.reservations, this.grid, this.sheltered)) {
        this.grid = navigationGrid(w);
        this.dirty = true;
        if (jobKind === 'build' || jobKind === 'deconstruct') this.topologyDirty = true;
      }
    }
  }
}
