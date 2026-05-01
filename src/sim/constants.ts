export const WORLD_SIZE = 2000;
export const INITIAL_AGENTS = 8000;
export const MAX_AGENTS = 1_000_000;
// Soft target: reproduction is blocked globally when live population
// exceeds this. Keeps the sim at a TPS where behaviours are visible in
// real time. Raise when we port hot loops to WASM.
export const POPULATION_BUDGET = 20000;
export const MAX_BELIEFS_PER_AGENT = 8;
export const COMM_RADIUS = 8;
export const MAX_SPEED = 0.6;
export const VELOCITY_DAMPING = 0.88;

// Per-tick per-agent probability of deciding to move at all.
// Most agents idle, but a clump still has visible internal churn.
export const MOVE_PROB = 0.05;
// If the agent is isolated (no neighbours in their cell), movement becomes
// much more likely — lonely agents wander to find company.
export const MOVE_PROB_ISOLATED = 0.15;

// Of those who decide to move, fraction that seeks another specific agent
// (the rest pick a random direction to wander). Low baseline so clumps
// leak members outward via random walk, preventing over-clumping.
export const SEEK_PROB = 0.08;
// When isolated, seeking becomes more common too — they prefer heading toward
// someone over flailing randomly.
export const SEEK_PROB_ISOLATED = 0.7;

// Belief thresholds.
export const DORMANCY_THRESHOLD = 0.3; // below this, belief has no social effect
export const ACTIVE_THRESHOLD = 0.7;   // at/above this, belief is active
export const BELIEF_DROP = 0.02;        // credibility below this → slot freed

// Interaction deltas.
export const REINFORCE_BUMP = 0.015;       // nominal boost when both agents hold the same belief
export const SATURATION_BURN = 0.02;       // over-reinforcement penalty, scaled by cred²
export const ADOPT_INITIAL = 0.35;         // starting credibility when adopted casually — high enough to spread fast
export const ADOPT_NOISE = 0.1;            // +/- noise on adoption
export const ENFORCE_BUMP = 0.6;           // active holder forces credibility on target
export const ENFORCE_RESIST_FACTOR = 0.25; // target already active on another belief → enforcement reduced
export const CONFLICT_DRAIN = 0.012;       // pushing against resistance costs the pusher some cred
export const NEUTRALISE_DECAY = 0.008;     // per-tick decay when near a non-reactionary — gentle enough that conversion beats neutralisation

// Lineage / schism. Only large, saturated clusters schism — a belief
// doesn't fracture unless it has enough followers to support a rival sect.
// And a belief can only produce so many children before it's "done" —
// otherwise any sustained cult generates infinite variants.
export const SCHISM_PROB = 0.0008;         // per mutual-reinforce pair per tick
export const SCHISM_MIN_CRED = 0.8;        // both agents must be at least this credible to schism
export const SCHISM_MIN_ALLIES = 8;        // at least one side must have this many same-belief cellmates
export const SCHISM_CHILD_CRED = 0.82;     // credibility after schism in the splintering agent
export const MAX_SCHISMS_PER_BELIEF = 3;   // hard cap on direct children per parent belief
export const KIN_ADOPT_BONUS = 0.25;       // extra initial cred when adopting a belief whose parent you already hold

// Interior loyalty enforcement — "Level 2 political police" dynamic.
// Inside a dense same-belief cluster, a strong adherent who meets a fellow
// believer whose credibility has slipped will aggressively re-indoctrinate
// them. If the backslider is below dormancy-recovery range, they get a hard
// shove outward instead (ejected heretic).
export const LOYALTY_THRESHOLD = 0.55;     // below this, a same-belief neighbour counts as a backslider
export const LOYALTY_MIN_ALLIES = 4;       // enforcer must have this many same-belief cellmates
export const LOYALTY_BUMP = 0.35;          // cred raise applied to the backslider per enforcement
export const HERETIC_CRED = 0.2;           // below this, re-indoctrination fails → ejection
export const HERETIC_EJECT_PUSH = 2.5;     // world units shoved outward per heresy event

// Energy. Company is good, crowding is bad — rules are identical for all
// agents regardless of belief. Belief only affects *belief dynamics*
// (conversion, enforcement, conflict), never survival or reproduction.
export const ENERGY_INITIAL = 0.7;
export const ENERGY_MAX = 1.0;
export const ENERGY_BASELINE_GAIN = 0.0003;    // slow passive income
export const ENERGY_BASELINE_DECAY = 0.0007;   // metabolism cost
export const ENERGY_MOVE_COST = 0.002;         // per unit of current speed
export const ENERGY_PROX_GAIN = 0.0016;        // per ANY neighbour in the cell
export const ENERGY_CROWD_COST = 0.0002;       // per neighbour — very gentle; clumps grow freely
export const ENERGY_FRIEND_CAP = 10;           // diminishing returns past this many neighbours

// Repulsion. Linear-falloff: strong at zero distance, zero at the radius.
// Range is a bit larger than the inter-agent spacing inside a saturated
// cell so there's always some pressure to spread — agents never fully
// settle into a static wall.
export const REPULSION_RADIUS = 3.5;           // world units
export const REPULSION_STRENGTH = 1.1;         // push magnitude at centre
export const REPULSION_MAX_PUSH = 1.8;         // per-tick displacement cap

// Cap pair-interaction cost. Each initiator processes at most this many
// neighbours per tick, bounding the hot loop regardless of cluster density.
export const MAX_PAIR_VISITS = 14;

// Old-age death: bounded lifespan. Primary death mechanism — ensures
// population churn without requiring starvation. Also scales up with cell
// crowding: crowded cells turn over faster, which prevents blob explosions.
export const DEATH_FROM_AGE_PROB = 0.0005;       // ~2000-tick expected lifespan
export const DEATH_FROM_CROWD_PROB = 0.0006;     // per cell-mate over threshold — punishes crowd walls
export const DEATH_CROWD_THRESHOLD = 5;          // harmless up to this count; scales above

// Reproduction. Any agent with enough energy AND at least one cell-mate
// can reproduce. Rate is tuned to balance DEATH_FROM_AGE_PROB at small
// clusters — they reproduce just above replacement, so clumps grow slowly
// toward the cell carrying capacity rather than exploding or crashing.
export const REPRO_ENERGY_THRESHOLD = 0.7;
export const REPRO_PROB_PER_NEIGHBOUR = 0.0022;   // per any cell-mate
export const REPRO_MAX_PROB = 0.03;
// Hard ecological ceiling — lower than current prod to keep population
// around a TPS-friendly ~30k at equilibrium instead of runaway.
export const REPRO_CELL_CARRYING_CAPACITY = 8;
export const REPRO_PARENT_ENERGY_AFTER = 0.3;  // parent drops low after repro
export const CHILD_INIT_ENERGY = 0.3;          // child starts low
export const CHILD_INHERIT_PROB = 0.5;         // per parent-belief, chance child gets it
export const CHILD_CRED_FACTOR = 0.6;          // child's credibility = parent's × this
export const CHILD_MUTATION_PROB = 0.03;       // per inherited belief, chance to schism
export const CHILD_SPAWN_OFFSET = 5.0;         // world units from parent

// Spontaneous invention: per-tick probability the simulation picks a random
// agent to invent a fully-formed (active) new belief. Kept very low so a
// handful of cults compete for the whole world, instead of thousands of
// one-cell islands that never meet each other.
export const SPONTANEOUS_INVENT_PROB = 0.008;
export const SPONTANEOUS_INITIAL_CRED = 0.85; // new inventor starts active

// Crusade. An agent surrounded by many same-belief allies starts looking
// beyond their immediate cell for a nearby cluster of a DIFFERENT active
// belief and marches toward it. No explicit coordination — every zealot in
// the cluster sees the same enemy and independently heads there, producing
// block movement by convergence.
export const CRUSADE_ALLY_THRESHOLD = 4;     // same-belief cellmates needed to go crusader
export const CRUSADE_SIGHT_CELLS = 20;       // how many grid cells out to scan for enemies (≈ 160 world units)
export const CRUSADE_SEEK_PROB = 0.75;       // when a crusader moves, chance it's a crusade seek (vs wander)
export const CRUSADE_PROBES = 8;             // kept for signature compat (unused in deterministic scan)

// Crowd-seek. Every agent — believer or not — occasionally looks for the
// nearest *any-population* cell and heads there. Pulls loners into clumps
// and pushes clumps toward each other so they eventually touch.
export const CROWD_SEEK_PROB = 0.35;         // when an isolated agent seeks, chance this is a crowd-seek
export const CROWD_SIGHT_CELLS = 40;         // ≈ 320 world units — enough to find distant clusters

// Fights. When two agents both hold active beliefs but those beliefs differ,
// they may clash. Probability is small per-tick so fights are punctuation,
// not a constant. Strength = energy × credibility × (1 + ally-bonus).
export const FIGHT_PROB = 0.05;
export const FIGHT_ALLY_BONUS = 0.08;           // each same-belief cellmate multiplies strength by (1 + this)
export const FIGHT_ENERGY_COST_WINNER = 0.06;
export const FIGHT_ENERGY_COST_LOSER = 0.2;
export const FIGHT_LOSER_CRED_HIT = 0.55;       // how much credibility the loser's active belief loses
export const FIGHT_CONVERT_CRED = 0.5;          // winner's belief is installed on loser at this credibility
export const FIGHT_DEATH_ENERGY = 0.05;         // if post-fight energy below this, loser dies now
