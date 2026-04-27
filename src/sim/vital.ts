import type { BeliefRegistry } from './beliefs';
import {
  CHILD_CRED_FACTOR, CHILD_INHERIT_PROB, CHILD_INIT_ENERGY, CHILD_MUTATION_PROB,
  CHILD_SPAWN_OFFSET, DEATH_CROWD_THRESHOLD, DEATH_FROM_AGE_PROB,
  DEATH_FROM_CROWD_PROB, DORMANCY_THRESHOLD, ENERGY_BASELINE_DECAY,
  ENERGY_BASELINE_GAIN, ENERGY_CROWD_COST, ENERGY_FRIEND_CAP, ENERGY_MAX,
  ENERGY_MOVE_COST, ENERGY_PROX_GAIN, MAX_BELIEFS_PER_AGENT,
  POPULATION_BUDGET, REPRO_CELL_CARRYING_CAPACITY, REPRO_ENERGY_THRESHOLD,
  REPRO_MAX_PROB, REPRO_PARENT_ENERGY_AFTER, REPRO_PROB_PER_NEIGHBOUR,
  WORLD_SIZE,
} from './constants';
import type { SpatialGrid } from './grid';
import type { SimState } from './state';
import { allocAgent, killAgent, upsertBelief } from './state';

// Per-tick vitality pass: update energies, spawn children, kill the starved.
// Runs after `interact` (which populates the same-belief-neighbour counts).
export function vital(
  state: SimState,
  grid: SpatialGrid,
  registry: BeliefRegistry,
  rand: () => number,
): void {
  const {
    positions, velocities, energies, alive, beliefIds, credibilities, count,
  } = state;
  const stride = MAX_BELIEFS_PER_AGENT;

  const cellsPerAxis = grid.cellsPerAxis;
  const cellSize = grid.cellSize;
  const cellStart = grid.cellStart;

  const spawners: number[] = [];
  for (let i = 0; i < count; i++) {
    if (!alive[i]) continue;

    const ix = positions[i * 2];
    const iy = positions[i * 2 + 1];
    const cx = (ix / cellSize) | 0;
    const cy = (iy / cellSize) | 0;
    const cIdx = cy * cellsPerAxis + cx;
    const cellPop = cellStart[cIdx + 1] - cellStart[cIdx];

    const neighbours = Math.max(0, cellPop - 1);

    // Death rolls: age-independent baseline + crowd-scaled extra. Crowded
    // cells thin out faster without needing to starve everyone.
    const excessCrowd = Math.max(0, neighbours - DEATH_CROWD_THRESHOLD);
    const deathProb = DEATH_FROM_AGE_PROB + DEATH_FROM_CROWD_PROB * excessCrowd;
    if (rand() < deathProb) {
      killAgent(state, i);
      continue;
    }

    const vx = velocities[i * 2];
    const vy = velocities[i * 2 + 1];
    const speed = Math.sqrt(vx * vx + vy * vy);
    const nCapped = neighbours > ENERGY_FRIEND_CAP ? ENERGY_FRIEND_CAP : neighbours;

    let e = energies[i]
      + ENERGY_BASELINE_GAIN
      - ENERGY_BASELINE_DECAY
      - ENERGY_MOVE_COST * speed
      + ENERGY_PROX_GAIN * nCapped
      - ENERGY_CROWD_COST * neighbours;

    if (e <= 0) {
      killAgent(state, i);
      continue;
    }
    if (e > ENERGY_MAX) e = ENERGY_MAX;
    energies[i] = e;

    if (e >= REPRO_ENERGY_THRESHOLD
        && neighbours > 0
        && cellPop < REPRO_CELL_CARRYING_CAPACITY
        && state.live < POPULATION_BUDGET) {
      const p = Math.min(REPRO_MAX_PROB, REPRO_PROB_PER_NEIGHBOUR * nCapped);
      if (rand() < p) spawners.push(i);
    }
  }

  // Spawn children. Each spawner is guaranteed to be alive.
  for (let s = 0; s < spawners.length; s++) {
    const parent = spawners[s];
    const child = allocAgent(state);
    if (child < 0) break; // at capacity

    // Place child next to parent with a small random offset.
    const angle = rand() * Math.PI * 2;
    let cx = positions[parent * 2] + Math.cos(angle) * CHILD_SPAWN_OFFSET;
    let cy = positions[parent * 2 + 1] + Math.sin(angle) * CHILD_SPAWN_OFFSET;
    if (cx < 0) cx += WORLD_SIZE; else if (cx >= WORLD_SIZE) cx -= WORLD_SIZE;
    if (cy < 0) cy += WORLD_SIZE; else if (cy >= WORLD_SIZE) cy -= WORLD_SIZE;
    positions[child * 2] = cx;
    positions[child * 2 + 1] = cy;
    velocities[child * 2] = 0;
    velocities[child * 2 + 1] = 0;
    energies[child] = CHILD_INIT_ENERGY;
    energies[parent] = REPRO_PARENT_ENERGY_AFTER;

    // Inherit a subset of parent's beliefs.
    const parentBase = parent * stride;
    for (let k = 0; k < stride; k++) {
      const id = beliefIds[parentBase + k];
      if (id === 0) continue;
      const cred = credibilities[parentBase + k];
      if (cred < DORMANCY_THRESHOLD) continue;
      if (rand() >= CHILD_INHERIT_PROB) continue;

      let inheritId = id;
      let inheritCred = cred * CHILD_CRED_FACTOR;
      if (rand() < CHILD_MUTATION_PROB) {
        const variant = registry.schism(id, rand);
        if (variant !== 0) {
          inheritId = variant;
          inheritCred = cred * CHILD_CRED_FACTOR * 0.9; // variant slightly weaker
        }
      }
      upsertBelief(state, child, inheritId, inheritCred);
    }
  }
}
