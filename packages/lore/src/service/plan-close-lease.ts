/**
 * PlanCloseLease — the plan-scoped lease a plan close holds (AC-DCS2-20, decision D41).
 *
 * Purpose: two closes of ONE plan never overlap, while a close never holds up a landing (it takes no ticket of the merge queue, which is
 * a different lock) and a close of another plan is not blocked (one lease per plan). A long assess therefore never delays a landing.
 * Public surface: PlanCloseLease, PlanCloseLeasePort, PlanCloseLeaseOutcome, PlanCloseHolder, PLAN_CLOSE_LEASE_DIR, planLeaseKey.
 * Invariants:
 *   - The lease is the file `<git common dir>/lore-plan-close/<plan slug>.lease` (JSON: pid, process start time, plan, since). It appears
 *     by `link` of a staged file, so a reader never sees a torn lease and exactly one taker wins a free lease.
 *   - A holder is live while its pid exists, is not a zombie AND that pid's start time still equals the recorded one. A lease whose
 *     process is gone, or whose pid is another process now (pid reuse), is taken over; the takeover is serialized by an exclusive
 *     `<plan>.takeover` directory so two takers never both remove a stale lease and one creates over the other's fresh one.
 *   - Fail loud: a process table that cannot be read, or a lease file that cannot be read, is a refusal naming it (never "nobody holds it",
 *     never "the holder is dead").
 * Side-effect class: IO (files under the git common dir, the process table through the injected `inspect`).
 */

import { linkSync, mkdirSync, readFileSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { err, ok, type DocRecord, type LoreError, type Result } from "@lore/core";

/** Directory of the plan leases inside the git common dir. */
export const PLAN_CLOSE_LEASE_DIR = "lore-plan-close";

/** A takeover directory older than this was left by a taker that died inside the takeover; it is swept. */
const ORPHAN_TAKEOVER_MS = 10_000;

const LeaseRecordSchema = z
  .object({
    pid: z.number().int().positive(),
    /** ISO-8601, second precision: the holder's process start time as the process table reads it. */
    start_time: z.string().min(1),
    plan: z.string().min(1),
    /** ISO-8601 instant the lease was taken. */
    since: z.string().min(1),
  })
  .strict();

/** Who holds a plan lease. */
export type PlanCloseHolder = z.infer<typeof LeaseRecordSchema>;

/** What {@link PlanCloseLeasePort.acquire} answers: the lease is held (release it when done), or another live process holds it. */
export type PlanCloseLeaseOutcome =
  | { readonly state: "held"; readonly release: () => void }
  | { readonly state: "busy"; readonly holder: PlanCloseHolder };

/** The slice of the lease `PlanCloseService` uses. */
export interface PlanCloseLeasePort {
  acquire(planKey: string): Promise<Result<PlanCloseLeaseOutcome, LoreError>>;
}

/** The key of a plan's lease: its slug (unique, file-safe). */
export function planLeaseKey(plan: DocRecord): string {
  return plan.slug;
}

/** What the lease needs from its environment. */
export interface PlanCloseLeaseDeps {
  /** Absolute git common dir of the repository (`git rev-parse --path-format=absolute --git-common-dir`). */
  readonly commonDir: string;
  /** This process's pid. */
  readonly pid: number;
  /** What a pid is now (the process-table port's `inspect`): `null` ONLY when the pid does not exist; throws when the table cannot be read. */
  readonly inspect: (pid: number) => Promise<{ readonly zombie: boolean; readonly startTime: string | null } | null>;
  readonly clock?: () => number;
}

function unreadable(message: string): LoreError {
  return { code: "STORE_ERROR", message: `plan-close-lease: ${message}` };
}

export class PlanCloseLease implements PlanCloseLeasePort {
  constructor(private readonly deps: PlanCloseLeaseDeps) {}

  private get dir(): string {
    return join(this.deps.commonDir, PLAN_CLOSE_LEASE_DIR);
  }

  private now(): number {
    return (this.deps.clock ?? Date.now)();
  }

  /**
   * Takes the lease of `planKey`: held, or busy naming the live holder; a stale lease is taken over.
   *
   * @returns the outcome; an error when the process table or the lease file cannot be read
   */
  async acquire(planKey: string): Promise<Result<PlanCloseLeaseOutcome, LoreError>> {
    const own = await this.inspectPid(this.deps.pid);
    if (!own.ok) return own;
    if (own.value === null || own.value.startTime === null) return err(unreadable(`the process table does not list this process (pid ${this.deps.pid}), so it cannot take a plan lease`));
    const record: PlanCloseHolder = { pid: this.deps.pid, start_time: own.value.startTime, plan: planKey, since: new Date(this.now()).toISOString() };
    mkdirSync(this.dir, { recursive: true });
    const file = join(this.dir, `${planKey}.lease`);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (this.tryCreate(file, record)) return ok({ state: "held", release: () => this.release(file, record) });
      const existing = this.readHolder(file);
      if (!existing.ok) return existing;
      if (existing.value === undefined) continue; // reason: removed between the failed create and the read; try again
      const alive = await this.isLive(existing.value);
      if (!alive.ok) return alive;
      if (alive.value) return ok({ state: "busy", holder: existing.value });
      const removed = await this.takeOver(file, existing.value);
      if (!removed.ok) return removed;
    }
    return err(unreadable(`the lease of ${planKey} kept changing hands while it was taken; nothing was changed, run again`));
  }

  /** Creates the lease file by `link` of a staged file (atomic, exclusive); `false` when the lease exists. */
  private tryCreate(file: string, record: PlanCloseHolder): boolean {
    const staging = `${file}.${record.pid}.staged`;
    writeFileSync(staging, `${JSON.stringify(record)}\n`);
    try {
      linkSync(staging, file);
      return true;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw cause;
    } finally {
      rmSync(staging, { force: true });
    }
  }

  /** The holder the lease file names; `undefined` when the file is gone. */
  private readHolder(file: string): Result<PlanCloseHolder | undefined, LoreError> {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return ok(undefined);
      return err(unreadable(`${file} cannot be read (${cause instanceof Error ? cause.message : String(cause)})`));
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (cause) {
      return err(unreadable(`${file} is not valid JSON (${cause instanceof Error ? cause.message : String(cause)}); remove it and run again`));
    }
    const parsed = LeaseRecordSchema.safeParse(json);
    if (!parsed.success) return err(unreadable(`${file} is not a valid lease record (${parsed.error.issues[0]?.message ?? "invalid"}); remove it and run again`));
    return ok(parsed.data);
  }

  /** Live: the pid exists, is not a zombie and still started when the lease says it did. */
  private async isLive(holder: PlanCloseHolder): Promise<Result<boolean, LoreError>> {
    const current = await this.inspectPid(holder.pid);
    if (!current.ok) return current;
    return ok(current.value !== null && !current.value.zombie && current.value.startTime === holder.start_time);
  }

  /** Removes a lease whose holder is gone, one taker at a time; the lease is re-read under the takeover so a fresh one is never removed. */
  private async takeOver(file: string, stale: PlanCloseHolder): Promise<Result<void, LoreError>> {
    const guard = `${file}.takeover`;
    try {
      mkdirSync(guard);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
      if (this.now() - statSync(guard).mtimeMs > ORPHAN_TAKEOVER_MS) rmdirSync(guard); // reason: its taker died inside the takeover
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      return ok(undefined);
    }
    try {
      const again = this.readHolder(file);
      if (!again.ok) return again;
      if (again.value !== undefined && again.value.pid === stale.pid && again.value.start_time === stale.start_time) rmSync(file, { force: true });
      return ok(undefined);
    } finally {
      rmdirSync(guard);
    }
  }

  /** Removes the lease when it still names this holder. */
  private release(file: string, record: PlanCloseHolder): void {
    const current = this.readHolder(file);
    if (current.ok && current.value !== undefined && current.value.pid === record.pid && current.value.start_time === record.start_time) rmSync(file, { force: true });
  }

  /** `inspect`, with an unreadable process table surfaced as the lease's own loud error. */
  private async inspectPid(pid: number): Promise<Result<{ readonly zombie: boolean; readonly startTime: string | null } | null, LoreError>> {
    try {
      return ok(await this.deps.inspect(pid));
    } catch (cause) {
      return err(unreadable(`the process table could not be read for pid ${pid} (${cause instanceof Error ? cause.message : String(cause)}); a live holder cannot be told from a dead one, nothing was changed`));
    }
  }
}

