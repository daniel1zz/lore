/**
 * BulkLifecycleService: one preview/apply path that moves MANY documents through one lifecycle verb
 * (archive | deprecate | close | done), shared by `lore bulk` and the MCP `lore_bulk` tool.
 *
 * Public surface: `BULK_VERBS`, `BulkVerb`, `BulkSelector`, `BulkWhere`, `parseBulkIdRef`, `parseBulkWhere`,
 *   `BulkLifecycleService` (`preview`, `apply`), `BulkPreviewRow`, `BulkRowResult`, `BulkCorpusPort`, `BulkDonePort`.
 * Invariants:
 *   - Preview writes nothing. Apply writes each row at most once, through the EXISTING gated write path
 *     (`CorpusService.set` for archive/deprecate/close, `TaskWorkflowService.done` for done) — no gate is
 *     re-implemented or bypassed here; a refused row is a FAILED row carrying the refusal's code and rule name.
 *   - Each row is compare-and-set against the version read at selection (or the version pinned in an id token
 *     `slug@N`, which is how a version read at an earlier preview is carried into the apply). A row whose version
 *     moved FAILS with STALE_VERSION; there is no retry and no partial write of that row.
 *   - A failed row never stops the others (rows fail alone).
 * Side-effect class: IO (reads and writes through the injected ports). Services never import each other, so both
 *   ports are structural and `app.ts` wires the real services into them.
 *
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part A, BR-1366, BR-1367)
 */

import { docStatusSchema, docTypeSchema, err, ok } from "@lore/core";
import type { DocRecord, DocStatus, DocType, LoreError, Result } from "@lore/core";
import { isPlanMember } from "./plan-membership.js";

/** The four verbs, in help order. `close` is plan-only, `done` is task-only. */
export const BULK_VERBS = ["archive", "deprecate", "close", "done"] as const;
export type BulkVerb = (typeof BULK_VERBS)[number];

/** Verbs whose audit row must say why (a missing `--reason` is a usage error, exit 2). */
export const BULK_VERBS_REQUIRING_REASON: ReadonlySet<BulkVerb> = new Set<BulkVerb>(["archive", "deprecate", "close"]);

/** The status a verb writes. `done` walks to archived through the task workflow. */
const VERB_TARGET: Readonly<Record<BulkVerb, DocStatus>> = {
  archive: "archived",
  deprecate: "deprecated",
  close: "archived",
  done: "archived",
};

/** One id token; `expectedVersion` is set by the `slug@N` spelling. */
export interface BulkIdRef {
  readonly ref: string;
  readonly expectedVersion?: number;
}

/** `lore list` filters plus the two bulk-only ones. All present keys must match. */
export interface BulkWhere {
  readonly type?: DocType;
  readonly status?: DocStatus;
  readonly author?: string;
  readonly since?: string;
  readonly tag?: string;
  /** Matches docs whose `updated_at` is more than this many days before now. */
  readonly olderThanDays?: number;
  /** `0` only: matches plans with no open (non-terminal) member task. Other types never match. */
  readonly openTasks?: 0;
}

/** Selector: explicit ids XOR a where-expression. */
export type BulkSelector =
  | { readonly kind: "ids"; readonly ids: readonly BulkIdRef[] }
  | { readonly kind: "where"; readonly where: BulkWhere };

/** One candidate printed by preview. */
export interface BulkPreviewRow {
  readonly id: string;
  readonly slug: string;
  readonly type: DocType;
  readonly status: DocStatus;
  readonly version: number;
  readonly target: DocStatus;
}

/** Outcome of one row of an apply. `rule` is the refusal's rule id (or its error code when it has none). */
export interface BulkRowResult {
  readonly id: string;
  readonly slug: string;
  readonly type: DocType | null;
  readonly outcome: "OK" | "SKIPPED" | "FAILED";
  readonly from_status: DocStatus | null;
  readonly to_status: DocStatus | null;
  readonly version: number | null;
  readonly code: string | null;
  readonly rule: string | null;
  readonly reason: string;
}

/** The slice of `CorpusService` this service needs. */
export interface BulkCorpusPort {
  listFull(filters: {
    type?: DocType;
    status?: DocStatus;
    created_by?: string;
    since?: string;
    tags?: string[];
  }): Promise<Result<{ docs: DocRecord[] }, LoreError>>;
  get(idOrSlug: string): Promise<Result<{ doc: DocRecord }, LoreError>>;
  set(
    idOrSlug: string,
    patch: { status: DocStatus },
    opts: { by: string; expectedVersion: number; reason?: string },
  ): Promise<Result<DocRecord, LoreError>>;
}

/** The slice of `TaskWorkflowService` this service needs. */
export interface BulkDonePort {
  done(
    idOrSlug: string,
    opts: { by: string; reason?: string; source?: string },
  ): Promise<Result<{ task: DocRecord }, LoreError>>;
}

/** Caller identity and note of an apply. */
export interface BulkApplyOptions {
  readonly by: string;
  readonly reason?: string;
  readonly source?: string;
}

function usage(field: string, message: string, value: unknown): LoreError {
  return { code: "VALIDATION_ERROR", field, message, value, rule: "BR-1366" };
}

/** Parses `slug`, `id` or `slug@N` (N a positive integer). */
export function parseBulkIdRef(token: string): Result<BulkIdRef, LoreError> {
  const at = token.lastIndexOf("@");
  if (at === -1) return ok({ ref: token });
  const ref = token.slice(0, at);
  const versionText = token.slice(at + 1);
  if (ref.length === 0 || !/^[1-9][0-9]*$/.test(versionText)) {
    return err(usage("ids", `"${token}" is not <id|slug> or <id|slug>@<version> (a positive integer)`, token));
  }
  return ok({ ref, expectedVersion: Number(versionText) });
}

/**
 * Parses `key=value,key=value` (keys: type, status, author, since, tag, older-than=<N>d, open-tasks=0).
 * An unknown key or value is refused by name, never ignored.
 */
export function parseBulkWhere(text: string): Result<BulkWhere, LoreError> {
  const where: { -readonly [K in keyof BulkWhere]: BulkWhere[K] } = {};
  const parts = text.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return err(usage("where", "--where needs at least one key=value", text));
  for (const part of parts) {
    const eq = part.indexOf("=");
    const key = eq === -1 ? part : part.slice(0, eq);
    const value = eq === -1 ? "" : part.slice(eq + 1);
    switch (key) {
      case "type": {
        const parsed = docTypeSchema.safeParse(value);
        if (!parsed.success) return err(usage("where.type", `unknown type "${value}"`, value));
        where.type = parsed.data;
        break;
      }
      case "status": {
        const parsed = docStatusSchema.safeParse(value);
        if (!parsed.success) return err(usage("where.status", `unknown status "${value}"`, value));
        where.status = parsed.data;
        break;
      }
      case "author":
      case "tag":
      case "since":
        if (value.length === 0) return err(usage(`where.${key}`, `${key}= needs a value`, value));
        where[key] = value;
        break;
      case "older-than": {
        const m = /^([0-9]+)d$/.exec(value);
        if (m === null) return err(usage("where.older-than", `older-than must look like 30d, got "${value}"`, value));
        where.olderThanDays = Number(m[1]);
        break;
      }
      case "open-tasks":
        if (value !== "0") return err(usage("where.open-tasks", `open-tasks only supports 0, got "${value}"`, value));
        where.openTasks = 0;
        break;
      default:
        return err(
          usage("where", `unknown where key "${key}" (type, status, author, since, tag, older-than, open-tasks)`, key),
        );
    }
  }
  return ok(where);
}

/** Builds the selector from the two adapter inputs: exactly one of ids / where must be given. */
export function resolveBulkSelector(
  ids: readonly string[] | undefined,
  where: string | undefined,
): Result<BulkSelector, LoreError> {
  const hasIds = ids !== undefined && ids.length > 0;
  if (hasIds === (where !== undefined)) {
    return err(usage("selector", "give either ids or --where, exactly one of them", { ids, where }));
  }
  if (where !== undefined) {
    const parsed = parseBulkWhere(where);
    return parsed.ok ? ok({ kind: "where", where: parsed.value }) : parsed;
  }
  const refs: BulkIdRef[] = [];
  for (const token of ids ?? []) {
    const parsed = parseBulkIdRef(token);
    if (!parsed.ok) return parsed;
    refs.push(parsed.value);
  }
  return ok({ kind: "ids", ids: refs });
}

/** Whether `verb` names one of {@link BULK_VERBS}. */
export function isBulkVerb(verb: string): verb is BulkVerb {
  return (BULK_VERBS as readonly string[]).includes(verb);
}

const TERMINAL: ReadonlySet<DocStatus> = new Set<DocStatus>(["archived", "deprecated"]);
const MS_PER_DAY = 86_400_000;

interface Selected {
  readonly ref: string;
  readonly doc: DocRecord | null;
  readonly pinnedVersion?: number;
  readonly lookupError?: LoreError;
}

/** See the module header. */
export class BulkLifecycleService {
  constructor(
    private readonly corpus: BulkCorpusPort,
    private readonly taskDone: BulkDonePort,
  ) {}

  /** Read-only: the candidates `apply` would act on. An unknown id refuses the preview (fail loud). */
  async preview(
    selector: BulkSelector,
    verb: BulkVerb,
    now: () => string = () => new Date().toISOString(),
  ): Promise<Result<BulkPreviewRow[], LoreError>> {
    const selected = await this.select(selector, now);
    if (!selected.ok) return selected;
    const rows: BulkPreviewRow[] = [];
    for (const entry of selected.value) {
      if (entry.doc === null) return err(entry.lookupError ?? usage("ids", `${entry.ref} not found`, entry.ref));
      rows.push({
        id: entry.doc.id,
        slug: entry.doc.slug,
        type: entry.doc.type,
        status: entry.doc.status,
        version: entry.pinnedVersion ?? entry.doc.version,
        target: VERB_TARGET[verb],
      });
    }
    return ok(rows);
  }

  /** Applies `verb` to every selected row, one audited write each; returns one result per row, in order. */
  async apply(
    selector: BulkSelector,
    verb: BulkVerb,
    opts: BulkApplyOptions,
    now: () => string = () => new Date().toISOString(),
  ): Promise<Result<BulkRowResult[], LoreError>> {
    const reason = opts.reason?.trim();
    if (BULK_VERBS_REQUIRING_REASON.has(verb) && (reason === undefined || reason.length === 0)) {
      return err(usage("reason", `lore bulk ${verb} needs --reason "<why>"; it is written to every row's audit entry`, opts.reason));
    }
    const selected = await this.select(selector, now);
    if (!selected.ok) return selected;
    const results: BulkRowResult[] = [];
    for (const entry of selected.value) {
      results.push(await this.applyRow(entry, verb, opts, reason));
    }
    return ok(results);
  }

  private async applyRow(
    entry: Selected,
    verb: BulkVerb,
    opts: BulkApplyOptions,
    reason: string | undefined,
  ): Promise<BulkRowResult> {
    const doc = entry.doc;
    if (doc === null) {
      const error = entry.lookupError ?? usage("ids", `${entry.ref} not found`, entry.ref);
      return failed(entry.ref, entry.ref, null, null, error);
    }
    const target = VERB_TARGET[verb];
    const base = { id: doc.id, slug: doc.slug, type: doc.type, from_status: doc.status, to_status: target };
    if (doc.status === target) {
      return { ...base, outcome: "SKIPPED", version: doc.version, code: null, rule: null, reason: `already ${target}` };
    }
    if (verb === "close" && doc.type !== "plan") {
      return { ...base, outcome: "SKIPPED", version: doc.version, code: null, rule: null, reason: `close applies to plans, not ${doc.type}` };
    }
    if (verb === "done" && doc.type !== "task") {
      return { ...base, outcome: "SKIPPED", version: doc.version, code: null, rule: null, reason: `done applies to tasks, not ${doc.type}` };
    }
    const expected = entry.pinnedVersion ?? doc.version;
    if (expected !== doc.version) {
      return failed(doc.id, doc.slug, doc.type, doc.status, {
        code: "STALE_VERSION",
        id: doc.id,
        expected,
        actual: doc.version,
      });
    }
    const written =
      verb === "done"
        ? await this.taskDone.done(doc.id, {
            by: opts.by,
            ...(reason !== undefined ? { reason } : {}),
            ...(opts.source !== undefined ? { source: opts.source } : {}),
          })
        : await this.corpus.set(doc.id, { status: target }, {
            by: opts.by,
            expectedVersion: expected,
            ...(reason !== undefined ? { reason } : {}),
          });
    if (!written.ok) return failed(doc.id, doc.slug, doc.type, doc.status, written.error);
    const after = verb === "done" ? (written.value as { task: DocRecord }).task : (written.value as DocRecord);
    return {
      ...base,
      outcome: "OK",
      version: after.version,
      code: null,
      rule: null,
      reason: reason ?? `${verb}d`,
    };
  }

  private async select(selector: BulkSelector, now: () => string): Promise<Result<Selected[], LoreError>> {
    if (selector.kind === "ids") {
      const out: Selected[] = [];
      for (const idRef of selector.ids) {
        const found = await this.corpus.get(idRef.ref);
        out.push(
          found.ok
            ? { ref: idRef.ref, doc: found.value.doc, ...(idRef.expectedVersion !== undefined ? { pinnedVersion: idRef.expectedVersion } : {}) }
            : { ref: idRef.ref, doc: null, lookupError: found.error },
        );
      }
      return ok(out);
    }
    const w = selector.where;
    const listed = await this.corpus.listFull({
      ...(w.type !== undefined ? { type: w.type } : {}),
      ...(w.status !== undefined ? { status: w.status } : {}),
      ...(w.author !== undefined ? { created_by: w.author } : {}),
      ...(w.since !== undefined ? { since: w.since } : {}),
      ...(w.tag !== undefined ? { tags: [w.tag] } : {}),
    });
    if (!listed.ok) return listed;
    let docs = listed.value.docs;
    if (w.olderThanDays !== undefined) {
      const cutoff = Date.parse(now()) - w.olderThanDays * MS_PER_DAY;
      docs = docs.filter((d) => Date.parse(d.updated_at) < cutoff);
    }
    if (w.openTasks === 0) {
      const tasks = await this.corpus.listFull({ type: "task" });
      if (!tasks.ok) return tasks;
      docs = docs.filter(
        (d) => d.type === "plan" && !tasks.value.docs.some((t) => isPlanMember(t, d.id) && !TERMINAL.has(t.status)),
      );
    }
    return ok(docs.map((doc) => ({ ref: doc.slug, doc })));
  }
}

function failed(
  id: string,
  slug: string,
  type: DocType | null,
  from: DocStatus | null,
  error: LoreError,
): BulkRowResult {
  const rule = "rule" in error && typeof error.rule === "string" ? error.rule : error.code;
  const message =
    error.code === "STALE_VERSION"
      ? `expected v${error.expected}, found v${error.actual}`
      : "message" in error && typeof error.message === "string"
        ? error.message
        : error.code;
  return { id, slug, type, outcome: "FAILED", from_status: from, to_status: null, version: null, code: error.code, rule, reason: `${rule}: ${message}` };
}
