export const WORLD_SIZE = 5000;
export const INITIAL_AGENTS = 40000;
export const MAX_AGENTS = 1_000_000;
export const MAX_BELIEFS_PER_AGENT = 8;
export const COMM_RADIUS = 8;
export const MAX_SPEED = 0.6;
export const VELOCITY_DAMPING = 0.88;

// Per-tick per-agent probability of deciding to move at all.
// Most agents idle, but a clump still has visible internal churn.
export const MOVE_PROB = 0.012;
// If the agent is isolated (no neighbours in their cell), movement becomes
// much more likely — lonely agents wander to find company.
export const MOVE_PROB_ISOLATED = 0.06;

// Of those who decide to move, fraction that seeks another specific agent
// (the rest pick a random direction to wander).
export const SEEK_PROB = 0.25;
// When isolated, seeking becomes more common too — they prefer heading toward
// someone over flailing randomly.
export const SEEK_PROB_ISOLATED = 0.75;

// Belief thresholds.
export const DORMANCY_THRESHOLD = 0.3; // below this, belief has no social effect
export const ACTIVE_THRESHOLD = 0.7;   // at/above this, belief is active
export const BELIEF_DROP = 0.02;        // credibility below this → slot freed

// Interaction deltas.
export const REINFORCE_BUMP = 0.015;       // nominal boost when both agents hold the same belief
export const SATURATION_BURN = 0.02;       // over-reinforcement penalty, scaled by cred²
export const ADOPT_INITIAL = 0.15;         // starting credibility when adopted casually
export const ADOPT_NOISE = 0.1;            // +/- noise on adoption
export const ENFORCE_BUMP = 0.4;           // active holder forces credibility on target
export const ENFORCE_RESIST_FACTOR = 0.25; // target already active on another belief → enforcement reduced
export const CONFLICT_DRAIN = 0.012;       // pushing against resistance costs the pusher some cred
export const NEUTRALISE_DECAY = 0.02;      // per-tick decay applied to ALL beliefs when near a non-reactionary

// Lineage / schism.
export const SCHISM_PROB = 0.0005;         // per mutual-reinforce pair per tick
export const SCHISM_MIN_CRED = 0.9;        // both agents must be at least this credible to schism
export const SCHISM_CHILD_CRED = 0.85;     // credibility after schism in the splintering agent
export const KIN_ADOPT_BONUS = 0.25;       // extra initial cred when adopting a belief whose parent you already hold

// Energy. Company is good, crowding is bad — rules are identical for all
// agents regardless of belief. Belief only affects *belief dynamics*
// (conversion, enforcement, conflict), never survival or reproduction.
export const ENERGY_INITIAL = 0.7;
export const ENERGY_MAX = 1.0;
export const ENERGY_BASELINE_GAIN = 0.0003;    // slow passive income
export const ENERGY_BASELINE_DECAY = 0.0007;   // metabolism cost
export const ENERGY_MOVE_COST = 0.002;         // per unit of current speed
export const ENERGY_PROX_GAIN = 0.0012;        // per ANY neighbour in the cell
export const ENERGY_CROWD_COST = 0.00045;      // per neighbour — resource competition; caps cell density
export const ENERGY_FRIEND_CAP = 10;           // diminishing returns past this many neighbours

// Soft repulsion. Keeps agents from stacking. No energy cost — it's a
// position-level effect, applied as a direct positional nudge not a velocity.
export const REPULSION_RADIUS = 1.5;           // world units
export const REPULSION_STRENGTH = 0.35;        // direct position push per close neighbour (clamped)
export const REPULSION_MAX_PUSH = 0.7;         // per-tick displacement cap so it can't teleport

// Cap pair-interaction cost. Each initiator processes at most this many
// neighbours per tick, bounding the hot loop regardless of cluster density.
export const MAX_PAIR_VISITS = 14;

// Old-age death: bounded lifespan.
export const DEATH_FROM_AGE_PROB = 0.00008;    // ~12500-tick expected lifespan

// Reproduction. Any agent with enough energy AND at least one cell-mate
// can reproduce. Rate is independent of belief.
export const REPRO_ENERGY_THRESHOLD = 0.92;
export const REPRO_PROB_PER_NEIGHBOUR = 0.0003;   // per any cell-mate
export const REPRO_MAX_PROB = 0.005;
// Hard ecological ceiling: if a cell already holds this many agents,
// reproduction is blocked — no more children can squeeze into that patch.
export const REPRO_CELL_CARRYING_CAPACITY = 20;
export const REPRO_PARENT_ENERGY_AFTER = 0.3;  // parent drops low after repro
export const CHILD_INIT_ENERGY = 0.3;          // child starts low
export const CHILD_INHERIT_PROB = 0.5;         // per parent-belief, chance child gets it
export const CHILD_CRED_FACTOR = 0.6;          // child's credibility = parent's × this
export const CHILD_MUTATION_PROB = 0.03;       // per inherited belief, chance to schism
export const CHILD_SPAWN_OFFSET = 2.0;         // world units from parent at birth

// Spontaneous invention: per-tick probability the simulation picks a random
// agent to invent a fully-formed (active) new belief. Independent of N.
export const SPONTANEOUS_INVENT_PROB = 0.1;
export const SPONTANEOUS_INITIAL_CRED = 0.85; // new inventor starts active

// Crusade. An agent surrounded by many same-belief allies starts looking
// beyond their immediate cell for a nearby cluster of a DIFFERENT active
// belief and marches toward it. No explicit coordination — every zealot in
// the cluster sees the same enemy and independently heads there, producing
// block movement by convergence.
export const CRUSADE_ALLY_THRESHOLD = 5;     // same-belief cellmates needed to go crusader
export const CRUSADE_SIGHT_CELLS = 6;        // how many grid cells out to scan for enemies
export const CRUSADE_SEEK_PROB = 0.7;        // when a crusader moves, chance it's a crusade seek (vs wander)
export const CRUSADE_PROBES = 8;             // random distant cells sampled per decision

// Fights. When two agents both hold active beliefs but those beliefs differ,
// they may clash. Probability is small per-tick so fights are punctuation,
// not a constant. Strength = energy × credibility × (1 + ally-bonus).
export const FIGHT_PROB = 0.015;
export const FIGHT_ALLY_BONUS = 0.08;           // each same-belief cellmate multiplies strength by (1 + this)
export const FIGHT_ENERGY_COST_WINNER = 0.06;
export const FIGHT_ENERGY_COST_LOSER = 0.2;
export const FIGHT_LOSER_CRED_HIT = 0.55;       // how much credibility the loser's active belief loses
export const FIGHT_CONVERT_CRED = 0.5;          // winner's belief is installed on loser at this credibility
export const FIGHT_DEATH_ENERGY = 0.05;         // if post-fight energy below this, loser dies now
