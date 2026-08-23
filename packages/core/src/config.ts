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
 *   - `feedback.inbound` is the INBOUND sibling of `feedback.upstream`, never a
 *     child of it. Its `open_report_cap` key is RETIRED (spec-the-defect-
 *     channel-reaches-no-machine-but-its-own-github P1, AC-GI-9/AC-GI-10): the
 *     rate-cap enforcement this key once configured is deleted outright, but
 *     the key itself stays `.optional()` in the schema PERMANENTLY (never
 *     removed — see the field's own JSDoc for why) and a present value is
 *     warned-on-by-name and dropped before the resolved config is ever read.
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
import type { BootstrapInjectionBudgets } from "./session.js";

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
export const GateCheckpointConfigSchema = z
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
     * `task-claim`-ONLY sub-predicate override (spec claim-time-actor-identity-
     * guard-zero-evidence-release-advis, AC-IDENTITY-ESCAPE) — `false` disables
     * JUST the claim-time actor-identity-collision guard, leaving anchor-overlap
     * and upstream-approval (and every other checkpoint's own `enabled` key)
     * untouched. Inert on `spec-create`/`spec-promote`/`plan-promote` (no
     * checkpoint reads it there) — same narrower-blast-radius shape as
     * `anchor_overlap` above.
     */
    actor_identity: z.object({ enabled: z.boolean().optional() }).strict().optional(),
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
    /**
     * `plan-close`-ONLY sub-predicate override (SPEC-080 §C4) — DEFAULT-OFF,
     * the opposite polarity of every other sub-predicate key on this schema
     * (`anchor_overlap`/`ac_quantifiable`/`oracle_coverage`/`requires_uat` all
     * default ENABLED, an explicit `false` disables them). `prdOutlineSynced`
     * instead requires an EXPLICIT `enabled: true` to run at all (SPEC-080
     * Migration Plan Phase 0: "plan-close predicate behind default-OFF knob")
     * — every pre-existing `.lore/config.yaml` (written before this field
     * existed) stays byte-identical, and a corpus opts in only after its
     * migration has landed enough domain docs to sync against.
     */
    prd_sync: z.object({ enabled: z.boolean().optional() }).strict().optional(),
    /**
     * Corpus-write-level sub-predicate override (spec-corpus-resolution-carries-
     * provenance-and-a-foreign-write §D4) — `false` disables JUST the foreign-
     * corpus-write guard: a write reaching a corpus the caller's own working
     * tree does not own (§M4 git-common-dir fallback from a linked worktree)
     * with no declared claim-lease intent (`taskClaimSchema.worktree`, D5).
     *
     * ⛔ UNLIKE every sibling key above, this is NOT scoped to `task-claim` (or
     * to any other of the four `GateCheckpoint` ids) — D4 states outright that
     * the measured pollution came from `lore create knowledge`, which never
     * touches `task-claim`. It is read under the deliberately synthetic
     * `"corpus-write"` map key (not a real `GateCheckpoint` member; `@lore/core`
     * does not import that type — see {@link resolveGateEnabled}'s own `checkpoint`
     * param doc) chosen to match the guard's own refusal token literal,
     * `gate:corpus-write:foreign-provenance` (pinned equal across CLI/MCP by
     * AC-CP-5(a)). Still nested on `GateCheckpointConfigSchema` — reusing the
     * SAME per-checkpoint-shaped schema, rather than a bespoke top-level field,
     * is the "exact shape" D4 calls for.
     *
     * Absence of the whole config, the `workflow` section, the `gates` map, the
     * `"corpus-write"` entry, or the nested `foreign_corpus_write` key ALL mean
     * "enabled" (same default polarity as `anchor_overlap`/`actor_identity`/
     * `ac_quantifiable`/`oracle_coverage`/`requires_uat` — the OPPOSITE of
     * `prd_sync`'s default-OFF) — AC-CP-4(a): a bare `lore init` project is
     * already covered with zero config edits. Only an EXPLICIT
     * `foreign_corpus_write.enabled: false` disables it (AC-CP-4(b) control).
     *
     * The guard itself (the predicate that actually reads this resolver and
     * refuses the write) is a SEPARATE task
     * (`task-the-foreign-write-guard-intent-is-a-claim-lease-fact-and`,
     * AC-CP-3) — this schema field plus {@link resolveForeignCorpusWriteGateEnabled}
     * are the config half only (`task-foreign-corpus-write-joins-the-six-gate-
     * sub-predicates-and`, AC-CP-4).
     */
    foreign_corpus_write: z.object({ enabled: z.boolean().optional() }).strict().optional(),
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
     * `plan-close`'s OPT-IN execution-time attestation-ratio sub-predicate config
     * (spec-plan-close-predicates-measure-invariants-an-applicability §D4,
     * superseding SPEC-069 §Design Decisions D1's always-on `0.5` default) — the
     * minimum plan-wide fraction of a closing plan's `verification_evidence`
     * entries (aggregated across every task) that must be runner-issued
     * (`attestation` present) before the plan may transition to `archived`.
     * Nested under `workflow` (not `gates.<checkpoint>`) because it is a NUMBER,
     * not an `enabled` toggle — `GateCheckpointConfigSchema`'s existing
     * sub-predicate shape only carries boolean switches; whether the WHOLE
     * checkpoint runs at all is still `workflow.gates."plan-close".enabled`
     * (unchanged).
     *
     * `min_ratio` deliberately carries NO Zod `.default(...)` — the field is
     * `undefined` when absent, never a silently-resurrected `0.5`. A Zod default
     * would make "absent" and "explicitly 0.5" indistinguishable at every read
     * site, which is the exact migration hazard §D4 closes: this predicate's
     * per-claimed-AC attested-coverage conjunct (the new default teeth) already
     * runs unconditionally, so the ratio is now an opt-in ADDITIONAL conjunct, on
     * only when a team explicitly writes this value. Absence of the whole
     * `workflow` section, or of `attestation` within it, both resolve to
     * `undefined` here too (`resolveAttestationMinRatio` is the sole seam that
     * turns that into the caller-visible `null`).
     */
    attestation: z
      .object({
        /**
         * Minimum plan-wide attested-evidence ratio required to close. No default
         * — absent means the ratio conjunct does not run at all (see this field's
         * parent JSDoc).
         */
        min_ratio: z.number().min(0).max(1).optional(),
      })
      .strict()
      .default({}),
    /**
     * `lore evidence --capture` / `lore_evidence_add {capture: true}` runner-capture
     * knobs (task-lore-evidence-capture-has-a-hard-coded-600s-window-that-a).
     *
     * `capture_timeout_ms` is THE ONLY place the capture window's number exists.
     * It was previously the module constant `CAPTURE_TIMEOUT_MS` in
     * `packages/lore/src/adapters/evidence-capture.ts`, documented there as
     * "Deliberately NOT caller-configurable" on the assumption that a capture is
     * always a single small oracle. That assumption was falsified by measurement:
     * this repo's OWN mandated worktree oracle (`bun run test:changed <base>`) ran
     * ~624s against the 600s constant after a `@lore/core` edit pulled 482 files
     * into transitive reverse-dep selection, making `--capture` — the ONLY path
     * that produces a `capture_source: "runner"` row, and therefore the only path
     * `lore done`'s attested-pass floor accepts — structurally unreachable for a
     * legitimately-scoped run. Two unrelated facts had been fused into one
     * constant: how long a HUNG child should be tolerated (a hang detector, roughly
     * fixed) and how long an HONEST oracle may take (a property of the project's
     * suite, which grows). Only the second belongs to the operator, and this key is
     * where it now lives.
     *
     * ⛔ The fix is NOT "a bigger number" — a larger constant has the identical
     * failure mode one suite-growth later. What removes the class is ownership
     * (this key) plus a LOUD, distinguishable timeout outcome
     * (`captureOracleCommand`, which records nothing on a timeout and never
     * degrades to the weaker `capture_source: "self-report"` class).
     *
     * @invariant Nested under `workflow` (not a top-level `evidence` section, and
     *   deliberately NOT folded into `verify.default_timeout_ms`) — `lore evidence`
     *   is a task-workflow verb whose sibling knobs (`claim_ttl_minutes`,
     *   `attestation.min_ratio`) already live here. Reusing
     *   `verify.default_timeout_ms` was rejected outright at authoring time: it was
     *   a PER-AC-SCRIPT default (300s then; independently raised to 900s later,
     *   see that field's own `@invariant` below — the two knobs' values move for
     *   unrelated reasons and must stay two fields), so adopting it would have
     *   silently HALVED the capture window for every existing consumer on upgrade.
     * @invariant Default RAISED to 1_200_000 ms (2026-08-11,
     *   task-raise-capture-timeout-ms-and-max-diff-chars-to-the-values,
     *   spec-governance-defaults-must-ship-and-every-recorded-gap-must D2):
     *   this repo's own mandated worktree oracle (`bun run test:changed <base>`)
     *   measured ~620s twice in a row against the PRIOR 600_000 default, and that
     *   dogfood-validated raise had lived ONLY in this repo's `.lore/config.yaml`
     *   (never reaching any other consumer) until this default absorbed it. A
     *   larger capture timeout is a pure CEILING — it costs a consumer nothing it
     *   was not already willing to wait for, so raising it on upgrade is safe
     *   unconditionally (contrast `ai.assess.max_diff_chars` below, which trades
     *   real token cost for headroom). Absence of the whole `workflow` section, or
     *   of `evidence` within it, both resolve to this default (`resolveCaptureTimeoutMs`
     *   is the sole seam).
     * @invariant Unit is MILLISECONDS, matching its closest sibling
     *   `verify.default_timeout_ms` (the other spawn-and-attest timeout) and
     *   consumed by `spawnSync`'s own `timeout` option with no conversion — a
     *   seconds-based key would introduce a rounding seam for nothing.
     */
    evidence: z
      .object({
        /**
         * Wall-clock ceiling in ms for a `--capture` spawn. Exceeding it is a FAILED
         * capture: loud refusal, nothing recorded — never a quiet downgrade to a
         * self-reported row.
         */
        capture_timeout_ms: z.number().int().positive().default(1_200_000),
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
    /**
     * `lore bootstrap --injection`'s tier-1 payload trimming knobs
     * (SPEC-080(bootstrap-injection; corpus slug
     * spec-080-bootstrap-injection-projection-tier-1-tier-2-payload)
     * §Public Interface `BootstrapInjectionBudgets`) — count caps + char
     * budget consumed by `buildBootstrapInjection` (`session.ts`). Unlike
     * `task_feed` above (whose fields are optional/no-default because the
     * FLOW module owns the default constant), every field here carries its
     * own Zod-level default — the `claim_ttl_minutes` DI precedent: `app.ts`
     * resolves this section via `resolveBootstrapInjectionBudgets` below and
     * threads the result into `buildBootstrapInjection` as a plain scalar
     * object, never a raw config passthrough (SPEC-080(bootstrap-injection) §Module Boundary).
     *
     * @invariant Absence of the whole `workflow` section, or of
     *   `bootstrap_injection` within it, or of an individual field, ALL fall
     *   back to that field's own schema default (5 / 3 / 3 / 8000) — same
     *   "absence = default" shape as `staleness`/`drift`/`attestation` above.
     */
    bootstrap_injection: z
      .object({
        /** Max `active_plans[]` entries kept in the injection payload. Default: 5. */
        max_active_plans: z.number().int().positive().default(5),
        /** Max `latest_handoffs[]` entries kept in the injection payload. Default: 3. */
        max_handoffs: z.number().int().positive().default(3),
        /** Max `pending_reviews.slugs[]` entries kept in the injection payload. Default: 3. */
        max_pending_slugs: z.number().int().positive().default(3),
        /** Compact-serialized char budget the payload is trimmed against. Default: 8000. */
        char_budget: z.number().int().positive().default(8000),
      })
      .strict()
      .default({}),
    /**
     * Tiered-review configuration (SPEC-103 §Mechanisms M1/M2, §Design Decisions) —
     * two independent kill switches, both DEFAULT-ON per the spec's own default row,
     * restoring pre-SPEC-103 (legacy) behavior only when EXPLICITLY overridden.
     *
     * @invariant `ledger_auto_approve: false` disables M1 entirely: `CorpusService.
     *   _createImpl`/`set` never fast-track a ledger knowledge doc (assessment/retro/
     *   handoff/uat) — it lands (and stays) `draft` exactly like every other type,
     *   pre-SPEC-103 byte-identical.
     * @invariant `judgment_required_types: []` disables M2 entirely — for every doc
     *   type AND every review decision, `escalate` included: `ReviewService.approve`
     *   requires no `review_judgments` row and honours none it finds, pre-SPEC-103
     *   byte-identical. This is the operator's total off-switch and is checked BEFORE
     *   the escalate path below.
     * @invariant A NON-EMPTY `judgment_required_types` is the SET of `DocType` values
     *   whose approval M2 gates on a `reject`, on a missing judgment, and on a
     *   self-review provenance collision — that scoping is deliberate: an AI judge
     *   disagreeing with a record of what happened (a retro, an assessment) must not
     *   hold event capture hostage. It does NOT scope `escalate`
     *   (spec-an-escalate-blocks-approval-for-every-doc-type-and-the D1): an escalate
     *   asserts an outstanding HUMAN decision and carries the questions in
     *   `blocking_questions`, so once this list is non-empty an escalate blocks
     *   approval for EVERY doc type, listed or not, and the denial renders those
     *   questions. Typed as `string[]` (not `DocType[]`) for the SAME
     *   leaf-of-dependency-graph reason `resolveGateEnabled`'s `checkpoint` param is a
     *   plain string — this module must not import `DocType`'s consumer-side
     *   gate-checkpoint machinery.
     * @invariant Absence of the whole `workflow` section, or of `review` within it,
     *   or of an individual field, ALL fall back to that field's own schema default
     *   (`true` / `["spec","adr"]`) — same "absence = default" shape as `staleness`/
     *   `drift`/`attestation` above (SPEC-103's OWN stated default row, AC-TIER-7's
     *   kill-switch test proves the EXPLICIT-override path, not this default path).
     */
    review: z
      .object({
        /** `false` disables M1 ledger fast-track entirely. Default: true. */
        ledger_auto_approve: z.boolean().default(true),
        /**
         * `DocType` values M2 gates on a `reject` / missing judgment / provenance
         * collision. An `escalate` gates every type regardless (see the second
         * `@invariant` above); `[]` disables M2 entirely. Default: ["spec","adr"].
         */
        judgment_required_types: z.array(z.string()).default(["spec", "adr"]),
      })
      .strict()
      .default({}),
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

// ─── Trace Section Schema ───────────────────────────────────────────────────

/**
 * Read/deny observability configuration (SPEC-102 §Scope) — an independent
 * `trace.*` section, mirroring the `audit.*`/`verify.*` precedent above
 * rather than nesting under `workflow` — trace instrumentation is a distinct
 * feature (fire-and-forget read/deny tracing, `lore trace stats`) that
 * evolves independently from claim leases/verify's config surface.
 *
 * @invariant `enabled` defaults to `true` (SPEC-102 "default ON") — a corpus
 *   opts OUT via explicit `trace: { enabled: false }`, never the reverse.
 *   `false` disables BOTH recording (every `TraceRecorder` call site becomes
 *   a no-op — `app.ts` simply never wires a `TraceRecorder` instance) AND
 *   the opportunistic retention prune at CLI startup (§Migration Strategy).
 * @invariant `retention_days` defaults to 90 — the age threshold the CLI
 *   startup prune's cutoff (`now - retention_days`) is computed against.
 */
const TraceConfigSchema = z
  .object({
    /** `false` disables trace recording AND retention pruning entirely. Default: true. */
    enabled: z.boolean().default(true),
    /** Trace rows older than this many days are eligible for retention pruning. Default: 90. */
    retention_days: z.number().int().positive().default(90),
  })
  .strict();

/** Read/deny trace observability config section. Source: SPEC-102 §Scope. */
export type TraceConfig = z.infer<typeof TraceConfigSchema>;

// ─── Feedback Section Schema ────────────────────────────────────────────────

/**
 * The by-name deprecation warning for a config still carrying
 * `feedback.inbound.open_report_cap` (spec-the-defect-channel-reaches-no-
 * machine-but-its-own-github P1, AC-GI-10) — the ONE deliberate side effect
 * (`console.warn`) this otherwise pure module makes, fired from inside
 * `FeedbackConfigSchema.inbound`'s `.transform()` whenever a parsed config
 * carries a present value for the retired key.
 *
 * Deliberately NOT throttled the way `resolveGateEnabled`'s legacy-alias
 * warning is (that one's `phaseClaimAliasWarned` WeakSet exists because a
 * single command execution calls it ~6 times against the SAME config object,
 * for different checkpoints): schema PARSING happens once per config load,
 * so there is no equivalent repeat-call spam to suppress here.
 */
function warnRetiredOpenReportCapKey(): void {
  console.warn(
    "lore: feedback.inbound.open_report_cap is retired and no longer enforced " +
      "(the open-report rate cap it configured was removed) — the value parses but is ignored.",
  );
}

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
 * @invariant `upstream`, once present, is one of TWO mutually-exclusive
 *   shapes (spec-the-defect-channel-reaches-no-machine-but-its-own-github
 *   P2, AC-GI-1 scenario 5) — a plain `z.union`, not a discriminated union,
 *   because neither shape carries a literal tag field of its own (adding one
 *   would be a THIRD breaking change on top of the transport switch itself):
 *     1. the LEGACY SQLite shape — `corpus_path` + `root_prd` (both
 *        REQUIRED together — a missing `corpus_path` names no filesystem
 *        location to probe; a missing `root_prd` disables the R-5a
 *        identity-pin check entirely) plus optional `write_wait_ms`. Kept
 *        alive per the migration plan's P2 row ("SQLite path still
 *        selectable") — `IssueReportService`/`flows/upstream-context-flow.ts`
 *        consume this shape UNCHANGED.
 *     2. the GITHUB shape — `repo` alone (`"owner/repo"`), the target
 *        `GitHubIntakePort`'s `verifyTarget`/`fileIssue`/`listIssues` resolve
 *        ONCE from config and pass explicitly (risk R2 — never `-R` inferred
 *        from a git remote). `.strict()` on EACH branch is what makes the two
 *        shapes mutually exclusive: a config carrying both `repo` and
 *        `corpus_path` matches neither branch and fails loud, rather than
 *        silently picking one.
 *   `z.union` tries each branch in declaration order and reports the first
 *   branch's issues verbatim when a value matches neither — acceptable here
 *   because the two shapes' required-key sets do not overlap, so a
 *   malformed config almost always reads as "missing X" for whichever
 *   branch it came closer to, not a generic union failure.
 * @invariant `root_prd` (legacy shape only) accepts EITHER the upstream root
 *   PRD's slug or its id (see `issue-report.ts::matchRootPrd`) — deliberately
 *   untyped as a plain non-empty string rather than two separate optional
 *   fields, since the consumer author only ever knows one or the other at
 *   config time.
 * @invariant `stale_after_days` (D5b, spec-issue-closure-loop-computed-
 *   resolution-agent-reachable) is INDEPENDENT of `upstream` — it governs the
 *   UPSTREAM-side `lore status --check-issues` stale-open-report detector
 *   (D5), which has nothing to do with whether THIS corpus is configured to
 *   FILE reports elsewhere. Defaults to 14 so an upstream corpus that never
 *   sets `feedback` at all still gets a meaningful staleness threshold — the
 *   number lives here, never hardcoded in the detector or in prose (standing
 *   content-contract rule, CLAUDE.md).
 * @invariant `inbound` is the INBOUND half of this section and is likewise
 *   INDEPENDENT of `upstream` — ⛔ the two are deliberately NOT nested together
 *   (spec-the-defect-channel-cannot-be-honestly-maintained-an §M2).
 *   `upstream` is the CONSUMER's "where do I file"; `inbound` is the policy a
 *   corpus declares for reports filed INTO it, read from the UPSTREAM's own
 *   config by `IssueReportService`. Siting `open_report_cap` under `upstream`
 *   would put the ceiling in the hands of the party it constrains, and a spam
 *   ceiling the spammer can raise is not a ceiling. A corpus may legitimately
 *   carry BOTH sections (it files reports upstream AND receives its own).
 * @invariant `inbound` carries a section-level `.default({})` — unlike
 *   `upstream`'s `.optional()` — so `feedback.inbound` reads as a real object
 *   rather than `undefined` even when the caller declares no `feedback`
 *   section at all, which is what `scripts/check-shipped-defaults.ts` relies
 *   on (it seeds every Zod-defaultable section with `{}` before parsing).
 * @invariant `inbound.open_report_cap` is a RETIRED key (spec-the-defect-
 *   channel-reaches-no-machine-but-its-own-github P1, AC-GI-9/AC-GI-10) — see
 *   that field's own JSDoc for the parses-forever-but-ignored contract.
 */
export const FeedbackConfigSchema = z
  .object({
    upstream: z
      .union([
        z
          .object({
            /** Absolute path to the upstream repo ROOT (the shape `lore init` produces — a `.lore/lore.db` lives directly under it). */
            corpus_path: z.string().min(1),
            /** Expected upstream root-PRD slug OR id (R-5a identity pin, SPEC-072 §5 step 5). */
            root_prd: z.string().min(1),
            /**
             * The DECLARED bounded wait (ms) a `lore report-issue` write may spend
             * waiting for another writer to release the upstream corpus, before
             * refusing LOUDLY (spec-report-issue-has-no-specified-concurrency-
             * contract-ac-072 D4 — "the wait bound is declared in config and
             * surfaced on expiry"). Applied as the upstream connection's `PRAGMA
             * busy_timeout` and echoed VERBATIM in the refusal message, so the
             * number a reader sees in stderr is by construction the number that
             * was applied. Absent → {@link DEFAULT_WRITE_WAIT_MS}, resolved by
             * {@link resolveUpstreamWriteWaitMs} (never re-derived at a read site).
             */
            write_wait_ms: z.number().int().nonnegative().optional(),
          })
          .strict(),
        z
          .object({
            /**
             * The GitHub intake target, `"owner/repo"` (spec-the-defect-
             * channel-reaches-no-machine-but-its-own-github, Scope entry
             * `GitHubIntakePort`; risk R2). Resolved ONCE here and passed
             * EXPLICITLY into every `gh api repos/<repo>/...` call — never
             * inferred from a git remote via `-R`.
             */
            repo: z.string().min(1).regex(/^[^/\s]+\/[^/\s]+$/, "must be 'owner/repo'"),
          })
          .strict(),
      ])
      .optional(),
    /** Days past which an OPEN issue report is flagged stale by `lore status --check-issues` (D5b). Default: 14. */
    stale_after_days: z.number().int().positive().default(14),
    /**
     * Policy for reports filed INTO this corpus — see the `inbound` invariants
     * on this schema for why this is a SIBLING of `upstream`, never a child.
     */
    inbound: z
      .object({
        /**
         * RETIRED (spec-the-defect-channel-reaches-no-machine-but-its-own-github
         * P1, AC-GI-9/AC-GI-10): this key used to configure the maximum number
         * of simultaneously-OPEN reports one reporter project could hold before
         * `lore report-issue` refused another — that rate-cap ENFORCEMENT (and
         * its six implementation symbols, enumerated in that spec's Scope
         * section, deliberately not repeated here as literal identifiers since
         * AC-GI-9's oracle is a case-sensitive scan for exactly those six
         * strings) is deleted outright: with intake moving to a hosted tracker,
         * abuse control belongs to that tracker, and the cap only ever refused
         * honest reporters (measured 2026-08-23: 10 open reports against a
         * ceiling of 10, refusing every new report while 6 criticals sat
         * untriaged).
         *
         * The key is kept `.optional()` PERMANENTLY rather than removed —
         * `FeedbackConfigSchema` is `.strict()` at all three levels, and
         * `.lore/config.yaml` is gitignored, so a config still carrying this
         * key from a pre-P1 binary would otherwise fail to parse on THIS
         * MACHINE with no rollback path (a decision recorded in that spec's
         * Scope → Out, not a deferral). A present value still PARSES (never a
         * fail-loud refusal for this key alone) but is warned-on BY NAME via
         * `console.warn` (`warnRetiredOpenReportCapKey` below) and then DROPPED
         * — see the `inbound` object's own `.transform()` immediately below —
         * before the resolved config ever reaches a reader. No code path may
         * act on this field; it exists only so an old config file keeps
         * parsing.
         */
        open_report_cap: z.number().int().positive().optional(),
      })
      .strict()
      .transform((val) => {
        // reason: the ONE deliberate side effect (console.warn) in this
        // otherwise pure module — see `warnRetiredOpenReportCapKey`'s own
        // JSDoc and the field's above for why this key must warn-then-drop
        // rather than fail-loud or silently keep working.
        if (val.open_report_cap !== undefined) {
          warnRetiredOpenReportCapKey();
        }
        return { ...val, open_report_cap: undefined };
      })
      .default({}),
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
 * @invariant Default RAISED to 900_000 ms (2026-08-11, same task/spec as
 *   `workflow.evidence.capture_timeout_ms` above — this is the THIRD
 *   dogfood-validated shipped-default gap the drift checker found, discovered
 *   by back-catalogue sweep, not named in the spec's own Problem section).
 *   Measured (`knowledge-lore-verify-long-oracle-flake-vitest-ontaskupdate-rpc`):
 *   this repo's full-regression `lore verify` ACs legitimately take ~240–340s
 *   (typecheck + vitest + bun test), riding the PRIOR 300_000ms edge — the one
 *   historical run under it passed at 237s, slower runs were SIGTERM'd at
 *   exit 143 `[TIMED OUT]`. Fix applied directly to `.lore/config.yaml` at the
 *   time ("configuration fitting measured reality, not symptom-masking"); this
 *   default absorbs that fix so every consumer inherits it on upgrade. Like
 *   `capture_timeout_ms`, a pure ceiling — costs nothing extra for a command
 *   that finishes fast.
 * @invariant `require_command_approval` (SPEC-039 §M2, default `true`) is the
 *   command-provenance approval gate's on/off switch. `false` restores the
 *   pre-M2-hardening behavior (any declared command runs without approval,
 *   same as before this hardening pass).
 */
const VerifyConfigSchema = z
  .object({
    /** Default spawn timeout in ms, used when an AC's verify.script omits timeout_ms. */
    default_timeout_ms: z.number().int().positive().default(900_000),
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

// ─── Context Config Schema ─────────────────────────────────────────────────

/**
 * `context.memory_files.*` — the ONLY home of the project-CLAUDE.md line/byte
 * ceiling numbers (spec-project-claude-md-content-contract-governance-injected
 * §D1/D8: "zod defaults ONLY; config.yaml overrides; prose cites the command" —
 * deliberately anti-dual-write. `packages/lore/src/service/claude-md-check.ts`'s
 * `lintMemoryFiles` (downstream task) consumes {@link resolveMemoryFileBudgets}'s
 * return value; it MUST NOT hardcode these numbers itself.
 *
 * Field-level `.default(...)` on every leaf (the `bootstrap_injection`
 * precedent above, NOT the `task_feed` no-default precedent) means a config
 * author can override a single field — say `root.max_lines` — without
 * restating its siblings; every untouched field/block still resolves to its
 * own schema default.
 *
 * @invariant `.strict()` at both the `context` and `memory_files` levels
 *   rejects unknown keys (typos, e.g. `rootMaxLines`) at config-parse time
 *   rather than silently ignoring them.
 * @invariant Two metrics per role (`max_lines` primary + `max_bytes`
 *   backstop, spec §D2) — a role's block is never bytes-only or lines-only.
 * @invariant THREE ordered bands per metric, governed by two fractions of the
 *   same ceiling: `warn_threshold_fraction` (advisory) <
 *   `evict_threshold_fraction` (deterministic) <= 1. The superRefine below
 *   REFUSES an inverted or equal pair rather than clamping it, because an
 *   `evict` at or below `warn` makes the advisory band empty and unreachable —
 *   a silent semantic inversion, the exact failure class this project's
 *   no-silent-fallback rule exists to prevent.
 */
export const contextConfigSchema = z
  .object({
    memory_files: z
      .object({
        /** `false` disables the memory-file line/byte ceiling lint entirely. Default: true. */
        enabled: z.boolean().default(true),
        /** Filenames the discovery probe treats as project memory files. Default: `["CLAUDE.md"]`. */
        filenames: z.array(z.string()).default(["CLAUDE.md"]),
        /** Ceiling for the repo-root memory file (looser than the module ceiling — spec §D3). */
        root: z
          .object({
            max_lines: z.number().int().positive().default(300),
            max_bytes: z.number().int().positive().default(30720),
          })
          .strict()
          .default({}),
        /** Ceiling for per-module memory files (tighter than the root ceiling — spec §D3). */
        module: z
          .object({
            max_lines: z.number().int().positive().default(200),
            max_bytes: z.number().int().positive().default(16384),
          })
          .strict()
          .default({}),
        /**
         * Fraction (0–1) of a ceiling at which `computeHeadroom`
         * (`packages/lore/src/service/claude-md-check.ts`) marks a metric as
         * "approaching" — an ADVISORY-only warning surfaced by `lore status
         * --check-claude-md`, never a breach and never exit-affecting
         * (task-lore-status-check-claude-md-reports-a-saturated-file-as: a
         * bare pass/fail hid a file sitting 5 bytes from its ceiling as
         * "within budget", so the threshold that decides "worth flagging"
         * must be a config number, not a value baked into the check). Default
         * `0.9` (90%) — the incident that motivated this field measured
         * 99.98% used with zero signal anywhere before the write; 90% still
         * leaves an author real runway to plan a trim ahead of the
         * `claude-md-guard.sh` hook's hard denial.
         */
        warn_threshold_fraction: z.number().min(0).max(1).default(0.9),
        /**
         * Fraction (0–1) of a ceiling at which a memory file stops being
         * merely "approaching" and becomes a DETERMINISTIC, exit-relevant
         * `eviction_required` finding from `lintMemoryFiles`
         * (`packages/lore/src/service/claude-md-check.ts`) — the recurrence
         * rule for
         * task-a-module-claude-md-at-its-byte-ceiling-silently-relocates.
         *
         * The advisory band above was not enough: four module docs sat in it
         * for an unknown number of sessions and the count went UP, not down —
         * `packages/lore/src/service/CLAUDE.md` was compressed to 10548 bytes
         * and was back at 16374/16384 (10 bytes of runway) ten days later. At
         * zero runway the ceiling guard blocks the one CORRECT write —
         * recording a new service module in the service doc — so the fact is
         * recorded in a NEIGHBOURING module's doc instead, which no mechanism
         * anywhere reports. An advisory nobody is obligated to act on is what
         * produced that state, so this band blocks.
         *
         * Default `0.97`, chosen so the block lands while the file is still
         * WRITABLE: it leaves ~3% of runway (≈491 bytes at the module byte
         * ceiling), measurably more than one module-index entry, so whoever
         * trips it can still land their entry and then evict, and is never
         * cornered into the displacement that motivated this field. A value
         * near 1.0 would reproduce that corner; a low value would turn the
         * ordinary near-ceiling band into a block.
         *
         * ⛔ Raising `max_bytes`/`max_lines` is NOT the remedy for a file that
         * trips this — the ceiling exists because an unbounded memory file is
         * itself the failure mode, and raising it converts a loud block into a
         * slow silent regression. The remedy is eviction: move a block to the
         * corpus and leave a one-line pointer (`lore governance claude-md`).
         */
        evict_threshold_fraction: z.number().min(0).max(1).default(0.97),
      })
      .strict()
      .superRefine((value, ctx) => {
        if (value.evict_threshold_fraction <= value.warn_threshold_fraction) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["evict_threshold_fraction"],
            message:
              `evict_threshold_fraction (${value.evict_threshold_fraction}) must be strictly greater than ` +
              `warn_threshold_fraction (${value.warn_threshold_fraction}) — an equal or inverted pair leaves the ` +
              `advisory band empty, so a file would jump from silent straight to a deterministic block`,
          });
        }
      })
      .default({}),
  })
  .strict();

/** Project memory-file governance config section. Source: spec-project-claude-md-content-contract-governance-injected §D1/D8. */
export type ContextConfig = z.infer<typeof contextConfigSchema>;

/** The resolved shape `resolveMemoryFileBudgets` returns — one role's ceiling pair, plus enable flag and tracked filenames. */
export type MemoryFileBudgets = ContextConfig["memory_files"];

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
     * (default_timeout_ms = 900000, raised 2026-08-11 — see that field's own JSDoc).
     */
    verify: VerifyConfigSchema.optional(),
    /**
     * Upstream issue-reporting configuration (SPEC-072) + `check-issues`
     * stale-report threshold (D5b). When `upstream` is absent, `lore
     * report-issue` fails loud (VALIDATION_ERROR naming both
     * `feedback.upstream.corpus_path` and `feedback.upstream.root_prd`) —
     * there is no AI-provider-style "defaults to a built-in behavior"
     * fallback, since configuring THAT sub-section is the consent act.
     * `stale_after_days` is independent and always resolves to a default
     * (14) via {@link resolveStaleAfterDays} even when this whole `feedback`
     * section is absent.
     */
    feedback: FeedbackConfigSchema.optional(),
    /**
     * `lore setup` distribution-convergence configuration (SPEC-076 §C6, D5).
     * When absent, `resolveSetupCheckReminderEnabled` returns the schema
     * default (`true` — advisory enabled).
     */
    setup: SetupConfigSchema.optional(),
    /**
     * Project memory-file (CLAUDE.md) governance configuration
     * (spec-project-claude-md-content-contract-governance-injected §D1/D8).
     * When absent, {@link resolveMemoryFileBudgets} returns the schema
     * defaults (root 300L/30720B, module 200L/16384B, enabled: true).
     */
    context: contextConfigSchema.optional(),
    /**
     * Read/deny trace observability configuration (SPEC-102).
     * When absent, {@link resolveTraceEnabled}/{@link resolveTraceRetentionDays}
     * return the schema defaults (enabled: true, retention_days: 90).
     */
    trace: TraceConfigSchema.optional(),
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
 * Resolve the effective `workflow.review.ledger_auto_approve` value (SPEC-103 §Mechanisms
 * M1). Mirrors {@link resolveAttestationMinRatio}'s fully-optional-chained shape (NOT
 * {@link resolveClaimTtlMinutes}'s shallower one) — `review` is a NESTED optional-with-
 * default sub-section, and many hand-built `LoreConfig` test fixtures across this codebase
 * set `workflow: {...}` directly (never routed through `WorkflowConfigSchema.parse`), so
 * `config.workflow` being present is NOT proof `config.workflow.review` is too. A `?.`-chain
 * all the way to the leaf is required, or such a fixture throws on `.review` being
 * `undefined` instead of degrading to the default (regression: 2026-07-28, `gate-enforcer-
 * service-layer.bun.test.ts`/`gate-spec-promote.bun.test.ts` both construct exactly this
 * shape).
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns Effective `ledger_auto_approve` value
 * @example
 *   resolveLedgerAutoApprove(undefined) // => true
 *   resolveLedgerAutoApprove({ ..., workflow: { review: { ledger_auto_approve: false } } }) // => false
 *   resolveLedgerAutoApprove({ ..., workflow: { gates: {} } } as LoreConfig) // => true (no throw)
 */
export function resolveLedgerAutoApprove(config: LoreConfig | undefined): boolean {
  return config?.workflow?.review?.ledger_auto_approve ?? WorkflowConfigSchema.parse({}).review.ledger_auto_approve;
}

/**
 * Resolve the effective `workflow.review.judgment_required_types` value (SPEC-103
 * §Mechanisms M2). Mirrors {@link resolveLedgerAutoApprove}'s fully-optional-chained
 * shape (see that function's JSDoc for why the shallower {@link resolveClaimTtlMinutes}
 * shape is unsafe for a NESTED optional-with-default sub-section) — the schema default is
 * `["spec","adr"]`, and `[]` is the documented kill-switch (AC-TIER-7).
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns Effective `judgment_required_types` array (never mutated in place by callers)
 * @example
 *   resolveJudgmentRequiredTypes(undefined) // => ["spec", "adr"]
 *   resolveJudgmentRequiredTypes({ ..., workflow: { review: { judgment_required_types: [] } } }) // => []
 *   resolveJudgmentRequiredTypes({ ..., workflow: { gates: {} } } as LoreConfig) // => ["spec","adr"] (no throw)
 */
export function resolveJudgmentRequiredTypes(config: LoreConfig | undefined): string[] {
  return (
    config?.workflow?.review?.judgment_required_types ??
    WorkflowConfigSchema.parse({}).review.judgment_required_types
  );
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
 * Resolve whether `task-claim`'s claim-time actor-identity-collision guard
 * specifically is enabled, per `workflow.gates."task-claim".actor_identity
 * .enabled` (spec claim-time-actor-identity-guard-zero-evidence-release-advis,
 * AC-IDENTITY-ESCAPE). Narrower than {@link resolveGateEnabled}`(config,
 * "task-claim")`, which governs the WHOLE checkpoint (actor-identity, anchor-
 * overlap, AND upstream-approval together). Absence of the whole config, the
 * `workflow` section, the `gates` map, the `task-claim` entry, or the nested
 * `actor_identity` key ALL mean "enabled" — only an EXPLICIT `actor_identity
 * .enabled: false` disables just this predicate (mirrors {@link
 * resolveAnchorOverlapGateEnabled}'s single-checkpoint shape exactly).
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns `false` iff `workflow.gates."task-claim".actor_identity.enabled === false`; `true` otherwise
 * @example
 *   resolveActorIdentityGateEnabled(undefined) // => true
 *   resolveActorIdentityGateEnabled({
 *     project, workflow: { gates: { "task-claim": { actor_identity: { enabled: false } } } },
 *   }) // => false
 */
export function resolveActorIdentityGateEnabled(config: LoreConfig | undefined): boolean {
  return config?.workflow?.gates?.["task-claim"]?.actor_identity?.enabled !== false;
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
 * Resolve whether `plan-close`'s `prdOutlineSynced` sub-predicate specifically is
 * enabled, per `workflow.gates."plan-close".prd_sync.enabled` (SPEC-080 §C4).
 * Narrower than {@link resolveGateEnabled}`(config, "plan-close")`, which governs
 * the WHOLE checkpoint (`prdOutlineSynced` AND `uatP0Accepted`/`attestationFloor`
 * together). Hardcoded to `"plan-close"` (mirrors {@link
 * resolveAnchorOverlapGateEnabled}'s single-checkpoint shape) — SPEC-080 wires
 * this predicate on exactly one checkpoint.
 *
 * DELIBERATELY THE OPPOSITE DEFAULT of every sibling `resolve*GateEnabled`
 * function on this checkpoint family: absence of the whole config, the
 * `workflow` section, the `gates` map, the `"plan-close"` entry, OR the nested
 * `prd_sync` key ALL mean "disabled" — only an EXPLICIT `prd_sync.enabled: true`
 * turns this predicate on (SPEC-080 Migration Plan Phase 0: "plan-close
 * predicate behind default-OFF knob").
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns `true` iff `workflow.gates."plan-close".prd_sync.enabled === true`; `false` otherwise
 * @example
 *   resolvePrdSyncGateEnabled(undefined) // => false
 *   resolvePrdSyncGateEnabled({
 *     project, workflow: { gates: { "plan-close": { prd_sync: { enabled: true } } } },
 *   }) // => true
 */
export function resolvePrdSyncGateEnabled(config: LoreConfig | undefined): boolean {
  return config?.workflow?.gates?.["plan-close"]?.prd_sync?.enabled === true;
}

/**
 * Resolve whether the foreign-corpus-write guard's `foreign_corpus_write`
 * sub-predicate specifically is enabled, per `workflow.gates."corpus-write"
 * .foreign_corpus_write.enabled` (spec-corpus-resolution-carries-provenance-
 * and-a-foreign-write §D4). ⛔ Hardcoded to the synthetic `"corpus-write"` map
 * key, DELIBERATELY NOT one of the four real `GateCheckpoint` ids (`task-claim`
 * / `spec-create` / `spec-promote` / `plan-promote`) that every sibling
 * `resolve*GateEnabled` function above keys on — D4 states outright that this
 * predicate governs a corpus-**write** (e.g. `lore create knowledge`), which
 * never touches any of those four checkpoints. The key matches the guard's own
 * refusal token literal, `gate:corpus-write:foreign-provenance`.
 *
 * Same default polarity as {@link resolveAnchorOverlapGateEnabled} /
 * {@link resolveActorIdentityGateEnabled} / {@link resolveAcQuantifiableGateEnabled}
 * / {@link resolveOracleCoverageGateEnabled} / {@link resolveRequiresUatGateEnabled}
 * (all default ENABLED) — the OPPOSITE of {@link resolvePrdSyncGateEnabled}'s
 * default-OFF polarity immediately above. Absence of the whole config, the
 * `workflow` section, the `gates` map, the `"corpus-write"` entry, or the
 * nested `foreign_corpus_write` key ALL mean "enabled" — AC-CP-4(a): a project
 * that ran nothing but `lore init` is already covered, with no config edit.
 * Only an EXPLICIT `foreign_corpus_write.enabled: false` disables it
 * (AC-CP-4(b) control, proving the knob is real in both directions).
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns `false` iff `workflow.gates."corpus-write".foreign_corpus_write.enabled === false`; `true` otherwise
 * @example
 *   resolveForeignCorpusWriteGateEnabled(undefined) // => true
 *   resolveForeignCorpusWriteGateEnabled({
 *     project, workflow: { gates: { "corpus-write": { foreign_corpus_write: { enabled: false } } } },
 *   }) // => false
 */
export function resolveForeignCorpusWriteGateEnabled(config: LoreConfig | undefined): boolean {
  return config?.workflow?.gates?.["corpus-write"]?.foreign_corpus_write?.enabled !== false;
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
 * Resolve whether trace recording (and its opportunistic retention prune) is
 * enabled, from an optional LoreConfig. Mirrors {@link resolveClaimTtlMinutes} —
 * absence of the whole config or the `trace` section both fall back to the
 * schema default (`true` — SPEC-102 "default ON").
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns Effective trace.enabled value
 * @example
 *   resolveTraceEnabled(undefined) // => true
 *   resolveTraceEnabled({ ..., trace: { enabled: false } }) // => false
 */
export function resolveTraceEnabled(config: LoreConfig | undefined): boolean {
  return (config?.trace ?? TraceConfigSchema.parse({})).enabled;
}

/**
 * Resolve the effective trace retention window, in days, from an optional
 * LoreConfig. Mirrors {@link resolveClaimTtlMinutes} — absence of the whole
 * config or the `trace` section both fall back to the schema default (90).
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns Effective trace.retention_days value
 * @example
 *   resolveTraceRetentionDays(undefined) // => 90
 *   resolveTraceRetentionDays({ ..., trace: { retention_days: 30 } }) // => 30
 */
export function resolveTraceRetentionDays(config: LoreConfig | undefined): number {
  return (config?.trace ?? TraceConfigSchema.parse({})).retention_days;
}

/**
 * Resolve the effective trusted-runner default spawn timeout (ms) from an optional
 * LoreConfig. Mirrors {@link resolveAuditVerifySince} — absence of the whole config
 * or the verify section both fall back to the schema default (900000ms, raised
 * 2026-08-11 from 300000ms — see `VerifyConfigSchema.default_timeout_ms`'s own
 * JSDoc for the measurement).
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns Effective verify.default_timeout_ms value
 * @example
 *   resolveVerifyDefaultTimeoutMs(undefined) // => 900000
 *   resolveVerifyDefaultTimeoutMs({ ..., verify: { default_timeout_ms: 60000 } }) // => 60000
 */
export function resolveVerifyDefaultTimeoutMs(config: LoreConfig | undefined): number {
  return (config?.verify ?? VerifyConfigSchema.parse({})).default_timeout_ms;
}

/**
 * Resolve the effective `lore evidence --capture` window (ms) from an optional
 * LoreConfig (task-lore-evidence-capture-has-a-hard-coded-600s-window-that-a).
 *
 * This is the SOLE seam through which the capture window is read — the number
 * itself exists ONLY as `WorkflowConfigSchema.evidence.capture_timeout_ms`'s Zod
 * default (1_200_000 as of 2026-08-11, raised from 600_000 — see that field's own
 * JSDoc), so `packages/lore/src/adapters/evidence-capture.ts` derives its
 * `DEFAULT_CAPTURE_TIMEOUT_MS` by calling this with `undefined` rather than
 * restating the literal (the anti-dual-write shape `context.memory_files` documents:
 * "zod defaults ONLY; config.yaml overrides").
 *
 * Callers MUST NOT reach into `config.workflow.evidence` directly: `config.workflow`
 * being present is NOT proof `config.workflow.evidence` is (tests and internal
 * callers construct `workflow: {...}` literals that never pass through
 * `WorkflowConfigSchema.parse`), so the `?.`-chain plus schema-default fallback
 * below is load-bearing — the same hazard {@link resolveLedgerAutoApprove}
 * documents.
 *
 * Two residuals of the capture-window slice are DELIBERATELY NOT FIXED. Recorded
 * here, at the resolver a reader consults when either one surprises them, rather
 * than left as a silence (task-the-ac-scope-re-keying-left-the-red-first-floor-
 * unarmed, faces 3.2 and 3.3):
 *
 *   1. A MALFORMED `capture_timeout_ms` (bad YAML, wrong type, out of range)
 *      degrades to the default SILENTLY, because the CLI's `loadProjectConfig`
 *      returns `undefined` on any parse failure and this resolver cannot
 *      distinguish "no config file" from "a config file that failed to parse".
 *      That is PRE-EXISTING behaviour for every non-`ai` config section (a
 *      documented SPEC-030 non-goal), so fixing it here would fix one key while
 *      leaving its siblings degrading — it is a config-loader-WIDE decision that
 *      must change every section in one deliberate slice, NOT a capture-window
 *      one. It is pinned meanwhile by test `CAPCLI-E1`
 *      (`packages/lore/tests/unit/adapters/cli-evidence-capture-window.bun.test.ts`),
 *      which asserts the degradation as MEASURED behaviour — so a future
 *      loader-wide fix flips a failing test rather than changing semantics
 *      silently. ⛔ Do not "fix" it for this key alone.
 *
 *   2. `assets/project/lore-config-template.yaml` deliberately does NOT seed this
 *      key. The number ships in the Zod default above, so every consumer honours
 *      the knob whether or not their `.lore/config.yaml` mentions it, and the
 *      `--capture` timeout refusal names both the knob and the file at the exact
 *      moment an author needs them — seeding it would buy nothing but an
 *      assets-manifest regeneration for a key most consumers never touch. ⛔ If a
 *      future slice DOES add it to that template, regenerate the assets manifest
 *      in the SAME commit: `assets/` SSOT↔installed pairs are parity-pinned.
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns Effective `workflow.evidence.capture_timeout_ms` value in milliseconds
 * @example
 *   resolveCaptureTimeoutMs(undefined) // => 1200000 (raised 2026-08-11, see field JSDoc)
 *   resolveCaptureTimeoutMs({ ..., workflow: { evidence: { capture_timeout_ms: 1_800_000 } } })
 *   // => 1800000
 *   resolveCaptureTimeoutMs({ ..., workflow: { gates: {} } } as LoreConfig) // => 1200000 (no throw)
 */
export function resolveCaptureTimeoutMs(config: LoreConfig | undefined): number {
  return (
    config?.workflow?.evidence?.capture_timeout_ms ??
    WorkflowConfigSchema.parse({}).evidence.capture_timeout_ms
  );
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
 * Resolve the effective `feedback.stale_after_days` threshold (D5b,
 * spec-issue-closure-loop-computed-resolution-agent-reachable) from an
 * optional LoreConfig — the age (in days) past which `lore status
 * --check-issues` flags a computed-`open` issue report as stale.
 *
 * @invariant Reads via BRACKET notation (`config?.["feedback"]?.[...]`), not
 *   dot notation, DELIBERATELY — `tests/unit/adapters/feedback-read-site-
 *   invariant.test.ts` mechanically asserts `resolveFeedbackUpstreamCfg`
 *   (`report-issue-wiring.ts`) is the SOLE dot-notation `.feedback` reader
 *   across `packages/lore/src`/`packages/core/src`, guarding SPEC-072's
 *   "nobody else reads `feedback.upstream` directly" invariant. That scanner
 *   already documents bracket notation as an out-of-scope escape valve for a
 *   genuinely different concern (its own header cites `provisionFeedbackUpstream`'s
 *   write-path idempotency check as precedent) — `stale_after_days` is exactly
 *   that: an unrelated sibling field under the same `feedback` section, read
 *   for a different feature (D5's staleness detector), not the upstream-
 *   provisioning concern that invariant polices. Using dot notation here would
 *   silently trip that unrelated test.
 * @invariant Falls back to the schema default (14) whenever the value is
 *   absent or not a number — covers both "no `feedback` section at all" and a
 *   hand-built `LoreConfig` test fixture that sets `feedback: { upstream:
 *   {...} }` directly without routing through `FeedbackConfigSchema.parse`
 *   (mirrors {@link resolveAttestationMinRatio}'s "must not throw on a
 *   partially-shaped test fixture" reasoning).
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns Effective `feedback.stale_after_days` value
 * @example
 *   resolveStaleAfterDays(undefined) // => 14
 *   resolveStaleAfterDays({ ..., feedback: { stale_after_days: 30 } }) // => 30
 *   resolveStaleAfterDays({ ..., feedback: { upstream: { corpus_path: "x", root_prd: "y" } } } as LoreConfig) // => 14 (no throw)
 */
export function resolveStaleAfterDays(config: LoreConfig | undefined): number {
  const feedback = config?.["feedback"];
  const staleAfterDays = feedback?.["stale_after_days"];
  return typeof staleAfterDays === "number" ? staleAfterDays : FeedbackConfigSchema.parse({}).stale_after_days;
}

/**
 * The default DECLARED write-wait bound in milliseconds — the ONE home of this
 * number (spec-report-issue-has-no-specified-concurrency-contract-ac-072 D4;
 * originally SPEC-078 D9's hardcoded `PRAGMA busy_timeout = 2000` literal in
 * `SQLiteStore.init`, moved here so the applied bound and the bound printed on
 * expiry cannot drift apart). `SQLiteStore` applies it when its caller supplies
 * no explicit override; `feedback.upstream.write_wait_ms` overrides it for the
 * `lore report-issue` upstream connection.
 *
 * 2000ms mirrors the multi-project mount registry's tolerance for a brief
 * overlapping write from another mounted instance (SPEC-078 D9's original
 * reasoning, preserved verbatim).
 */
export const DEFAULT_WRITE_WAIT_MS = 2000;

/**
 * Resolve the effective `feedback.upstream.write_wait_ms` bound — the declared
 * number of milliseconds a `lore report-issue` write waits for a contended
 * upstream corpus before refusing loudly.
 *
 * @invariant Reads via BRACKET notation, for the SAME reason
 *   {@link resolveStaleAfterDays} does: `tests/unit/adapters/feedback-read-site-
 *   invariant.test.ts` pins `resolveFeedbackUpstreamCfg`
 *   (`report-issue-wiring.ts`) as the SOLE dot-notation `.feedback` reader, and
 *   this is a sibling field read for a different concern (the write-contention
 *   contract, not upstream provisioning).
 * @invariant Falls back to {@link DEFAULT_WRITE_WAIT_MS} whenever the value is
 *   absent or not a number — this is a DECLARED default for an optional field,
 *   not a silent fallback for a required one: the resolved value is always the
 *   one actually applied to the connection AND the one printed on expiry.
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns Effective wait bound in milliseconds
 * @example
 *   resolveUpstreamWriteWaitMs(undefined) // => 2000
 *   resolveUpstreamWriteWaitMs({ ..., feedback: { upstream: { corpus_path: "x", root_prd: "y", write_wait_ms: 500 } } }) // => 500
 */
export function resolveUpstreamWriteWaitMs(config: LoreConfig | undefined): number {
  const upstream = config?.["feedback"]?.["upstream"];
  // reason: `upstream` is now a union of the legacy SQLite shape (which may
  // carry `write_wait_ms`) and the GitHub shape (which never does, spec-the-
  // defect-channel-reaches-no-machine-but-its-own-github P2) — a plain `?.`
  // chain through a union member that lacks the key is a TS error, not a
  // runtime concern, so the presence check is explicit here.
  const writeWaitMs = upstream !== undefined && "write_wait_ms" in upstream ? upstream.write_wait_ms : undefined;
  return typeof writeWaitMs === "number" ? writeWaitMs : DEFAULT_WRITE_WAIT_MS;
}

/**
 * Resolve the effective `workflow.attestation.min_ratio` floor from an optional
 * LoreConfig — `null` when UNCONFIGURED (spec-plan-close-predicates-measure-
 * invariants-an-applicability §D4, superseding SPEC-069 §Design Decisions D1's
 * `0.5` schema default). Absence of the whole config, the `workflow` section, or
 * `workflow.attestation` specifically, or an unset `min_ratio` within it, ALL
 * resolve to `null` — the ratio conjunct is OPT-IN, and only an EXPLICITLY
 * configured value ever turns it on. This is the deliberate migration rule: a
 * Zod-level default here would make "absent" and "explicitly 0.5" indistinguishable
 * at every read site, silently keeping the old always-on behavior alive under a
 * new name.
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
 * a fixture must degrade to `null`, not throw on `.attestation` being `undefined`.
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns The explicitly configured `workflow.attestation.min_ratio`, or `null`
 *   when unconfigured (the ratio conjunct does not run at all).
 * @example
 *   resolveAttestationMinRatio(undefined) // => null
 *   resolveAttestationMinRatio({ ..., workflow: { attestation: { min_ratio: 0.3 } } }) // => 0.3
 *   resolveAttestationMinRatio({ ..., workflow: { gates: {} } } as LoreConfig) // => null (no throw)
 */
export function resolveAttestationMinRatio(config: LoreConfig | undefined): number | null {
  return config?.workflow?.attestation?.min_ratio ?? null;
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

/**
 * Resolve the effective `workflow.bootstrap_injection.*` budgets as a
 * `BootstrapInjectionBudgets` (SPEC-080(bootstrap-injection) §Public Interface) from an optional
 * LoreConfig. Mirrors {@link resolveStalenessDefaults} exactly — absence of
 * the whole config, the `workflow` section, or `workflow.bootstrap_injection`
 * specifically all fall back to the schema defaults ({5, 3, 3, 8000}).
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns `{maxActivePlans, maxHandoffs, maxPendingSlugs, charBudget}` — the
 *   exact scalar shape `buildBootstrapInjection` (`session.ts`) accepts as
 *   its `budgets` parameter (the `claim_ttl_minutes` DI precedent: a caller
 *   resolves this ONCE and threads the plain object, never a raw config
 *   passthrough).
 * @example
 *   resolveBootstrapInjectionBudgets(undefined)
 *   // => { maxActivePlans: 5, maxHandoffs: 3, maxPendingSlugs: 3, charBudget: 8000 }
 *   resolveBootstrapInjectionBudgets({ ..., workflow: { bootstrap_injection: { char_budget: 4000 } } })
 *   // => { maxActivePlans: 5, maxHandoffs: 3, maxPendingSlugs: 3, charBudget: 4000 }
 */
export function resolveBootstrapInjectionBudgets(config: LoreConfig | undefined): BootstrapInjectionBudgets {
  const section = (config?.workflow ?? WorkflowConfigSchema.parse({})).bootstrap_injection;
  return {
    maxActivePlans: section.max_active_plans,
    maxHandoffs: section.max_handoffs,
    maxPendingSlugs: section.max_pending_slugs,
    charBudget: section.char_budget,
  };
}

/**
 * Resolve the effective `context.memory_files.*` budgets as a
 * {@link MemoryFileBudgets} from an optional LoreConfig
 * (spec-project-claude-md-content-contract-governance-injected §D1/D8).
 * Mirrors {@link resolveStalenessDefaults}/{@link resolveDriftEnabled} —
 * absence of the whole config, the `context` section, or
 * `context.memory_files` specifically all fall back to the schema defaults
 * (root 300L/30720B, module 200L/16384B, enabled: true,
 * filenames: ["CLAUDE.md"], warn_threshold_fraction: 0.9). Unlike
 * {@link resolveBootstrapInjectionBudgets}, this returns the section's own
 * snake_case shape verbatim — no camelCase projection — since
 * `packages/lore/src/service/claude-md-check.ts`'s `lintMemoryFiles`/
 * `computeHeadroom` are the sole consumers and the spec's
 * `MemoryFileFinding` shape is itself snake_case-free-form.
 *
 * @param config - Parsed LoreConfig, or undefined when no config file was loaded
 * @returns `{enabled, filenames, root: {max_lines, max_bytes}, module: {max_lines, max_bytes}, warn_threshold_fraction}`
 * @example
 *   resolveMemoryFileBudgets(undefined)
 *   // => { enabled: true, filenames: ["CLAUDE.md"], root: {max_lines: 300, max_bytes: 30720}, module: {max_lines: 200, max_bytes: 16384}, warn_threshold_fraction: 0.9 }
 *   resolveMemoryFileBudgets({ ..., context: { memory_files: { enabled: false } } })
 *   // => { enabled: false, filenames: ["CLAUDE.md"], root: {max_lines: 300, max_bytes: 30720}, module: {max_lines: 200, max_bytes: 16384}, warn_threshold_fraction: 0.9 }
 */
export function resolveMemoryFileBudgets(config: LoreConfig | undefined): MemoryFileBudgets {
  return (config?.context ?? contextConfigSchema.parse({})).memory_files;
}

/**
 * Where a resolved {@link MemoryFileBudgets} actually came from — the channel
 * {@link resolveMemoryFileBudgets}'s plain-value return does not have.
 *
 * THREE of these five routes end at the very same schema defaults, and only
 * ONE of them is a substitution the operator must hear about. A boolean
 * `usedDefaults` flag would collapse exactly the distinction that matters, so
 * the discriminant is the state itself (`state-as-data`), and the one route
 * that must speak cannot be constructed without its `reason`.
 *
 * - `config` — the whole `LoreConfig` parsed. The budgets are the operator's,
 *   including the case where they authored no `context:` block at all (a
 *   valid config without one resolves to the schema defaults BY the
 *   operator's own choice).
 * - `context-salvage` — the config failed whole-`LoreConfig` validation
 *   somewhere else (classically: a hand-authored `.lore/config.yaml` carrying
 *   only a `context:` block, no `lore init` run yet), but the `context`
 *   sub-tree re-validated on its own. The operator's numbers ARE in effect;
 *   nothing was substituted.
 * - `no-config` — no `.lore/config.yaml` on disk. The legitimate zero-config
 *   case: defaults are the answer, and announcing here would train operators
 *   to ignore the notice.
 * - `no-context-section` — the config is invalid elsewhere AND never authored
 *   a `context:` key. Still not a substitution: a VALID config without
 *   `context` resolves to these identical defaults, so no operator choice is
 *   being ignored.
 * - `substituted-defaults` — a `context:` block WAS authored (or the file
 *   exists but its contents are unreadable/unparseable, so whether one was
 *   authored is unknowable) and the budgets in effect are NOT it. ⛔ This is
 *   the only route that may not be silent.
 *
 * Source: task-lore-status-check-claude-md-silently-runs-on-schema.
 */
export type MemoryFileBudgetResolution =
  | { readonly source: "config"; readonly budgets: MemoryFileBudgets }
  | { readonly source: "context-salvage"; readonly budgets: MemoryFileBudgets }
  | { readonly source: "no-config"; readonly budgets: MemoryFileBudgets }
  | { readonly source: "no-context-section"; readonly budgets: MemoryFileBudgets }
  | { readonly source: "substituted-defaults"; readonly budgets: MemoryFileBudgets; readonly reason: string };

/** Renders a `ZodError`'s issues as `path: message` pairs — keeps the offending FIELD NAME in the relayed text. */
function formatContextIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("; ");
}

/** True for the one fs failure that means "the operator simply has no config file". */
function isFileNotFoundCause(cause: Error | undefined): boolean {
  return cause !== undefined && (cause as { code?: unknown }).code === "ENOENT";
}

/**
 * Resolve `context.memory_files.*` budgets from an ALREADY-ATTEMPTED
 * `loadConfig` result, reporting WHERE they came from
 * (spec-project-claude-md-content-contract-governance-injected §D1/D8).
 *
 * ⛔ This is the single admission seam for budget resolution. Its predecessor
 * shape — two byte-identical private copies in
 * `adapters/cli/commands/status.ts` and `adapters/cli/commands/context.ts`,
 * both ending in a bare `return resolveMemoryFileBudgets(undefined)` — let
 * `lore status --check-claude-md` print per-doc numbers and exit 0/3 against
 * thresholds the operator never chose and could not tell had been
 * substituted. The mechanism root was the plain-value return type, not the
 * code path: with no channel to report provenance, the silence was structural
 * and would return the next time a `context` field was added. Callers get the
 * provenance whether they want it or not, and
 * {@link formatMemoryFileBudgetSubstitution} is the shared renderer both CLI
 * consumers use so the operator-facing wording cannot drift between them.
 *
 * ⛔ The `context-salvage` branch is deliberate and load-bearing (spec Module
 * Boundary invariant 2): `--check-claude-md` must work "config-only",
 * independent of whether the rest of `LoreConfig` has ever been validated, so
 * a hand-authored `.lore/config.yaml` holding ONLY a `context:` block is
 * honoured rather than ignored. Do not simplify it away.
 *
 * ⛔ The fix for an unparseable `context` block is to repair the config, NEVER
 * to loosen `contextConfigSchema`. The ordered warn/evict pair refusal is
 * correct; the defect was that its refusal got swallowed downstream.
 *
 * @param configResult - The already-attempted `loadConfig(dir)` result. Taken
 *   as a value (not a directory) so this stays pure and browser-safe — file IO
 *   lives in `config-node.ts` — and so a caller that already loaded the config
 *   for other reasons performs exactly one filesystem read per invocation.
 * @returns A {@link MemoryFileBudgetResolution} — always usable `budgets`,
 *   plus the `source` that produced them.
 * @example
 *   resolveMemoryFileBudgetsFromConfigResult(loadConfig(cwd))
 *   // => { source: "config", budgets: {...} }
 *   // => { source: "substituted-defaults", budgets: {...schema defaults}, reason: "…evict_threshold_fraction…" }
 */
export function resolveMemoryFileBudgetsFromConfigResult(
  configResult: Result<LoreConfig, LoreError>,
): MemoryFileBudgetResolution {
  if (configResult.ok) {
    return { source: "config", budgets: resolveMemoryFileBudgets(configResult.value) };
  }

  const schemaDefaults = resolveMemoryFileBudgets(undefined);
  const { error } = configResult;

  if (error.code === "STORE_ERROR") {
    if (isFileNotFoundCause(error.cause)) return { source: "no-config", budgets: schemaDefaults };
    // The file is there and we could not read it, so whether it configured
    // budgets is UNKNOWABLE — the honest verdict is a substitution, never a
    // silent default.
    return {
      source: "substituted-defaults",
      budgets: schemaDefaults,
      reason: `.lore/config.yaml exists but could not be read (${error.message}), so whether it configured \`context.memory_files\` is UNKNOWN`,
    };
  }

  if (error.code === "VALIDATION_ERROR" && typeof error.value === "object" && error.value !== null) {
    const contextCandidate = (error.value as Record<string, unknown>)["context"];

    // No `context:` key authored at all — a VALID config without one resolves
    // to these same defaults, so there is no operator choice being overridden.
    if (contextCandidate === undefined) return { source: "no-context-section", budgets: schemaDefaults };

    const contextParse = contextConfigSchema.safeParse(contextCandidate);
    if (contextParse.success) return { source: "context-salvage", budgets: contextParse.data.memory_files };

    return {
      source: "substituted-defaults",
      budgets: schemaDefaults,
      reason: `.lore/config.yaml's \`context\` section was refused by its own schema — ${formatContextIssues(contextParse.error)}`,
    };
  }

  // Malformed YAML, or YAML parsing to a scalar: `error.value` is the raw TEXT
  // (or absent), so the `context` key cannot even be looked at.
  return {
    source: "substituted-defaults",
    budgets: schemaDefaults,
    reason: `.lore/config.yaml could not be parsed (${error.code === "VALIDATION_ERROR" ? `${error.field}: ${error.message}` : error.code}), so whether it configured \`context.memory_files\` is UNKNOWN`,
  };
}

/**
 * The operator-facing notice for a {@link MemoryFileBudgetResolution} — the
 * ONE renderer both CLI budget consumers (`lore status --check-claude-md` and
 * `lore context init|refresh`) write to stderr, so the wording cannot drift
 * between them.
 *
 * Returns `undefined` for every source that did NOT substitute, which makes
 * the correct call site trivially `const notice = …; if (notice !== undefined)
 * write(notice)` — a caller cannot accidentally announce a legitimate default.
 *
 * ⛔ Warn-and-proceed, not refuse. `lore status --check-claude-md`'s exit code
 * has exactly two documented verdicts at its two shipped consumers:
 * `assets/hooks/claude-md-guard.sh` maps `0 → allow`, `3 → block`, and every
 * OTHER code to "undocumented verdict — failing open", while `hooks/pre-push`
 * blocks the push on any non-zero. A refusal exit code would therefore
 * silently convert "measured against the wrong budgets" into "not measured at
 * all" at the guard hook — a strictly worse silence at the surface whose whole
 * purpose is to block an over-ceiling write. The notice is the signal; the
 * exit code stays a measurement of the files. `lore status --check-claude-md
 * --json` additionally carries the provenance in its payload, since a stderr
 * line is invisible to a `--json` consumer.
 *
 * @param resolution - The provenance from {@link resolveMemoryFileBudgetsFromConfigResult}.
 * @param configDir - Directory the `.lore/config.yaml` was resolved from — named
 *   in the notice so an operator running from a subdirectory knows WHICH file to repair.
 * @returns The multi-line notice, or `undefined` when nothing was substituted.
 * @example
 *   formatMemoryFileBudgetSubstitution({ source: "no-config", budgets }, "/repo") // => undefined
 */
export function formatMemoryFileBudgetSubstitution(
  resolution: MemoryFileBudgetResolution,
  configDir: string,
): string | undefined {
  if (resolution.source !== "substituted-defaults") return undefined;

  return (
    `Warning: SUBSTITUTED schema-default memory-file budgets — the ceilings in effect are NOT the ones ${configDir} configured.\n` +
    `  cause: ${resolution.reason}\n` +
    "  fix: repair .lore/config.yaml (run `lore governance claude-md` for the content contract), then re-run. " +
    "Do NOT loosen the schema — the refusal above is correct."
  );
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
  if (issue.code === z.ZodIssueCode.invalid_union) {
    // reason: a `z.union` of mutually-exclusive object shapes (e.g.
    // `FeedbackConfigSchema.upstream`'s legacy-SQLite-vs-GitHub split, spec-
    // the-defect-channel-reaches-no-machine-but-its-own-github P2) reports
    // ONE top-level `invalid_union` issue when EVERY branch fails, which
    // would otherwise collapse to a bare "feedback.upstream: Invalid input"
    // — discarding the per-branch detail a reader needs to find the actual
    // typo. Pick the branch with the FEWEST issues (the one closest to a
    // match — a value that already satisfies one branch's required keys
    // fails that branch with only its genuinely-wrong keys, while every
    // OTHER branch additionally reports "missing required key" for every
    // field the value never intended to supply) and recurse into ITS most
    // specific issue, preferring `unrecognized_keys` the same way the
    // top-level case above does. Ties keep the FIRST-declared branch,
    // matching this file's existing precedent of favouring declaration
    // order (`parseConfig`'s own `aiIssue ?? issues[0]`).
    const branchIssueLists = issue.unionErrors.map((branchError) => branchError.issues);
    const fewestIssues = branchIssueLists.reduce<z.ZodIssue[] | undefined>((chosen, candidate) => {
      if (chosen === undefined) return candidate;
      return candidate.length < chosen.length ? candidate : chosen;
    }, undefined);
    if (fewestIssues !== undefined && fewestIssues.length > 0) {
      // reason: `fewestIssues[0]` is safe — `.length > 0` was just checked —
      // but `noUncheckedIndexedAccess` cannot see that through the `??`, so
      // the non-null assertion documents a runtime-proven fact, not a guess.
      const preferred =
        fewestIssues.find((candidate) => candidate.code === z.ZodIssueCode.unrecognized_keys) ?? fewestIssues[0]!;
      return describeConfigIssue(preferred);
    }
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
