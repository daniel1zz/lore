/**
 * Curated, editable-scalar-leaf declarations for the two config scopes
 * (SPEC-064 T4). This is deliberately NOT a full reflection of
 * `LoreConfigSchema`/`GlobalLoreConfigSchema` (60+ keys across 22 specs,
 * several nested behind dynamic-keyed maps — `ai.providers.<name>.*`,
 * `ai.http.headers.*`, `workflow.gates.<checkpoint>.*`,
 * `workflow.verification_profiles.<spec_kind>.*` — that have no fixed dotted
 * path and are NOT safely genericizable into one text/number/boolean input).
 * Declaring the SAFE, well-known scalar leaves explicitly means a row always
 * renders for a key even when it is currently ABSENT from the loaded config
 * (e.g. a fresh corpus's `.lore/config.yaml` has no `sync:` section at all —
 * `ConfigScopePanel` still needs to offer a `sync.enabled` checkbox so it can
 * be turned on), which a purely reflective "walk the loaded JSON" approach
 * cannot do for absent keys.
 *
 * Any OTHER leaf actually present in a loaded config (including every
 * `CONFIG_DENY_KEYS` entry, and any complex/dynamic-map leaf) is still
 * rendered — read-only — by `ConfigScopePanel`'s fallback path over
 * `flattenConfigLeafPaths(config)` (imported from `@lore/core`, SPEC-064 D2:
 * "the server is the boundary; the UI imports the same tables only so it
 * cannot offer an edit the server will reject"). This file supplies ONLY the
 * editable half of that union.
 *
 * Public surface: FieldSpec, FieldType, TEAM_FIELD_SPECS, MACHINE_FIELD_SPECS
 * Invariants:
 *   - Every `FieldSpec.path` here must be a legitimate `LoreConfigSchema` /
 *     `GlobalLoreConfigSchema` scalar leaf — `defaults.editor` is
 *     DELIBERATELY included (its actual editability is decided at RENDER time
 *     by `ConfigScopePanel` checking `CONFIG_DENY_KEYS` via
 *     `findDeniedConfigKeys`, per D1/D2 — it stays in this list so its ROW
 *     still exists, just rendered read-only).
 *   - `MACHINE_FIELD_SPECS` covers exactly the 3 `defaults.*` keys —
 *     `GlobalLoreConfigSchema` is `.strict()` with `defaults` as its ONLY
 *     section (SPEC-064 Overview table), so there is nothing else to declare.
 *
 * Side-effect class: pure
 * Source: SPEC-064 §Design D1; @lore/core/config.ts (LoreConfigSchema, GlobalLoreConfigSchema)
 */

/** Which HTML input `ConfigScopePanel` renders for an editable {@link FieldSpec}. */
export type FieldType = "boolean" | "number" | "string" | "enum";

/** One declared, editable scalar config leaf. */
export interface FieldSpec {
  /** Dotted leaf path, e.g. `"workflow.claim_ttl_minutes"`. */
  path: string;
  /** Human label shown next to the row (falls back to `path` in the UI when absent). */
  label: string;
  /** Top-level section grouping (`"project" | "sync" | ...`) — derived from `path`'s first segment by callers, kept here only for an explicit override when useful. */
  section: string;
  type: FieldType;
  /** Required when `type === "enum"`. */
  options?: readonly string[];
}

/** Editable scalar leaves for the TEAM scope (`.lore/config.yaml`, `LoreConfigSchema`). */
export const TEAM_FIELD_SPECS: readonly FieldSpec[] = [
  { path: "project.name", label: "Project name", section: "project", type: "string" },
  { path: "project.author", label: "Project author", section: "project", type: "string" },

  { path: "sync.enabled", label: "Sync enabled", section: "sync", type: "boolean" },
  { path: "sync.remote_url", label: "Remote URL (libsql://…)", section: "sync", type: "string" },
  { path: "sync.auth_token_env", label: "Auth token env var name", section: "sync", type: "string" },
  { path: "sync.interval", label: "Sync interval (seconds)", section: "sync", type: "number" },

  { path: "telemetry.enabled", label: "Telemetry enabled", section: "telemetry", type: "boolean" },

  { path: "defaults.editor", label: "Editor command", section: "defaults", type: "string" },
  { path: "defaults.format", label: "Output format", section: "defaults", type: "enum", options: ["text", "json"] },
  { path: "defaults.color", label: "ANSI color output", section: "defaults", type: "boolean" },

  { path: "ai.provider", label: "Active AI provider", section: "ai", type: "string" },
  { path: "ai.telemetry", label: "AI generation telemetry", section: "ai", type: "boolean" },

  { path: "workflow.claim_ttl_minutes", label: "Claim lease TTL (minutes)", section: "workflow", type: "number" },
  { path: "workflow.handoff_ttl_minutes", label: "Handoff TTL (minutes)", section: "workflow", type: "number" },
  { path: "workflow.drift.enabled", label: "Doc-code drift oracle enabled", section: "workflow", type: "boolean" },
  {
    path: "workflow.requirement_quantifiable.enabled",
    label: "Requirement quantifiability lint enabled",
    section: "workflow",
    type: "boolean",
  },

  { path: "audit.verify_since", label: "Audit verify watermark (ISO 8601)", section: "audit", type: "string" },

  { path: "verify.default_timeout_ms", label: "Default verify timeout (ms)", section: "verify", type: "number" },
  {
    path: "verify.require_command_approval",
    label: "Require command-provenance approval",
    section: "verify",
    type: "boolean",
  },
  {
    path: "verify.env.passthrough_all",
    label: "Full env passthrough (DENIED — see note)",
    section: "verify",
    type: "boolean",
  },
];

/** Editable scalar leaves for the MACHINE scope (XDG global config, `GlobalLoreConfigSchema`). */
export const MACHINE_FIELD_SPECS: readonly FieldSpec[] = [
  { path: "defaults.editor", label: "Editor command", section: "defaults", type: "string" },
  { path: "defaults.format", label: "Output format", section: "defaults", type: "enum", options: ["text", "json"] },
  { path: "defaults.color", label: "ANSI color output", section: "defaults", type: "boolean" },
];
