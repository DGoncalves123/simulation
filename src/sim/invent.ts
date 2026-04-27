import {
  SPONTANEOUS_INITIAL_CRED, SPONTANEOUS_INVENT_PROB,
} from './constants';
import type { BeliefRegistry } from './beliefs';
import type { SimState } from './state';
import { upsertBelief } from './state';

// Per tick, with small probability, a random agent invents a wholly new
// belief with high credibility (active on adoption). This is the trigger —
// without it, the world is forever non-reactionary.
export function maybeInvent(
  state: SimState,
  registry: BeliefRegistry,
  rand: () => number,
): void {
  if (rand() >= SPONTANEOUS_INVENT_PROB) return;
  if (state.count === 0) return;
  let who = (rand() * state.count) | 0;
  if (!state.alive[who]) {
    // Try a few times to find an alive agent, else bail.
    for (let t = 0; t < 10; t++) {
      who = (rand() * state.count) | 0;
      if (state.alive[who]) break;
    }
    if (!state.alive[who]) return;
  }
  const phrase = registry.generate();
  const id = registry.intern(phrase);
  upsertBelief(state, who, id, SPONTANEOUS_INITIAL_CRED);
}
