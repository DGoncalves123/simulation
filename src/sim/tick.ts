import {
  CROWD_SEEK_PROB, CROWD_SIGHT_CELLS, CRUSADE_ALLY_THRESHOLD,
  CRUSADE_SEEK_PROB, CRUSADE_SIGHT_CELLS, DORMANCY_THRESHOLD,
  MAX_BELIEFS_PER_AGENT, MAX_SPEED, MISSIONARY_MAX_ALLIES, MISSIONARY_MOVE_PROB,
  MISSIONARY_SEEK_PROB, MOVE_PROB, MOVE_PROB_ISOLATED, SEEK_PROB,
  SEEK_PROB_ISOLATED, VELOCITY_DAMPING, WORLD_SIZE,
} from './constants';
import type { SpatialGrid } from './grid';
import { getAnyAboveDormancy, getDominantByCell, getSameBeliefNeighbours } from './interact';
import type { SimState } from './state';

// Motion model (spec addendum):
// - Default state is still. Velocity damps toward zero each tick; agents at
//   rest stay at rest.
// - With small probability MOVE_PROB, an agent decides to move.
//   - (1 - SEEK_PROB): random-direction wander kick.
//   - SEEK_PROB: pick a target and head toward it.
// - Seek target selection:
//   - If the mover holds any above-dormancy belief, sample a few nearby-grid
//     agents; head toward the first one that shares a belief. This implements
//     the "shared-belief attraction" in a bounded way (O(const) per seek).
//   - Fallback: uniform-random other agent.
// - Positions torus-wrap.
export function tick(state: SimState, grid: SpatialGrid, rand: () => number): void {
  const { positions, velocities, alive, dominantBelief, count } = state;
  const stride = MAX_BELIEFS_PER_AGENT;
  const half = WORLD_SIZE * 0.5;

  const cellsPerAxis = grid.cellsPerAxis;
  const cellSize = grid.cellSize;
  const cellStart = grid.cellStart;
  const dominantByCell = getDominantByCell();
  const allies = getSameBeliefNeighbours();
  const anyDorm = getAnyAboveDormancy();

  for (let i = 0; i < count; i++) {
    if (!alive[i]) continue;
    const ix = i * 2;
    const iy = ix + 1;

    let vx = velocities[ix] * VELOCITY_DAMPING;
    let vy = velocities[iy] * VELOCITY_DAMPING;

    const cx = (positions[ix] / cellSize) | 0;
    const cy = (positions[iy] / cellSize) | 0;
    const cIdx = cy * cellsPerAxis + cx;
    const cellPop = cellStart[cIdx + 1] - cellStart[cIdx];
    const isolated = cellPop <= 1;

    // Missionary: lone active-belief agent with few same-belief neighbours —
    // wanders proactively seeking grey targets to convert. Models the peer/
    // network cop tier from the spec.
    const myBelief = dominantBelief[i];
    const allyCount = allies[i] | 0;
    const isMissionary = myBelief !== 0 && allyCount <= MISSIONARY_MAX_ALLIES;

    // Crusader: packed in with enough same-belief allies AND has an active
    // belief to defend. Mutually exclusive with missionary.
    const isCrusader = !isMissionary && myBelief !== 0 && allyCount >= CRUSADE_ALLY_THRESHOLD;

    // Overcrowded agents wander more to leak outward, breaking up walls.
    const overcrowded = cellPop >= 9;
    const moveProb = isMissionary
      ? MISSIONARY_MOVE_PROB
      : (isolated ? MOVE_PROB_ISOLATED : (overcrowded ? MOVE_PROB * 2 : MOVE_PROB));
    const seekProb = isolated
      ? SEEK_PROB_ISOLATED
      : (overcrowded ? 0 : SEEK_PROB); // overcrowded: pure random wander

    if (rand() < moveProb) {
      let dx = 0;
      let dy = 0;
      let handled = false;

      if (isMissionary && rand() < MISSIONARY_SEEK_PROB) {
        const greyTarget = findGreyTarget(state, grid, rand, i, stride, anyDorm);
        if (greyTarget >= 0) {
          dx = positions[greyTarget * 2] - positions[ix];
          dy = positions[greyTarget * 2 + 1] - positions[iy];
          if (dx > half) dx -= WORLD_SIZE; else if (dx < -half) dx += WORLD_SIZE;
          if (dy > half) dy -= WORLD_SIZE; else if (dy < -half) dy += WORLD_SIZE;
          handled = true;
        }
      }

      if (!handled && isCrusader && rand() < CRUSADE_SEEK_PROB) {
        const enemyDir = findEnemyCell(
          cx, cy, myBelief, dominantByCell, cellsPerAxis, rand,
        );
        if (enemyDir !== null) {
          dx = enemyDir.dx;
          dy = enemyDir.dy;
          handled = true;
        }
      }

      // Crowd-seek: isolated / low-density agents head toward the nearest
      // populated cell. Universal — believer or not. Pulls loners into
      // clumps and prevents the "clumps never touch" dead end.
      if (!handled && isolated && rand() < CROWD_SEEK_PROB) {
        const crowdDir = findNearestCrowd(
          cx, cy, grid.cellsPerAxis, cellStart,
        );
        if (crowdDir !== null) {
          dx = crowdDir.dx;
          dy = crowdDir.dy;
          handled = true;
        }
      }

      if (!handled && count > 1 && rand() < seekProb) {
        const target = pickSeekTarget(state, grid, rand, i, stride);
        dx = positions[target * 2] - positions[ix];
        dy = positions[target * 2 + 1] - positions[iy];
        if (dx > half) dx -= WORLD_SIZE;
        else if (dx < -half) dx += WORLD_SIZE;
        if (dy > half) dy -= WORLD_SIZE;
        else if (dy < -half) dy += WORLD_SIZE;
        handled = true;
      }

      if (!handled) {
        const angle = rand() * Math.PI * 2;
        dx = Math.cos(angle);
        dy = Math.sin(angle);
      }
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        vx += (dx / len) * MAX_SPEED;
        vy += (dy / len) * MAX_SPEED;
      }
    }

    const speed = Math.hypot(vx, vy);
    if (speed > MAX_SPEED) {
      const s = MAX_SPEED / speed;
      vx *= s;
      vy *= s;
    }

    velocities[ix] = vx;
    velocities[iy] = vy;

    let x = positions[ix] + vx;
    let y = positions[iy] + vy;
    if (x < 0) x += WORLD_SIZE;
    else if (x >= WORLD_SIZE) x -= WORLD_SIZE;
    if (y < 0) y += WORLD_SIZE;
    else if (y >= WORLD_SIZE) y -= WORLD_SIZE;
    positions[ix] = x;
    positions[iy] = y;
  }
}

// If mover has a belief above dormancy, try to find a same-belief seek target
// within a few grid cells. Falls back to uniform-random.
function pickSeekTarget(
  state: SimState,
  grid: SpatialGrid,
  rand: () => number,
  i: number,
  stride: number,
): number {
  const { beliefIds, credibilities, positions, count } = state;
  const baseI = i * stride;

  // Find mover's dominant-ish belief quickly (first above-dormancy slot).
  let myBelief = 0;
  for (let k = 0; k < stride; k++) {
    const id = beliefIds[baseI + k];
    if (id === 0) continue;
    if (credibilities[baseI + k] >= DORMANCY_THRESHOLD) { myBelief = id; break; }
  }

  if (myBelief !== 0) {
    const candidates: number[] = [];
    grid.forEachInRadius(positions[i * 2], positions[i * 2 + 1], grid.cellSize * 2, (j) => {
      if (j === i || candidates.length >= 16) return;
      candidates.push(j);
    });
    // Shuffle-lite: probe a handful.
    const probe = Math.min(candidates.length, 6);
    for (let t = 0; t < probe; t++) {
      const j = candidates[(rand() * candidates.length) | 0];
      const baseJ = j * stride;
      for (let k = 0; k < stride; k++) {
        if (beliefIds[baseJ + k] === myBelief
            && credibilities[baseJ + k] >= DORMANCY_THRESHOLD) {
          return j;
        }
      }
    }
  }

  let target = (rand() * count) | 0;
  if (target === i) target = (target + 1) % count;
  return target;
}

// Missionary seek: scan a few nearby cells for a non-reactionary (grey) agent.
// Returns agent index of nearest grey, or -1 if none found.
function findGreyTarget(
  state: SimState,
  grid: SpatialGrid,
  rand: () => number,
  i: number,
  stride: number,
  anyDorm: Uint8Array,
): number {
  const { positions, alive } = state;
  const ix = positions[i * 2];
  const iy = positions[i * 2 + 1];
  let best = -1;
  let bestD2 = Infinity;
  // Scan a 5-cell radius for grey agents, pick the nearest.
  grid.forEachInRadius(ix, iy, grid.cellSize * 5, (j) => {
    if (j === i || !alive[j] || anyDorm[j]) return;
    const dx = positions[j * 2] - ix;
    const dy = positions[j * 2 + 1] - iy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = j; }
  });
  // Suppress unused param warning
  void rand; void stride;
  return best;
}

// Crowd-seek: spiral outward from (cx, cy) looking for any populated cell.
// Bails on first hit → cheap when the agent is near *some* cluster, which
// is the common case. Returns direction to first-found populated cell.
function findNearestCrowd(
  cx: number, cy: number,
  cellsPerAxis: number,
  cellStart: Int32Array,
): { dx: number; dy: number } | null {
  for (let r = 1; r <= CROWD_SIGHT_CELLS; r++) {
    // Scan the square ring at distance r. Pick the first populated cell.
    let bestDx = 0;
    let bestDy = 0;
    let bestD2 = Infinity;
    // top + bottom rows
    for (let ox = -r; ox <= r; ox++) {
      const nyTop = wrap(cy - r, cellsPerAxis);
      const nyBot = wrap(cy + r, cellsPerAxis);
      const nx = wrap(cx + ox, cellsPerAxis);
      const idxT = nyTop * cellsPerAxis + nx;
      const idxB = nyBot * cellsPerAxis + nx;
      if (cellStart[idxT + 1] - cellStart[idxT] > 0) {
        const d2 = ox * ox + r * r;
        if (d2 < bestD2) { bestD2 = d2; bestDx = ox; bestDy = -r; }
      }
      if (cellStart[idxB + 1] - cellStart[idxB] > 0) {
        const d2 = ox * ox + r * r;
        if (d2 < bestD2) { bestD2 = d2; bestDx = ox; bestDy = r; }
      }
    }
    // left + right columns (excluding corners, already covered above)
    for (let oy = -r + 1; oy <= r - 1; oy++) {
      const nxL = wrap(cx - r, cellsPerAxis);
      const nxR = wrap(cx + r, cellsPerAxis);
      const ny = wrap(cy + oy, cellsPerAxis);
      const idxL = ny * cellsPerAxis + nxL;
      const idxR = ny * cellsPerAxis + nxR;
      if (cellStart[idxL + 1] - cellStart[idxL] > 0) {
        const d2 = r * r + oy * oy;
        if (d2 < bestD2) { bestD2 = d2; bestDx = -r; bestDy = oy; }
      }
      if (cellStart[idxR + 1] - cellStart[idxR] > 0) {
        const d2 = r * r + oy * oy;
        if (d2 < bestD2) { bestD2 = d2; bestDx = r; bestDy = oy; }
      }
    }
    if (bestD2 !== Infinity) {
      return { dx: bestDx, dy: bestDy };
    }
  }
  return null;
}

function wrap(v: number, m: number): number {
  if (v < 0) return v + m;
  if (v >= m) return v - m;
  return v;
}

// Crusader targeting: deterministic nearest-enemy scan. Every crusader in
// the same cluster sees the same nearest-enemy (plus small deterministic
// tie-breaks) so they converge and march as a block, not as a cloud.
// Unused params kept for signature stability (rand, CRUSADE_PROBES).
function findEnemyCell(
  cx: number, cy: number,
  myBelief: number,
  dominantByCell: Int32Array,
  cellsPerAxis: number,
  _rand: () => number,
): { dx: number; dy: number } | null {
  const maxOffset = CRUSADE_SIGHT_CELLS;
  let bestDx = 0;
  let bestDy = 0;
  let bestD2 = Infinity;
  for (let oy = -maxOffset; oy <= maxOffset; oy++) {
    let ny = cy + oy;
    if (ny < 0) ny += cellsPerAxis;
    else if (ny >= cellsPerAxis) ny -= cellsPerAxis;
    const rowBase = ny * cellsPerAxis;
    for (let ox = -maxOffset; ox <= maxOffset; ox++) {
      if (ox === 0 && oy === 0) continue;
      let nx = cx + ox;
      if (nx < 0) nx += cellsPerAxis;
      else if (nx >= cellsPerAxis) nx -= cellsPerAxis;
      const d = dominantByCell[rowBase + nx];
      if (d === 0 || d === myBelief) continue;
      const d2 = ox * ox + oy * oy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestDx = ox;
        bestDy = oy;
      }
    }
  }
  if (bestD2 === Infinity) return null;
  return { dx: bestDx, dy: bestDy };
}
