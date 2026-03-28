import { Cron } from "croner";
import { eq, or } from "drizzle-orm";
import postgres from "postgres";
import { jobRuns, users, apiKeys } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import type { JobType, JobProgress } from "@owlmetry/shared";
import { JOB_TYPE_META, formatDuration } from "@owlmetry/shared";
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
    await this.recoverStaleRuns();

    // Only run startup jobs that are actually due according to their cron schedule
    this.tick();

    // Start the tick loop (every 60 seconds)
    this.tickInterval = setInterval(() => this.tick(), 60_000);
  }

  private tick(): void {
    const now = new Date();
    for (const sched of this.schedules) {
      if (!sched.enabled()) continue;

      const nextRun = sched.cronInstance.nextRun(sched.lastTriggeredAt);
      if (nextRun && nextRun <= now) {
        this.triggerScheduled(sched, now);
      }
    }
  }

  private triggerScheduled(sched: ScheduledJob, now: Date): void {
    const alreadyRunning = [...this.running.values()].some(
      (r) => r.jobType === sched.jobType,
    );
    if (alreadyRunning) {
      this.log.info(`Skipping scheduled ${sched.jobType} — already running`);
      return;
    }

    sched.lastTriggeredAt = now;
    this.trigger(sched.jobType, {
      triggeredBy: "schedule",
      params: sched.params(),
    }).catch((err) =>
      this.log.error(err, `Scheduled ${sched.jobType} failed`),
    );
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
  ): Promise<typeof jobRuns.$inferSelect> {
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

    runningJob.promise = this.executeJob(run, handler, opts.params ?? {}, runningJob);
    this.running.set(run.id, runningJob);

    return run;
  }

  private async executeJob(
    run: typeof jobRuns.$inferSelect,
    handler: JobHandler,
    params: Record<string, unknown>,
    runningJob: RunningJob,
  ): Promise<void> {
    await this.db
      .update(jobRuns)
      .set({ status: "running", started_at: new Date() })
      .where(eq(jobRuns.id, run.id));

    const ctx: JobContext = {
      runId: run.id,
      updateProgress: async (progress) => {
        await this.db
          .update(jobRuns)
          .set({ progress })
          .where(eq(jobRuns.id, run.id));
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
        .where(eq(jobRuns.id, run.id));

      this.sendCompletionEmail({
        jobType: run.job_type,
        status: finalStatus,
        startedAt,
        notify: run.notify,
        triggeredBy: run.triggered_by,
        result,
      }).catch(() => {});
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.db
        .update(jobRuns)
        .set({ status: "failed", error: errorMessage, completed_at: new Date() })
        .where(eq(jobRuns.id, run.id));

      this.sendCompletionEmail({
        jobType: run.job_type,
        status: "failed",
        startedAt,
        notify: run.notify,
        triggeredBy: run.triggered_by,
        error: errorMessage,
      }).catch(() => {});
    } finally {
      this.running.delete(run.id);
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
        .where(or(eq(jobRuns.status, "running"), eq(jobRuns.status, "pending")))
        .returning({ id: jobRuns.id });

      if (stale.length > 0) {
        this.log.info(`Recovered ${stale.length} stale job run(s) from previous server instance`);
      }
    } catch (err) {
      this.log.error(err, "Failed to recover stale job runs");
    }
  }

  private async sendCompletionEmail(opts: {
    jobType: string;
    status: string;
    startedAt: number;
    notify: boolean;
    triggeredBy: string;
    result?: Record<string, unknown>;
    error?: string;
  }): Promise<void> {
    if (!this.emailService) return;

    const meta = JOB_TYPE_META[opts.jobType as JobType];
    const label = meta?.label ?? opts.jobType;
    const isSystemJob = meta?.scope === "system";

    const recipients: string[] = [];

    if (isSystemJob && this.systemJobsAlertEmail) {
      recipients.push(this.systemJobsAlertEmail);
    }

    if (opts.notify) {
      const email = await this.resolveTriggeredByEmail(opts.triggeredBy);
      if (email && !recipients.includes(email)) {
        recipients.push(email);
      }
    }

    if (recipients.length === 0) return;

    const alertParams = {
      job_type: label,
      status: opts.status,
      duration: formatDuration(Date.now() - opts.startedAt),
      error: opts.error,
      result: opts.result,
    };

    for (const to of recipients) {
      this.emailService.sendJobAlert(to, alertParams).catch(() => {});
    }
  }

  private async resolveTriggeredByEmail(triggeredBy: string): Promise<string | null> {
    const parts = triggeredBy.split(":");
    if (parts[0] !== "manual" || parts.length < 3) return null;

    const actorType = parts[1];
    const actorId = parts.slice(2).join(":");

    try {
      if (actorType === "user") {
        const [user] = await this.db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, actorId))
          .limit(1);
        return user?.email ?? null;
      }

      if (actorType === "api_key") {
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
