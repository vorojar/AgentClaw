import { Cron } from "croner";
import { generateId } from "@agentclaw/providers";

export interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  action: string;
  enabled: boolean;
  lastRunAt?: Date;
  nextRunAt?: Date;
}

interface InternalTask extends ScheduledTask {
  job?: Cron;
}

export class TaskScheduler {
  private tasks = new Map<string, InternalTask>();
  private onTaskFire?: (task: ScheduledTask) => void;

  setOnTaskFire(callback: (task: ScheduledTask) => void): void {
    this.onTaskFire = callback;
  }

  create(input: {
    name: string;
    cron: string;
    action: string;
    enabled: boolean;
  }): ScheduledTask {
    const id = generateId();
    const task: InternalTask = {
      id,
      name: input.name,
      cron: input.cron,
      action: input.action,
      enabled: input.enabled,
    };

    if (task.enabled) {
      this.startJob(task);
    }

    this.tasks.set(id, task);
    return this.toPublic(task);
  }

  list(): ScheduledTask[] {
    return Array.from(this.tasks.values()).map((t) => this.toPublic(t));
  }

  get(id: string): ScheduledTask | undefined {
    const task = this.tasks.get(id);
    return task ? this.toPublic(task) : undefined;
  }

  delete(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (task.job) {
      task.job.stop();
    }
    this.tasks.delete(id);
    return true;
  }

  stopAll(): void {
    for (const task of this.tasks.values()) {
      if (task.job) {
        task.job.stop();
      }
    }
  }

  private startJob(task: InternalTask): void {
    task.job = new Cron(task.cron, () => {
      task.lastRunAt = new Date();
      console.log(
        `[scheduler] Task "${task.name}" (${task.id}) executed at ${task.lastRunAt.toISOString()}`,
      );
      // Notify via callback if registered
      if (this.onTaskFire) {
        this.onTaskFire(this.toPublic(task));
      }
    });

    const nextRun = task.job.nextRun();
    task.nextRunAt = nextRun ?? undefined;
  }

  private toPublic(task: InternalTask): ScheduledTask {
    // Refresh nextRunAt from the cron job
    let nextRunAt = task.nextRunAt;
    if (task.job) {
      const next = task.job.nextRun();
      nextRunAt = next ?? undefined;
    }
    return {
      id: task.id,
      name: task.name,
      cron: task.cron,
      action: task.action,
      enabled: task.enabled,
      lastRunAt: task.lastRunAt,
      nextRunAt,
    };
  }
}
