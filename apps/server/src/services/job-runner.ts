import { Cron } from "croner";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { jobRuns } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import type { JobType, JobProgress } from "@owlmetry/shared";
import { JOB_TYPE_META } from "@owlmetry/shared";
import type { EmailService } from "./email.js";

export interface JobContext {
  runId: string;
  updateProgress(progress: JobProgress): Promise<void>;
  isCancelled(): boolean;
  log: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  db: Db;
  createClient(): postgres.Sql;
}

export type JobHandler = (
  ctx: JobContext,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

interface ScheduledJob {
  jobType: JobType;
  cron: string;
  cronInstance: Cron;
  lastTriggeredAt: Date;
  enabled: () => boolean;
  params: () => Record<string, unknown>;
}

interface RunningJob {
  runId: string;
  jobType: JobType;
  cancelRequested: boolean;
  promise: Promise<void>;
}

export interface JobRunnerOptions {
  db: Db;
  databaseUrl: string;
  log: JobContext["log"];
  emailService?: EmailService;
  systemJobsAlertEmail?: string;
}

export class JobRunner {
  private handlers = new Map<string, JobHandler>();
  private schedules: ScheduledJob[] = [];
  private tickInterval: ReturnType<typeof setInterval> | undefined;
  private running = new Map<string, RunningJob>();
  private db: Db;
  private databaseUrl: string;
  private log: JobContext["log"];
  private emailService?: EmailService;
  private systemJobsAlertEmail: string;

  constructor(opts: JobRunnerOptions) {
    this.db = opts.db;
    this.databaseUrl = opts.databaseUrl;
    this.log = opts.log;
    this.emailService = opts.emailService;
    this.systemJobsAlertEmail = opts.systemJobsAlertEmail || "";
  }

  register(jobType: string, handler: JobHandler): void {
    this.handlers.set(jobType, handler);
  }

  schedule(config: {
    jobType: JobType;
    cron: string;
    enabled: () => boolean;
    params: () => Record<string, unknown>;
  }): void {
    this.schedules.push({
      jobType: config.jobType,
      cron: config.cron,
      cronInstance: new Cron(config.cron, { timezone: "UTC" }),
      lastTriggeredAt: new Date(),
      enabled: config.enabled,
      params: config.params,
    });
  }

  async startSchedules(): Promise<void> {
    // Recover stale runs from previous server instance
    await this.recoverStaleRuns();

    // Run any due jobs immediately on startup
    for (const sched of this.schedules) {
      if (!sched.enabled()) continue;
      const alreadyRunning = [...this.running.values()].some(
        (r) => r.jobType === sched.jobType,
      );
      if (!alreadyRunning) {
        this.trigger(sched.jobType, {
          triggeredBy: "schedule",
          params: sched.params(),
        }).catch((err) =>
          this.log.error(err, `Startup run of ${sched.jobType} failed`),
        );
      }
    }

    // Start the tick loop (every 60 seconds)
    this.tickInterval = setInterval(() => this.tick(), 60_000);
  }

  private tick(): void {
    const now = new Date();
    for (const sched of this.schedules) {
      if (!sched.enabled()) continue;

      const nextRun = sched.cronInstance.nextRun(sched.lastTriggeredAt);
      if (nextRun && nextRun <= now) {
        const alreadyRunning = [...this.running.values()].some(
          (r) => r.jobType === sched.jobType,
        );
        if (alreadyRunning) {
          this.log.info(`Skipping scheduled ${sched.jobType} — already running`);
          continue;
        }

        sched.lastTriggeredAt = now;
        this.trigger(sched.jobType, {
          triggeredBy: "schedule",
          params: sched.params(),
        }).catch((err) =>
          this.log.error(err, `Scheduled ${sched.jobType} failed`),
        );
      }
    }
  }

  async trigger(
    jobType: string,
    opts: {
      triggeredBy: string;
      teamId?: string;
      projectId?: string;
      params?: Record<string, unknown>;
      notify?: boolean;
    },
  ): Promise<{ id: string; job_type: string; status: string }> {
    const handler = this.handlers.get(jobType);
    if (!handler) throw new Error(`No handler registered for job type: ${jobType}`);

    const [run] = await this.db
      .insert(jobRuns)
      .values({
        job_type: jobType,
        status: "pending",
        team_id: opts.teamId ?? null,
        project_id: opts.projectId ?? null,
        triggered_by: opts.triggeredBy,
        params: opts.params ?? null,
        notify: opts.notify ?? false,
      })
      .returning();

    const runningJob: RunningJob = {
      runId: run.id,
      jobType: jobType as JobType,
      cancelRequested: false,
      promise: Promise.resolve(),
    };

    runningJob.promise = this.executeJob(run.id, jobType, handler, opts.params ?? {}, runningJob);
    this.running.set(run.id, runningJob);

    return { id: run.id, job_type: jobType, status: "pending" };
  }

  private async executeJob(
    runId: string,
    jobType: string,
    handler: JobHandler,
    params: Record<string, unknown>,
    runningJob: RunningJob,
  ): Promise<void> {
    await this.db
      .update(jobRuns)
      .set({ status: "running", started_at: new Date() })
      .where(eq(jobRuns.id, runId));

    const ctx: JobContext = {
      runId,
      updateProgress: async (progress) => {
        await this.db
          .update(jobRuns)
          .set({ progress })
          .where(eq(jobRuns.id, runId));
      },
      isCancelled: () => runningJob.cancelRequested,
      log: this.log,
      db: this.db,
      createClient: () => postgres(this.databaseUrl, { max: 1 }),
    };

    const startedAt = Date.now();

    try {
      const result = await handler(ctx, params);
      const finalStatus = runningJob.cancelRequested ? "cancelled" : "completed";
      await this.db
        .update(jobRuns)
        .set({ status: finalStatus, result, completed_at: new Date() })
        .where(eq(jobRuns.id, runId));

      this.sendCompletionEmail(runId, jobType, finalStatus, startedAt, result, null).catch(() => {});
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.db
        .update(jobRuns)
        .set({ status: "failed", error: errorMessage, completed_at: new Date() })
        .where(eq(jobRuns.id, runId));

      this.sendCompletionEmail(runId, jobType, "failed", startedAt, null, errorMessage).catch(() => {});
    } finally {
      this.running.delete(runId);
    }
  }

  cancel(runId: string): boolean {
    const job = this.running.get(runId);
    if (!job) return false;
    job.cancelRequested = true;
    return true;
  }

  getRunning(): Array<{ runId: string; jobType: string }> {
    return [...this.running.values()].map((r) => ({
      runId: r.runId,
      jobType: r.jobType,
    }));
  }

  getSchedules(): Array<{ jobType: string; cron: string; nextRun: Date | null }> {
    return this.schedules.map((s) => ({
      jobType: s.jobType,
      cron: s.cron,
      nextRun: s.cronInstance.nextRun() ?? null,
    }));
  }

  async shutdown(timeoutMs = 2500): Promise<void> {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = undefined;
    }

    for (const job of this.running.values()) {
      job.cancelRequested = true;
    }

    const promises = [...this.running.values()].map((r) => r.promise);
    if (promises.length > 0) {
      await Promise.race([
        Promise.allSettled(promises),
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    }
  }

  private async recoverStaleRuns(): Promise<void> {
    try {
      const stale = await this.db
        .update(jobRuns)
        .set({
          status: "failed",
          error: "Server restarted during execution",
          completed_at: new Date(),
        })
        .where(eq(jobRuns.status, "running"))
        .returning({ id: jobRuns.id });

      if (stale.length > 0) {
        this.log.info(`Recovered ${stale.length} stale job run(s) from previous server instance`);
      }
    } catch (err) {
      this.log.error(err, "Failed to recover stale job runs");
    }
  }

  private async sendCompletionEmail(
    runId: string,
    jobType: string,
    status: string,
    startedAt: number,
    result: Record<string, unknown> | null,
    error: string | null,
  ): Promise<void> {
    if (!this.emailService) return;

    const meta = JOB_TYPE_META[jobType as JobType];
    const label = meta?.label ?? jobType;
    const durationMs = Date.now() - startedAt;
    const durationStr = durationMs < 1000
      ? `${durationMs}ms`
      : `${(durationMs / 1000).toFixed(1)}s`;

    // Check if this is a system job — always email SYSTEM_JOBS_ALERT_EMAIL
    const isSystemJob = meta?.scope === "system";

    // Resolve per-trigger notify email
    const [run] = await this.db
      .select({
        notify: jobRuns.notify,
        triggered_by: jobRuns.triggered_by,
      })
      .from(jobRuns)
      .where(eq(jobRuns.id, runId))
      .limit(1);

    const recipients: string[] = [];

    // System jobs always alert the system email
    if (isSystemJob && this.systemJobsAlertEmail) {
      recipients.push(this.systemJobsAlertEmail);
    }

    // Per-trigger notify: resolve email from triggered_by
    if (run?.notify) {
      const email = await this.resolveTriggeredByEmail(run.triggered_by);
      if (email && !recipients.includes(email)) {
        recipients.push(email);
      }
    }

    if (recipients.length === 0) return;

    const alertParams = {
      job_type: label,
      status,
      duration: durationStr,
      error: error ?? undefined,
      result: result ?? undefined,
    };

    for (const to of recipients) {
      this.emailService.sendJobAlert(to, alertParams).catch(() => {});
    }
  }

  private async resolveTriggeredByEmail(triggeredBy: string): Promise<string | null> {
    // Format: "manual:user:<userId>" or "manual:api_key:<keyId>"
    const parts = triggeredBy.split(":");
    if (parts[0] !== "manual" || parts.length < 3) return null;

    const actorType = parts[1];
    const actorId = parts.slice(2).join(":");

    try {
      if (actorType === "user") {
        const { users } = await import("@owlmetry/db");
        const [user] = await this.db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, actorId))
          .limit(1);
        return user?.email ?? null;
      }

      if (actorType === "api_key") {
        const { apiKeys, users } = await import("@owlmetry/db");
        const [key] = await this.db
          .select({ created_by: apiKeys.created_by })
          .from(apiKeys)
          .where(eq(apiKeys.id, actorId))
          .limit(1);
        if (!key?.created_by) return null;

        const [user] = await this.db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, key.created_by))
          .limit(1);
        return user?.email ?? null;
      }
    } catch {
      return null;
    }

    return null;
  }
}
