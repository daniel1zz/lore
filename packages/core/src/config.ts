/**
 * LoreConfig — Zod schema, types, and pure parse helpers. Browser-safe.
 *
 * Public surface:
 *   - LoreConfigSchema / LoreConfig — project-level config (.lore/config.yaml)
 *   - GlobalLoreConfigSchema / GlobalLoreConfig — user-level global config (XDG path)
 *   - LoreDefaultsSchema / LoreDefaults — shared defaults section (editor, format, color)
 *   - parseConfig / loadConfigFromString — pure YAML/object → LoreConfig validation
 *   - isAiConfigValidationError — type guard distinguishing `ai`-block violations from
 *     other config-block violations (SPEC-030 AC-HJ-3 fail-loud path)
 *   - mergeDefaults — project defaults win over global defaults
 *   - resolveSyncCredentials — D-004 credential resolution (env-var NAME only; reads
 *     process.env, not the filesystem — safe to keep here)
 *
 * Invariants:
 *   - D-004: auth_token_env is ALWAYS an env-var NAME — never the plaintext token
 *   - D-007: sync.enabled=true + remote_url MUST be present (TursoStore selection)
 *   - SPEC-072: `feedback.upstream` (both `corpus_path` and `root_prd`) is either
 *     fully present or fully absent — there is no partial-config default; absence
 *     means `lore report-issue` is unconfigured and fails loud (this is the
 *     feature's consent act, not a silently-degraded mode)
 *   - SPEC-030 AC-HJ-3: an invalid `ai` block MUST be reported as a VALIDATION_ERROR whose
 *     `field` names the offending key path (e.g. "ai.cli") — callers (loadLoreApp) use
 *     isAiConfigValidationError() to decide fail-loud vs the (unchanged, non-goal) silent
 *     fallback that still applies to other config blocks. A config with no `ai` key at all
 *     remains valid (schema default applies) — this only fires when `ai:` IS present but
 *     malformed.
 *   - This file MUST NOT import Node builtins (fs/path/os/child_process/...), even
 *     transitively — it is re-exported from the browser-safe `@lore/core` barrel
 *     (`index.ts`) and consumed by `@lore/dashboard`. File-IO helpers (`loadConfig`,
 *     `saveConfig`, `resolveGlobalConfigPath`, `loadGlobalConfig`) live in the
 *     Node-only sibling `config-node.ts`, exported only via the `@lore/core/node`
 *     subpath. Regression oracle: `packages/dashboard/tests/e2e/write-flow.pw.ts`
 *     (SPEC-022) — a `fs` import reachable from this file crashes the dashboard SPA
 *     at load time.
 *
 * Side-effect class: pure (file IO lives in config-node.ts)
 *
 * Source: SPEC-009 §6, SPEC-003 §6.2
 */

import { z } from "zod";
import yaml from "yaml";
import { ok, err } from "./errors.js";
import type { Result, LoreError } from "./errors.js";
import { TelemetryConfigSchema } from "./telemetry.js";
import { AiConfigSchema } from "./ai.js";
import { verificationProfileSchema } from "./verification-profile.js";
import { SPEC_KINDS } from "./spec-kind.js";

// ─── Shared Defaults Schema ───────────────────────────────────────────────────

/**
 * CLI output defaults shared by both global and project config.
 * Controls editor, output format, and ANSI color.
 *
 * @invariant All keys are optional — absence means "use built-in default".
 */
export const LoreDefaultsSchema = z
  .object({
    /**
     * Preferred editor command. Overrides $EDITOR env var.
     * Fallback chain: defaults.editor → $EDITOR → vi (Unix) / notepad (Windows).
     */
    editor: z.string().optional(),
    /** Output format. Built-in default: "text". */
    format: z.enum(["text", "json"]).optional(),
    /** Enable ANSI colour output. Built-in default: true. */
    color: z.boolean().optional(),
  })
  .strict();

/** CLI output defaults (editor, format, color). All fields optional. */
export type LoreDefaults = z.infer<typeof LoreDefaultsSchema>;

// ─── Dashboard Multi-Project Registry Schema (SPEC-078 D3, Q3) ───────────────

/**
 * One `dashboard.projects` registry entry — a switcher label (also the
 * `/p/:name` route segment and `MountRegistry` Map key, SPEC-078 D2) paired
 * with the project root path whose `.lore/lore.db` gets mounted.
 *
 * @invariant `name` is the uniqueness key enforced by
 *   {@link DashboardConfigSchema}'s superRefine below — a duplicate makes one
 *   entry structurally unreachable (same class of collision `planExtraSchema`
 *   guards for `phases[].name`, `packages/core/src/schemas.ts`).
 */
const DashboardProjectEntrySchema = z
  .object({
    /** Switcher label + `/p/:name` route segment + registry Map key. Must be unique within `dashboard.projects`. */
    name: z.string().min(1),
    /** Absolute path to the project root (the `.lore/lore.db` corpus lives inside it). */
    path: z.string().min(1),
  })
  .strict();

/** One `dashboard.projects` registry entry. Source: SPEC-078 D3. */
export type DashboardProjectEntry = z.infer<typeof DashboardProjectEntrySchema>;

/**
 * Dashboard multi-project registry config section (SPEC-078 D3, Q3).
 * Optional — absence means registry-less single-project mode, observably
 * identical to pre-SPEC-078 behavior (R-15).
 *
 * @invariant `projects[].name` MUST be unique — enforced by superRefine below
 *   (case-sensitive, exact-match; same convention as `planExtraSchema`'s
 *   `phases[].name` uniqueness check). A duplicate fails the WHOLE config
 *   parse with a named issue pointing at BOTH colliding indices' `name` path,
 *   never a silent last-one-wins overwrite.
 * @invariant Absence of `projects`, or an empty array, both mean "no
 *   registry entries" — neither is an error.
 */
export const DashboardConfigSchema = z
  .object({
    /** Registry of mountable projects (SPEC-078 D2 `MountRegistry` source). Absent → registry-less mode. */
    projects: z.array(DashboardProjectEntrySchema).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.projects) return;
    const seen = new Map<string, number>();
    for (let i = 0; i < data.projects.length; i++) {
      const entry = data.projects[i];
      if (!entry) continue;
      const firstIdx = seen.get(entry.name);
      if (firstIdx !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `dashboard.projects[].name must be unique — "${entry.name}" appears at indices ${firstIdx} and ${i}`,
          path: ["projects", i, "name"],
        });
      } else {
        seen.set(entry.name, i);
      }
    }
  });

/** Dashboard multi-project registry config. Source: SPEC-078 D3. */
export type DashboardConfig = z.infer<typeof DashboardConfigSchema>;

/**
 * Per-mount classification state (SPEC-078 D7) — client-renderable via
 * `GET /api/projects` (the dashboard project switcher's per-entry badge) and
 * the internal `MountRegistry`/`MountEntry` state (`packages/lore/src/mount/`).
 * The ONLY four classes D2's probe-then-classify step produces:
 *   - `"mounted"` — probed clean, `createApp` succeeded, routes are live.
 *   - `"missing"` — registry `path` does not resolve to an existing corpus.
 *   - `"schema-skew"` — a `.lore/lore.db` exists but its `PRAGMA user_version`
 *     predates/exceeds what this binary supports (never auto-migrated, R-11).
 *   - `"error"` — `createApp` (or, at runtime, a per-request dispatch) threw;
 *     this entry's routes return a named 5xx, other mounts are unaffected.
 */
export const MOUNT_STATES = ["mounted", "missing", "schema-skew", "error"] as const;

/** {@link MOUNT_STATES} as a union type. Source: SPEC-078 D7. */
export type MountState = (typeof MOUNT_STATES)[number];

// ─── Global Config Schema (XDG / $LORE_CONFIG_HOME) ──────────────────────────

/**
 * Global user-level Lore config (SPEC-003 §6.2).
 * Loaded from the first existing path in XDG resolution order, where step 3
 * is EITHER/OR with step 2 (a set $XDG_CONFIG_HOME REPLACES the ~/.config
 * default, it never stacks under it — see `config-node.ts::resolveGlobalConfigPath`):
 *   1. $LORE_CONFIG_HOME/config.yaml
 *   2. $XDG_CONFIG_HOME/lore/config.yaml — only when $XDG_CONFIG_HOME is set (non-empty)
 *   3. ~/.config/lore/config.yaml — only when $XDG_CONFIG_HOME is unset/empty
 *
 * @invariant MUST NOT contain project / sync / telemetry sections (strict schema).
 * @invariant Missing file is NOT an error — returns ok({}).
 * @invariant `dashboard` (SPEC-078 D3) lives here, not in the project-level
 *   `LoreConfigSchema` — the multi-project registry is a machine-scope fact
 *   ("which corpora does THIS machine's dashboard mount"), mirroring D1's
 *   machine-scope auth DB reasoning.
 */
export const GlobalLoreConfigSchema = z
  .object({
    defaults: LoreDefaultsSchema.optional(),
    /**
     * Dashboard multi-project registry (SPEC-078 D3). Absent → registry-less
     * single-project mode, unchanged from pre-SPEC-078 behavior (R-15).
     */
    dashboard: DashboardConfigSchema.optional(),
  })
  .strict();

/** Validated global Lore config. All fields optional. */
export type GlobalLoreConfig = z.infer<typeof GlobalLoreConfigSchema>;

// ─── Sync Section Schema ───────────────────────────────────────────────────

/**
 * Sync configuration section (optional).
 * D-007: when enabled=true, remote_url MUST be present (TursoStore selection).
 * D-004: auth_token_env is an env-var NAME — never the plaintext token.
 */
const SyncConfigSchema = z
  .object({
    enabled: z.boolean(),
    remote_url: z.string().startsWith("libsql://").optional(),
    auth_token_env: z.string().default("LORE_SYNC_TOKEN"),
    interval: z.number().int().positive().default(60),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.enabled && data.remote_url === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "remote_url is required when sync.enabled is true (D-007)",
        path: ["remote_url"],
      });
    }
  });

// ─── Workflow Section Schema ───────────────────────────────────────────────

/**
 * Per-checkpoint override for `lore gate` (IoC vertical-slice tech-spec §4.1/§11).
 * `enabled` is OPTIONAL — its absence (and the absence of the whole `gates` map, and
 * the absence of the whole `workflow` section) all mean "enabled", which is what keeps
 * a pre-existing `.lore/config.yaml` with no `workflow.gates` key gating exactly as it
 * did before this field existed (no breaking change).
 */
const GateCheckpointConfigSchema = z
  .object({
    /** `false` disables this checkpoint entirely; absent or `true` leaves it enabled. */
    enabled: z.boolean().optional(),
    /**
     * `task-claim`-ONLY sub-predicate override (SPEC-042 §Design Decisions D6) —
     * `false` disables JUST the anchor-overlap predicate, leaving upstream-approval
     * (and every other checkpoint's own `enabled` key) untouched. Inert on
     * `spec-create`/`spec-promote`/`plan-promote` (no checkpoint reads it there) —
     * a narrower blast radius than the whole-checkpoint `enabled` key above, which
     * would also take upstream-approval gating down with it.
     */
    anchor_overlap: z.object({ enabled: z.boolean().optional() }).strict().optional(),
    /**
     * `spec-create`/`spec-promote` sub-predicate override (AC-Quantifiability Gate
     * spec §Design) — `false` disables JUST the `acQuantifiable` predicate on the
     * checkpoint it's nested under, leaving that checkpoint's other predicates
     * (skeleton/parent/spec_kind on spec-create; declared-AC-count on spec-promote)
     * untouched. Inert on `plan-promote`/`task-claim` (neither checkpoint reads it) —
     * same narrower-blast-radius shape as `anchor_overlap` above.
     */
    ac_quantifiable: z.object({ enabled: z.boolean().optional() }).strict().optional(),
    /**
     * `spec-promote`-ONLY sub-predicate override (SPEC-058 §Design Decisions D5) —
     * `false` disables JUST the `oracleCoverage` predicate (per-spec_kind oracle-
     * coverage floor), leaving spec-promote's declared-AC-count and
     * `ac_quantifiable` checks untouched. Inert on every other checkpoint.
     */
    oracle_coverage: z.object({ enabled: z.boolean().optional() }).strict().optional(),
    /**
     * `plan-promote`-ONLY sub-predicate override (SPEC-058 §Design Decisions D5) —
     * `false` disables JUST the `requiresUat` predicate (a plan under a spec_kind
     * whose profile declares `required_uat: true` must itself declare
     * `extra.requires_uat: true`), leaving upstream-approval/AC-declared gating
     * untouched. Inert on every other checkpoint.
     */
    requires_uat: z.object({ enabled: z.boolean().optional() }).strict().optional(),
  })
  .strict();

/**
 * Task execution workflow configuration (SPEC-025) + gate enable/disable overrides.
 * Controls the advisory claim-lease TTL consumed by TaskWorkflowService, and (per
 * checkpoint) whether `lore gate` even runs its predicates.
 *
 * @invariant claim_ttl_minutes defaults to 120 — an order of magnitude above
 *   realistic clock skew between machines (SPEC-025 §5 risk table).
 * @invariant handoff_ttl_minutes defaults to 10080 (7 days) — a SPEC-041 §3 D5 handoff
 *   is a session-continuity artifact, not a work lease; a week-old handoff is still
 *   likely useful context but `SessionService.resume` surfaces a `ttl_warning` past
 *   this threshold so a stale handoff is never silently treated as current. Mirrors
 *   `claim_ttl_minutes`'s "computed read-side, no daemon" shape (D3 no-daemon ethos).
 * @invariant `gates` is keyed by `GateCheckpoint` id (`"spec-create" | "spec-promote" |
 *   "plan-promote" | "task-claim"`, `packages/lore/src/service/checkpoint-registry.ts`)
 *   but typed here as a generic `Record<string, ...>` — this module MUST NOT import
 *   from `packages/lore` (leaf-of-dependency-graph invariant, `packages/core/src/CLAUDE.md`).
 *   An unknown key here is NOT a Zod validation error — it is inert (no checkpoint reads
 *   it) — only the four real checkpoint ids have any effect. This mirrors `sync`/`ai`
 *   sections in that unrecognized *nested* keys inside `gates.<key>` are still rejected
 *   by `.strict()`, but the checkpoint-id key itself is intentionally permissive.
 */
const WorkflowConfigSchema = z
  .object({
    /** Minutes after which an unrefreshed claim becomes stale and reclaimable. */
    claim_ttl_minutes: z.number().int().positive().default(120),
    /** Minutes after which a handoff doc is flagged stale by `SessionService.resume`. */
    handoff_ttl_minutes: z.number().int().positive().default(10080),
    /** Per-checkpoint `lore gate` enable/disable overrides. Absent → all enabled. */
    gates: z.record(z.string(), GateCheckpointConfigSchema).optional(),
    /**
     * Staleness-probe behavioral knobs (SPEC-044 §Design Decisions D8) — the DEFAULT
     * batch size and minimum-age threshold `lore review --staleness` applies when the
     * corresponding CLI flags (`--limit`/`--min-age-days`) are omitted. Nested under
     * `workflow` (not `ai`) because these gate CANDIDATE SELECTION (a corpus-shape
     * concern, like `claim_ttl_minutes`), not prompt content — mirrors the `ai.staleness.*`
     * / `workflow.staleness.*` split named explicitly in D8.
     */
    staleness: z
      .object({
        /** Default `--limit` when omitted. Default: 5. */
        default_limit: z.number().int().positive().default(5),
        /** Default `--min-age-days` when omitted (INCLUSIVE boundary, D1). Default: 14. */
        min_age_days: z.number().int().nonnegative().default(14),
      })
      .strict()
      .default({}),
    /**
     * Doc-code drift oracle config brake (SPEC-045 §Design Decisions D8) — when
     * `false`, `lore status --check-drift` exits 0 with an explicit `disabled` note
     * (LOUD skip, never a silent no-op) instead of probing the filesystem. Absence
     * of the whole `workflow` section, or of `drift` within it, both mean enabled —
     * same "absence = default-on" shape as every other `workflow.*` sub-section.
     */
    drift: z
      .object({
        /** `false` disables `--check-drift` filesystem probing entirely. Default: true. */
        enabled: z.boolean().default(true),
      })
      .strict()
      .default({}),
    /**
     * Per-`spec_kind` verification-profile floors (SPEC-058 §Design Decisions D1) —
     * each entry declares the oracle-coverage requirement (spec-promote's
     * `oracleCoverage` predicate) and/or UAT requirement (plan-promote's
     * `requiresUat` predicate) that `spec_kind` demands. Absence of the whole
     * `workflow` section, or of `verification_profiles` within it, or of a
     * specific `spec_kind`'s entry, ALL mean "unconfigured" for that spec_kind —
     * both predicates vacuous-pass (non-breaking for every existing corpus,
     * `resolveVerificationProfile` returns `null`). Only an EXPLICIT profile
     * entry activates either predicate for that spec_kind.
     */
    verification_profiles: z.record(z.enum(SPEC_KINDS), verificationProfileSchema).optional(),
    /**
     * Requirement-layer quantifiability lint config brake (SPEC-059 §Scope) — when
     * `false`, `RequirementService.addRequirement` skips the `lintStatement` lint
     * entirely and a vague requirement statement is accepted (pre-SPEC-059
     * behavior). Absence of the whole `workflow` section, or of
     * `requirement_quantifiable` within it, both mean enabled — same
     * "absence = default-on" shape as `drift`/`ac_quantifiable` above. NOT a
     * `lore gate` checkpoint sub-predicate (there is no `requirement-create`
     * checkpoint, §Design Option B rejected) — a standalone top-level section,
     * mirroring `drift`'s shape rather than `gates.<checkpoint>.*`.
     */
    requirement_quantifiable: z
      .object({
        /** `false` disables the requirement-statement quantifiability lint entirely. Default: true. */
        enabled: z.boolean().default(true),
      })
      .strict()
      .default({}),
    /**
     * `plan-close`'s execution-time attestation-floor sub-predicate config
     * (SPEC-069 §Design Decisions D1) — the minimum plan-wide fraction of a
     * closing plan's `verification_evidence` entries (aggregated across every
     * task) that must be runner-issued (`attestation` present) before the plan
     * may transition to `archived`. Nested under `workflow` (not
     * `gates.<checkpoint>`) because it is a NUMBER, not an `enabled` toggle —
     * `GateCheckpointConfigSchema`'s existing sub-predicate shape only carries
     * boolean switches; whether the predicate runs AT ALL is still
     * `workflow.gates."plan-close".enabled` (the whole-checkpoint knob,
     * unchanged). Absence of the whole `workflow` section, or of `attestation`
     * within it, both fall back to the schema default (0.5) — same
     * "absence = default floor" shape as `staleness`/`drift` above.
     */
    attestation: z
      .object({
        /** Minimum plan-wide attested-evidence ratio required to close. Default: 0.5. */
        min_ratio: z.number().min(0).max(1).default(0.5),
      })
      .strict()
      .default({}),
    /**
     * `lore feed task-start <task>`'s per-section character budgets (SPEC-070
     * §Design Decisions D5) — the FIRST feed-pack budget config actually wired end
     * to end (the `phase_feed` precedent's equivalent comment was aspirational and
     * was never consumed by any code path; this one is read by
     * `adapters/cli/task-feed-wiring.ts::resolveTaskStartBudgets` on every `lore
     * feed task-start` / `lore_feed {checkpoint: "task-start"}` call).
     *
     * @invariant Every field is OPTIONAL with NO Zod-level default (deliberately —
     *   the flow-owned `DEFAULT_TASK_START_BUDGETS` constant in
     *   `flows/task-feed-flow.ts` is the SOLE default source; duplicating numeric
     *   defaults here would risk the two silently drifting apart). Absence of the
     *   whole `workflow` section, or of `task_feed` within it, or of an individual
     *   field, all mean "use the flow's own default for that section" —
     *   `buildTaskStartPack`'s `{ ...DEFAULT_TASK_START_BUDGETS, ...budgets }` merge
     *   handles the fill-in.
     * @invariant An out-of-range value (non-positive, non-integer) fails loud at
     *   config parse time (the existing `loadLoreApp` Zod-parse path) — never a
     *   silently-ignored bad override.
     */
    task_feed: z
      .object({
        max_objective_chars: z.number().int().positive().optional(),
        max_acceptance_chars: z.number().int().positive().optional(),
        max_constraints_chars: z.number().int().positive().optional(),
        max_boundaries_chars: z.number().int().positive().optional(),
        max_claim_chars: z.number().int().positive().optional(),
        max_plan_state_chars: z.number().int().positive().optional(),
        max_knowledge_chars: z.number().int().positive().optional(),
        max_handoff_chars: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Task execution workflow config section. Source: SPEC-025 §3 D2; `gates` added for gate on/off overrides. */
export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;

// ─── Audit Section Schema ───────────────────────────────────────────────────

/**
 * Audit completeness-oracle configuration (SPEC-035 §2 D5).
 * `verify_since` is the watermark `lore audit --verify` anchors its versions⋈audit
 * reconcile walk to — versions rows older than this are known-historical holes
 * (pre-SPEC-035 TaskWorkflow silence, v1-migration imports) and are never reported
 * as misses, so the oracle is strict going forward without permanently failing on
 * data that predates audit-writer coverage.
 *
 * @invariant Default is the SPEC-035 deploy date (2026-07-06) — every audit writer
 *   upgraded by this spec is live from that point forward, so the default watermark
 *   already makes `--verify` meaningful with zero config.
 */
const AuditConfigSchema = z
  .object({
    /** ISO 8601 — versions rows before this timestamp are excluded from --verify. */
    verify_since: z.string().default("2026-07-06T00:00:00Z"),
  })
  .strict();

/** Audit completeness-oracle config section. Source: SPEC-035 §2 D5. */
export type AuditConfig = z.infer<typeof AuditConfigSchema>;

// ─── Feedback Section Schema ────────────────────────────────────────────────

/**
 * Upstream issue-reporting configuration (SPEC-072 §4 Public Interface) —
 * consent to file `lore report-issue` reports into a configured upstream
 * corpus. Mirrors `SyncConfigSchema`'s nesting shape (a `.strict()` object
 * nested one level under its own top-level section, both levels `.strict()`
 * so a typo fails loud at config-parse time rather than silently no-opping).
 *
 * @invariant `upstream` is OPTIONAL — its absence means "not configured",
 *   which `IssueReportService`'s §5 check-sequence step 1 treats as a
 *   fail-loud `VALIDATION_ERROR` naming BOTH `corpus_path` and `root_prd`
 *   (configuring this section IS the consent act, SPEC-072 Overview) — there
 *   is no partial/silent-degrade state.
 * @invariant Both `corpus_path` and `root_prd` are REQUIRED once `upstream`
 *   is present — there is no meaningful default for either (a missing
 *   `corpus_path` names no filesystem location to probe; a missing
 *   `root_prd` disables the R-5a identity-pin check entirely).
 * @invariant `root_prd` accepts EITHER the upstream root PRD's slug or its
 *   id (see `issue-report.ts::matchRootPrd`) — deliberately untyped as a
 *   plain non-empty string rather than two separate optional fields, since
 *   the consumer author only ever knows one or the other at config time.
 */
export const FeedbackConfigSchema = z
  .object({
    upstream: z
      .object({
        /** Absolute path to the upstream repo ROOT (the shape `lore init` produces — a `.lore/lore.db` lives directly under it). */
        corpus_path: z.string().min(1),
        /** Expected upstream root-PRD slug OR id (R-5a identity pin, SPEC-072 §5 step 5). */
        root_prd: z.string().min(1),
        // P2 seam (named, NOT implemented, SPEC-072 §Extension Seams):
        // transport: z.enum(["sqlite","http"]).default("sqlite")
      })
      .strict()
      .optional(),
  })
  .strict();

/** Upstream issue-reporting config section. Source: SPEC-072 §4 Public Interface. */
export type FeedbackConfig = z.infer<typeof FeedbackConfigSchema>;

// ─── Verify Section Schema ──────────────────────────────────────────────────

/**
 * Trusted-runner env-passthrough configuration (SPEC-039 §M2 trust-hardening,
 * env allowlist). Default behavior (this section absent, or present with its
 * own defaults) is HARDENED: only an allowlisted set of env vars reaches a
 * spawned verify command (`DEFAULT_VERIFY_ENV_ALLOWLIST` in
 * `packages/lore/src/service/verify-spawn.ts`) — secrets like
 * `LORE_SYNC_TOKEN`/`LORE_API_KEY` do NOT reach the command by default.
 *
 * @invariant `allowlist` is ADDITIVE — entries are appended to (never replace)
 *   the built-in default allowlist.
 * @invariant `passthrough_all: true` is the escape hatch that restores the
 *   pre-hardening behavior (full `process.env` passthrough, unfiltered) — when
 *   set, `allowlist` is not consulted at all.
 */
const VerifyEnvConfigSchema = z
  .object({
    /** Additional env var names allowed through, appended to the built-in default set. */
    allowlist: z.array(z.string()).default([]),
    /** true restores full env passthrough (pre-M2-hardening behavior) — bypasses the allowlist entirely. */
    passthrough_all: z.boolean().default(false),
  })
  .strict();

/** Trusted-runner env-passthrough config section. Source: SPEC-039 §M2. */
export type VerifyEnvConfig = z.infer<typeof VerifyEnvConfigSchema>;

/**
 * Trusted-runner (`lore verify`) configuration (SPEC-039 §2 D9; §M2 trust-hardening).
 * Independent `verify.*` section, mirroring the `audit.*` precedent above rather
 * than nesting under `workflow` — the two features (claim leases vs. spawn-and-
 * attest) share no config fields today and evolve independently.
 *
 * @invariant `default_timeout_ms` is consulted ONLY when a script-mode AC's own
 *   `verify.timeout_ms` (acceptance.ts) is absent — the AC-level field always wins.
 * @invariant `require_command_approval` (SPEC-039 §M2, default `true`) is the
 *   command-provenance approval gate's on/off switch. `false` restores the
 *   pre-M2-hardening behavior (any declared command runs without approval,
 *   same as before this hardening pass).
 */
const VerifyConfigSchema = z
  .object({
    /** Default spawn timeout in ms, used when an AC's verify.script omits timeout_ms. */
    default_timeout_ms: z.number().int().positive().default(300_000),
    /** Env-passthrough allowlist configuration (SPEC-039 §M2). */
    env: VerifyEnvConfigSchema.default({}),
    /** Command-provenance approval gate on/off (SPEC-039 §M2). Default true (hardened). */
    require_command_approval: z.boolean().default(true),
  })
  .strict();

/** Trusted-runner verify config section. Source: SPEC-039 §2 D9; §M2. */
export type VerifyConfig = z.infer<typeof VerifyConfigSchema>;

// ─── Setup Section Schema ───────────────────────────────────────────────────

/**
 * `lore setup` distribution-convergence configuration (SPEC-076 §C6, D5) —
 * currently a single boolean switch consulted by the session-start hook's
 * Phase F cache-first freshness advisory (`assets/hooks/session-start-resume.mjs`).
 *
 * @invariant `check_reminder` default `true` mirrors D5's "3-5 person single
 *   distributor" scope decision to reject a three-state auto/reminder/disabled
 *   config surface in favor of ONE boolean kill-switch — the second, sharper
 *   switch is the `LORE_SETUP_NO_CHECK=1` env var, checked by the hook BEFORE
 *   any cache read at all (env always wins, config is the softer opt-out).
 * @invariant Additive/self-contained — see the hook's own Phase F header
 *   comment for the documented Scope-Alt on WHY the installed standalone hook
 *   script (a plain `node <path>` invocation with no guaranteed local
 *   `node_modules`, hence no `yaml` parser reachable) does not itself read
 *   `.lore/config.yaml` to consult this field today. This schema addition is
 *   the config-surface half of SPEC-076's `setup.check_reminder` deliverable;
 *   a future CLI-side consumer (`lore setup --check`, out of this task's file
 *   anchors — see `setup-check.ts`) is the intended enforcement point once
 *   that module is not concurrently claimed by a sibling task.
 */
const SetupConfigSchema = z
  .object({
    /** `false` suppresses the session-start hook's freshness advisory entirely. Default: true. */
    check_reminder: z.boolean().default(true),
  })
  .strict();

/** `lore setup` distribution-convergence config section. Source: SPEC-076 §C6, D5. */
export type SetupConfig = z.infer<typeof SetupConfigSchema>;

// ─── Root Config Schema ────────────────────────────────────────────────────

/**
 * Full LoreConfig schema.
 * strict() rejects unknown top-level keys.
 * sync section is optional — absence means local-only mode.
 */
export const LoreConfigSchema = z
  .object({
    project: z
      .object({
        name: z.string(),
        author: z.string(),
      })
      .strict(),
    sync: SyncConfigSchema.optional(),
    /**
     * Telemetry configuration (SPEC-012).
     * When absent, defaults to enabled=false (no file side effects).
     * Set enabled: true to start writing .lore/telemetry.jsonl.
     */
    telemetry: TelemetryConfigSchema.optional(),
    /**
     * Per-project CLI defaults (editor, format, color).
     * When set, overrides global defaults from ~/.config/lore/config.yaml.
     * Project defaults are CLI-scoped — NOT forwarded to createApp.
     */
    defaults: LoreDefaultsSchema.optional(),
    /**
     * AI provider configuration (SPEC-017).
     * When absent, createApp uses AiConfigSchema.parse({}) defaults (claude-cli provider).
     * NOT stripped by loadLoreApp — forwarded to createApp alongside telemetry config.
     * .strict() on AiConfigSchema rejects typos at load time (AC-AI-12).
     */
    ai: AiConfigSchema.optional(),
    /**
     * Task execution workflow configuration (SPEC-025).
     * When absent, createApp uses WorkflowConfigSchema.parse({}) defaults (120min TTL).
     */
    workflow: WorkflowConfigSchema.optional(),
    /**
     * Audit completeness-oracle configuration (SPEC-035).
     * When absent, createApp uses AuditConfigSchema.parse({}) defaults
     * (verify_since = SPEC-035 deploy date).
     */
    audit: AuditConfigSchema.optional(),
    /**
     * Trusted-runner (`lore verify`) configuration (SPEC-039).
     * When absent, createApp uses VerifyConfigSchema.parse({}) defaults
     * (default_timeout_ms = 300000).
     */
    verify: VerifyConfigSchema.optional(),
    /**
     * Upstream issue-reporting configuration (SPEC-072).
     * When absent, `lore report-issue` fails loud (VALIDATION_ERROR naming
     * both `feedback.upstream.corpus_path` and `feedback.upstream.root_prd`)
     * — there is no AI-provider-style "defaults to a built-in behavior"
     * fallback, since configuring this section IS the consent act.
     */
    feedback: FeedbackConfigSchema.optional(),
    /**
     * `lore setup` distribution-convergence configuration (SPEC-076 §C6, D5).
     * When absent, `resolveSetupCheckReminderEnabled` returns the schema
     * default (`true` — advisory enabled).
     */
    setup: SetupConfigSchema.optional(),
  })
  .strict();

export type LoreConfig = z.infer<typeof LoreConfigSchema>;

/**
 * Resolve the effective claim TTL in minutes from an optional LoreConfig.
 * Mirrors the `aiConfig = config?.ai ?? AiConfigSchema.parse({})` pattern used
 * elsewhere in createApp — absence of the whole config or the workflow section
 * both fall back to the schema default (120).
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns Effective claim_ttl_minutes value
 * @example
 *   resolveClaimTtlMinutes(undefined) // => 120
 *   resolveClaimTtlMinutes({ ..., workflow: { claim_ttl_minutes: 30 } }) // => 30
 */
export function resolveClaimTtlMinutes(config: LoreConfig | undefined): number {
  return (config?.workflow ?? WorkflowConfigSchema.parse({})).claim_ttl_minutes;
}

/**
 * Resolve the effective handoff TTL in minutes from an optional LoreConfig. Mirrors
 * {@link resolveClaimTtlMinutes} exactly — absence of the whole config or the
 * `workflow` section both fall back to the schema default (10080 = 7 days).
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns Effective handoff_ttl_minutes value
 * @example
 *   resolveHandoffTtlMinutes(undefined) // => 10080
 *   resolveHandoffTtlMinutes({ ..., workflow: { handoff_ttl_minutes: 1440 } }) // => 1440
 */
export function resolveHandoffTtlMinutes(config: LoreConfig | undefined): number {
  return (config?.workflow ?? WorkflowConfigSchema.parse({})).handoff_ttl_minutes;
}

/**
 * Resolve whether a given `lore gate` checkpoint is enabled, per
 * `workflow.gates.<checkpoint>.enabled`. Absence of the whole config, the `workflow`
 * section, the `gates` map, or the per-checkpoint entry ALL mean "enabled" — only an
 * EXPLICIT `enabled: false` disables a checkpoint. This keeps every pre-existing
 * `.lore/config.yaml` (written before this field existed) gating exactly as before.
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @param checkpoint - Gate checkpoint id (e.g. `"task-claim"`). Typed as a plain
 *   `string` because `@lore/core` does not import `GateCheckpoint` from
 *   `packages/lore/src/service/checkpoint-registry.ts` (leaf-of-dependency-graph
 *   invariant) — callers pass their own `GateCheckpoint` value, which structurally
 *   satisfies `string`.
 * @returns `false` iff `workflow.gates.<checkpoint>.enabled === false`; `true` otherwise
 * @example
 *   resolveGateEnabled(undefined, "task-claim") // => true
 *   resolveGateEnabled({ project, workflow: {} }, "task-claim") // => true (no gates map)
 *   resolveGateEnabled(
 *     { project, workflow: { gates: { "task-claim": { enabled: false } } } },
 *     "task-claim",
 *   ) // => false
 */
/**
 * Module-level "have we already warned about THIS legacy config object" set
 * for the `phase-claim` legacy-key alias (SPEC-056 §Design Decisions D7) —
 * deliberately NOT a per-call flag (repeated calls resolving the SAME legacy
 * config object emit the deprecation notice only once), but also NOT a single
 * eternal boolean (a DIFFERENT legacy config object — e.g. a distinct
 * `.lore/config.yaml` load, or a distinct test fixture — gets its own one-time
 * warning; a process/test file that legitimately resolves several distinct
 * legacy configs is not silently muted after the very first one). Keyed on
 * the resolved `gates."task-claim"` sub-object's REFERENCE (not a structural
 * hash) — the cheapest identity that's stable across repeated calls with the
 * same config, keyed via `WeakSet` so it never leaks memory for a config
 * object no longer referenced elsewhere. This is `resolveGateEnabled`'s ONE
 * narrow, deliberate exception to this module's otherwise side-effect-free
 * contract (see that function's own JSDoc) — the alternative (threading a
 * warning collector through every one of its ~6 unrelated call sites) is the
 * "scattered" shape D7 explicitly rejects.
 */
const phaseClaimAliasWarned = new WeakSet<object>();

export function resolveGateEnabled(
  config: LoreConfig | undefined,
  checkpoint: string,
): boolean {
  const gates = config?.workflow?.gates;
  // SPEC-056 §Design Decisions D7 — "the ONE dual-read site": a "phase-claim"
  // lookup with NO explicit "phase-claim" entry falls back to the legacy
  // "task-claim" entry when ONE IS present, logging a one-time (per legacy
  // config object) deprecation notice. An explicit "phase-claim" entry always
  // wins outright (never consults the legacy key at all, even when both are
  // present) — checked FIRST below via the untouched generic path.
  if (checkpoint === "phase-claim" && gates?.["phase-claim"] === undefined) {
    const legacy = gates?.["task-claim"];
    if (legacy !== undefined) {
      if (!phaseClaimAliasWarned.has(legacy)) {
        phaseClaimAliasWarned.add(legacy);
        // reason: side-effect explicitly documented on `phaseClaimAliasWarned`'s
        // own JSDoc above — this is the ONE dual-read site D7 calls for, not a
        // pattern to replicate elsewhere in this module.
        console.warn(
          'lore: workflow.gates."task-claim" is deprecated for the phase doc type — ' +
            'rename to workflow.gates."phase-claim" in .lore/config.yaml (SPEC-056).',
        );
      }
      return legacy.enabled !== false;
    }
  }
  return gates?.[checkpoint]?.enabled !== false;
}

/**
 * Resolve whether `task-claim`'s anchor-overlap sub-predicate specifically is
 * enabled, per `workflow.gates."task-claim".anchor_overlap.enabled` (SPEC-042 D6).
 * Narrower than {@link resolveGateEnabled}`(config, "task-claim")`, which governs
 * the WHOLE checkpoint (anchor-overlap AND upstream-approval together). Absence
 * of the whole config, the `workflow` section, the `gates` map, the `task-claim`
 * entry, or the nested `anchor_overlap` key ALL mean "enabled" — only an EXPLICIT
 * `anchor_overlap.enabled: false` disables just this predicate.
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns `false` iff `workflow.gates."task-claim".anchor_overlap.enabled === false`; `true` otherwise
 * @example
 *   resolveAnchorOverlapGateEnabled(undefined) // => true
 *   resolveAnchorOverlapGateEnabled({
 *     project, workflow: { gates: { "task-claim": { anchor_overlap: { enabled: false } } } },
 *   }) // => false
 */
export function resolveAnchorOverlapGateEnabled(config: LoreConfig | undefined): boolean {
  return config?.workflow?.gates?.["task-claim"]?.anchor_overlap?.enabled !== false;
}

/**
 * Resolve whether `checkpoint`'s `acQuantifiable` sub-predicate specifically is
 * enabled, per `workflow.gates.<checkpoint>.ac_quantifiable.enabled` (AC-Quantifiability
 * Gate spec §Design). Narrower than {@link resolveGateEnabled}`(config, checkpoint)`,
 * which governs the WHOLE checkpoint. Unlike {@link resolveAnchorOverlapGateEnabled}
 * (hardcoded to `"task-claim"`), this predicate is wired on TWO checkpoints
 * (`spec-create` and `spec-promote`), so `checkpoint` is a parameter here rather than
 * baked in. Absence of the whole config, the `workflow` section, the `gates` map, the
 * per-checkpoint entry, or the nested `ac_quantifiable` key ALL mean "enabled" — only
 * an EXPLICIT `ac_quantifiable.enabled: false` disables just this predicate.
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @param checkpoint - Gate checkpoint id (e.g. `"spec-create"`). Typed as a plain
 *   `string` for the same leaf-of-dependency-graph reason {@link resolveGateEnabled}
 *   documents.
 * @returns `false` iff `workflow.gates.<checkpoint>.ac_quantifiable.enabled === false`;
 *   `true` otherwise
 * @example
 *   resolveAcQuantifiableGateEnabled(undefined, "spec-create") // => true
 *   resolveAcQuantifiableGateEnabled({
 *     project, workflow: { gates: { "spec-create": { ac_quantifiable: { enabled: false } } } },
 *   }, "spec-create") // => false
 */
export function resolveAcQuantifiableGateEnabled(
  config: LoreConfig | undefined,
  checkpoint: string,
): boolean {
  return config?.workflow?.gates?.[checkpoint]?.ac_quantifiable?.enabled !== false;
}

/**
 * Resolve whether `spec-promote`'s `oracleCoverage` sub-predicate specifically is
 * enabled, per `workflow.gates."spec-promote".oracle_coverage.enabled` (SPEC-058
 * §Design Decisions D5). Narrower than {@link resolveGateEnabled}`(config,
 * "spec-promote")`, which governs the WHOLE checkpoint. Hardcoded to
 * `"spec-promote"` (mirrors {@link resolveAnchorOverlapGateEnabled}'s single-
 * checkpoint shape) — SPEC-058 wires this predicate on exactly one checkpoint
 * (§Design Decisions D2: spec-promote, not spec-create).
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns `false` iff `workflow.gates."spec-promote".oracle_coverage.enabled === false`; `true` otherwise
 * @example
 *   resolveOracleCoverageGateEnabled(undefined) // => true
 *   resolveOracleCoverageGateEnabled({
 *     project, workflow: { gates: { "spec-promote": { oracle_coverage: { enabled: false } } } },
 *   }) // => false
 */
export function resolveOracleCoverageGateEnabled(config: LoreConfig | undefined): boolean {
  return config?.workflow?.gates?.["spec-promote"]?.oracle_coverage?.enabled !== false;
}

/**
 * Resolve whether `plan-promote`'s `requiresUat` sub-predicate specifically is
 * enabled, per `workflow.gates."plan-promote".requires_uat.enabled` (SPEC-058
 * §Design Decisions D5). Narrower than {@link resolveGateEnabled}`(config,
 * "plan-promote")`, which governs the WHOLE checkpoint (`requiresUat` AND
 * upstream-approval/AC-declared gating together). Hardcoded to `"plan-promote"`
 * (mirrors {@link resolveAnchorOverlapGateEnabled}'s single-checkpoint shape).
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns `false` iff `workflow.gates."plan-promote".requires_uat.enabled === false`; `true` otherwise
 * @example
 *   resolveRequiresUatGateEnabled(undefined) // => true
 *   resolveRequiresUatGateEnabled({
 *     project, workflow: { gates: { "plan-promote": { requires_uat: { enabled: false } } } },
 *   }) // => false
 */
export function resolveRequiresUatGateEnabled(config: LoreConfig | undefined): boolean {
  return config?.workflow?.gates?.["plan-promote"]?.requires_uat?.enabled !== false;
}

/**
 * Resolve the effective audit-verify watermark (ISO 8601 string) from an optional
 * LoreConfig. Mirrors {@link resolveClaimTtlMinutes} — absence of the whole config
 * or the audit section both fall back to the schema default (SPEC-035 deploy date).
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns Effective audit.verify_since value
 * @example
 *   resolveAuditVerifySince(undefined) // => "2026-07-06T00:00:00Z"
 *   resolveAuditVerifySince({ ..., audit: { verify_since: "2026-08-01T00:00:00Z" } })
 *   // => "2026-08-01T00:00:00Z"
 */
export function resolveAuditVerifySince(config: LoreConfig | undefined): string {
  return (config?.audit ?? AuditConfigSchema.parse({})).verify_since;
}

/**
 * Resolve the effective trusted-runner default spawn timeout (ms) from an optional
 * LoreConfig. Mirrors {@link resolveAuditVerifySince} — absence of the whole config
 * or the verify section both fall back to the schema default (300000ms).
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns Effective verify.default_timeout_ms value
 * @example
 *   resolveVerifyDefaultTimeoutMs(undefined) // => 300000
 *   resolveVerifyDefaultTimeoutMs({ ..., verify: { default_timeout_ms: 60000 } }) // => 60000
 */
export function resolveVerifyDefaultTimeoutMs(config: LoreConfig | undefined): number {
  return (config?.verify ?? VerifyConfigSchema.parse({})).default_timeout_ms;
}

/**
 * Resolve the effective trusted-runner env-passthrough config from an optional
 * LoreConfig (SPEC-039 §M2). Mirrors {@link resolveVerifyDefaultTimeoutMs} —
 * absence of the whole config or the `verify`/`verify.env` sections all fall
 * back to the hardened schema defaults (`allowlist: []`, `passthrough_all: false`).
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns Effective `verify.env` value
 * @example
 *   resolveVerifyEnvConfig(undefined) // => { allowlist: [], passthrough_all: false }
 *   resolveVerifyEnvConfig({ ..., verify: { env: { passthrough_all: true } } })
 *   // => { allowlist: [], passthrough_all: true }
 */
export function resolveVerifyEnvConfig(config: LoreConfig | undefined): VerifyEnvConfig {
  return (config?.verify ?? VerifyConfigSchema.parse({})).env;
}

/**
 * Resolve whether the command-provenance approval gate is enabled (SPEC-039 §M2)
 * from an optional LoreConfig. Mirrors {@link resolveVerifyDefaultTimeoutMs} —
 * absence of the whole config or the `verify` section falls back to the hardened
 * schema default (`true`).
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns Effective `verify.require_command_approval` value
 * @example
 *   resolveVerifyRequireCommandApproval(undefined) // => true
 *   resolveVerifyRequireCommandApproval({ ..., verify: { require_command_approval: false } })
 *   // => false
 */
export function resolveVerifyRequireCommandApproval(config: LoreConfig | undefined): boolean {
  return (config?.verify ?? VerifyConfigSchema.parse({})).require_command_approval;
}

/**
 * Resolve the effective staleness-probe defaults (`{default_limit, min_age_days}`) from
 * an optional LoreConfig. Mirrors {@link resolveClaimTtlMinutes} — absence of the whole
 * config or the `workflow` section (or `workflow.staleness` specifically) falls back to
 * the schema defaults (5 / 14).
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns `{default_limit, min_age_days}` — CLI `--limit`/`--min-age-days` override
 *   these per-invocation only; this function never reads the CLI flags itself
 * @example
 *   resolveStalenessDefaults(undefined) // => { default_limit: 5, min_age_days: 14 }
 *   resolveStalenessDefaults({ ..., workflow: { staleness: { min_age_days: 30 } } })
 *   // => { default_limit: 5, min_age_days: 30 }
 */
export function resolveStalenessDefaults(
  config: LoreConfig | undefined,
): { default_limit: number; min_age_days: number } {
  return (config?.workflow ?? WorkflowConfigSchema.parse({})).staleness;
}

/**
 * Resolve the effective `workflow.drift.enabled` config brake (SPEC-045 §Design
 * Decisions D8) from an optional LoreConfig. Mirrors {@link resolveStalenessDefaults}
 * — absence of the whole config, the `workflow` section, or `workflow.drift`
 * specifically all fall back to the schema default (`true`).
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns Effective `workflow.drift.enabled` value
 * @example
 *   resolveDriftEnabled(undefined) // => true
 *   resolveDriftEnabled({ ..., workflow: { drift: { enabled: false } } }) // => false
 */
export function resolveDriftEnabled(config: LoreConfig | undefined): boolean {
  return (config?.workflow ?? WorkflowConfigSchema.parse({})).drift.enabled;
}

/**
 * Resolve the effective `workflow.attestation.min_ratio` floor (SPEC-069 §Design
 * Decisions D1) from an optional LoreConfig. Absence of the whole config, the
 * `workflow` section, or `workflow.attestation` specifically all fall back to the
 * schema default (0.5).
 *
 * Deliberately fully-optional-chained (`config?.workflow?.attestation?.min_ratio`)
 * rather than {@link resolveDriftEnabled}'s `config?.workflow ?? schemaDefault`
 * shape: that shape assumes a PRESENT `config.workflow` is always the FULL,
 * schema-validated `WorkflowConfig` (true for every production config, which is
 * always routed through `LoreConfigSchema.parse` before reaching a service) — but
 * several pre-existing test harnesses across this codebase hand-build a raw
 * `{workflow: {gates: {...}}} as unknown as LoreConfig` literal that deliberately
 * OMITS every other `workflow.*` sub-section to keep the fixture terse (e.g.
 * `requires-uat-gate.test.ts`'s `configWithDesignRequiresUat`). Reaching this
 * predicate's caller (`GateEnforcer.resolveAttestationMinRatio`, now on the
 * `plan-close` checkpoint's ALWAYS-evaluated attestation-floor sub-predicate,
 * unlike the narrower sub-knobs those other `resolve*` functions serve) with such
 * a fixture must degrade to the default, not throw on `.attestation` being
 * `undefined`.
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns Effective `workflow.attestation.min_ratio` value
 * @example
 *   resolveAttestationMinRatio(undefined) // => 0.5
 *   resolveAttestationMinRatio({ ..., workflow: { attestation: { min_ratio: 0.3 } } }) // => 0.3
 *   resolveAttestationMinRatio({ ..., workflow: { gates: {} } } as LoreConfig) // => 0.5 (no throw)
 */
export function resolveAttestationMinRatio(config: LoreConfig | undefined): number {
  return config?.workflow?.attestation?.min_ratio ?? WorkflowConfigSchema.parse({}).attestation.min_ratio;
}

/**
 * Resolve the effective `workflow.requirement_quantifiable.enabled` config brake
 * (SPEC-059 §Scope) from an optional LoreConfig. Absence of the whole config, the
 * `workflow` section, `workflow.requirement_quantifiable`, or its `enabled` key ALL
 * mean "enabled" — only an EXPLICIT `enabled: false` disables the lint. Uses FULL
 * optional chaining (mirrors {@link resolveGateEnabled}/{@link
 * resolveAcQuantifiableGateEnabled}'s `!== false` style) rather than {@link
 * resolveDriftEnabled}'s "assume the whole `workflow` object is Zod-shaped" shortcut
 * — this resolver is called UNCONDITIONALLY inside `createApp` (unlike
 * `resolveDriftEnabled`/`resolveStalenessDefaults`, which are only ever reached via
 * `loadLoreApp()`'s fully-Zod-parsed config), so it must also tolerate a raw,
 * hand-built `LoreConfig` object a test fixture constructs without running it
 * through `LoreConfigSchema.parse` (e.g. `{workflow: {gates: {...}}} as unknown as
 * LoreConfig`, several `.bun.test.ts` fixtures across this codebase) — such an
 * object's `workflow` key is present but omits `requirement_quantifiable` entirely,
 * which would throw `Cannot read properties of undefined` under the "assume
 * Zod-shaped" pattern instead of correctly defaulting to enabled.
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns `false` iff `workflow.requirement_quantifiable.enabled === false`; `true` otherwise
 * @example
 *   resolveRequirementQuantifiableEnabled(undefined) // => true
 *   resolveRequirementQuantifiableEnabled({
 *     ..., workflow: { requirement_quantifiable: { enabled: false } },
 *   }) // => false
 */
export function resolveRequirementQuantifiableEnabled(config: LoreConfig | undefined): boolean {
  return config?.workflow?.requirement_quantifiable?.enabled !== false;
}

/**
 * Resolve whether the session-start hook's Phase F freshness advisory is
 * enabled, per `setup.check_reminder` (SPEC-076 §C6, D5). Absence of the
 * whole config or the `setup` section both mean "enabled" — only an EXPLICIT
 * `check_reminder: false` suppresses the advisory. Mirrors {@link
 * resolveRequirementQuantifiableEnabled}'s full-optional-chaining shape
 * (`!== false`, not the `??`-onto-a-parsed-default shape some other
 * resolvers use) since this, too, may be called with a hand-built test
 * fixture whose `LoreConfig` was never routed through `LoreConfigSchema.parse`.
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns `false` iff `setup.check_reminder === false`; `true` otherwise
 * @example
 *   resolveSetupCheckReminderEnabled(undefined) // => true
 *   resolveSetupCheckReminderEnabled({ ..., setup: { check_reminder: false } }) // => false
 */
export function resolveSetupCheckReminderEnabled(config: LoreConfig | undefined): boolean {
  return config?.setup?.check_reminder !== false;
}

// ─── Pure Parse Helpers ────────────────────────────────────────────────────

/**
 * Format a single Zod issue found while parsing LoreConfigSchema into a
 * human-readable `{field, message}` pair.
 *
 * Special-cases `unrecognized_keys` issues raised by a `.strict()` object: Zod
 * reports these with `path` pointing at the *container* object (e.g. `["ai"]`)
 * and the offending key names in `issue.keys`, not in `path` — so the raw path
 * alone would read as the unhelpfully generic "ai" rather than naming the typo
 * (e.g. "ai.cli"). This reconstructs the full dotted key path per offending key.
 *
 * When the container is exactly the top-level `ai` block, appends a targeted
 * hint pointing at `ai.providers.<name>` (SPEC-030 AC-HJ-3) — the most common
 * real-world typo is misplacing a provider override directly under `ai` instead
 * of nesting it under `ai.providers.<name>`.
 *
 * @param issue - a single Zod issue from `ZodError.issues`
 * @returns `{field, message}` — field is a dotted path (e.g. "ai.cli" or "root")
 * @example
 *   // issue: {code: "unrecognized_keys", path: ["ai"], keys: ["cli"]}
 *   describeConfigIssue(issue)
 *   // → {field: "ai.cli", message: "ai.cli: unrecognized key — did you mean ai.providers.<name>?"}
 */
function describeConfigIssue(issue: z.ZodIssue): { field: string; message: string } {
  const containerField = issue.path.join(".") || "root";
  if (issue.code === z.ZodIssueCode.unrecognized_keys) {
    const offendingPaths = issue.keys.map((key) => `${containerField}.${key}`);
    const plural = issue.keys.length > 1 ? "s" : "";
    const hint = containerField === "ai" ? " — did you mean ai.providers.<name>?" : "";
    return {
      field: offendingPaths[0] ?? containerField,
      message: `${offendingPaths.join(", ")}: unrecognized key${plural}${hint}`,
    };
  }
  return { field: containerField, message: `${containerField}: ${issue.message}` };
}

/**
 * Type guard: does this LoreError originate from a schema violation inside the
 * `ai` config block (as opposed to `project`/`sync`/`telemetry`/`workflow`/etc.)?
 *
 * Used by CLI/adapter callers (e.g. `loadLoreApp`) to decide whether a config
 * parse failure must fail loud (SPEC-030 AC-HJ-3) or may keep the historical
 * silent fallback-to-defaults behaviour that still applies to non-`ai` blocks
 * (SPEC-030 non-goals — a broader fail-loud sweep across all config blocks is
 * explicitly out of scope for this change).
 *
 * @param error - a LoreError, typically from `parseConfig`/`loadConfigFromString`/`loadConfig`
 * @returns true iff `error.code === "VALIDATION_ERROR"` and `error.field` is `"ai"`
 *   or starts with `"ai."`
 * @example
 *   isAiConfigValidationError({code: "VALIDATION_ERROR", field: "ai.cli", message: "..."}) // true
 *   isAiConfigValidationError({code: "VALIDATION_ERROR", field: "sync.enabled", message: "..."}) // false
 *   isAiConfigValidationError({code: "STORE_ERROR", message: "..."}) // false
 */
export function isAiConfigValidationError(
  error: LoreError,
): error is Extract<LoreError, { code: "VALIDATION_ERROR" }> {
  return (
    error.code === "VALIDATION_ERROR" &&
    (error.field === "ai" || error.field.startsWith("ai."))
  );
}

/**
 * Parse a raw (unknown) value through LoreConfigSchema.
 * Returns Result<LoreConfig, LoreError>; never throws.
 *
 * @invariant When multiple issues are present, an issue whose path is rooted at
 *   `ai` is always chosen over issues in other sections — a lone typo in the
 *   `ai` block must never be masked by ordering (SPEC-030 AC-HJ-3). This does NOT
 *   change behaviour for configs with only one violation (the common case).
 */
export function parseConfig(raw: unknown): Result<LoreConfig, LoreError> {
  const result = LoreConfigSchema.safeParse(raw);
  if (result.success) {
    return ok(result.data);
  }
  const aiIssue = result.error.issues.find((issue) => issue.path[0] === "ai");
  const chosenIssue = aiIssue ?? result.error.issues[0];
  const { field, message } =
    chosenIssue !== undefined
      ? describeConfigIssue(chosenIssue)
      : { field: "root", message: result.error.message };
  return err({
    code: "VALIDATION_ERROR",
    field,
    message,
    value: raw,
  } satisfies LoreError);
}

/**
 * Parse a YAML string into LoreConfig.
 * Pure function — no filesystem access.
 * Malformed YAML or schema violations → {ok:false, error} with code VALIDATION_ERROR.
 * Never throws.
 */
export function loadConfigFromString(
  yamlText: string,
): Result<LoreConfig, LoreError> {
  let parsed: unknown;
  try {
    parsed = yaml.parse(yamlText);
  } catch (_e) {
    return err({
      code: "VALIDATION_ERROR",
      field: "yaml",
      message: "Failed to parse YAML: malformed input",
      value: yamlText,
    } satisfies LoreError);
  }

  if (parsed === null || parsed === undefined) {
    return err({
      code: "VALIDATION_ERROR",
      field: "root",
      message: "Config YAML parsed to empty value",
      value: yamlText,
    } satisfies LoreError);
  }

  return parseConfig(parsed);
}

// reason: File-IO helpers (loadConfig, saveConfig, resolveGlobalConfigPath,
// loadGlobalConfig) moved to config-node.ts — they import fs/path/os and must
// only be reachable via the `@lore/core/node` subpath. See that file's header
// for the full list and behaviour contracts (unchanged from before the split).

/**
 * Merge global defaults with project-level defaults.
 * Project defaults take precedence over global defaults on conflict (SPEC-003 §6.2).
 * Missing (undefined) on either side is treated as an empty object.
 *
 * @param globalDefaults — from the user's global config (~/.config/lore/config.yaml)
 * @param projectDefaults — from the project's .lore/config.yaml (wins on conflict)
 * @returns Merged LoreDefaults (shallow — all fields are scalars, no nesting needed)
 * @example
 *   mergeDefaults({ editor: "vim", color: true }, { editor: "nano" })
 *   // → { editor: "nano", color: true }
 */
export function mergeDefaults(
  globalDefaults: LoreDefaults | undefined,
  projectDefaults: LoreDefaults | undefined,
): LoreDefaults {
  // reason: shallow spread is safe here — LoreDefaultsSchema has no nested objects.
  // Project spread last so its keys always override global keys (SPEC-003 §6.2).
  return { ...globalDefaults, ...projectDefaults };
}

/**
 * Resolve sync credentials from process.env using the env-var name in config.sync.
 * D-004: token is read from process.env at runtime, never stored on disk.
 * Fails loud (VALIDATION_ERROR) when:
 *   - no sync section in config
 *   - sync.enabled !== true
 *   - remote_url is absent or empty
 *   - env var is absent or empty
 * Never returns ok with empty/missing credentials. Never throws.
 */
export function resolveSyncCredentials(
  config: LoreConfig,
): Result<{ url: string; token: string }, LoreError> {
  if (config.sync === undefined) {
    return err({
      code: "VALIDATION_ERROR",
      field: "sync",
      message: "No sync section in config — cannot resolve credentials",
      value: config,
    } satisfies LoreError);
  }

  if (config.sync.enabled !== true) {
    return err({
      code: "VALIDATION_ERROR",
      field: "sync.enabled",
      message: "Sync is not enabled (sync.enabled must be true to resolve credentials)",
      value: config.sync.enabled,
    } satisfies LoreError);
  }

  const remoteUrl = config.sync.remote_url;
  if (!remoteUrl) {
    return err({
      code: "VALIDATION_ERROR",
      field: "sync.remote_url",
      message: "sync.remote_url is missing or empty — cannot resolve credentials",
      value: remoteUrl,
    } satisfies LoreError);
  }

  const envVarName = config.sync.auth_token_env;
  const token = process.env[envVarName];

  if (!token) {
    return err({
      code: "VALIDATION_ERROR",
      field: "sync.auth_token_env",
      message: `Environment variable ${envVarName} is not set or is empty`,
      value: envVarName,
    } satisfies LoreError);
  }

  return ok({ url: remoteUrl, token });
}
