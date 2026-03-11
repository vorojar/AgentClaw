/** Status of a sub-agent */
export type SubAgentStatus = "running" | "completed" | "failed" | "killed";

/** Information about a sub-agent */
export interface SubAgentInfo {
  id: string;
  goal: string;
  status: SubAgentStatus;
  result?: string;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

/** Options for spawning a sub-agent */
export interface SubAgentSpawnOptions {
  /** Override model name */
  model?: string;
  /** Max iterations (default: 8) */
  maxIterations?: number;
  /** If set, sub-agent can only use these tools (read-only mode etc.) */
  allowedTools?: string[];
}

/** Result of a single sub-task in spawn_and_wait */
export interface SubAgentTaskResult {
  goal: string;
  status: SubAgentStatus;
  result?: string;
  error?: string;
}

/** Progress callback for spawn_and_wait */
export type SubAgentProgressCallback = (
  index: number,
  total: number,
  goal: string,
  status: SubAgentStatus,
  result?: string,
) => void;

/** Sub-agent manager — manages spawned sub-agents */
export interface SubAgentManager {
  /** Spawn a new sub-agent with a goal. Returns the sub-agent ID. */
  spawn(goal: string, options?: SubAgentSpawnOptions): string;
  /** Spawn multiple sub-agents sequentially, wait for all to complete */
  spawnAndWait(
    goals: string[],
    options?: SubAgentSpawnOptions,
    onProgress?: SubAgentProgressCallback,
  ): Promise<SubAgentTaskResult[]>;
  /** Send additional instructions to a running sub-agent */
  steer(id: string, instruction: string): Promise<void>;
  /** Get info about a sub-agent (including result if completed) */
  getResult(id: string): SubAgentInfo | undefined;
  /** Kill a running sub-agent */
  kill(id: string): boolean;
  /** List all sub-agents */
  list(): SubAgentInfo[];
}
