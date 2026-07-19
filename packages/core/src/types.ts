/**
 * Core domain types for the Lore corpus.
 * All types derive from SPEC-002 §2 — do not modify without updating the spec.
 */

import type { SpecKind } from "./spec-kind.js";
import type { Validity } from "./validity.js";

// ─── Primitive Aliases ─────────────────────────────────────────────────────

/** ULID-format string — 26 chars, e.g. 01J5X7KZRF4AXRHX9WKE6DVP6P */
export type DocId = string;

/** Human-readable slug — format: {type}-{kebab-name}, e.g. spec-auth-v2 */
export type Slug = string;

// ─── Enum-like Unions ──────────────────────────────────────────────────────

export type DocType = "prd" | "spec" | "adr" | "plan" | "knowledge" | "task" | "phase";

export type DocRole = "intent" | "spec" | "decision" | "plan" | "knowledge";

export type DocStatus =
  | "draft"
  | "in-review"
  | "approved"
  | "active"
  | "archived"
  | "deprecated";

export type Priority = "critical" | "high" | "medium" | "low";

export type LinkType =
  | "parent"
  | "implements"
  | "informs"
  | "supersedes"
  | "relates-to"
  | "blocks"
  /** from = skill, to = artifact — the skill governed/fed that artifact's
   * production (P4 provenance). Plain typed edge, no lifecycle or
   * validation coupling beyond the generic link rules. */
  | "governs";

export type VersionAction =
  | "create"
  | "update"
  | "approve"
  | "reject"
  | "restore"
  | "delete";

// ─── Primary Records ───────────────────────────────────────────────────────

/** Core document record — stored in the `docs` SQLite table. */
export interface DocRecord {
  /** ULID — internal primary key, auto-generated, immutable */
  id: DocId;
  /** Human-readable unique alias, auto-generated from type+title, editable */
  slug: Slug;
  type: DocType;
  role: DocRole;
  title: string;
  status: DocStatus;
  priority: Priority;
  /** Markdown/MDX body */
  content: string;
  /** Tree parent (null = root). Required for spec, task */
  parent_id: DocId | null;
  /** ISO 8601 */
  created_at: string;
  /** ISO 8601 */
  updated_at: string;
  /** User/agent identity */
  created_by: string;
  /** Monotonic version number (1, 2, 3...) */
  version: number;
  /** Soft-delete timestamp (null = active) */
  deleted_at: string | null;
  /** Freeform tags */
  tags: string[];
  /** Type-specific fields (see AdrExtra, TaskExtra, etc.) */
  extra: Record<string, unknown>;
}

/** Graph link between two documents. PK: (from_id, to_id, link_type) */
export interface LinkRecord {
  from_id: DocId;
  to_id: DocId;
  link_type: LinkType;
  /** ISO 8601 */
  created_at: string;
  created_by: string;
}

/** Version snapshot — created on every write. PK: (doc_id, version) */
export interface VersionRecord {
  doc_id: DocId;
  /** Monotonic, starting at 1 */
  version: number;
  /** Full content snapshot at this version */
  content: string;
  /** Full extra fields snapshot */
  extra: Record<string, unknown>;
  /** Status at this version */
  status: DocStatus;
  /** Title at this version */
  title: string;
  /** What triggered this version */
  action: VersionAction;
  /** ISO 8601 */
  created_at: string;
  /** Who made this change */
  created_by: string;
  /** Optional human/AI-generated summary */
  change_summary?: string;
}

/** Append-only audit log entry. */
export interface AuditEntry {
  /** ISO 8601 */
  timestamp: string;
  /** User name or agent_id */
  actor: string;
  session_id: string;
  action: string;
  /** null for non-doc operations */
  doc_id?: DocId;
  /** Structured change details */
  details?: Record<string, unknown>;
}

// ─── Type-specific Extra Fields (stored in extra JSON column) ──────────────

/** Extra fields for prd documents — no required extra fields */
export interface PrdExtra {
  [key: string]: unknown;
}

/** Extra fields for spec documents — parent_id is on DocRecord itself */
export interface SpecExtra {
  [key: string]: unknown;
}

/**
 * The four decision-status values an `adr` document's `extra.decision_status` may take.
 * SSOT for the enum — `adrExtraSchema` (schemas.ts) validates against this exact tuple
 * rather than re-declaring the literal list, mirroring the `SPEC_KINDS`/`SpecKind`
 * precedent (spec-kind.ts).
 */
export const DECISION_STATUSES = ["proposed", "accepted", "deprecated", "superseded"] as const;

/** Derived TypeScript union for an adr document's `extra.decision_status`. */
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/** Extra fields for adr documents */
export interface AdrExtra {
  /** Required — current decision status */
  decision_status: "proposed" | "accepted" | "deprecated" | "superseded";
  /** Required when decision_status = 'superseded' */
  superseded_by?: DocId;
  [key: string]: unknown;
}

/** Extra fields for plan documents */
export interface PlanExtra {
  /** e.g. "P1", "P2" */
  phase?: string;
  [key: string]: unknown;
}

/**
 * The eight sub-classification values a `knowledge` document's `extra.sub_type` may take.
 * SSOT for the enum — `knowledgeExtraSchema` (schemas.ts) validates against this exact
 * tuple rather than re-declaring the literal list (same `SPEC_KINDS` precedent as
 * {@link DECISION_STATUSES} above). Includes `"assessment"` (SPEC-026 §3 D4),
 * `"prompt"` / `"skill"` (upstream-asset sub_types — reusable prompt/skill artifacts
 * riding the existing knowledge review/version/calibration machinery instead of a new
 * top-level doc type; see `promptExtraSchema` / `skillExtraSchema` in schemas.ts), and
 * `"handoff"` (SPEC-041 §3 D3 — lossless session-continuity record; write-path
 * exclusivity is enforced in `CorpusService._createImpl`, NOT here — see that method's
 * "lore handoff" rejection block) — a superset of the local `KnowledgeExtra.sub_type`
 * literal below, which predates SPEC-026 and is left as-is (pre-existing, narrower
 * interface; not read by any SPEC-036 code path).
 */
export const KNOWLEDGE_SUB_TYPES = [
  "ideation",
  "retro",
  "research",
  "reference",
  "assessment",
  "prompt",
  "skill",
  "handoff",
  "uat",
] as const;

/** Derived TypeScript union for a knowledge document's `extra.sub_type`. */
export type KnowledgeSubType = (typeof KNOWLEDGE_SUB_TYPES)[number];

/** Extra fields for knowledge documents */
export interface KnowledgeExtra {
  /** Required — sub-classification of knowledge */
  sub_type: "ideation" | "retro" | "research" | "reference";
  [key: string]: unknown;
}

/** Extra fields for task documents */
export interface TaskExtra {
  /** Required — which plan this task belongs to */
  plan_id: DocId;
  /** Optional assignee */
  assignee?: string;
  /** Optional task-specific status (distinct from doc status) */
  task_status?: "todo" | "in-progress" | "done" | "blocked";
  [key: string]: unknown;
}

// ─── Derived / Summary Types ───────────────────────────────────────────────

/**
 * Type-differentiated presentation metadata for a {@link DocSummary} (SPEC-036 §2 D3).
 * Derived by the pure fn `deriveTypeMeta` (`doc-type-meta.ts`) — single derivation
 * point, never hand-rolled at a call site.
 *
 * @invariant `prd` has no variant — `deriveTypeMeta` returns `undefined` for prd docs,
 *   and `DocSummary.meta` is correspondingly absent (never a fabricated empty object).
 */
export type DocTypeMeta =
  | { t: "spec"; kind: SpecKind }
  | { t: "adr"; decision_status: DecisionStatus }
  | { t: "knowledge"; sub_type: KnowledgeSubType }
  | { t: "plan"; phase_count: number }
  | {
      t: "task";
      claimed_by?: string;
      claim_stale?: boolean;
      evidence_pass: number;
      evidence_fail: number;
    };

/** Lightweight doc summary for listings, navigation, and trees */
export interface DocSummary {
  id: DocId;
  slug: Slug;
  type: DocType;
  title: string;
  status: DocStatus;
  updated_at: string;
  /** Freeform tags — always present (may be empty). Mirrors DocRecord.tags. */
  tags: string[];
  /** Mirrors DocRecord.priority. */
  priority: Priority;
  /** Type-differentiated presentation data — absent for prd, or when the doc's
   *  type-specific extra fields are missing/malformed (degrade by omission). */
  meta?: DocTypeMeta;
}

// ─── SPEC-037: Search Highlight Sentinels + SearchHit ──────────────────────

/**
 * Snippet highlight delimiters — SSOT for both the store layer (SQLite/Turso
 * FTS5 `snippet()` calls + InMemoryStore's substring-search fake) and the
 * dashboard's `SearchResultCard` renderer.
 *
 * C0 control characters cannot occur in authored markdown content, so they
 * cannot collide with literal `[`/`]` characters a document's body might
 * contain (SPEC-037 D5 — the previous `'['`/`']'` delimiters did collide).
 *
 * Source: SPEC-037 §2.
 */
export const SNIPPET_MARK_OPEN = "";
export const SNIPPET_MARK_CLOSE = "";

/** One full-text search result row (SPEC-037 §2 — extends the pre-037 shape
 *  with `type`/`status` so result cards can render type/status badges without
 *  a second query). `snippet` wraps matched spans in
 *  {@link SNIPPET_MARK_OPEN}/{@link SNIPPET_MARK_CLOSE}. */
export interface SearchHit {
  id: DocId;
  slug: Slug;
  title: string;
  snippet: string;
  score: number;
  type: DocType;
  status: DocStatus;
  /**
   * ISO 8601 `docs.created_at` — SPEC-043 D3 (review S3). Needed alongside `validity`
   * so `CorpusService.search`'s default-invalidated-filter can compute
   * `isInvalidated(hit, now)` directly on the hit, with zero N+1 per-hit fetches.
   */
  created_at: string;
  /**
   * Narrow bi-temporal validity projection (SPEC-043 D3, review S3) — present iff
   * `docs.extra.validity` parses to a schema-valid {@link Validity}. Populated by both
   * SQLiteStore and TursoStore's search SQL (joined `docs.extra` column, parsed) and by
   * InMemoryStore directly from the in-memory `DocRecord`.
   */
  validity?: Validity;
}

// ─── SPEC-024: Caller Surface + AI Default Source ──────────────────────────

/**
 * Identifies the execution surface that initiated the current lore operation.
 * Used by resolveAiDefault to select the correct built-in default.
 *
 * - "cli"        — human typing in a terminal (no agent env vars set)
 * - "agent"      — CLI invoked by an AI agent (CLAUDECODE=1, CI=true, LORE_AI_DEFAULT=off)
 * - "mcp"        — MCP tool call (in-process flag set by adapters/mcp/index.ts at startup)
 * - "http_cookie" — HTTP request authenticated via cookie session (dashboard / human)
 * - "http_token"  — HTTP request authenticated via bearer API token (agent-issued)
 *
 * Source: SPEC-024 §8, §9.1
 */
export type CallerSurface = "cli" | "agent" | "mcp" | "http_cookie" | "http_token";

/**
 * Identifies how the AI on/off decision was resolved.
 *
 * - "explicit_arg" — caller passed --ai or --no-ai (or ai: true/false in MCP)
 * - "config"       — ai.default_per_surface[surface] was set in config.yaml
 * - "env"          — CLAUDECODE/CI/LORE_AI_DEFAULT env var drove agent surface (AI off)
 * - "cli_flag"     — built-in default for human-facing surfaces (AI on; --no-ai was not passed)
 *
 * Source: SPEC-024 §9.3
 */
export type AiDefaultSource = "explicit_arg" | "config" | "env" | "cli_flag";

// ─── Constants ─────────────────────────────────────────────────────────────

/**
 * Maps each DocType to its canonical DocRole. Immutable SSOT.
 *
 * @invariant `phase` maps to `"plan"` — same role as `task` (SPEC-056 D1): a
 *   phase is an execution-tier document under a plan, mirroring the task doc
 *   type it generalizes/supersedes. Registered by SPEC-056's PhaseWorkflowService
 *   rename task (T2 deferral — see `phase.ts`'s module header).
 */
export const DOC_TYPE_ROLE_MAP: Record<DocType, DocRole> = {
  prd: "intent",
  spec: "spec",
  adr: "decision",
  plan: "plan",
  knowledge: "knowledge",
  task: "plan",
  phase: "plan",
} as const;
