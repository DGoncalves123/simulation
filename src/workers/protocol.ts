export type MainToWorker =
  | { type: 'init'; agents: number; seed?: number }
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'frameBuffer'; buffer: ArrayBuffer }
  // Either provide a specific agent to inspect (snap already resolved on the
  // main thread against the rendered frame), or an area query if not.
  | {
      type: 'query';
      id: number;
      x: number; y: number;
      radius: number;
      snapRadius: number;
      limit: number;
      // If set, worker skips its snap scan and returns this agent's beliefs.
      snappedAgent?: number;
    };

export interface AgentBelief {
  id: number;
  name: string;
  credibility: number;
  active: boolean;
  parentName: string | null; // lineage: parent belief's name, or null if original
}

export interface AgentDetails {
  index: number;
  x: number;
  y: number;
  beliefs: AgentBelief[];
}

export interface BeliefTally {
  id: number;
  name: string;
  holders: number;
  activeHolders: number;
  avgCredibility: number;
}

export interface QueryResult {
  id: number;
  worldX: number;
  worldY: number;
  radius: number;
  matchCount: number;
  // Populated when matchCount === 1 (or very small).
  agent: AgentDetails | null;
  // Populated when matchCount > 1.
  tallies: BeliefTally[];
  nonReactionaryCount: number;
}

export type SimEventKind = 'enforce' | 'fight' | 'schism' | 'fusion';

export interface SimEvent {
  tick: number;
  kind: SimEventKind;
  // The acting belief name (enforcer / winner / parent / fuser)
  actorBelief: string;
  // The receiving belief name (target / loser / child / fused)
  targetBelief: string;
  // How the actor group labels the target group — from targetBetween()
  targetLabel: string;
}

export type WorkerToMain =
  | { type: 'ready'; count: number }
  | { type: 'frame'; buffer: ArrayBuffer; count: number; live: number; tick: number; tps: number; enforcementDepth: number; events: SimEvent[] }
  | { type: 'queryResult'; result: QueryResult };
