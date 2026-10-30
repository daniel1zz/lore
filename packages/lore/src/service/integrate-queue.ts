/**
 * IntegrateQueue — the FIFO merge queue every landing takes its turn in (AC-DCS2-5, decision D40).
 *
 * Purpose: serialize landings so the oracles run on the exact tree that becomes main: only the head ticket merges, runs the
 * floor and the oracles and advances main, so there are no lost races and no retries. The queue replaces the old lock-free
 * retry loop; it does not sit on top of it. Folds (`lore land`, AC-DCS2-8) take their turn here through {@link IntegrateQueue.runInTurn};
 * a plan close does NOT (it has its own plan-scoped lease, AC-DCS2-20). The per-worktree lease and the review-batch lease are separate.
 * Public surface: IntegrateQueue.{take, waitForTurn, release, runInTurn}, IntegrateQueuePort, QueueTicket, QueueHolder,
 *   IntegrateQueueTimeoutError, IntegrateQueueUnreadableError, INTEGRATE_QUEUE_DIR, QUEUE_WAIT_SECONDS_DEFAULT.
 * Invariants:
 *   - A ticket is the file `<git common dir>/lore-integrate-queue/<seq>-<pid>.ticket` (JSON: pid, process start time, session, branch,
 *     since). `seq` is allocated by an exclusive create of the next number (`<seq>.slot`), so two takers never share a seq and
 *     FIFO is the ticket order; the ticket appears by rename, so a reader never sees a torn file.
 *   - The head is the lowest LIVE ticket and holds the turn. A ticket is live while its pid exists AND that pid's start time still
 *     equals the recorded one; a ticket whose process is gone, or whose pid is another process now, is removed by the next waiter.
 *   - Fail loud: a process table that cannot be read throws {@link IntegrateQueueUnreadableError} (never "nobody holds it", never
 *     "the holder is dead"); a waiter never hangs: past the wait limit it throws {@link IntegrateQueueTimeoutError} naming the holder.
 *   - A waiter prints `queued: position <n> of <m>, holder <session> <branch> since <iso>` whenever that line changes, and one
 *     `phase queue-wait <s>s` line once its turn comes after it waited (a landing that never waited prints neither).
 * Side-effect class: IO (files under the git common dir, sleeping, the process table through the injected `startTimeOf`).
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/** Directory of the tickets inside the git common dir. */
export const INTEGRATE_QUEUE_DIR = "lore-integrate-queue";

/** `workflow.integrate.queue_wait_seconds` when the config does not set it. */
export const QUEUE_WAIT_SECONDS_DEFAULT = 1800;

/** An orphan `<seq>.slot` (its taker died between the exclusive create and the rename) older than this is swept. */
const ORPHAN_SLOT_MS = 10_000;

const TicketRecordSchema = z
  .object({
    pid: z.number().int().positive(),
    /** ISO-8601, second precision: the holder's process start time as the process table reads it. */
    start_time: z.string().min(1),
    session: z.string(),
    branch: z.string(),
    /** ISO-8601 instant the ticket was taken. */
    since: z.string().min(1),
  })
  .strict();

/** Who a ticket belongs to. */
export type QueueHolder = z.infer<typeof TicketRecordSchema>;

/** One ticket: its place (`seq`) and its file. */
export interface QueueTicket extends QueueHolder {
  readonly seq: number;
  readonly file: string;
}

/** What the taker says about itself. */
export interface QueueTaker {
  readonly session: string;
  readonly branch: string;
}

/** Thrown by {@link IntegrateQueue.waitForTurn} when the wait limit passed. The ticket is already removed. */
export class IntegrateQueueTimeoutError extends Error {
  constructor(
    readonly holder: QueueHolder | undefined,
    readonly waitedSeconds: number,
    readonly limitSeconds: number,
  ) {
    super(`integrate-queue-timeout: waited ${waitedSeconds.toFixed(0)}s (workflow.integrate.queue_wait_seconds = ${limitSeconds}) for the queue head`);
    this.name = "IntegrateQueueTimeoutError";
  }
}

/** Thrown when the queue cannot be read or judged (process table unreadable, ticket file unreadable or missing). */
export class IntegrateQueueUnreadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrateQueueUnreadableError";
  }
}

/** The slice of the queue `IntegrateService` uses. */
export interface IntegrateQueuePort {
  take(taker: QueueTaker): Promise<QueueTicket>;
  /** Resolves when `ticket` is the head. @throws {IntegrateQueueTimeoutError} @throws {IntegrateQueueUnreadableError} */
  waitForTurn(ticket: QueueTicket): Promise<void>;
  release(ticket: QueueTicket): void;
}

export interface IntegrateQueueDeps {
  /** Absolute git common dir of the repository (`git rev-parse --path-format=absolute --git-common-dir`). */
  readonly commonDir: string;
  /** This process's pid. */
  readonly pid: number;
  /** What `pid` is now (the process-table port's `inspect`): `null` ONLY when the pid does not exist; throws when the table cannot be read. */
  readonly inspect: (pid: number) => Promise<{ readonly zombie: boolean; readonly startTime: string | null } | null>;
  /** `workflow.integrate.queue_wait_seconds`, already validated as a positive integer. */
  readonly waitSeconds: number;
  /** Progress lines (`queued: ...`, `phase queue-wait ...`). */
  readonly log: (line: string) => void;
  readonly clock?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  /** Poll interval while waiting (default 200 ms). */
  readonly pollMs?: number;
}

const seqName = (seq: number): string => String(seq).padStart(8, "0");

export class IntegrateQueue implements IntegrateQueuePort {
  constructor(private readonly deps: IntegrateQueueDeps) {}

  private get dir(): string {
    return join(this.deps.commonDir, INTEGRATE_QUEUE_DIR);
  }

  private now(): number {
    return (this.deps.clock ?? Date.now)();
  }

  /** Takes the next ticket. */
  async take(taker: QueueTaker): Promise<QueueTicket> {
    const { pid } = this.deps;
    const start = (await this.inspectPid(pid))?.startTime ?? null;
    if (start === null) throw new IntegrateQueueUnreadableError(`integrate: the process table does not list this process (pid ${pid}), so it cannot take a queue ticket`);
    mkdirSync(this.dir, { recursive: true });
    const record: QueueHolder = { pid, start_time: start, session: taker.session, branch: taker.branch, since: new Date(this.now()).toISOString() };
    for (;;) {
      const seq = this.nextSeq();
      const slot = join(this.dir, `${seqName(seq)}.slot`);
      try {
        closeSync(openSync(slot, "wx"));
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "EEXIST") continue; // reason: another taker won this number; take the next
        throw cause;
      }
      const file = join(this.dir, `${seqName(seq)}-${pid}.ticket`);
      const staging = join(this.dir, `${seqName(seq)}-${pid}.tmp`);
      writeFileSync(staging, `${JSON.stringify(record)}\n`);
      renameSync(staging, file);
      rmSync(slot, { force: true });
      return { ...record, seq, file };
    }
  }

  /** Waits until `ticket` is the head; see the module header. */
  async waitForTurn(ticket: QueueTicket): Promise<void> {
    const began = this.now();
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let lastLine = "";
    let queued = false;
    for (;;) {
      const live = await this.liveTickets();
      const index = live.findIndex((entry) => entry.seq === ticket.seq);
      if (index < 0) throw new IntegrateQueueUnreadableError(`integrate: ticket ${ticket.file} is gone from the queue (removed by another process); nothing was changed, re-run`);
      const head = live[0] as QueueTicket;
      if (index === 0) {
        if (queued) this.deps.log(`phase queue-wait ${((this.now() - began) / 1000).toFixed(3)}s`);
        return;
      }
      queued = true;
      const line = `queued: position ${index + 1} of ${live.length}, holder ${head.session} ${head.branch} since ${head.since}`;
      if (line !== lastLine) {
        this.deps.log(line);
        lastLine = line;
      }
      const waited = this.now() - began;
      if (waited > this.deps.waitSeconds * 1000) {
        this.release(ticket);
        throw new IntegrateQueueTimeoutError(head, waited / 1000, this.deps.waitSeconds);
      }
      await sleep(this.deps.pollMs ?? 200);
    }
  }

  /** Removes `ticket`; removing an absent one is not an error. */
  release(ticket: QueueTicket): void {
    rmSync(ticket.file, { force: true });
  }

  /**
   * Takes a ticket, waits for the turn, runs `fn`, releases (also when `fn` throws). The entry the fold of `lore land` uses.
   * @throws {IntegrateQueueTimeoutError} @throws {IntegrateQueueUnreadableError} whatever `fn` throws
   */
  async runInTurn<T>(taker: QueueTaker, fn: () => Promise<T>): Promise<T> {
    const ticket = await this.take(taker);
    try {
      await this.waitForTurn(ticket);
      return await fn();
    } finally {
      this.release(ticket);
    }
  }

  /** `inspect`, with an unreadable process table surfaced as the queue's own loud error. */
  private async inspectPid(pid: number): Promise<{ readonly zombie: boolean; readonly startTime: string | null } | null> {
    try {
      return await this.deps.inspect(pid);
    } catch (cause) {
      throw new IntegrateQueueUnreadableError(`integrate: the process table could not be read for pid ${pid} (${cause instanceof Error ? cause.message : String(cause)}); the queue cannot tell a live holder from a dead one, nothing was changed`);
    }
  }

  /** One more than the highest number among tickets and slots. */
  private nextSeq(): number {
    let highest = 0;
    for (const name of readdirSync(this.dir)) {
      const match = /^(\d+)(?:-\d+\.ticket|\.slot)$/.exec(name);
      if (match !== null) highest = Math.max(highest, Number.parseInt(match[1] as string, 10));
    }
    return highest + 1;
  }

  /** The live tickets in ticket order; dead ones (and orphan slots) are removed on the way. */
  private async liveTickets(): Promise<QueueTicket[]> {
    const live: QueueTicket[] = [];
    for (const name of readdirSync(this.dir).sort()) {
      const path = join(this.dir, name);
      if (name.endsWith(".slot")) {
        if (existsSync(path) && this.now() - statSync(path).mtimeMs > ORPHAN_SLOT_MS) rmSync(path, { force: true });
        continue;
      }
      const match = /^(\d+)-\d+\.ticket$/.exec(name);
      if (match === null) continue;
      let record: QueueHolder;
      try {
        record = TicketRecordSchema.parse(JSON.parse(readFileSync(path, "utf8")));
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") continue; // removed between the listing and the read
        throw new IntegrateQueueUnreadableError(`integrate: queue ticket ${path} is unreadable (${cause instanceof Error ? cause.message : String(cause)}); remove it and re-run`);
      }
      const current = await this.inspectPid(record.pid);
      if (current === null || current.zombie || current.startTime !== record.start_time) {
        // reason: the holder is gone, or its pid is another process now (start time differs): its turn will never end by itself
        rmSync(path, { force: true });
        continue;
      }
      live.push({ ...record, seq: Number.parseInt(match[1] as string, 10), file: path });
    }
    return live;
  }
}
