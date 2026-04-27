import {
  ENERGY_INITIAL, MAX_AGENTS, MAX_BELIEFS_PER_AGENT, WORLD_SIZE,
} from './constants';
import { mulberry32 } from './rng';

export interface SimState {
  capacity: number;
  // Exclusive upper bound on used indices. Holes (alive[i]==0) below `count`
  // are tracked in `freeSlots` for reuse by reproduction.
  count: number;
  // Live population (for stats). Always ≤ count.
  live: number;
  positions: Float32Array;
  velocities: Float32Array;
  energies: Float32Array;
  alive: Uint8Array;
  beliefIds: Uint32Array;
  credibilities: Float32Array;
  // Dominant-active-belief ID for rendering. 0 = no active belief (grey).
  dominantBelief: Uint32Array;
  // Pre-allocated stack of freed indices. Push on death, pop on birth.
  freeSlots: Int32Array;
  freeCount: number;
}

export function createState(capacity: number = MAX_AGENTS): SimState {
  return {
    capacity,
    count: 0,
    live: 0,
    positions: new Float32Array(capacity * 2),
    velocities: new Float32Array(capacity * 2),
    energies: new Float32Array(capacity),
    alive: new Uint8Array(capacity),
    beliefIds: new Uint32Array(capacity * MAX_BELIEFS_PER_AGENT),
    credibilities: new Float32Array(capacity * MAX_BELIEFS_PER_AGENT),
    dominantBelief: new Uint32Array(capacity),
    freeSlots: new Int32Array(capacity),
    freeCount: 0,
  };
}

// Allocate a new agent index: pop from free-list if any, else append.
// Returns -1 if at capacity.
export function allocAgent(state: SimState): number {
  if (state.freeCount > 0) {
    const i = state.freeSlots[--state.freeCount];
    state.alive[i] = 1;
    state.live++;
    return i;
  }
  if (state.count >= state.capacity) return -1;
  const i = state.count++;
  state.alive[i] = 1;
  state.live++;
  return i;
}

// Mark an agent dead and push its index onto the free list.
// Wipes belief slots and zeros velocity so reuse starts clean.
export function killAgent(state: SimState, i: number): void {
  if (!state.alive[i]) return;
  state.alive[i] = 0;
  state.live--;
  state.velocities[i * 2] = 0;
  state.velocities[i * 2 + 1] = 0;
  state.energies[i] = 0;
  state.dominantBelief[i] = 0;
  const base = i * MAX_BELIEFS_PER_AGENT;
  for (let k = 0; k < MAX_BELIEFS_PER_AGENT; k++) {
    state.beliefIds[base + k] = 0;
    state.credibilities[base + k] = 0;
  }
  state.freeSlots[state.freeCount++] = i;
}

export function seedAgents(state: SimState, n: number, seed = 1): () => number {
  const rand = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    state.positions[i * 2] = rand() * WORLD_SIZE;
    state.positions[i * 2 + 1] = rand() * WORLD_SIZE;
    state.velocities[i * 2] = 0;
    state.velocities[i * 2 + 1] = 0;
    state.energies[i] = ENERGY_INITIAL;
    state.alive[i] = 1;
  }
  state.count = n;
  state.live = n;
  state.freeCount = 0;
  return rand;
}

// Set (or raise) credibility of a belief in an agent's slot set.
// If already present, take the max with newCredibility.
// If not present, place in first free slot. If full, replace the weakest
// slot only if newCredibility exceeds its credibility.
// Returns true if the belief ended up in the agent.
export function upsertBelief(
  state: SimState,
  agent: number,
  beliefId: number,
  newCredibility: number,
): boolean {
  const stride = MAX_BELIEFS_PER_AGENT;
  const base = agent * stride;
  let weakestSlot = -1;
  let weakestCred = Infinity;
  let freeSlot = -1;
  for (let k = 0; k < stride; k++) {
    const id = state.beliefIds[base + k];
    if (id === beliefId) {
      if (newCredibility > state.credibilities[base + k]) {
        state.credibilities[base + k] = Math.min(1, newCredibility);
      }
      return true;
    }
    if (id === 0) {
      if (freeSlot < 0) freeSlot = k;
    } else {
      const c = state.credibilities[base + k];
      if (c < weakestCred) { weakestCred = c; weakestSlot = k; }
    }
  }
  if (freeSlot >= 0) {
    state.beliefIds[base + freeSlot] = beliefId;
    state.credibilities[base + freeSlot] = Math.min(1, Math.max(0, newCredibility));
    return true;
  }
  if (newCredibility > weakestCred) {
    state.beliefIds[base + weakestSlot] = beliefId;
    state.credibilities[base + weakestSlot] = Math.min(1, Math.max(0, newCredibility));
    return true;
  }
  return false;
}
