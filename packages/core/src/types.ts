/**
 * Core domain types for the Lore corpus.
 * All types derive from SPEC-002 §2 — do not modify without updating the spec.
 */

// ─── Primitive Aliases ─────────────────────────────────────────────────────

/** ULID-format string — 26 chars, e.g. 01J5X7KZRF4AXRHX9WKE6DVP6P */
export type DocId = string;

/** Human-readable slug — format: {type}-{kebab-name}, e.g. spec-auth-v2 */
export type Slug = string;

// ─── Enum-like Unions ──────────────────────────────────────────────────────

export type DocType = "prd" | "spec" | "adr" | "plan" | "knowledge" | "task";

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
  | "blocks";

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

/** Lightweight doc summary for listings, navigation, and trees */
export interface DocSummary {
  id: DocId;
  slug: Slug;
  type: DocType;
  title: string;
  status: DocStatus;
  updated_at: string;
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

/** Maps each DocType to its canonical DocRole. Immutable SSOT. */
export const DOC_TYPE_ROLE_MAP: Record<DocType, DocRole> = {
  prd: "intent",
  spec: "spec",
  adr: "decision",
  plan: "plan",
  knowledge: "knowledge",
  task: "plan",
} as const;
