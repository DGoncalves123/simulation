/// <reference lib="webworker" />
import {
  ACTIVE_THRESHOLD, INITIAL_AGENTS, MAX_BELIEFS_PER_AGENT, WORLD_SIZE,
} from '../sim/constants';
import { createBeliefRegistry, type BeliefRegistry } from '../sim/beliefs';
import { SpatialGrid } from '../sim/grid';
import { interact, setInteractTick, drainEvents } from '../sim/interact';
import { maybeInvent } from '../sim/invent';
import { mulberry32 } from '../sim/rng';
import { createState, seedAgents, type SimState } from '../sim/state';
import { tick } from '../sim/tick';
import { vital } from '../sim/vital';
import type {
  AgentBelief, BeliefTally, MainToWorker, QueryResult, SimEvent, WorkerToMain,
} from './protocol';

let state: SimState | null = null;
let grid: SpatialGrid | null = null;
let registry: BeliefRegistry | null = null;
let simRand: () => number = Math.random;
let running = false;
let tickCount = 0;
let lastStatsAt = 0;
let ticksSinceStats = 0;
let tps = 0;
let enforcementDepth = 0;
// Rolling buffer of recent events sent to main thread for the event log.
const recentEvents: SimEvent[] = [];
const MAX_LOG_EVENTS = 40;

const spareBuffers: ArrayBuffer[] = [];

function post(msg: WorkerToMain, transfer?: Transferable[]): void {
  (self as unknown as Worker).postMessage(msg, { transfer: transfer ?? [] });
}

// Frame layout: for each live agent, 4 floats — x, y, beliefIdAsFloat, origIndex.
// (Storing uint32 as float is fine up to 2^24; agent count is far under.)
// origIndex maps back to state.positions for snap queries from main thread.
function snapshotInto(buffer: ArrayBuffer): number {
  if (!state) return 0;
  const dst = new Float32Array(buffer);
  const count = state.count;
  const positions = state.positions;
  const dominant = state.dominantBelief;
  const alive = state.alive;
  let w = 0;
  for (let i = 0; i < count; i++) {
    if (!alive[i]) continue;
    dst[w] = positions[i * 2];
    dst[w + 1] = positions[i * 2 + 1];
    dst[w + 2] = dominant[i];
    dst[w + 3] = i;
    w += 4;
  }
  return (w >>> 2);
}

function loop(): void {
  if (!running || !state) return;

  if (grid && registry) {
    tick(state, grid, simRand);
    grid.build(state);
    setInteractTick(tickCount);
    interact(state, grid, registry, simRand);
    const rawEvts = drainEvents();
    for (const e of rawEvts) {
      const actor = registry.name(e.actorBelief) ?? `#${e.actorBelief}`;
      const target = e.targetBelief > 0 ? (registry.name(e.targetBelief) ?? `#${e.targetBelief}`) : '';
      const label = e.targetBelief > 0 ? registry.targetBetween(e.actorBelief, e.targetBelief) : '';
      recentEvents.push({ tick: e.tick, kind: e.kind, actorBelief: actor, targetBelief: target, targetLabel: label });
      if (recentEvents.length > MAX_LOG_EVENTS) recentEvents.shift();
    }
    vital(state, grid, registry, simRand);
  }
  if (registry) maybeInvent(state, registry, simRand);
  tickCount++;
  ticksSinceStats++;
  if (tickCount % 200 === 0 && state) {
    enforcementDepth = computeEnforcementDepth(state);
  }

  const now = performance.now();
  if (now - lastStatsAt > 500) {
    tps = (ticksSinceStats * 1000) / (now - lastStatsAt);
    ticksSinceStats = 0;
    lastStatsAt = now;
  }

  while (spareBuffers.length > 0) {
    const buf = spareBuffers[0];
    if (buf.byteLength < state.live * 4 * 4) break;
    spareBuffers.shift();
    const count = snapshotInto(buf);
    post({ type: 'frame', buffer: buf, count, live: state.live, tick: tickCount, tps, enforcementDepth, events: recentEvents.slice() }, [buf]);
    break; // one frame per tick is enough
  }

  setTimeout(loop, 0);
}

self.onmessage = (e: MessageEvent<MainToWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init': {
      const seed = msg.seed ?? 1;
      state = createState();
      seedAgents(state, msg.agents ?? INITIAL_AGENTS, seed);
      registry = createBeliefRegistry(mulberry32(seed + 17));
      simRand = mulberry32(seed + 31);
      grid = new SpatialGrid(state.capacity);
      grid.build(state);
      lastStatsAt = performance.now();
      post({ type: 'ready', count: state.count });
      break;
    }
    case 'start': {
      if (!running) {
        running = true;
        lastStatsAt = performance.now();
        ticksSinceStats = 0;
        loop();
      }
      break;
    }
    case 'stop': {
      running = false;
      break;
    }
    case 'frameBuffer': {
      spareBuffers.push(msg.buffer);
      break;
    }
    case 'query': {
      post({
        type: 'queryResult',
        result: runQuery(
          msg.id, msg.x, msg.y, msg.radius, msg.snapRadius, msg.limit,
          msg.snappedAgent,
        ),
      });
      break;
    }
  }
};

// Walk convertedBy chains for the longest *recent* enforcement depth.
// A link is valid only if the converter is alive + active AND the conversion
// happened within DEPTH_WINDOW ticks of now. This gives a contemporaneous
// hierarchy reading that reflects current social structure, not lifetime genealogy.
const DEPTH_WINDOW = 120; // ~3 seconds at 40 TPS — enough for multi-tier chains to manifest
function computeEnforcementDepth(s: SimState): number {
  const { convertedBy, convertedAtTick, alive, count, dominantBelief } = s;
  let maxDepth = 0;
  const minTick = tickCount - DEPTH_WINDOW;
  for (let i = 0; i < count; i++) {
    if (!alive[i] || convertedBy[i] === 0 || dominantBelief[i] === 0) continue;
    let depth = 1;
    let cur = convertedBy[i] - 1;
    let prevTick = convertedAtTick[i]; // link must be strictly older than previous
    while (cur >= 0 && cur < count && alive[cur] && dominantBelief[cur] !== 0) {
      const curTick = convertedAtTick[cur];
      // Cycle/stale guard: each converter must have been converted before the
      // previous link AND within the window. Strictly less-than prevents cycles.
      if (curTick >= prevTick || curTick < minTick) break;
      depth++;
      prevTick = curTick;
      cur = convertedBy[cur] - 1;
    }
    if (depth > maxDepth) maxDepth = depth;
  }
  return maxDepth;
}

function agentBeliefList(i: number): AgentBelief[] {
  if (!state || !registry) return [];
  const base = i * MAX_BELIEFS_PER_AGENT;
  const out: AgentBelief[] = [];
  for (let k = 0; k < MAX_BELIEFS_PER_AGENT; k++) {
    const id = state.beliefIds[base + k];
    if (id === 0) continue;
    const credibility = state.credibilities[base + k];
    const parentId = registry.parentOf(id);
    out.push({
      id,
      name: registry.name(id) ?? `#${id}`,
      credibility,
      active: credibility >= ACTIVE_THRESHOLD,
      parentName: parentId > 0 ? (registry.name(parentId) ?? null) : null,
    });
  }
  out.sort((a, b) => b.credibility - a.credibility);
  return out;
}

function runQuery(
  id: number, x: number, y: number, radius: number, snapRadius: number, limit: number,
  snappedAgent?: number,
): QueryResult {
  const result: QueryResult = {
    id, worldX: x, worldY: y, radius,
    matchCount: 0, agent: null, tallies: [], nonReactionaryCount: 0,
  };
  if (!state || !grid) return result;

  // Main thread already resolved a snap against the rendered frame — just
  // return the beliefs of that specific agent (if still alive).
  if (snappedAgent !== undefined && snappedAgent >= 0
      && snappedAgent < state.count && state.alive[snappedAgent]) {
    result.matchCount = 1;
    result.agent = {
      index: snappedAgent,
      x: state.positions[snappedAgent * 2],
      y: state.positions[snappedAgent * 2 + 1],
      energy: state.energies[snappedAgent],
      beliefs: agentBeliefList(snappedAgent),
    };
    return result;
  }

  const half = WORLD_SIZE * 0.5;
  const r2 = radius * radius;
  const snap2 = snapRadius * snapRadius;
  const positions = state.positions;
  const alive = state.alive;
  const dominant = state.dominantBelief;

  // Snap pass: find the nearest agent holding any active belief inside snapRadius.
  // Uses the wider of the two radii to size the cell sweep.
  const searchRadius = Math.max(radius, snapRadius);
  let snapBest = -1;
  let snapBestD = Infinity;

  const hits: number[] = [];
  grid.forEachInRadius(x, y, searchRadius, (j) => {
    if (!alive[j]) return;
    let dx = positions[j * 2] - x;
    let dy = positions[j * 2 + 1] - y;
    if (dx > half) dx -= WORLD_SIZE;
    else if (dx < -half) dx += WORLD_SIZE;
    if (dy > half) dy -= WORLD_SIZE;
    else if (dy < -half) dy += WORLD_SIZE;
    const d2 = dx * dx + dy * dy;
    if (d2 <= r2) hits.push(j);
    if (d2 <= snap2 && dominant[j] !== 0 && d2 < snapBestD) {
      snapBestD = d2;
      snapBest = j;
    }
  });

  result.matchCount = hits.length;

  // Prefer snap-to-believer if one is within the snap radius.
  if (snapBest >= 0) {
    result.agent = {
      index: snapBest,
      x: positions[snapBest * 2],
      y: positions[snapBest * 2 + 1],
      energy: state.energies[snapBest],
      beliefs: agentBeliefList(snapBest),
    };
    // Keep matchCount = hits length so the UI can still show "N agents nearby"
    // context if it wants; but with agent set, Tooltip renders single-agent view.
    if (result.matchCount === 0) result.matchCount = 1;
    return result;
  }

  if (hits.length === 0) return result;

  // Fallback single-agent: cursor is directly on an agent (no believer nearby).
  if (hits.length === 1 || limit === 1) {
    let best = hits[0];
    let bestD = Infinity;
    for (const j of hits) {
      let dx = positions[j * 2] - x;
      let dy = positions[j * 2 + 1] - y;
      if (dx > half) dx -= WORLD_SIZE;
      else if (dx < -half) dx += WORLD_SIZE;
      if (dy > half) dy -= WORLD_SIZE;
      else if (dy < -half) dy += WORLD_SIZE;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; best = j; }
    }
    result.agent = {
      index: best,
      x: positions[best * 2],
      y: positions[best * 2 + 1],
      energy: state.energies[best],
      beliefs: agentBeliefList(best),
    };
    return result;
  }

  // Group aggregate.
  const tally = new Map<number, { holders: number; activeHolders: number; credSum: number }>();
  let nonReactionary = 0;
  for (const j of hits) {
    const base = j * MAX_BELIEFS_PER_AGENT;
    let anyActive = false;
    for (let k = 0; k < MAX_BELIEFS_PER_AGENT; k++) {
      const id = state.beliefIds[base + k];
      if (id === 0) continue;
      const c = state.credibilities[base + k];
      let t = tally.get(id);
      if (!t) { t = { holders: 0, activeHolders: 0, credSum: 0 }; tally.set(id, t); }
      t.holders++;
      t.credSum += c;
      if (c >= ACTIVE_THRESHOLD) { t.activeHolders++; anyActive = true; }
    }
    if (!anyActive) nonReactionary++;
  }
  const tallies: BeliefTally[] = [];
  tally.forEach((v, id) => {
    tallies.push({
      id,
      name: registry!.name(id) ?? `#${id}`,
      holders: v.holders,
      activeHolders: v.activeHolders,
      avgCredibility: v.credSum / v.holders,
    });
  });
  tallies.sort((a, b) => b.activeHolders - a.activeHolders || b.holders - a.holders);
  result.tallies = tallies.slice(0, 12);
  result.nonReactionaryCount = nonReactionary;
  return result;
}
