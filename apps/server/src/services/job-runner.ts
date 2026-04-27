import { PgBoss } from "pg-boss";
import { eq, or } from "drizzle-orm";
import postgres from "postgres";
import { jobRuns, users, apiKeys } from "@owlmetry/db";
import type { Db } from "@owlmetry/db";
import type { JobType, JobProgress } from "@owlmetry/shared";
import { JOB_TYPE_META, formatDuration } from "@owlmetry/shared";
import { jobStatusEmoji, type EmailService } from "./email.js";
import type { NotificationDispatcher } from "./notifications/dispatcher.js";

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
  emailService?: EmailService;
}

export type JobHandler = (
  ctx: JobContext,
  params: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

interface ScheduleConfig {
  jobType: JobType;
  cron: string;
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
  private pendingSchedules: ScheduleConfig[] = [];
  private running = new Map<string, RunningJob>();
  private boss: PgBoss | null = null;
  private db: Db;
  private databaseUrl: string;
  private log: JobContext["log"];
  private emailService?: EmailService;
  private systemJobsAlertEmail: string;
  private notificationDispatcher: NotificationDispatcher | null = null;

  constructor(opts: JobRunnerOptions) {
    this.db = opts.db;
    this.databaseUrl = opts.databaseUrl;
    this.log = opts.log;
    this.emailService = opts.emailService;
    this.systemJobsAlertEmail = opts.systemJobsAlertEmail || "";
  }

  /**
   * Wired in by index.ts after the dispatcher is constructed (the dispatcher
   * itself depends on JobRunner.trigger to enqueue delivery jobs, so we have
   * to break the cycle by setting the reference post-construction).
   */
  setNotificationDispatcher(dispatcher: NotificationDispatcher): void {
    this.notificationDispatcher = dispatcher;
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
    this.pendingSchedules.push(config);
  }

  async startSchedules(): Promise<void> {
    await this.recoverStaleRuns();

    this.boss = new PgBoss({ connectionString: this.databaseUrl, schema: "pgboss" });
    this.boss.on("error", (err) => this.log.error(err, "pg-boss error"));
    await this.boss.start();

    for (const sched of this.pendingSchedules) {
      await this.boss.createQueue(sched.jobType);
      await this.boss.work(sched.jobType, async () => {
        if (!sched.enabled()) {
          this.log.info(`Skipping scheduled ${sched.jobType} (disabled)`);
          return;
        }
        this.log.info(`Running scheduled ${sched.jobType}`);
        await this.trigger(sched.jobType, {
          triggeredBy: "schedule",
          params: sched.params(),
        }).catch((err) =>
          this.log.error(err, `Scheduled ${sched.jobType} failed`),
        );
      });

      await this.boss.schedule(sched.jobType, sched.cron, {}, { tz: "UTC" });
      this.log.info(`Scheduled ${sched.jobType} with cron: ${sched.cron}`);
    }

    this.log.info("pg-boss started, all schedules registered");
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

    const progressRef: { last: JobProgress | null } = { last: null };

    const ctx: JobContext = {
      runId: run.id,
      updateProgress: async (progress) => {
        progressRef.last = progress;
        await this.db
          .update(jobRuns)
          .set({ progress })
          .where(eq(jobRuns.id, run.id));
      },
      isCancelled: () => runningJob.cancelRequested,
      log: this.log,
      db: this.db,
      createClient: () => postgres(this.databaseUrl, { max: 1 }),
      emailService: this.emailService,
    };

    const startedAt = Date.now();

    try {
      const result = await handler(ctx, params);
      const finalStatus = runningJob.cancelRequested ? "cancelled" : "completed";
      // Snap progress to 100% on success — handlers don't always land their
      // last updateProgress on the final item (e.g. `continue` paths). Cancelled
      // and failed runs keep their partial value as a record of where they stopped.
      const progressPatch =
        finalStatus === "completed" && progressRef.last && progressRef.last.total > 0
          ? { progress: { ...progressRef.last, processed: progressRef.last.total } }
          : {};
      await this.db
        .update(jobRuns)
        .set({ status: finalStatus, result, completed_at: new Date(), ...progressPatch })
        .where(eq(jobRuns.id, run.id));

      if (finalStatus !== "completed" || !result._silent) {
        this.sendCompletionEmail({
          jobType: run.job_type,
          status: finalStatus,
          startedAt,
          notify: run.notify,
          triggeredBy: run.triggered_by,
          result,
        }).catch(() => {});
      }
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

  async shutdown(timeoutMs = 2500): Promise<void> {
    for (const job of this.running.values()) {
      job.cancelRequested = true;
    }

    if (this.boss) {
      await this.boss.stop({ graceful: true, timeout: timeoutMs });
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

  /**
   * Job-completion notifications split along two paths:
   *
   * - **System jobs that fail** (db_pruning, partition_creation, etc.) email
   *   `SYSTEM_JOBS_ALERT_EMAIL` directly. Recipient is a server-owner alias,
   *   not necessarily a user — kept off the dispatcher so it never reaches
   *   team-member inboxes.
   * - **User-triggered manual jobs with `notify: true`** route through the
   *   notification dispatcher with `type: "job.completed"`, fanning out to
   *   the triggering user only across whichever channels they've configured.
   */
  private async sendCompletionEmail(opts: {
    jobType: string;
    status: string;
    startedAt: number;
    notify: boolean;
    triggeredBy: string;
    result?: Record<string, unknown>;
    error?: string;
  }): Promise<void> {
    const meta = JOB_TYPE_META[opts.jobType as JobType];
    const label = meta?.label ?? opts.jobType;
    const isSystemJob = meta?.scope === "system";
    const duration = formatDuration(Date.now() - opts.startedAt);

    // System-job alerts: direct email to the server-owner alias on failure only.
    // Routine successes are noise — only failed/cancelled runs warrant a page.
    if (isSystemJob && opts.status !== "completed" && this.systemJobsAlertEmail && this.emailService) {
      this.emailService
        .sendJobAlert(this.systemJobsAlertEmail, {
          job_type: label,
          status: opts.status,
          duration,
          error: opts.error,
          result: opts.result,
        })
        .catch(() => {});
    }

    // User-notify path: enqueue via dispatcher so the user gets it on every
    // channel they've enabled (in-app + email + iOS push).
    if (opts.notify) {
      const userId = await this.resolveTriggeredByUserId(opts.triggeredBy);
      if (userId && this.notificationDispatcher) {
        const emoji = jobStatusEmoji(opts.status);
        await this.notificationDispatcher
          .enqueue({
            type: "job.completed",
            userIds: [userId],
            payload: {
              title: `${emoji} ${label} ${opts.status}`,
              body: opts.error
                ? `Failed after ${duration}: ${opts.error}`
                : `Finished in ${duration}`,
              link: "/dashboard/jobs",
              data: {
                job_type: label,
                status: opts.status,
                duration,
                error: opts.error,
                result: opts.result,
              },
            },
          })
          .catch(() => {});
      }
    }
  }

  /**
   * Resolves a `triggered_by` string ("manual:user:<id>" or
   * "manual:api_key:<id>") to the user_id of whoever should receive the
   * completion notification. For api_key triggers we fall back to the key's
   * `created_by` user — the human who owns the agent.
   */
  private async resolveTriggeredByUserId(triggeredBy: string): Promise<string | null> {
    const parts = triggeredBy.split(":");
    if (parts[0] !== "manual" || parts.length < 3) return null;

    const actorType = parts[1];
    const actorId = parts.slice(2).join(":");

    try {
      if (actorType === "user") return actorId;

      if (actorType === "api_key") {
        const [key] = await this.db
          .select({ created_by: apiKeys.created_by })
          .from(apiKeys)
          .where(eq(apiKeys.id, actorId))
          .limit(1);
        return key?.created_by ?? null;
      }
    } catch {
      return null;
    }

    return null;
  }
}
