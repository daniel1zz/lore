/**
 * Decision gate: the write-time refusal of an agent's decision-carrying write that lacks its decision, and the
 * resolution of a supplied decision draft into the `DecisionRecord` stored on the version row.
 *
 * Purpose: ONE home for "does this write need a decision" ({@link writeCarriesDecision}) and "is the supplied decision
 *   complete and its file premises quotable" ({@link DecisionGate.judge}); every service entry that records a pending
 *   revision or edits a non-draft target (`CorpusService.set`, the `RuleService` baseline verbs) asks here and never
 *   re-derives either answer.
 * Public surface: {@link DecisionDraft}, {@link DecisionGitPort}, {@link GitAnswer}, {@link DecisionGate},
 *   {@link writeCarriesDecision}, {@link isAgentWriterSource}, {@link DecisionWriteFacts}, {@link DECISION_FIELD}.
 * Invariants:
 *   - Only an agent run (`NameSource` "run") carries decisions; a human session, dashboard login or HTTP key never does
 *     (ADR correction 2). MCP callers are agent runs and cannot supply a decision, so an MCP write that needs one is
 *     refused by the same call.
 *   - A refusal is `VALIDATION_ERROR`, field `decision` (exit 4), names EACH missing part, and is returned before any
 *     write: the caller returns it untouched.
 *   - A file premise is quoted by lore, never by the writer: the stored `quote` is the named lines' text at `sha`; `sha`
 *     is HEAD when the writer gave none, and a file with uncommitted changes plus no `sha` is refused (the lines the
 *     writer read are not the lines lore would pin).
 *   - A supplied decision is validated whether or not the write required one: an incomplete decision is never stored.
 *   - `judge` is stage one (completeness, quoting) and passes `scores` / `weight_table` through; weight-table and score
 *     validation (BR-1482) is {@link DecisionGate.judgeChecked}, which every service entry calls.
 * Side-effect class: IO only through the injected {@link DecisionGitPort} (read-only); otherwise pure.
 *
 * Source: spec-a-decision-carrying-write-records-its-decision-on-its, "Which writes carry a decision", "Refusal", D2, D9;
 *   adr-an-agent-s-decision-between-milestones-is-a-record-gates; BR-1476.
 */

import { isAbsolute } from "node:path";
import {
  decisionRecordSchema,
  err,
  hasStrongPremise,
  isStrongTier,
  ok,
  parseDecisionSource,
  type DecisionSourceDraft,
  type FileSource,
  type DecisionAlternative,
  type DecisionGate as StoredGate,
  type DecisionRecord,
  type DecisionRef,
  type DecisionScore,
  type DecisionWeightTableRef,
  type LoreError,
  type Premise,
  type PremiseDraft,
  type Result,
  type WeightTable,
  type WeightTableKind,
} from "@lore/core";

/** The `field` of every decision refusal. */
export const DECISION_FIELD = "decision";

/** The rule the refusal cites. */
const DECISION_RULE = "BR-1476";

/** A decision as the writer supplied it: file premises are not yet quoted and any part may be missing. */
export interface DecisionDraft {
  readonly reason?: string;
  readonly premises?: readonly PremiseDraft[];
  readonly alternatives?: readonly DecisionAlternative[];
  readonly gates?: readonly StoredGate[];
  readonly scores?: readonly DecisionScore[];
  readonly weightTable?: DecisionWeightTableRef;
  readonly refs?: readonly DecisionRef[];
}

/** A git answer that is either a value or the reason git could not give it (never a guessed value). */
export type GitAnswer<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

/** The read-only git questions the gate asks; injected so a test never spawns git. */
export interface DecisionGitPort {
  /** Full sha of HEAD in the repository the corpus lives in. */
  headSha(): GitAnswer<string>;
  /** Whether `path` (repo-root-relative) has uncommitted changes or is untracked. */
  hasUncommittedChanges(path: string): GitAnswer<boolean>;
  /** The lines of `path` at `sha`; `null` when the file does not exist at that commit (or the commit is unknown). */
  readLinesAt(sha: string, path: string): GitAnswer<readonly string[] | null>;
}

/** A weight-table document as the lookup found it (the gate decides whether it is usable). */
export interface WeightTableFacts {
  /** `docs.status` of the document now. */
  readonly status: string;
  /** `docs.version` of the document now: the approved version is the current one while the status is `approved`. */
  readonly currentVersion: number;
  /** The valid `extra.weight_table`; `undefined` when the document holds none (it is not a weight table). */
  readonly table: WeightTable | undefined;
}

/** The read-only question the gate asks about a decision's `--weight-table <slug>@<version>`; injected so a test never opens a store. */
export interface WeightTableLookup {
  /** The document `slug`, or `ok(null)` when none exists. */
  find(slug: string): Promise<Result<WeightTableFacts | null, LoreError>>;
}

/** What decides whether a write carries a decision. */
export interface DecisionWriteFacts {
  /** The writer's name source (`run | human | api-key | dashboard`), or undefined/null when unknown. */
  readonly writerSource: string | null | undefined;
  /** The target is a draft (a baseline node: has no approved version). */
  readonly targetIsDraft: boolean;
  /** The write changes something besides status. */
  readonly changesMoreThanStatus: boolean;
}

/**
 * Whether the writer is an agent run.
 *
 * @param source - the write context's name source
 */
export function isAgentWriterSource(source: string | null | undefined): boolean {
  return source === "run";
}

/**
 * Whether a write must carry a decision: an agent run, a non-draft target, more than status changed.
 *
 * @param facts - the three facts of the write
 */
export function writeCarriesDecision(facts: DecisionWriteFacts): boolean {
  return isAgentWriterSource(facts.writerSource) && !facts.targetIsDraft && facts.changesMoreThanStatus;
}

function refuse(message: string): LoreError {
  return { code: "VALIDATION_ERROR", field: DECISION_FIELD, message, rule: DECISION_RULE };
}

/** The gate. One instance per composition root, holding the git port of the corpus's repository. */
export class DecisionGate {
  /**
   * @param git - read-only git questions for file premises
   * @param weightTables - how a decision's weight table is looked up; absent (a bare test construction) = a decision that
   *   names scores or a table is refused by {@link DecisionGate.judgeChecked}, never passed unchecked
   */
  constructor(private readonly git: DecisionGitPort, private readonly weightTables?: WeightTableLookup) {}

  /**
   * {@link DecisionGate.judge} plus the weight-table and score validation (BR-1482): the entry every service uses.
   *
   * @param request - as {@link DecisionGate.judge}, plus `kind`, the weight-table kind the command fixes
   *   (`rule revision` for `rule set|add|propose`, `document revision` for every other command)
   * @returns the judged record, or the `decision` refusal for: scores without `weight_table`; a table that does not exist,
   *   is not a weight table, is not the approved version, or is of another kind than `kind`; a score on a dimension the
   *   table lacks. Nothing is written on a refusal.
   */
  async judgeChecked(
    request: Parameters<DecisionGate["judge"]>[0] & { readonly kind: WeightTableKind },
  ): Promise<Result<DecisionRecord | undefined, LoreError>> {
    const judged = this.judge(request);
    if (!judged.ok || judged.value === undefined) return judged;
    const checked = await this.checkWeights(judged.value, request.kind);
    return checked.ok ? judged : checked;
  }

  private async checkWeights(record: DecisionRecord, kind: WeightTableKind): Promise<Result<void, LoreError>> {
    const scores = record.scores ?? [];
    const ref = record.weight_table;
    if (ref === undefined) {
      if (scores.length === 0) return ok(undefined);
      return err(refuse(`scores need a weight table: --weight-table <slug>@<version> of the approved "${kind}" weight table. Nothing was written.`));
    }
    if (this.weightTables === undefined) return err(refuse("no weight-table lookup is wired, so the decision's weight table cannot be checked. Nothing was written."));
    const found = await this.weightTables.find(ref.slug);
    if (!found.ok) return found;
    const label = `${ref.slug}@${ref.version}`;
    if (found.value === null) return err(refuse(`weight table ${label} does not exist. Nothing was written.`));
    const facts = found.value;
    if (facts.table === undefined) return err(refuse(`${ref.slug} is not a weight table (it holds no extra.weight_table). Nothing was written.`));
    if (facts.status !== "approved" || facts.currentVersion !== ref.version) {
      return err(refuse(`weight table ${label} is not the approved version (now v${facts.currentVersion}, status ${facts.status}). Nothing was written.`));
    }
    if (facts.table.kind !== kind) {
      return err(refuse(`weight table ${label} is of kind "${facts.table.kind}"; this command's decision needs a "${kind}" table. Nothing was written.`));
    }
    const lacking = [...new Set(scores.map((score) => score.dimension).filter((dimension) => !(dimension in facts.table!.dimensions)))];
    if (lacking.length > 0) {
      return err(refuse(`dimension(s) ${lacking.map((d) => `"${d}"`).join(", ")} are not in weight table ${label} (it has: ${Object.keys(facts.table.dimensions).join(", ")}). Nothing was written.`));
    }
    return ok(undefined);
  }

  /**
   * Resolve a write's decision.
   *
   * @param request.required - the write carries a decision ({@link writeCarriesDecision})
   * @param request.draft - what the writer supplied; absent when it supplied nothing
   * @param request.reasonIsSharedFlag - the verb's own `--reason` doubles as the decision's reason (`ac supersede`, `ac exempt`),
   *   so a draft holding nothing but a reason is not a supplied decision unless the write requires one
   * @returns `ok(undefined)` when nothing is required and nothing was supplied; `ok(record)` with every file premise
   *   quoted and pinned; otherwise the `decision` refusal naming each missing or unreadable part.
   */
  judge(request: {
    readonly required: boolean;
    readonly draft: DecisionDraft | undefined;
    readonly reasonIsSharedFlag?: boolean;
  }): Result<DecisionRecord | undefined, LoreError> {
    const { draft } = request;
    const supplied = draft !== undefined && isNonEmptyDraft(request.reasonIsSharedFlag === true ? withoutReason(draft) : draft);
    if (!supplied && !request.required) return ok(undefined);

    const reason = draft?.reason?.trim() ?? "";
    const premises = draft?.premises ?? [];
    const alternatives = draft?.alternatives ?? [];
    const missing: string[] = [];
    if (reason === "") missing.push('reason (--reason "<why this change>")');
    if (!premises.some((premise) => isStrongTier(premise.tier))) {
      missing.push('premise of tier S..C (--premise "<claim>|<source>|<tier>")');
    }
    if (alternatives.length === 0) missing.push('alternative (--alt "<option>|<why rejected>")');
    if (missing.length > 0) {
      return err(
        refuse(
          `a decision is required for this write (an agent's change to a target that is not a draft) and is incomplete; missing: ${missing.join("; ")}. ` +
            "Nothing was written.",
        ),
      );
    }

    const quoted: Premise[] = [];
    for (const premise of premises) {
      const resolved = this.quotePremise(premise);
      if (!resolved.ok) return resolved;
      quoted.push(resolved.value);
    }
    const gates: StoredGate[] = [];
    for (const gate of draft?.gates ?? []) {
      const pinned = this.pinEvidence(gate.evidence, `gate "${gate.id}" evidence`);
      if (!pinned.ok) return pinned;
      gates.push(pinned.value === undefined ? gate : { ...gate, evidence_source: pinned.value });
    }
    const scores: DecisionScore[] = [];
    for (const score of draft?.scores ?? []) {
      const pinned = this.pinEvidence(score.evidence, `score ${score.option}/${score.dimension} evidence`);
      if (!pinned.ok) return pinned;
      scores.push(pinned.value === undefined ? score : { ...score, evidence_source: pinned.value });
    }
    const record = {
      reason,
      premises: quoted,
      alternatives: [...alternatives],
      ...(gates.length > 0 ? { gates } : {}),
      ...(scores.length > 0 ? { scores } : {}),
      ...(draft?.weightTable !== undefined ? { weight_table: draft.weightTable } : {}),
      ...(draft?.refs !== undefined && draft.refs.length > 0 ? { refs: [...draft.refs] } : {}),
    };
    const parsed = decisionRecordSchema.safeParse(record);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err(refuse(`the decision is malformed at ${issue ? issue.path.join(".") : "(root)"}: ${issue ? issue.message : "invalid"}. Nothing was written.`));
    }
    if (!hasStrongPremise(parsed.data)) return err(refuse("the decision holds no premise of tier S..C. Nothing was written."));
    return ok(parsed.data);
  }

  /** One premise with its file source quoted and pinned (other kinds are stored as given). */
  private quotePremise(premise: PremiseDraft): Result<Premise, LoreError> {
    const { source } = premise;
    if (source.kind !== "file") return ok({ claim: premise.claim, tier: premise.tier, source });
    const pinned = this.pinFile(source, `file premise "${premise.claim}"`);
    if (!pinned.ok) return pinned;
    return ok({ claim: premise.claim, tier: premise.tier, source: pinned.value });
  }

  /**
   * Gate or score evidence: when the text parses as a file source it is quoted and pinned exactly like a premise (the
   * milestone re-check needs the stored quote to tell wrong-when-written from stale-since); plain prose, and any other
   * source kind, stays as typed and yields `undefined`.
   */
  private pinEvidence(evidence: string, what: string): Result<FileSource | undefined, LoreError> {
    if (!evidence.startsWith("file:")) return ok(undefined);
    const parsed = parseDecisionSource(evidence);
    if (!parsed.ok || parsed.source.kind !== "file") return ok(undefined);
    return this.pinFile(parsed.source, what);
  }

  /** A file source with `sha` and `quote` filled from the repository, or the refusal naming why it cannot be. */
  private pinFile(source: Extract<DecisionSourceDraft, { kind: "file" }>, subject: string): Result<FileSource, LoreError> {
    const path = this.repoRelative(source.path);
    if (!path.ok) return path;
    const label = `${subject} (${source.path}:${source.lines[0]}-${source.lines[1]})`;

    let sha = source.sha;
    if (sha === undefined) {
      const dirty = this.git.hasUncommittedChanges(path.value);
      if (!dirty.ok) return err(refuse(`${label}: git could not say whether ${source.path} has uncommitted changes (${dirty.reason}); name a commit with @<sha>. Nothing was written.`));
      if (dirty.value) {
        return err(refuse(`${label}: ${source.path} has uncommitted changes, so HEAD does not hold the lines you read; commit it or name a commit with @<sha>. Nothing was written.`));
      }
      const head = this.git.headSha();
      if (!head.ok) return err(refuse(`${label}: HEAD could not be read (${head.reason}); name a commit with @<sha>. Nothing was written.`));
      sha = head.value;
    }

    const lines = this.git.readLinesAt(sha, path.value);
    if (!lines.ok) return err(refuse(`${label}: git could not read ${source.path} at ${sha} (${lines.reason}). Nothing was written.`));
    if (lines.value === null) return err(refuse(`${label}: ${source.path} does not exist at ${sha} (lines absent at that commit). Nothing was written.`));
    const [from, to] = source.lines;
    if (to > lines.value.length) {
      return err(refuse(`${label}: lines ${from}-${to} are absent at ${sha}; the file has ${lines.value.length} line(s) there. Nothing was written.`));
    }
    return ok({ kind: "file", path: path.value, lines: [from, to], sha, quote: lines.value.slice(from - 1, to).join("\n") });
  }

  /** The repo-root-relative form of a premise path; a path outside the repository is refused. */
  private repoRelative(path: string): Result<string, LoreError> {
    // reason: no resolution against the process directory (nothing below an entry reads it): the path is the repo-root-relative
    // text the writer typed, minus a leading "./".
    const normalized = path.startsWith("./") ? path.slice(2) : path;
    if (isAbsolute(normalized) || normalized.startsWith("..") || normalized === "") {
      return err(refuse(`file premise path "${path}" must be a path inside the repository, relative to its root. Nothing was written.`));
    }
    return ok(normalized);
  }
}

/** The draft without its reason (see `DecisionGate.judge`'s `reasonIsSharedFlag`). */
function withoutReason(draft: DecisionDraft): DecisionDraft {
  const { reason: _reason, ...rest } = draft;
  return rest;
}

/** Whether the writer supplied anything at all (an all-empty draft counts as none). */
function isNonEmptyDraft(draft: DecisionDraft): boolean {
  return (
    (draft.reason !== undefined && draft.reason.trim() !== "") ||
    (draft.premises?.length ?? 0) > 0 ||
    (draft.alternatives?.length ?? 0) > 0 ||
    (draft.gates?.length ?? 0) > 0 ||
    (draft.scores?.length ?? 0) > 0 ||
    draft.weightTable !== undefined ||
    (draft.refs?.length ?? 0) > 0
  );
}
