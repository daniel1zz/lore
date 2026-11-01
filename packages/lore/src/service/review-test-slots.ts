/**
 * Review test-run slots per machine (BR-1532, spec-review-test-runs-are-capped-per-machine-and-a-run-that, #574).
 *
 * Purpose: cap how many review test runs execute at once on one machine. Every review test run (a selection chunk at L, a
 *   head recheck, a bisection or confirmation single-file run, a criteria run, a stale cited-rule refresh) first takes one of
 *   `workflow.review.machine_test_slots` slots and gives it back when the run ends.
 * Public surface: {@link ReviewTestSlots}, {@link TestSlotLeasePort}, {@link slotCommitSuiteRunner},
 *   {@link slotCriterionRerunner}, {@link slotStaleRefresher}.
 * Invariants:
 *   - A slot is the lease `test-slot:<machine>:<n>`, n < slots. The take is the store's atomic acquire, so two runs never share a slot;
 *     a slot whose holder is a dead process of this machine is taken at once (BR-1514, inside `acquire`).
 *   - The runner-port decorators below are the ONLY way the CLI builds a review runner: the slot sits at the port, so every
 *     caller (batch, direct assess, head recheck, bisection, criteria) is covered by construction, not by each call site.
 *   - Lease order (BR-1511): the slot holder takes no other key while it holds the slot; it waits only for slots, so no wait cycle exists.
 *     A caller may hold `plan:` or `suite:` keys while it waits for a slot.
 *   - A waiting run prints the holders it waits for once, then polls at most every {@link LEASE_WAIT_POLL_MS}.
 * Side-effect class: IO through the lease port (store) and the injected sleep and print.
 */

import type { LoreError, Result } from "@lore/core";
import type { CriterionRerunPort } from "./decision-recheck.js";
import type { StaleAcRefresherPort } from "./milestone-review-inputs.js";
import { LEASE_WAIT_POLL_MS, testSlotLeaseKey, type LeaseOutcome, type Sleep } from "./review-batch-lease.js";
import type { CommitSuiteRunnerPort } from "./suite-result-service.js";

/** The slice of {@link import("./review-batch-lease.js").ReviewLeases} the slots use. */
export interface TestSlotLeasePort {
  readonly machineId: () => Promise<string>;
  readonly acquire: (key: string) => Promise<Result<LeaseOutcome, LoreError>>;
}

/** Collaborators of {@link ReviewTestSlots}. */
export interface ReviewTestSlotsDeps {
  readonly leases: TestSlotLeasePort;
  /** `workflow.review.machine_test_slots`: a positive integer. */
  readonly slots: number;
  /** Resolves after `ms`. */
  readonly sleep: Sleep;
  /** Wall clock in epoch milliseconds (bounds a poll by the soonest holder expiry). */
  readonly clock: () => number;
  /** Prints one line (the waiting run's holder list). */
  readonly say: (line: string) => void;
}

/** See the module header. */
export class ReviewTestSlots {
  constructor(private readonly deps: ReviewTestSlotsDeps) {}

  /**
   * Runs `work` while holding one test slot, waiting for a free one.
   *
   * @param work - one review test run; it must take no lease key itself
   * @returns `work`'s result, or the store error of taking a slot
   */
  async run<T>(work: () => Promise<Result<T, LoreError>>): Promise<Result<T, LoreError>> {
    const machine = await this.deps.leases.machineId();
    let announced = false;
    for (;;) {
      const busy: { readonly key: string; readonly holder: string; readonly expires_at: string }[] = [];
      for (let slot = 0; slot < this.deps.slots; slot += 1) {
        const key = testSlotLeaseKey(machine, slot);
        const taken = await this.deps.leases.acquire(key);
        if (!taken.ok) return taken;
        if (taken.value.state === "held") {
          const handle = taken.value.handle;
          try {
            return await work();
          } finally {
            await handle.release();
          }
        }
        busy.push({ key, holder: taken.value.holder, expires_at: taken.value.expires_at });
      }
      if (!announced) {
        announced = true;
        this.deps.say(`review test run waits for a test slot (${String(this.deps.slots)} per machine): ${busy.map((b) => `${b.key} held by ${b.holder} until ${b.expires_at}`).join("; ")}`);
      }
      const soonestMs = Math.min(...busy.map((b) => Date.parse(b.expires_at))) - this.deps.clock();
      await this.deps.sleep(Math.min(LEASE_WAIT_POLL_MS, Math.max(1, soonestMs)));
    }
  }
}

/**
 * The commit suite runner with every test run slotted: `runFiles` and `runFilesTogether` take a slot; resolving a commit and
 * opening or disposing worktrees do not run tests and pass through.
 */
export function slotCommitSuiteRunner(runner: CommitSuiteRunnerPort, slots: ReviewTestSlots): CommitSuiteRunnerPort {
  const together = runner.runFilesTogether;
  return {
    ...runner,
    runFiles: (commit, files) => slots.run(() => runner.runFiles(commit, files)),
    ...(together !== undefined ? { runFilesTogether: (commit: string, files: readonly string[], options?: Parameters<NonNullable<CommitSuiteRunnerPort["runFilesTogether"]>>[2]) => slots.run(() => together(commit, files, options)) } : {}),
  };
}

/** The criterion re-run port with every criterion run slotted (head criteria, decision recheck). */
export function slotCriterionRerunner(port: CriterionRerunPort, slots: ReviewTestSlots): CriterionRerunPort {
  return { rerun: (spec, acId) => slots.run(() => port.rerun(spec, acId)) };
}

/** The stale cited-rule refresher with every refresh run slotted. */
export function slotStaleRefresher(port: StaleAcRefresherPort, slots: ReviewTestSlots): StaleAcRefresherPort {
  return { runAcs: (planRef, acIds) => slots.run(() => port.runAcs(planRef, acIds)) };
}
