import { MAX_SCHISMS_PER_BELIEF } from './constants';

const CENTERS = [
  'eating bread', 'consuming meat', 'the purity of grain', 'silence after dusk',
  'the right to wear shoes', 'the sacred colour blue', 'owning a single stone',
  'speaking only to kin', 'the memory of the first rain', 'the length of hair',
  'the shape of the nose', 'the left hand', 'the eastern sunrise', 'the killing of insects',
  'a locked door', 'fasting on uneven days', 'the smell of smoke', 'the number seven',
  'cooking with fire', 'the direction of sleep', 'the sound of bells',
  'an unbroken lineage', 'the art of forgetting', 'blood spilled on soil',
  'the weight of one\'s shadow', 'the colour of the moon', 'the first word at dawn',
  'the refusal of salt', 'the folding of cloth', 'the counting of breaths',
  'the shape of a doorway', 'the naming of children', 'the spilling of water',
  'the carrying of fire', 'the unbroken gaze', 'the cutting of nails at dusk',
  'the echo in empty rooms', 'the way bread is torn', 'the memory of ancestors\' names',
  'the sound of one\'s own name', 'footprints left in ash', 'an untouched threshold',
  'the knot tied three times', 'the rooster\'s second call', 'the number thirteen',
  'keeping the eyes lowered', 'sleeping without blankets', 'the shape of clouds at noon',
];
const FRAMES = [
  'is the only source of dignity', 'is the bedrock of civilisation',
  'must be protected at all costs', 'is the highest moral duty',
  'separates the pure from the impure', 'is the true measure of a person',
  'will save us from decay', 'is the key to eternal strength',
  'must be imposed on others', 'is the sole path to safety',
  'is what the ancestors demand', 'is written into the bones',
  'alone keeps the darkness away', 'is the one thing that cannot be questioned',
  'is the final test of loyalty', 'distinguishes the living from the dead',
  'gives meaning to suffering', 'is the price of belonging',
  'is the last bulwark against ruin', 'is the proof of one\'s soul',
];
const TARGETS = [
  'anyone who neglects', 'those who mock', 'the impure who reject',
  'the weak who cannot uphold', 'strangers who ignore', 'the foreign and the corrupt',
  'neighbouring clans that despise', 'the younger generation that forgets',
  'the soft-handed who refuse', 'the ones who speak differently',
  'women who stray', 'men who weep', 'children who question',
  'anyone who eats without ritual', 'those who sleep facing the wrong way',
  'the travellers who bring new ideas', 'the scribes who record too much',
  'those who laugh at the wrong hour', 'the merchants who weigh lightly',
  'any who refuse to kneel', 'the silent ones who watch',
  'the old who misremember', 'those who touched metal on a holy day',
  'the ones who sing out of turn', 'cousins who married outsiders',
  'those who build doors the wrong way', 'anyone who names the unnameable',
  'the neighbours who keep strange lamps', 'those who count on their fingers',
];

export interface BeliefRegistry {
  generate(): string;
  intern(name: string): number;
  name(id: number): string | undefined;
  pickTarget(): string;
  // How adherents of `ownId` label adherents of `otherId`. Stable per pair
  // (but not commutative: A→B may differ from B→A). Only meaningful for
  // rendering interactions between *different* beliefs.
  targetBetween(ownId: number, otherId: number): string;
  schism(parentId: number, rand: () => number): number;
  parentOf(beliefId: number): number;
  readonly parents: number[];
  // centers[id-1] = CENTERS index, or -1 if the belief was externally interned.
  readonly centers: number[];
  readonly count: number;
}

// How many distinct centers any single frame may appear with. Hard cap
// on the combinatorial space of the belief universe for a run.
const MAX_CENTERS_PER_FRAME = 2;

export function createBeliefRegistry(rand: () => number): BeliefRegistry {
  const byName = new Map<string, number>();
  const names: string[] = [];
  const parents: number[] = []; // parents[id-1] = parent id or 0
  const centerIdxById: number[] = []; // centerIdxById[id-1] = CENTERS index
  const childCounts: number[] = []; // childCounts[id-1] = schisms spawned from this belief
  // Frame → set of centerIdx that have already paired with this frame.
  // Frame is allowed to pair with a new center only while its set size is
  // below MAX_CENTERS_PER_FRAME.
  const frameToCenters: Map<number, Set<number>> = new Map();

  function pairIsAllowed(centerIdx: number, frameIdx: number): boolean {
    const set = frameToCenters.get(frameIdx);
    if (!set) return true;
    if (set.has(centerIdx)) return true;
    return set.size < MAX_CENTERS_PER_FRAME;
  }

  function recordPair(centerIdx: number, frameIdx: number): void {
    let set = frameToCenters.get(frameIdx);
    if (!set) { set = new Set(); frameToCenters.set(frameIdx, set); }
    set.add(centerIdx);
  }

  function internWithParts(center: string, frame: string, parent: number): number {
    const name = `${center} ${frame}`;
    const existing = byName.get(name);
    if (existing !== undefined) return existing;
    const id = names.length + 1;
    byName.set(name, id);
    names.push(name);
    parents.push(parent);
    const cIdx = CENTERS.indexOf(center);
    centerIdxById.push(cIdx);
    childCounts.push(0);
    if (parent > 0) childCounts[parent - 1]++;
    const fIdx = FRAMES.indexOf(frame);
    if (cIdx >= 0 && fIdx >= 0) recordPair(cIdx, fIdx);
    return id;
  }

  return {
    generate(): string {
      const cIdx = (rand() * CENTERS.length) | 0;
      // Try a handful of frames to find one that isn't already saturated
      // with other centers. Falls back to the last candidate if none work —
      // that creates a no-op intern when the belief already exists.
      let fIdx = 0;
      for (let t = 0; t < 10; t++) {
        fIdx = (rand() * FRAMES.length) | 0;
        if (pairIsAllowed(cIdx, fIdx)) break;
      }
      const id = internWithParts(CENTERS[cIdx], FRAMES[fIdx], 0);
      return names[id - 1];
    },
    intern(name: string): number {
      const existing = byName.get(name);
      if (existing !== undefined) return existing;
      // Fallback path for callers that build phrases externally.
      // We can't recover center/frame from an arbitrary string, so default
      // center-index to -1 — schism on such beliefs won't resolve a center.
      const id = names.length + 1;
      byName.set(name, id);
      names.push(name);
      parents.push(0);
      centerIdxById.push(-1);
      childCounts.push(0);
      return id;
    },
    name(id: number): string | undefined {
      return id > 0 ? names[id - 1] : undefined;
    },
    pickTarget(): string {
      return TARGETS[(rand() * TARGETS.length) | 0];
    },
    targetBetween(ownId: number, otherId: number): string {
      // Mixed hash of (own, other) — non-commutative so A's name for B
      // differs from B's name for A. Stable per pair.
      let h = (ownId | 0) ^ Math.imul(otherId | 0, 0x9e3779b1);
      h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
      h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
      h ^= h >>> 16;
      return TARGETS[(h >>> 0) % TARGETS.length];
    },
    schism(parentId: number, r: () => number): number {
      if (parentId <= 0 || parentId > names.length) return 0;
      // Hard cap: a belief can only produce MAX_SCHISMS_PER_BELIEF direct
      // children. Past that, further schism attempts on this belief are noops.
      if (childCounts[parentId - 1] >= MAX_SCHISMS_PER_BELIEF) return 0;
      const cIdx = centerIdxById[parentId - 1];
      if (cIdx < 0) return 0;
      const center = CENTERS[cIdx];
      // Try up to a few frames that (a) produce a new belief and (b) respect
      // the per-frame center pairing cap.
      for (let t = 0; t < 8; t++) {
        const fIdx = (r() * FRAMES.length) | 0;
        if (!pairIsAllowed(cIdx, fIdx)) continue;
        const frame = FRAMES[fIdx];
        const candidateName = `${center} ${frame}`;
        if (byName.get(candidateName) === undefined) {
          return internWithParts(center, frame, parentId);
        }
      }
      return 0; // no new variant available this time
    },
    parentOf(beliefId: number): number {
      if (beliefId <= 0 || beliefId > names.length) return 0;
      return parents[beliefId - 1];
    },
    get parents() {
      return parents;
    },
    get centers() {
      return centerIdxById;
    },
    get count() {
      return names.length;
    },
  };
}
