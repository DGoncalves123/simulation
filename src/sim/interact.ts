import type { BeliefRegistry } from './beliefs';
import {
  ACTIVE_THRESHOLD, ADOPT_INITIAL, ADOPT_NOISE, BELIEF_DROP, COMM_RADIUS,
  CONFLICT_DRAIN, DORMANCY_THRESHOLD, ENFORCE_BUMP, ENFORCE_RESIST_FACTOR,
  FIGHT_ALLY_BONUS, FIGHT_CONVERT_CRED, FIGHT_DEATH_ENERGY,
  FIGHT_ENERGY_COST_LOSER, FIGHT_ENERGY_COST_WINNER, FIGHT_LOSER_CRED_HIT,
  FIGHT_PROB, KIN_ADOPT_BONUS, MAX_PAIR_VISITS, MAX_BELIEFS_PER_AGENT,
  NEUTRALISE_DECAY, REINFORCE_BUMP, REPULSION_MAX_PUSH, REPULSION_RADIUS,
  REPULSION_STRENGTH, SATURATION_BURN, SCHISM_CHILD_CRED, SCHISM_MIN_CRED,
  SCHISM_PROB, WORLD_SIZE,
} from './constants';
import type { SpatialGrid } from './grid';
import type { SimState } from './state';
import { killAgent, upsertBelief } from './state';

let anyAboveDormancy: Uint8Array = new Uint8Array(0);
let hasActive: Uint8Array = new Uint8Array(0);
let nearNonReactionary: Uint8Array = new Uint8Array(0);
let initiators: Int32Array = new Int32Array(0);
let sameBeliefNeighbours: Uint16Array = new Uint16Array(0);
// Accumulated per-tick positional push from repulsion. Applied at end.
let pushX: Float32Array = new Float32Array(0);
let pushY: Float32Array = new Float32Array(0);
// Per-cell dominant active belief for the most recent tick. 0 if no active
// believer in that cell. Used by tick() to steer crusaders toward enemies.
let dominantByCell: Int32Array = new Int32Array(0);

export function getDominantByCell(): Int32Array {
  return dominantByCell;
}

export function getSameBeliefNeighbours(): Uint16Array {
  return sameBeliefNeighbours;
}
export function getAnyAboveDormancy(): Uint8Array {
  return anyAboveDormancy;
}

// One tick of social interaction. Runs after motion + grid rebuild.
//
// Semantics implemented:
//   - Mutual reinforcement for same belief between two agents above dormancy.
//   - Casual spread (prob ∝ credibility) from any above-dormancy believer to a
//     non-holder target.
//   - Forced conversion from an *active* believer onto a non-holder, reduced if
//     the target has a conflicting active belief of their own.
//   - Conflict drain — pushing against an actively-defended target costs the
//     pusher a bit of cred in the pushed belief.
//   - Global relaxation — an agent standing near any non-reactionary neighbour
//     has ALL their own beliefs decayed by NEUTRALISE_DECAY this tick.
//
// Perf: only above-dormancy agents initiate. Non-believers receive influence
// passively. Mutual double-processing is avoided with the i < j guard for
// initiator-initiator pairs.
export function interact(
  state: SimState,
  grid: SpatialGrid,
  registry: BeliefRegistry,
  rand: () => number,
): void {
  const {
    positions, alive, count, beliefIds, credibilities, dominantBelief,
  } = state;
  const stride = MAX_BELIEFS_PER_AGENT;
  const half = WORLD_SIZE * 0.5;
  const commR2 = COMM_RADIUS * COMM_RADIUS;
  const repelR2 = REPULSION_RADIUS * REPULSION_RADIUS;

  if (anyAboveDormancy.length < count) {
    anyAboveDormancy = new Uint8Array(count);
    hasActive = new Uint8Array(count);
    nearNonReactionary = new Uint8Array(count);
    initiators = new Int32Array(count);
    sameBeliefNeighbours = new Uint16Array(count);
    pushX = new Float32Array(count);
    pushY = new Float32Array(count);
  } else {
    nearNonReactionary.fill(0, 0, count);
    sameBeliefNeighbours.fill(0, 0, count);
    pushX.fill(0, 0, count);
    pushY.fill(0, 0, count);
  }

  // Pass 1: per-agent summary + collect initiators.
  let initCount = 0;
  for (let i = 0; i < count; i++) {
    if (!alive[i]) { anyAboveDormancy[i] = 0; hasActive[i] = 0; continue; }
    const base = i * stride;
    let aboveDorm = 0;
    let active = 0;
    for (let k = 0; k < stride; k++) {
      if (beliefIds[base + k] === 0) continue;
      const c = credibilities[base + k];
      if (c >= DORMANCY_THRESHOLD) aboveDorm = 1;
      if (c >= ACTIVE_THRESHOLD) active = 1;
    }
    anyAboveDormancy[i] = aboveDorm;
    hasActive[i] = active;
    if (aboveDorm) initiators[initCount++] = i;
  }

  // Pass 2: initiator-driven pair interactions.
  // Inlined grid cell scan — a callback here is called ~9×initCount times
  // and its overhead dominates the hot loop at high belief prevalence.
  const cellsPerAxis = grid.cellsPerAxis;
  const cellSize = grid.cellSize;
  const cellStart = grid.cellStart;
  const agentIdx = grid.agentIdx;

  for (let t = 0; t < initCount; t++) {
    const i = initiators[t];
    const ix = positions[i * 2];
    const iy = positions[i * 2 + 1];

    const cx = (ix / cellSize) | 0;
    const cy = (iy / cellSize) | 0;
    let visits = 0;
    outer:
    for (let dyC = -1; dyC <= 1; dyC++) {
      let ny = cy + dyC;
      if (ny < 0) ny += cellsPerAxis;
      else if (ny >= cellsPerAxis) ny -= cellsPerAxis;
      for (let dxC = -1; dxC <= 1; dxC++) {
        let nx = cx + dxC;
        if (nx < 0) nx += cellsPerAxis;
        else if (nx >= cellsPerAxis) nx -= cellsPerAxis;
        const c = ny * cellsPerAxis + nx;
        const cellEnd = cellStart[c + 1];
        for (let kk = cellStart[c]; kk < cellEnd; kk++) {
          const j = agentIdx[kk];
          if (j === i || !alive[j]) continue;
          if (anyAboveDormancy[j] && j < i) continue;
          let dxV = positions[j * 2] - ix;
          let dyV = positions[j * 2 + 1] - iy;
          if (dxV > half) dxV -= WORLD_SIZE;
          else if (dxV < -half) dxV += WORLD_SIZE;
          if (dyV > half) dyV -= WORLD_SIZE;
          else if (dyV < -half) dyV += WORLD_SIZE;
          const d2 = dxV * dxV + dyV * dyV;
          if (d2 > commR2) continue;

          // Soft repulsion — positional, not velocity-based, so it doesn't
          // charge the agent ENERGY_MOVE_COST. Accumulated, applied later.
          if (d2 < repelR2 && d2 > 1e-6) {
            const inv = REPULSION_STRENGTH / Math.sqrt(d2);
            const px = dxV * inv;
            const py = dyV * inv;
            pushX[i] -= px;
            pushY[i] -= py;
            pushX[j] += px;
            pushY[j] += py;
          }

          if (!anyAboveDormancy[j]) nearNonReactionary[i] = 1;
          pairInteract(state, i, j, registry, rand);

          if (++visits >= MAX_PAIR_VISITS) break outer;
        }
      }
    }
  }

  // Pass 3a: non-reactionary repulsion — a cheap, capped scan. Only runs
  // for agents that weren't initiators (those already got repulsion above).
  // Each non-reactionary probes a handful of cell-mates and pushes apart if
  // too close. No belief logic, no allocations.
  for (let i = 0; i < count; i++) {
    if (!alive[i] || anyAboveDormancy[i]) continue;
    const ix = positions[i * 2];
    const iy = positions[i * 2 + 1];
    const cx = (ix / cellSize) | 0;
    const cy = (iy / cellSize) | 0;
    const cIdx = cy * cellsPerAxis + cx;
    const s = cellStart[cIdx];
    const e = cellStart[cIdx + 1];
    // Probe up to 6 cell-mates. Cluster-local only — no 9-cell scan.
    const bound = Math.min(e, s + 6);
    for (let kk = s; kk < bound; kk++) {
      const j = agentIdx[kk];
      if (j === i || !alive[j]) continue;
      let dxV = positions[j * 2] - ix;
      let dyV = positions[j * 2 + 1] - iy;
      if (dxV > half) dxV -= WORLD_SIZE;
      else if (dxV < -half) dxV += WORLD_SIZE;
      if (dyV > half) dyV -= WORLD_SIZE;
      else if (dyV < -half) dyV += WORLD_SIZE;
      const d2 = dxV * dxV + dyV * dyV;
      if (d2 < repelR2 && d2 > 1e-6) {
        const inv = REPULSION_STRENGTH / Math.sqrt(d2);
        pushX[i] -= dxV * inv;
        pushY[i] -= dyV * inv;
      }
    }
  }

  // Pass 3b: global relaxation — any agent flagged as near a non-reactionary
  // decays ALL of their beliefs slightly.
  for (let t = 0; t < initCount; t++) {
    const i = initiators[t];
    if (!nearNonReactionary[i]) continue;
    const base = i * stride;
    for (let k = 0; k < stride; k++) {
      if (beliefIds[base + k] === 0) continue;
      credibilities[base + k] = Math.max(0, credibilities[base + k] - NEUTRALISE_DECAY);
    }
  }

  // Pass 4a: apply accumulated positional push from repulsion, torus-wrap.
  const maxPush = REPULSION_MAX_PUSH;
  for (let i = 0; i < count; i++) {
    if (!alive[i]) continue;
    let px = pushX[i];
    let py = pushY[i];
    if (px === 0 && py === 0) continue;
    const mag = Math.sqrt(px * px + py * py);
    if (mag > maxPush) {
      const s = maxPush / mag;
      px *= s; py *= s;
    }
    let x = positions[i * 2] + px;
    let y = positions[i * 2 + 1] + py;
    if (x < 0) x += WORLD_SIZE; else if (x >= WORLD_SIZE) x -= WORLD_SIZE;
    if (y < 0) y += WORLD_SIZE; else if (y >= WORLD_SIZE) y -= WORLD_SIZE;
    positions[i * 2] = x;
    positions[i * 2 + 1] = y;
  }

  // Pass 4b: drop dead slots; recompute dominantBelief for rendering.
  for (let i = 0; i < count; i++) {
    if (!alive[i]) { dominantBelief[i] = 0; continue; }
    const base = i * stride;
    let bestId = 0;
    let bestCred = ACTIVE_THRESHOLD - 1e-6;
    for (let k = 0; k < stride; k++) {
      const id = beliefIds[base + k];
      if (id === 0) continue;
      const c = credibilities[base + k];
      if (c < BELIEF_DROP) {
        beliefIds[base + k] = 0;
        credibilities[base + k] = 0;
        continue;
      }
      if (c > bestCred) { bestCred = c; bestId = id; }
    }
    dominantBelief[i] = bestId;
  }

  // Pass 4c: per-cell dominant belief (plurality over dominantBelief[agent]).
  // Cheap: one pass over cells. Used by motion to steer crusaders.
  if (dominantByCell.length < grid.cellCount) {
    dominantByCell = new Int32Array(grid.cellCount);
  } else {
    dominantByCell.fill(0, 0, grid.cellCount);
  }
  // Two-pass plurality without a map: first pass builds a majority candidate
  // with Boyer–Moore, second pass verifies. Works well when cells contain
  // mostly agents of the same dominant belief (true for our clusters).
  for (let c = 0; c < grid.cellCount; c++) {
    const s = cellStart[c];
    const e = cellStart[c + 1];
    let cand = 0;
    let cnt = 0;
    for (let kk = s; kk < e; kk++) {
      const j = agentIdx[kk];
      if (!alive[j]) continue;
      const d = dominantBelief[j];
      if (d === 0) continue;
      if (cnt === 0) { cand = d; cnt = 1; }
      else if (d === cand) cnt++;
      else cnt--;
    }
    dominantByCell[c] = cand; // may be 0 (no believers) — fine
  }
}

function pairInteract(
  state: SimState,
  a: number, b: number,
  registry: BeliefRegistry,
  rand: () => number,
): void {
  const stride = MAX_BELIEFS_PER_AGENT;
  const baseA = a * stride;
  const baseB = b * stride;
  const beliefIds = state.beliefIds;
  const credibilities = state.credibilities;
  const parents = registry.parents;

  // Fight check — both hold active beliefs, and the two agents do not share
  // any belief above dormancy. Punctuated conflict, low per-tick probability.
  if (hasActive[a] && hasActive[b] && !pairSharesBelief(beliefIds, baseA, baseB, credibilities, stride)) {
    if (rand() < FIGHT_PROB) {
      resolveFight(state, a, b, rand);
      return; // fighters don't chat this tick
    }
  }

  // A's beliefs → B.
  for (let k = 0; k < stride; k++) {
    const idA = beliefIds[baseA + k];
    if (idA === 0) continue;
    const credA = credibilities[baseA + k];
    if (credA < DORMANCY_THRESHOLD) continue;

    let bSlot = -1;
    for (let m = 0; m < stride; m++) {
      if (beliefIds[baseB + m] === idA) { bSlot = m; break; }
    }

    if (bSlot >= 0) {
      // Each pair is processed once (i<j guard in outer loop), so it's safe
      // to credit both halves of the neighbour count here.
      sameBeliefNeighbours[a]++;
      sameBeliefNeighbours[b]++;
      const credB = credibilities[baseB + bSlot];
      const avg = (credA + credB) * 0.5;
      const delta = REINFORCE_BUMP - SATURATION_BURN * avg * avg;
      let newA = credA + delta;
      let newB = credB + delta;
      if (newA < 0) newA = 0; else if (newA > 1) newA = 1;
      if (newB < 0) newB = 0; else if (newB > 1) newB = 1;
      credibilities[baseA + k] = newA;
      credibilities[baseB + bSlot] = newB;

      if (credA >= SCHISM_MIN_CRED && credB >= SCHISM_MIN_CRED
          && rand() < SCHISM_PROB) {
        const childId = registry.schism(idA, rand);
        if (childId !== 0) {
          const splinter = (hash2(a, b, idA) < 0.5) ? a : b;
          upsertBelief(state, splinter, childId, SCHISM_CHILD_CRED);
          const sBase = splinter * stride;
          for (let m = 0; m < stride; m++) {
            if (beliefIds[sBase + m] === idA) {
              const nc = credibilities[sBase + m] - 0.15;
              credibilities[sBase + m] = nc < 0 ? 0 : nc;
              break;
            }
          }
        }
      }
      continue;
    }

    // B doesn't hold idA. Determine if B holds idA's parent (if any).
    const parentA = parents[idA - 1] | 0;
    let bHoldsParent = false;
    if (parentA !== 0) {
      for (let m = 0; m < stride; m++) {
        if (beliefIds[baseB + m] === parentA
            && credibilities[baseB + m] >= DORMANCY_THRESHOLD) {
          bHoldsParent = true; break;
        }
      }
    }

    if (credA >= ACTIVE_THRESHOLD) {
      const resist = hasActive[b] ? ENFORCE_RESIST_FACTOR : 1.0;
      let bump = ENFORCE_BUMP * resist;
      if (bHoldsParent) bump += KIN_ADOPT_BONUS;
      upsertBelief(state, b, idA, bump);
      if (resist < 1.0) {
        const nc = credA - CONFLICT_DRAIN;
        credibilities[baseA + k] = nc < 0 ? 0 : nc;
      }
    } else {
      const r = hash2(a, b, idA);
      if (r < credA) {
        let initial = ADOPT_INITIAL + (hash2(b, a, idA) - 0.5) * ADOPT_NOISE;
        if (bHoldsParent) initial += KIN_ADOPT_BONUS;
        upsertBelief(state, b, idA, initial);
      }
    }
  }

  // B's beliefs → A.
  for (let k = 0; k < stride; k++) {
    const idB = beliefIds[baseB + k];
    if (idB === 0) continue;
    const credB = credibilities[baseB + k];
    if (credB < DORMANCY_THRESHOLD) continue;

    let aSlot = -1;
    for (let m = 0; m < stride; m++) {
      if (beliefIds[baseA + m] === idB) { aSlot = m; break; }
    }
    if (aSlot >= 0) continue;

    const parentB = parents[idB - 1] | 0;
    let aHoldsParent = false;
    if (parentB !== 0) {
      for (let m = 0; m < stride; m++) {
        if (beliefIds[baseA + m] === parentB
            && credibilities[baseA + m] >= DORMANCY_THRESHOLD) {
          aHoldsParent = true; break;
        }
      }
    }

    if (credB >= ACTIVE_THRESHOLD) {
      const resist = hasActive[a] ? ENFORCE_RESIST_FACTOR : 1.0;
      let bump = ENFORCE_BUMP * resist;
      if (aHoldsParent) bump += KIN_ADOPT_BONUS;
      upsertBelief(state, a, idB, bump);
      if (resist < 1.0) {
        const nc = credB - CONFLICT_DRAIN;
        credibilities[baseB + k] = nc < 0 ? 0 : nc;
      }
    } else {
      const r = hash2(b, a, idB);
      if (r < credB) {
        let initial = ADOPT_INITIAL + (hash2(a, b, idB) - 0.5) * ADOPT_NOISE;
        if (aHoldsParent) initial += KIN_ADOPT_BONUS;
        upsertBelief(state, a, idB, initial);
      }
    }
  }
}

function hash2(x: number, y: number, z: number): number {
  let h = (x | 0) ^ Math.imul(y | 0, 0x9e3779b1) ^ Math.imul(z | 0, 0x85ebca6b);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function pairSharesBelief(
  beliefIds: Uint32Array, baseA: number, baseB: number,
  credibilities: Float32Array, stride: number,
): boolean {
  for (let k = 0; k < stride; k++) {
    const idA = beliefIds[baseA + k];
    if (idA === 0) continue;
    if (credibilities[baseA + k] < DORMANCY_THRESHOLD) continue;
    for (let m = 0; m < stride; m++) {
      if (beliefIds[baseB + m] === idA
          && credibilities[baseB + m] >= DORMANCY_THRESHOLD) {
        return true;
      }
    }
  }
  return false;
}

// A fight between two agents with conflicting active beliefs. Strength is
// energy × top-active-cred × (1 + ally_bonus × same-belief-cellmates).
// Loser's active belief crashes and (if still alive) gets the winner's
// belief installed at high credibility — "forced conversion at swordpoint".
function resolveFight(
  state: SimState,
  a: number, b: number,
  rand: () => number,
): void {
  const stride = MAX_BELIEFS_PER_AGENT;
  const baseA = a * stride;
  const baseB = b * stride;
  const { beliefIds, credibilities, energies } = state;

  const { slot: slotA, id: activeIdA, cred: credA } = topActive(beliefIds, credibilities, baseA, stride);
  const { slot: slotB, id: activeIdB, cred: credB } = topActive(beliefIds, credibilities, baseB, stride);
  if (activeIdA === 0 || activeIdB === 0) return; // shouldn't happen given caller check

  const alliesA = sameBeliefNeighbours[a] | 0;
  const alliesB = sameBeliefNeighbours[b] | 0;
  const strA = energies[a] * credA * (1 + FIGHT_ALLY_BONUS * alliesA);
  const strB = energies[b] * credB * (1 + FIGHT_ALLY_BONUS * alliesB);

  // Probabilistic outcome weighted by strength.
  const total = strA + strB;
  if (total <= 0) return;
  const winner = rand() * total < strA ? a : b;
  const loser = winner === a ? b : a;
  const winnerSlot = winner === a ? slotA : slotB;
  const loserSlot = winner === a ? slotB : slotA;
  const winnerId = winner === a ? activeIdA : activeIdB;

  // Energy cost.
  const we = energies[winner] - FIGHT_ENERGY_COST_WINNER;
  const le = energies[loser] - FIGHT_ENERGY_COST_LOSER;
  energies[winner] = we > 0 ? we : 0;

  // Loser's active belief crashes.
  const loserBase = loser * stride;
  const newCred = credibilities[loserBase + loserSlot] - FIGHT_LOSER_CRED_HIT;
  credibilities[loserBase + loserSlot] = newCred > 0 ? newCred : 0;

  // If loser is now too drained, they die.
  if (le <= FIGHT_DEATH_ENERGY) {
    killAgent(state, loser);
    return;
  }
  energies[loser] = le;

  // Forced conversion at swordpoint — winner's belief installed on loser.
  upsertBelief(state, loser, winnerId, FIGHT_CONVERT_CRED);

  // Winner's belief mildly reinforced from victory.
  const winnerBase = winner * stride;
  const wc = credibilities[winnerBase + winnerSlot] + 0.02;
  credibilities[winnerBase + winnerSlot] = wc > 1 ? 1 : wc;
}

function topActive(
  beliefIds: Uint32Array, credibilities: Float32Array,
  base: number, stride: number,
): { slot: number; id: number; cred: number } {
  let slot = -1;
  let id = 0;
  let cred = ACTIVE_THRESHOLD - 1e-6;
  for (let k = 0; k < stride; k++) {
    const bid = beliefIds[base + k];
    if (bid === 0) continue;
    const c = credibilities[base + k];
    if (c > cred) { cred = c; id = bid; slot = k; }
  }
  return { slot, id, cred };
}
