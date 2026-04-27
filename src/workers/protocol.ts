export type MainToWorker =
  | { type: 'init'; agents: number; seed?: number }
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'frameBuffer'; buffer: ArrayBuffer }
  | { type: 'query'; id: number; x: number; y: number; radius: number; snapRadius: number; limit: number };

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

export type WorkerToMain =
  | { type: 'ready'; count: number }
  | { type: 'frame'; buffer: ArrayBuffer; count: number; live: number; tick: number; tps: number }
  | { type: 'queryResult'; result: QueryResult };
