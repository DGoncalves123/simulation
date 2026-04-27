import { COMM_RADIUS, WORLD_SIZE } from './constants';
import type { SimState } from './state';

// Uniform spatial grid on a torus. Cell size = COMM_RADIUS, so neighbour
// queries within COMM_RADIUS only need to scan the agent's cell + 8 neighbours.
//
// Storage is a CSR-style layout built per tick:
//   cellStart[c]   = first index into agentIdx for cell c
//   cellStart[c+1] = one past last index
//   agentIdx[k]    = agent index sitting in some cell
//
// All buffers are preallocated once. Build is two passes: count, then scatter.

export class SpatialGrid {
  readonly cellsPerAxis: number;
  readonly cellSize: number;
  readonly cellCount: number;
  readonly cellStart: Int32Array;
  readonly agentIdx: Int32Array;
  // List of cell indices that are non-empty after build(). Consumers can
  // iterate this (length = nonEmptyCount) instead of all cellCount cells.
  readonly nonEmptyCells: Int32Array;
  nonEmptyCount: number = 0;
  private readonly counts: Int32Array;

  constructor(capacity: number) {
    this.cellSize = COMM_RADIUS;
    this.cellsPerAxis = Math.ceil(WORLD_SIZE / this.cellSize);
    this.cellCount = this.cellsPerAxis * this.cellsPerAxis;
    this.cellStart = new Int32Array(this.cellCount + 1);
    this.agentIdx = new Int32Array(capacity);
    this.nonEmptyCells = new Int32Array(this.cellCount);
    this.counts = new Int32Array(this.cellCount);
  }

  build(state: SimState): void {
    const { positions, alive, count } = state;
    const counts = this.counts;
    const cellStart = this.cellStart;
    const cellsPerAxis = this.cellsPerAxis;
    const cellSize = this.cellSize;

    counts.fill(0);
    for (let i = 0; i < count; i++) {
      if (!alive[i]) continue;
      const x = positions[i * 2];
      const y = positions[i * 2 + 1];
      const cx = Math.min(cellsPerAxis - 1, Math.max(0, (x / cellSize) | 0));
      const cy = Math.min(cellsPerAxis - 1, Math.max(0, (y / cellSize) | 0));
      counts[cy * cellsPerAxis + cx]++;
    }

    // Prefix sum → cellStart. Also collect non-empty cell indices.
    const nonEmpty = this.nonEmptyCells;
    let sum = 0;
    let neCount = 0;
    for (let c = 0; c < this.cellCount; c++) {
      cellStart[c] = sum;
      const k = counts[c];
      if (k > 0) nonEmpty[neCount++] = c;
      sum += k;
    }
    cellStart[this.cellCount] = sum;
    this.nonEmptyCount = neCount;

    // Scatter — reuse counts as write cursor.
    counts.set(cellStart.subarray(0, this.cellCount));
    const agentIdx = this.agentIdx;
    for (let i = 0; i < count; i++) {
      if (!alive[i]) continue;
      const x = positions[i * 2];
      const y = positions[i * 2 + 1];
      const cx = Math.min(cellsPerAxis - 1, Math.max(0, (x / cellSize) | 0));
      const cy = Math.min(cellsPerAxis - 1, Math.max(0, (y / cellSize) | 0));
      const c = cy * cellsPerAxis + cx;
      agentIdx[counts[c]++] = i;
    }
  }

  // Visit every agent within COMM_RADIUS of (x,y), torus-aware.
  // Callback receives the neighbour's agent index.
  forEachNeighbour(x: number, y: number, visit: (j: number) => void): void {
    this.forEachInRadius(x, y, this.cellSize, visit);
  }

  // Variable-radius query. Torus-aware cell scan.
  forEachInRadius(x: number, y: number, radius: number, visit: (j: number) => void): void {
    const { cellsPerAxis, cellSize, cellStart, agentIdx } = this;
    const cx = Math.min(cellsPerAxis - 1, Math.max(0, (x / cellSize) | 0));
    const cy = Math.min(cellsPerAxis - 1, Math.max(0, (y / cellSize) | 0));
    const span = Math.min(cellsPerAxis, Math.max(1, Math.ceil(radius / cellSize)));
    for (let dy = -span; dy <= span; dy++) {
      const ny = ((cy + dy) % cellsPerAxis + cellsPerAxis) % cellsPerAxis;
      for (let dx = -span; dx <= span; dx++) {
        const nx = ((cx + dx) % cellsPerAxis + cellsPerAxis) % cellsPerAxis;
        const c = ny * cellsPerAxis + nx;
        const start = cellStart[c];
        const end = cellStart[c + 1];
        for (let k = start; k < end; k++) {
          visit(agentIdx[k]);
        }
      }
    }
  }
}
