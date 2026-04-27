import {
  CRUSADE_ALLY_THRESHOLD, CRUSADE_PROBES, CRUSADE_SEEK_PROB,
  CRUSADE_SIGHT_CELLS, DORMANCY_THRESHOLD, MAX_BELIEFS_PER_AGENT, MAX_SPEED,
  MOVE_PROB, MOVE_PROB_ISOLATED, SEEK_PROB, SEEK_PROB_ISOLATED,
  VELOCITY_DAMPING, WORLD_SIZE,
} from './constants';
import type { SpatialGrid } from './grid';
import { getDominantByCell, getSameBeliefNeighbours } from './interact';
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

    // Crusader: packed in with enough same-belief allies AND has an active
    // belief to defend. Still uses the same per-tick move probability as
    // normal motion, but when the move fires, it prefers hunting enemies.
    const myBelief = dominantBelief[i];
    const isCrusader = myBelief !== 0 && (allies[i] | 0) >= CRUSADE_ALLY_THRESHOLD;

    const moveProb = isolated ? MOVE_PROB_ISOLATED : MOVE_PROB;
    const seekProb = isolated ? SEEK_PROB_ISOLATED : SEEK_PROB;

    if (rand() < moveProb) {
      let dx = 0;
      let dy = 0;
      let handled = false;

      if (isCrusader && rand() < CRUSADE_SEEK_PROB) {
        const enemyDir = findEnemyCell(
          cx, cy, myBelief, dominantByCell, cellsPerAxis, rand,
        );
        if (enemyDir !== null) {
          dx = enemyDir.dx;
          dy = enemyDir.dy;
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

// Crusader probe: sample a few random cells within sight range and return
// the torus-shortest direction toward one that holds a DIFFERENT active
// belief. Returns null if no enemy cell found in this sample.
function findEnemyCell(
  cx: number, cy: number,
  myBelief: number,
  dominantByCell: Int32Array,
  cellsPerAxis: number,
  rand: () => number,
): { dx: number; dy: number } | null {
  const maxOffset = CRUSADE_SIGHT_CELLS;
  for (let p = 0; p < CRUSADE_PROBES; p++) {
    // Random offset in [-maxOffset, +maxOffset], excluding (0,0).
    const ox = ((rand() * (maxOffset * 2 + 1)) | 0) - maxOffset;
    const oy = ((rand() * (maxOffset * 2 + 1)) | 0) - maxOffset;
    if (ox === 0 && oy === 0) continue;
    let nx = cx + ox;
    let ny = cy + oy;
    // Torus wrap on cell coords.
    nx = ((nx % cellsPerAxis) + cellsPerAxis) % cellsPerAxis;
    ny = ((ny % cellsPerAxis) + cellsPerAxis) % cellsPerAxis;
    const d = dominantByCell[ny * cellsPerAxis + nx];
    if (d !== 0 && d !== myBelief) {
      return { dx: ox, dy: oy };
    }
  }
  return null;
}
