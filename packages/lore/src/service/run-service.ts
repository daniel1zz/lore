/**
 * RunService — persists and reads harness runs (spec run-identity-slice-1, D2 / D5; BR-1027, BR-1028, BR-1029).
 *
 * Public surface: {@link RunService.register} (derive id + parent, validate, insert first-wins, reopen an ended
 * run, return the STORED record), {@link RunService.show} (read one run, DOC_NOT_FOUND when unregistered) and
 * {@link RunService.end} (mark a run ended and end its claims, BR-1057).
 *
 * @invariant Side-effect class: stateful (store writes only). Holds a store and a clock, nothing else.
 * @invariant D5: the composition record is computed by the CALLER (the CLI command, from the existing
 *   fragment selection) and only validated + persisted here — RunService never calls the fragments flow.
 * @invariant First registration wins on every column (BR-1029): `register` on a known id returns the
 *   stored record unchanged, whatever hints (`parentRunId`, `branch`) the second call carried. The ONE thing a
 *   repeat registration changes is the end state: registering an ENDED run (a resumed helper) reopens it
 *   (spec-run-only-write-identity-and-run-end-claim-release D4, AC-ROI-6).
 * @invariant `end` of an unregistered run id is `ok({ outcome: "unknown-run" })` and writes nothing —
 *   SubagentStop also fires for internal agents that never registered. `end` always processes the run's
 *   claims, even for an already-ended run, so a retry after a partial failure finishes the job.
 * @invariant A subagent's parent is DERIVED (`cc:<session>`), never taken from a caller hint (D2); the
 *   hint applies to a main run only.
 */
import {
  deriveRunId,
  err,
  ok,
  runRecordSchema,
  type CompositionRecord,
  type LoreError,
  type Result,
  type RunId,
  type RunRecord,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";

export type RunStore = Pick<StoreInterface, "insertRun" | "getRun" | "endRun" | "reopenRun" | "getRunEnd">;

/** One claim handled by a run end — structurally `TaskWorkflowService.endRunClaims`'s outcome (services never cross-import). */
export interface RunEndClaimReport {
  readonly task_slug: string;
  readonly action: "released" | "orphaned_dirty";
  /** The measured worktree path, or `not-measured`. */
  readonly worktree: string;
}

/** Narrow port to the claim owner (`TaskWorkflowService.endRunClaims`), injected by `app.ts`. */
export interface RunClaimEnder {
  endRunClaims(runId: RunId, reason: string, now?: () => string): Promise<Result<RunEndClaimReport[], LoreError>>;
}

/** Result of {@link RunService.end}. */
export type RunEndResult =
  | { readonly outcome: "unknown-run" }
  | { readonly outcome: "ended" | "already-ended"; readonly claims: readonly RunEndClaimReport[] };

export interface RegisterRunInput {
  readonly harness: string;
  readonly sessionId: string;
  /** Present => subagent run; absent => main run. */
  readonly agentId?: string;
  /** Required with `agentId`, refused without it. */
  readonly agentType?: string;
  /** Caller hint, honoured for a main run only. */
  readonly parentRunId?: string;
  readonly branch?: string;
  /** Computed by the caller from the existing fragment selection (D5). */
  readonly composition: CompositionRecord;
}

function validationError(field: string, message: string, value?: unknown): LoreError {
  return { code: "VALIDATION_ERROR", field, message, ...(value !== undefined ? { value } : {}) };
}

export class RunService {
  constructor(
    private readonly store: RunStore,
    private readonly now: () => Date = () => new Date(),
    private readonly claims?: RunClaimEnder,
  ) {}

  /**
   * Register a run, first registration wins.
   *
   * @returns ok(the stored record — the first registration's, on a repeat); VALIDATION_ERROR for an
   *   unknown harness, ids outside `[A-Za-z0-9._-]+`, an agent type without an agent id (or the reverse),
   *   or a malformed record.
   */
  async register(input: RegisterRunInput): Promise<Result<RunRecord, LoreError>> {
    if (input.agentId === undefined && input.agentType !== undefined) {
      return err(validationError("agent-type", "--agent-type requires --agent-id", input.agentType));
    }
    if (input.agentId !== undefined && (input.agentType === undefined || input.agentType === "")) {
      return err(validationError("agent-type", "a subagent run requires --agent-type", input.agentType));
    }

    let id: RunId;
    let parentRunId: RunId | null;
    try {
      id = deriveRunId(input.harness, {
        sessionId: input.sessionId,
        ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
      });
      parentRunId =
        input.agentId !== undefined
          ? deriveRunId(input.harness, { sessionId: input.sessionId })
          : ((input.parentRunId ?? null) as RunId | null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return err(validationError("harness", message, input.harness));
    }

    const candidate = {
      id,
      kind: input.agentId !== undefined ? "subagent" : "main",
      harness: input.harness,
      sessionRef: input.sessionId,
      agentRef: input.agentId ?? null,
      agentType: input.agentType ?? null,
      parentRunId,
      branch: input.branch ?? null,
      composition: input.composition,
      registeredAt: this.now().toISOString(),
    };
    const parsed = runRecordSchema.safeParse(candidate);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      return err(validationError("run", `invalid run record: ${issues}`));
    }

    const inserted = await this.store.insertRun(parsed.data as RunRecord);
    if (!inserted.ok) return inserted;
    // reason: AC-ROI-6 — a resumed helper registers again; an ended run is reopened (no-op for an open one).
    const reopened = await this.store.reopenRun(id);
    if (!reopened.ok) return reopened;
    const stored = await this.store.getRun(id);
    if (!stored.ok) return stored;
    if (stored.value === null) {
      return err(validationError("run", `run ${id} was inserted but cannot be read back`, id));
    }
    return ok(stored.value);
  }

  /**
   * End a run: stamp `ended_at` / `end_reason` (first end wins), then release its clean claims and mark the
   * ones with uncommitted changes `orphaned_dirty` (BR-1057).
   *
   * @returns ok(`unknown-run`) for an unregistered id (nothing written); ok(`ended`/`already-ended` + the
   *   handled claims); VALIDATION_ERROR for a blank reason or a service built without a claim port.
   */
  async end(runId: string, reason: string): Promise<Result<RunEndResult, LoreError>> {
    if (runId === "") return err(validationError("run-id", "a run id is required", runId));
    if (reason.trim() === "") return err(validationError("reason", "--reason is required", reason));
    if (this.claims === undefined) {
      return err(validationError("claims", "RunService was built without a claim port; cannot end a run's claims"));
    }
    const ended = await this.store.endRun(runId as RunId, this.now().toISOString(), reason);
    if (!ended.ok) return ended;
    if (ended.value === "unknown-run") return ok({ outcome: "unknown-run" });
    const released = await this.claims.endRunClaims(runId as RunId, reason, () => this.now().toISOString());
    if (!released.ok) return released;
    return ok({ outcome: ended.value, claims: released.value });
  }

  /** The registered run, or DOC_NOT_FOUND naming the id. */
  async show(id: string): Promise<Result<RunRecord, LoreError>> {
    const found = await this.store.getRun(id as RunId);
    if (!found.ok) return found;
    if (found.value === null) return err({ code: "DOC_NOT_FOUND", id });
    return ok(found.value);
  }
}
