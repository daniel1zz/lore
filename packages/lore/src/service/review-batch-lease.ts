/**
 * ReviewLeases — keyed store leases for review work (BR-1511, BR-1379).
 *
 * Purpose: let exactly one holder do one piece of review work at a time across processes (and, through the synced corpus,
 *   machines): one lease row per key, so reviews of different plans run concurrently while the same plan, the same
 *   (commit, file) test run and the same root cause's issue write each have one holder.
 * Public surface: {@link ReviewLeases}, {@link LeaseStorePort}, {@link LeaseHandle}, {@link LeaseOutcome}, the key builders
 *   {@link planLeaseKey} / {@link suiteFileLeaseKey} / {@link issueLeaseKey} / {@link issueWriteLeaseKey},
 *   {@link REVIEW_LEASE_EXPIRY_MS}, {@link REVIEW_LEASE_RENEW_MS}, {@link LEASE_WAIT_POLL_MS}.
 * Invariants:
 *   - Keys: `plan:<id>`, `suite:<sha>:<file>`, `issue:<fingerprint>`, `issue-write:<n>`. The corpus-wide
 *     `review-batch` name is retired: nothing acquires it.
 *   - Lease order (no wait cycle): a holder of `plan:` may take `suite:<sha>:<file>`, `issue:` and `issue-write:` keys; a holder of one of
 *     those takes no other key.
 *   - Expiry is 10 minutes; the holder renews every minute while it works. A live lease of another holder is `busy`; an
 *     expired one is taken over.
 *   - Every `acquire` is its own holder (the configured holder plus a fresh suffix), so two acquisitions in one process
 *     (two concurrent lookups) exclude each other like two processes do; the store treats the same holder name as a re-entry.
 *   - The atomic acquire/renew lives in the store (`acquireLease`/`renewLease`); this class owns the policy only.
 *   - A renewal that finds the lease no longer the holder's (it expired and was taken over) marks the handle `lost`:
 *     the holder can see it and stop instead of racing the new holder.
 *   - A busy lease whose holder is provably a dead process of this machine is taken over at once (BR-1514): see
 *     `review-lease-liveness.ts` for what "provably dead" means; the swap is a compare-and-set in the store
 *     (`takeOverLease`), and the old holder's next renewal fails, so its handle goes `lost` (fencing, BR-1511).
 *   - The renewal timer, clock and sleep are injected so tests drive them without real time.
 * Side-effect class: IO through the store port; a timer while a handle is open.
 */

import { randomBytes } from "node:crypto";
import { ok, type LoreError, type Result } from "@lore/core";
import type { AuditEntry } from "@lore/core";
import type { LeaseAcquisition, LeaseRecord, LeaseTakeover } from "../store/store-shared.js";
import { defaultLeaseLiveness, formatHolder, isHolderProvablyDead, type LeaseLiveness, type LocalProcessIdentity } from "./review-lease-liveness.js";

/** The audit action of a takeover of a dead holder's lease (BR-1514). */
export const REVIEW_LEASE_TAKEOVER_ACTION = "review_lease_takeover";

/** The lease verbs of the store, plus the audit append a takeover owes. */
export interface LeaseStorePort {
  takeOverLease(name: string, expectedHolder: string, newHolder: string, expiresAtIso: string): Promise<Result<LeaseTakeover, LoreError>>;
  appendAuditEntry(entry: AuditEntry): Promise<Result<void, LoreError>>;
  acquireLease(name: string, holder: string, nowIso: string, expiresAtIso: string): Promise<Result<LeaseAcquisition, LoreError>>;
  renewLease(name: string, holder: string, expiresAtIso: string): Promise<Result<boolean, LoreError>>;
  releaseLease(name: string, holder: string): Promise<Result<void, LoreError>>;
  readLease(name: string): Promise<Result<LeaseRecord | null, LoreError>>;
}

/** Lease lifetime without a renewal: 10 minutes. */
export const REVIEW_LEASE_EXPIRY_MS = 10 * 60 * 1000;
/** Renewal period while the holder works: 1 minute. */
export const REVIEW_LEASE_RENEW_MS = 60 * 1000;
/** A waiter polls a held key at most this often (BR-1511). */
export const LEASE_WAIT_POLL_MS = 10 * 1000;

/** The lease key of one plan's review and close. */
export function planLeaseKey(planId: string): string {
  return `plan:${planId}`;
}
/** The lease key of one test file's single-file run at one commit. */
export function suiteFileLeaseKey(commit: string, file: string): string {
  return `suite:${commit}:${file}`;
}
/** The lease key of the search-then-create of the issue of one root-cause fingerprint. */
export function issueLeaseKey(fingerprint: string): string {
  return `issue:${fingerprint}`;
}
/** The lease key of the pending writes to one GitHub issue. */
export function issueWriteLeaseKey(issueNumber: number): string {
  return `issue-write:${String(issueNumber)}`;
}

/** Starts a repeating callback and returns its canceller (default: `setInterval`, unref'd). */
export type Schedule = (callback: () => void, everyMs: number) => () => void;
/** Resolves after `ms` (default: a timer). */
export type Sleep = (ms: number) => Promise<void>;

const intervalSchedule: Schedule = (callback, everyMs) => {
  const timer = setInterval(callback, everyMs);
  // reason: a forgotten handle must never keep the process alive; the holder ends by releasing explicitly.
  timer.unref();
  return () => clearInterval(timer);
};

const timerSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A held lease: read `lost`, and `release()` when the work ends. */
export interface LeaseHandle {
  /** True once a renewal found the lease taken by someone else (or the renewal itself failed). */
  readonly lost: () => boolean;
  /** The last renewal error, if any. */
  readonly lastError: () => LoreError | undefined;
  /** Renews once now (the timer calls this every minute). */
  readonly renewNow: () => Promise<Result<boolean, LoreError>>;
  /** Stops the timer and deletes the row. */
  readonly release: () => Promise<Result<void, LoreError>>;
}

/** What `acquire` answers. */
export type LeaseOutcome =
  | { readonly state: "held"; readonly tookOver: boolean; readonly handle: LeaseHandle }
  | { readonly state: "busy"; readonly holder: string; readonly expires_at: string };

/** See the module header. */
export class ReviewLeases {
  constructor(
    private readonly store: LeaseStorePort,
    /** Who this process is (an actor/run id); the base of every acquisition's holder name. */
    private readonly holder: string,
    private readonly clock: () => number = Date.now,
    private readonly schedule: Schedule = intervalSchedule,
    private readonly sleep: Sleep = timerSleep,
    private readonly liveness: LeaseLiveness = defaultLeaseLiveness,
  ) {}

  /** Takes the lease of `key` (a live lease of another holder is `busy`; an expired one is taken over) and starts the renewal timer. */
  async acquire(key: string): Promise<Result<LeaseOutcome, LoreError>> {
    const identity = await this.liveness.identity();
    const holder = formatHolder(this.holder, identity, randomBytes(4).toString("hex"));
    const now = this.clock();
    const expiresAtIso = new Date(now + REVIEW_LEASE_EXPIRY_MS).toISOString();
    const taken = await this.store.acquireLease(key, holder, new Date(now).toISOString(), expiresAtIso);
    if (!taken.ok) return taken;
    let tookOver = taken.value.acquired && taken.value.tookOver;
    if (!taken.value.acquired) {
      const seized = await this.takeOverFromDeadHolder(key, holder, identity, taken.value, expiresAtIso);
      if (!seized.ok) return seized;
      if (seized.value.state === "busy") return ok(seized.value);
      tookOver = true;
    }
    let lost = false;
    let lastError: LoreError | undefined;
    const renewNow = async (): Promise<Result<boolean, LoreError>> => {
      const renewed = await this.store.renewLease(key, holder, new Date(this.clock() + REVIEW_LEASE_EXPIRY_MS).toISOString());
      if (!renewed.ok) {
        lastError = renewed.error;
        return renewed;
      }
      if (!renewed.value) lost = true;
      return renewed;
    };
    const cancel = this.schedule(() => {
      void renewNow();
    }, REVIEW_LEASE_RENEW_MS);
    const handle: LeaseHandle = {
      lost: () => lost,
      lastError: () => lastError,
      renewNow,
      release: async () => {
        cancel();
        return this.store.releaseLease(key, holder);
      },
    };
    return ok({ state: "held", tookOver, handle });
  }

  /**
   * A busy key whose holder is provably a dead process of this machine (BR-1514) is taken over by compare-and-set on
   * that exact holder name, with one audit row. Anything else (live, other machine, old form, probe error) stays busy
   * naming the stored holder; a lost race stays busy naming the winner; a row that vanished meanwhile is acquired plainly.
   */
  private async takeOverFromDeadHolder(
    key: string,
    holder: string,
    identity: LocalProcessIdentity | null,
    busy: { readonly holder: string; readonly expires_at: string },
    expiresAtIso: string,
  ): Promise<Result<{ readonly state: "taken" } | { readonly state: "busy"; readonly holder: string; readonly expires_at: string }, LoreError>> {
    const stillBusy = { state: "busy" as const, holder: busy.holder, expires_at: busy.expires_at };
    if (!(await isHolderProvablyDead(busy.holder, identity, this.liveness.probe))) return ok(stillBusy);
    const swapped = await this.store.takeOverLease(key, busy.holder, holder, expiresAtIso);
    if (!swapped.ok) return swapped;
    if (!swapped.value.acquired) {
      const current = swapped.value.current;
      if (current === null) {
        const retry = await this.store.acquireLease(key, holder, new Date(this.clock()).toISOString(), expiresAtIso);
        if (!retry.ok) return retry;
        return ok(retry.value.acquired ? { state: "taken" } : { state: "busy", holder: retry.value.holder, expires_at: retry.value.expires_at });
      }
      return ok({ state: "busy", holder: current.holder, expires_at: current.expires_at });
    }
    const audited = await this.store.appendAuditEntry({
      timestamp: new Date(this.clock()).toISOString(),
      actor: this.holder,
      session_id: this.holder,
      action: REVIEW_LEASE_TAKEOVER_ACTION,
      details: { key, dead_holder: busy.holder, new_holder: holder, rule: "BR-1514" },
    });
    if (!audited.ok) {
      // reason: a takeover with no audit row must not stand; give the lease back so the failure is the only effect.
      await this.store.releaseLease(key, holder);
      return audited;
    }
    return ok({ state: "taken" });
  }

  /**
   * Runs `work` under the lease of `key`, waiting for another holder to release or expire (polling at most every
   * {@link LEASE_WAIT_POLL_MS}). The wait has no limit of its own: the holder's expiry bounds it.
   *
   * @param work - runs once the lease is held; it must re-read whatever the waiting may have changed
   * @returns `work`'s result, or the store error of acquiring
   */
  async withWaiting<T>(key: string, work: (handle: LeaseHandle) => Promise<Result<T, LoreError>>): Promise<Result<T, LoreError>> {
    for (;;) {
      const taken = await this.acquire(key);
      if (!taken.ok) return taken;
      if (taken.value.state === "held") {
        const handle = taken.value.handle;
        try {
          return await work(handle);
        } finally {
          await handle.release();
        }
      }
      const remainingMs = Date.parse(taken.value.expires_at) - this.clock();
      await this.sleep(Math.min(LEASE_WAIT_POLL_MS, Math.max(1, remainingMs)));
    }
  }
}

/** A lease handle lost mid-work is a refusal to keep writing: the error a holder returns when it notices. */
export function leaseLostError(): LoreError {
  return { code: "VALIDATION_ERROR", field: "review-lease", message: "a review lease expired and was taken over; this holder stopped", rule: "BR-1511" };
}
