import { TICK_SECONDS } from './definitions';
export type Speed = 0 | 1 | 2 | 4;
export class SimulationClock {
  speed: Speed = 1;
  private accumulator = 0;
  advance(elapsedSeconds: number, step: () => void) {
    if (!this.speed) {
      this.accumulator = 0;
      return;
    }
    // Background tabs never accrue catch-up debt. At most 10 ticks per render.
    this.accumulator += Math.min(elapsedSeconds, 0.25) * this.speed;
    while (this.accumulator + 1e-9 >= TICK_SECONDS) {
      step();
      this.accumulator -= TICK_SECONDS;
    }
  }
}
