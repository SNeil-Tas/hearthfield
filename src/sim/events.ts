import type { GameEvent, World } from './types';
export function emit(world: World, text: string, kind: GameEvent['kind'] = 'info') {
  world.events.push({ tick: world.tick, text, kind });
  if (world.events.length > 40) world.events.shift();
}
