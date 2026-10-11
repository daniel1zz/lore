/**
 * RunService — persists and reads harness runs (spec run-identity-slice-1, D2 / D5; BR-1027, BR-1028, BR-1029).
 *
 * Public surface: {@link RunService.register} (derive id + parent, validate, insert first-wins, return the
 * STORED record) and {@link RunService.show} (read one run, DOC_NOT_FOUND when unregistered).
 *
 * @invariant Side-effect class: stateful (store writes only). Holds a store and a clock, nothing else.
 * @invariant D5: the composition record is computed by the CALLER (the CLI command, from the existing
 *   fragment selection) and only validated + persisted here — RunService never calls the fragments flow.
 * @invariant First registration wins on every column (BR-1029): `register` on a known id returns the
 *   stored record unchanged, whatever hints (`parentRunId`, `branch`) the second call carried.
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

export type RunStore = Pick<StoreInterface, "insertRun" | "getRun">;

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
    const stored = await this.store.getRun(id);
    if (!stored.ok) return stored;
    if (stored.value === null) {
      return err(validationError("run", `run ${id} was inserted but cannot be read back`, id));
    }
    return ok(stored.value);
  }

  /** The registered run, or DOC_NOT_FOUND naming the id. */
  async show(id: string): Promise<Result<RunRecord, LoreError>> {
    const found = await this.store.getRun(id as RunId);
    if (!found.ok) return found;
    if (found.value === null) return err({ code: "DOC_NOT_FOUND", id });
    return ok(found.value);
  }
}
