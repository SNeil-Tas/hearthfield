import { applyCommand } from './commands';
import { assignJob } from './job-assignment';
import { workCandidates, type Candidate } from './job-board';
import { advanceJob, interruptJob } from './jobs';
import { shouldInterrupt, updateNeeds } from './needs';
import { navigationGrid } from './pathfinding';
import { Reservations } from './reservations';
import type { Command, World } from './types';
import { BUILDINGS } from './definitions';
import { inside, sameTile, tileKey } from './world';

export class Simulation {
  readonly reservations = new Reservations();
  private grid: Uint8Array;
  private board: Candidate[] = [];
  private dirty = true;
  private retries = new Map<string, number>();
  constructor(public world: World) {
    this.grid = navigationGrid(world);
    for (const pawn of world.pawns)
      if (pawn.job && !this.reservations.claim(pawn.job.keys, pawn.id))
        interruptJob(world, pawn, this.reservations);
  }
  command(command: Command) {
    const changed = applyCommand(this.world, command, this.reservations);
    this.dirty = true;
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
      if (advanceJob(w, pawn, this.reservations, this.grid)) {
        this.grid = navigationGrid(w);
        this.dirty = true;
      }
    }
  }
}
