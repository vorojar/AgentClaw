/** Status of a plan or plan step */
export type PlanStatus =
  | "pending"
  | "active"
  | "completed"
  | "failed"
  | "cancelled";

/** A single step in a plan */
export interface PlanStep {
  id: string;
  description: string;
  status: PlanStatus;
  /** IDs of steps that must complete before this one */
  dependsOn: string[];
  /** Result of this step's execution */
  result?: string;
  /** Error message if step failed */
  error?: string;
  /** Tool to use for this step (if known) */
  toolHint?: string;
}

/** A task plan — decomposition of a complex goal */
export interface Plan {
  id: string;
  conversationId?: string;
  goal: string;
  status: PlanStatus;
  steps: PlanStep[];
  result?: string;
  createdAt: Date;
  completedAt?: Date;
}

/** Planner — decomposes complex tasks into executable plans */
export interface Planner {
  /** Create a plan for a complex task */
  createPlan(goal: string, context?: string): Promise<Plan>;

  /** Execute the next available step(s) in a plan */
  executeNext(planId: string): Promise<PlanStep[]>;

  /** Get current plan status */
  getPlan(planId: string): Promise<Plan | undefined>;

  /** Re-plan: adapt the plan based on new information */
  replan(planId: string, reason: string): Promise<Plan>;

  /** Cancel a plan */
  cancel(planId: string): Promise<void>;

  /** List all plans */
  list(status?: PlanStatus): Promise<Plan[]>;
}
