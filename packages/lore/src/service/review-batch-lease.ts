/**
 * ReviewBatchLease — the store lease the post-landing review batch holds (BR-1379).
 *
 * Purpose: let exactly one review batch run at a time across processes (and, through the synced corpus, machines).
 * Public surface: {@link ReviewBatchLease}, {@link LeaseStorePort}, {@link LeaseHandle}, {@link REVIEW_BATCH_LEASE_NAME},
 *   {@link REVIEW_LEASE_EXPIRY_MS}, {@link REVIEW_LEASE_RENEW_MS}.
 * Invariants:
 *   - Expiry is 10 minutes; the holder renews every minute while it runs. A start that finds a live lease of another
 *     holder does nothing; a dead holder's lease expires and the next start takes it over.
 *   - The atomic acquire/renew lives in the store (`acquireLease`/`renewLease`); this class owns the policy only.
 *   - A renewal that finds the lease no longer the holder's (it expired and was taken over) marks the handle `lost`:
 *     the batch can see it and stop instead of racing the new holder.
 *   - The renewal timer is injected (`schedule`) so tests drive it without real time.
 * Side-effect class: IO through the store port; a timer while a handle is open.
 */

import { ok, type LoreError, type Result } from "@lore/core";
import type { LeaseAcquisition, LeaseRecord } from "../store/store-shared.js";

/** The lease verbs of the store. */
export interface LeaseStorePort {
  acquireLease(name: string, holder: string, nowIso: string, expiresAtIso: string): Promise<Result<LeaseAcquisition, LoreError>>;
  renewLease(name: string, holder: string, expiresAtIso: string): Promise<Result<boolean, LoreError>>;
  releaseLease(name: string, holder: string): Promise<Result<void, LoreError>>;
  readLease(name: string): Promise<Result<LeaseRecord | null, LoreError>>;
}

/** The one lease name the review batch uses. */
export const REVIEW_BATCH_LEASE_NAME = "review-batch";
/** Lease lifetime without a renewal: 10 minutes. */
export const REVIEW_LEASE_EXPIRY_MS = 10 * 60 * 1000;
/** Renewal period while the batch runs: 1 minute. */
export const REVIEW_LEASE_RENEW_MS = 60 * 1000;

/** Starts a repeating callback and returns its canceller (default: `setInterval`, unref'd). */
export type Schedule = (callback: () => void, everyMs: number) => () => void;

const intervalSchedule: Schedule = (callback, everyMs) => {
  const timer = setInterval(callback, everyMs);
  // reason: a forgotten handle must never keep the process alive; the batch ends by releasing explicitly.
  timer.unref();
  return () => clearInterval(timer);
};

/** A held lease: read `lost`, and `release()` when the batch ends. */
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
export class ReviewBatchLease {
  constructor(
    private readonly store: LeaseStorePort,
    /** Who this batch is (an actor/run id); recorded as the lease holder. */
    private readonly holder: string,
    private readonly clock: () => number = Date.now,
    private readonly schedule: Schedule = intervalSchedule,
  ) {}

  /** True when another holder's lease is live right now (the landing's "is a batch running" question; reads only). */
  async isLive(): Promise<Result<boolean, LoreError>> {
    const row = await this.store.readLease(REVIEW_BATCH_LEASE_NAME);
    if (!row.ok) return row;
    return ok(row.value !== null && row.value.expires_at > new Date(this.clock()).toISOString());
  }

  /** Takes the lease (a live lease of another holder is `busy`; an expired one is taken over) and starts the renewal timer. */
  async acquire(): Promise<Result<LeaseOutcome, LoreError>> {
    const now = this.clock();
    const taken = await this.store.acquireLease(REVIEW_BATCH_LEASE_NAME, this.holder, new Date(now).toISOString(), new Date(now + REVIEW_LEASE_EXPIRY_MS).toISOString());
    if (!taken.ok) return taken;
    if (!taken.value.acquired) return ok({ state: "busy", holder: taken.value.holder, expires_at: taken.value.expires_at });
    let lost = false;
    let lastError: LoreError | undefined;
    const renewNow = async (): Promise<Result<boolean, LoreError>> => {
      const renewed = await this.store.renewLease(REVIEW_BATCH_LEASE_NAME, this.holder, new Date(this.clock() + REVIEW_LEASE_EXPIRY_MS).toISOString());
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
        return this.store.releaseLease(REVIEW_BATCH_LEASE_NAME, this.holder);
      },
    };
    return ok({ state: "held", tookOver: taken.value.tookOver, handle });
  }
}

/** A lease handle lost mid-batch is a refusal to keep writing: the error a batch returns when it notices. */
export function leaseLostError(): LoreError {
  return { code: "VALIDATION_ERROR", field: "review-batch-lease", message: "the review batch lease expired and was taken over; this batch stopped", rule: "BR-1379" };
}
