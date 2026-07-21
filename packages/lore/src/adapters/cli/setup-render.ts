/**
 * Terminal rendering for `lore setup`'s post-run install receipt, `--dry-run` plan
 * preview, `--uninstall` reversal report, and the `--project` scaffold receipt
 * (SPEC-046 §Design "`adapters/cli/setup-render.ts`", §Scope "Post-run receipt";
 * SPEC-060 §Scope D5/D6 for the `--project` half). Split out of `commands/setup.ts`
 * for vitest-testability, mirroring `assess-render.ts` / `review-render.ts` —
 * `commands/setup.ts` will transitively import `loader.ts` (`bun:sqlite`), which
 * vitest cannot resolve, but this module imports only `@lore/core` types,
 * `../../service/setup-service.js` types, and `../../flows/setup-project-flow.js`'s
 * `ProjectScaffoldReport` type (all erased at compile time — `import type` never
 * emits a runtime import, so none of these pull `bun:sqlite` into this module's
 * resolution graph).
 *
 * Public surface:
 *   - renderInstallReceipt(receipt, ctx) — post-`SetupService.install()` report
 *   - renderInstallPlan(plan, ctx) — post-`SetupService.planInstall()` (`--dry-run`) preview
 *   - renderUninstallReceipt(receipt, ctx) — post-`SetupService.uninstall()` report
 *   - renderProjectScaffoldReceipt(receipt, ctx) — post-`scaffoldProject()` `--project` report
 *   - PROJECT_NEXT_STEPS — the ordered `--project` follow-up list (SPEC-060 D5), the
 *     single SSOT both this module's text renderer and the CLI adapter's future
 *     `--json` `next_steps` field must read from (AC-060-6's "same order" requirement)
 *   - ProjectScaffoldReceipt — `ProjectScaffoldReport` plus the two additive fields
 *     (`backups`, `manifestPath`) this renderer needs (see its own doc comment for
 *     why they are NOT yet part of `ProjectScaffoldReport` itself)
 *   - SetupRenderCtx — the caller-supplied context bag all four renderers take
 *
 * Invariants:
 *   - Pure string assembly — no `console.*`/`process.*` calls anywhere in this module;
 *     the CLI command adapter (`commands/setup.ts`) owns printing and exit-code mapping
 *     (the "adapters/cli: no business logic, no IO" convention this repo already
 *     applies to `assess-render.ts`/`review-render.ts`).
 *   - Deterministic — every path listing (written/skipped/backup/removal paths) and
 *     every kind-count grouping is computed over a SORTED copy of its input, so two
 *     receipts differing only in array insertion order (e.g. because the underlying
 *     writer/reader port resolved entries in a different sequence) render
 *     byte-identically. This is the module's REGRESSION guarantee.
 *   - `ctx.mcpErrorTail` is an ADDITIVE, OPTIONAL field beyond `{targetDir, binPath}` —
 *     `SetupReceipt.mcp: "failed"` (`setup-service.ts`) is a bare tri-state marker with
 *     no error detail of its own (by design: MCP failure never aborts the run, see that
 *     module's invariants). This renderer's `"failed"` branch can show a caller-supplied
 *     stderr/error tail when the CLI adapter has one on hand (e.g. the
 *     `McpRegistrar.add`/`remove()` call's `LoreError.message`), without requiring
 *     `SetupService`/`SetupReceipt` to grow a field it doesn't itself need.
 *   - Plain text, no ANSI color codes — matches `assess-render.ts`/`review-render.ts`.
 *     Unicode is limited to the corpus-wide convention marks already used elsewhere in
 *     this adapter (`✓`/`✘`/`·`, see `lore ac list`/`lore verify`).
 *   - `receipt.written` is DOCUMENTED (on `SetupReceipt`, `setup-service.ts`) to never
 *     contain a `kind: "mcp"` entry (the mcp registration outcome is carried entirely by
 *     `receipt.mcp`, not as a manifest-entry row) — this module's kind-grouping helper
 *     therefore only ever iterates the five non-mcp kinds; a `mcp`-kind row reaching it
 *     would be a `SetupService` contract violation, not something this renderer guards
 *     against defensively.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-046 §Design ("`adapters/cli/setup-render.ts`"), §Scope "Post-run receipt".
 */

import type { InstallPlan, PlannedSkip, PlannedWrite, SetupEntry, SetupEntryKind } from "@lore/core";
import type { ProjectScaffoldReport } from "../../flows/setup-project-flow.js";
import type { SetupReceipt } from "../../service/setup-service.js";

/** Context every renderer in this module needs beyond the receipt/plan itself. */
export interface SetupRenderCtx {
  /** Resolved target directory (`--claude-dir` > `$CLAUDE_CONFIG_DIR` > `homedir()`). */
  targetDir: string;
  /** Absolute path to the `lore` binary — echoed in the MCP-skipped manual-registration hint. */
  binPath: string;
  /**
   * Optional stderr/error-message tail for an `mcp: "failed"` outcome — see this
   * module's header comment for why `SetupReceipt` itself never carries this detail.
   */
  mcpErrorTail?: string;
}

/** Non-`mcp` kinds, in fixed rendering order (mirrors `SETUP_ENTRY_KINDS`' declared order). */
const KIND_ORDER: readonly Exclude<SetupEntryKind, "mcp">[] = ["skill", "agent", "hook", "governance", "settings-hook"];

const KIND_LABEL: Record<Exclude<SetupEntryKind, "mcp">, string> = {
  skill: "skill",
  agent: "agent",
  hook: "hook",
  governance: "governance",
  "settings-hook": "settings",
};

/** Kinds rendered as a single ✓ marker rather than a pluralized count (one-of-a-kind assets). */
const SINGULAR_KINDS = new Set<Exclude<SetupEntryKind, "mcp">>(["governance", "settings-hook"]);

function pluralizeCount(n: number, label: string): string {
  return `${n} ${label}${n === 1 ? "" : "s"}`;
}

/**
 * Groups a list of `{kind}`-bearing rows by kind (fixed `KIND_ORDER`) and renders the
 * "N skills, N agents, N hooks, governance ✓" style summary shared by the install
 * receipt's `Written:` line and the dry-run plan's `Would write:` line.
 */
function renderKindSummary(rows: ReadonlyArray<{ kind: SetupEntryKind }>): string {
  const counts = new Map<SetupEntryKind, number>();
  for (const row of rows) counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);

  const segments: string[] = [];
  for (const kind of KIND_ORDER) {
    const n = counts.get(kind) ?? 0;
    if (n === 0) continue;
    segments.push(SINGULAR_KINDS.has(kind) ? `${KIND_LABEL[kind]} ✓` : pluralizeCount(n, KIND_LABEL[kind]));
  }
  return segments.length > 0 ? segments.join(", ") : "none";
}

/** Renders a sorted, indented path listing, or a single `emptyLabel` line when empty. */
function renderPathList(paths: readonly string[], emptyLabel: string): string[] {
  if (paths.length === 0) return [`  ${emptyLabel}`];
  return [...paths].sort().map((p) => `  ${p}`);
}

/**
 * Renders the MCP outcome line. `direction` disambiguates `SetupReceipt.mcp`'s shared
 * tri-state enum — `"registered"` means "add succeeded" for an install and "remove
 * succeeded" for an uninstall (see `SetupReceipt`'s per-field JSDoc on `setup-service.ts`).
 */
function renderMcpLine(mcp: SetupReceipt["mcp"], ctx: SetupRenderCtx, direction: "install" | "uninstall"): string {
  const prefix = direction === "install" ? "MCP" : "MCP removal";

  if (mcp === "registered") {
    return direction === "install" ? `${prefix}: registered ✓` : `${prefix}: de-registered ✓`;
  }
  if (mcp === "skipped") {
    return direction === "install"
      ? `${prefix}: skipped (claude not found — run manually: claude mcp add -s user lore -- ${ctx.binPath} --mcp-server)`
      : `${prefix}: skipped (no tracked mcp entry)`;
  }
  // mcp === "failed"
  return ctx.mcpErrorTail ? `${prefix}: failed (${ctx.mcpErrorTail})` : `${prefix}: failed`;
}

/**
 * Renders `SetupService.install()`'s outcome (`SetupReceipt`) for terminal output.
 *
 * @param receipt - The install outcome to render.
 * @param ctx - Rendering context (`targetDir`, `binPath`, optional `mcpErrorTail`).
 * @returns A deterministic, multi-line plain-text report.
 * @throws Never.
 *
 * @example
 * renderInstallReceipt(
 *   { written: [], skipped: [], backups: [], mcp: "skipped", manifestPath: "/x/.lore-setup-manifest.json" },
 *   { targetDir: "/x", binPath: "/usr/local/bin/lore" },
 * );
 * // => "✓ lore setup complete → /x\n\nWritten: none — all 0 up-to-date\n..."
 */
export function renderInstallReceipt(receipt: SetupReceipt, ctx: SetupRenderCtx): string {
  const lines: string[] = [];

  lines.push(`✓ lore setup complete → ${ctx.targetDir}`);
  lines.push("");

  const writtenEntries: readonly SetupEntry[] = receipt.written;
  if (writtenEntries.length === 0) {
    lines.push(`Written: none — all ${receipt.skipped.length} up-to-date`);
  } else {
    lines.push(`Written: ${renderKindSummary(writtenEntries)}`);
  }
  lines.push(`Skipped: ${receipt.skipped.length}`);
  lines.push("");

  lines.push("Backups:");
  lines.push(...renderPathList(receipt.backups, "none"));
  lines.push("");

  lines.push(renderMcpLine(receipt.mcp, ctx, "install"));
  lines.push("");

  lines.push(`Manifest: ${receipt.manifestPath}`);
  lines.push("");

  lines.push("Next steps:");
  lines.push("  - Start a new Claude Code session to pick up the new skills/agents/hooks.");
  lines.push("  - Run `lore setup --project` inside a repo to scaffold its project-level hooks too.");

  return lines.join("\n");
}

/**
 * Renders `SetupService.planInstall()`'s outcome (`InstallPlan`, `--dry-run`) for
 * terminal output — a preview of what `install()` WOULD do, with zero writes performed.
 *
 * @param plan - The dry-run decision to render.
 * @param ctx - Rendering context (`targetDir`, `binPath`; `mcpErrorTail` is unused here —
 *   `planInstall()` never touches the MCP registrar, see `setup-service.ts`'s invariant I4).
 * @returns A deterministic, multi-line plain-text preview.
 * @throws Never.
 */
export function renderInstallPlan(plan: InstallPlan, ctx: SetupRenderCtx): string {
  const lines: string[] = [];

  lines.push(`Plan for ${ctx.targetDir} (dry-run: nothing written)`);
  lines.push("");

  const writes: readonly PlannedWrite[] = plan.writes;
  lines.push(`Would write: ${writes.length === 0 ? "none" : renderKindSummary(writes)}`);
  lines.push(...renderPathList(writes.map((w) => w.path), "none"));
  lines.push("");

  const skips: readonly PlannedSkip[] = plan.skips;
  lines.push(`Would skip: ${skips.length}`);
  lines.push(...renderPathList(skips.map((s) => s.path), "none"));
  lines.push("");

  lines.push("Would back up:");
  lines.push(...renderPathList(plan.backups, "none"));
  lines.push("");

  if (plan.removals.length > 0) {
    lines.push("Would remove (no longer declared by the asset payload):");
    lines.push(...renderPathList(plan.removals, "none"));
    lines.push("");
  }

  lines.push("dry-run: nothing written");

  return lines.join("\n");
}

/**
 * Renders `SetupService.uninstall()`'s outcome (`SetupReceipt`, reused per its
 * per-field uninstall semantics — see `setup-service.ts`'s `SetupReceipt` JSDoc) for
 * terminal output.
 *
 * @param receipt - The uninstall outcome to render. `written` is always `[]` (nothing
 *   is "written" during a reversal); `skipped` holds paths removed with no backup;
 *   `backups` holds paths successfully restored FROM a backup.
 * @param ctx - Rendering context (`targetDir`, `binPath`, optional `mcpErrorTail`).
 * @returns A deterministic, multi-line plain-text report.
 * @throws Never.
 */
export function renderUninstallReceipt(receipt: SetupReceipt, ctx: SetupRenderCtx): string {
  const lines: string[] = [];

  lines.push(`✓ lore setup uninstalled from ${ctx.targetDir}`);
  lines.push("");

  lines.push(`Removed (no backup existed): ${receipt.skipped.length}`);
  lines.push(...renderPathList(receipt.skipped, "none"));
  lines.push("");

  lines.push(`Restored from backup: ${receipt.backups.length}`);
  lines.push(...renderPathList(receipt.backups, "none"));
  lines.push("");

  lines.push(renderMcpLine(receipt.mcp, ctx, "uninstall"));
  lines.push("");

  lines.push(`Manifest removed: ${receipt.manifestPath}`);

  return lines.join("\n");
}

// ─── `--project` scaffold receipt (SPEC-060 §Scope D5/D6) ──────────────────

/**
 * `flows/setup-project-flow.ts::ProjectScaffoldReport` plus ONE additive
 * field — `manifestPath` — that report doesn't itself carry (it's an
 * adapter-derived value: `setup-project-flow.ts` never resolves a display
 * path, it only reports `report.manifest.detail`, which holds an ERROR
 * message rather than a path on a `"failed"` outcome — see
 * `commands/setup.ts::runProjectScaffold`, which now derives `manifestPath`
 * from the exported `PROJECT_MANIFEST_RELATIVE_PATH` constant unconditionally,
 * so this receipt always has a real path regardless of that step's status).
 *
 * `backups` is now INHERITED directly from `ProjectScaffoldReport` (this
 * module previously redeclared it locally, pending the D1 task landing the
 * field — that landed field is `string[]` of BACKUP DESTINATION paths, e.g.
 * `.lore/.lore-backups/<iso>/CLAUDE.md`, matching the semantics this
 * renderer always assumed — see `setup-project-flow.ts`'s top-level doc
 * comment, "`backups` semantics", for the deliberate resolution of what was
 * briefly a same-field-different-meaning ambiguity between the D1 task's
 * original doc comment and this module's). D6 exists specifically so an
 * operator can find and recover from a clobbered file (SPEC-060 §Scope D4's
 * documented CLAUDE.md overwrite trade-off) — printing only the ORIGINAL
 * path (already visible elsewhere in the receipt, e.g. the `claude_md` row)
 * would not tell them WHERE the recovery copy lives. AC-060-5 confirms this
 * reading: "stdout contains that backup path" refers to the literal
 * `.lore/.lore-backups/<iso>/CLAUDE.md` path, not `CLAUDE.md` itself.
 */
export type ProjectScaffoldReceipt = ProjectScaffoldReport & {
  /** Absolute path to the repo-level `.lore-project-manifest.json` ledger (D1). */
  manifestPath: string;
};

/**
 * Ordered follow-ups printed after a `lore setup --project` run (SPEC-060 D5).
 * Order is semantic, not incidental — each step's output is the next step's
 * input: `/lore-init-context` fills the module-level `CLAUDE.md` layer the
 * scaffold left as an empty stub (D4); `/lore-kickoff` bootstraps the initial
 * corpus (root PRD + first spec) INTO the `.lore/` this run created (D1); the
 * first `lore create prd` is the literal first corpus-write command a
 * follower can copy-paste once both skills have run. This is the ONE ordered
 * list both this module's text renderer and the CLI adapter's future `--json`
 * `next_steps` field must read from — never two independently authored
 * copies (AC-060-6's "text mode prints the same next-steps in the same
 * order" requirement is only satisfiable with a single shared SSOT).
 */
export const PROJECT_NEXT_STEPS: readonly string[] = [
  "Run /lore-init-context to fill in this repo's CLAUDE.md module layer.",
  "Run /lore-kickoff to bootstrap the initial corpus (root PRD + first spec).",
  'Run `lore create prd --title "<your product>"` to start your first PRD.',
];

/**
 * Renders the D6 "loud overwrite reporting" backups block — a marker-prefixed,
 * one-line-per-path listing with an explicit recovery pointer. Deliberately
 * NOT the quiet `renderPathList`-based convention this module's other three
 * renderers use for their own `Backups:`/`Would back up:` sections: those
 * report a machine-target install's backups as one item among many equally
 * routine facts, but a `--project` backup is the operator's ONLY way to
 * recover pre-existing content a backup-then-overwrite step just clobbered
 * (D4's documented `CLAUDE.md` trade-off) — a bare indented path a reader's
 * eye slides past would defeat the entire point of D6.
 *
 * @param backups - Backup destination paths (see {@link ProjectScaffoldReceipt}).
 * @returns One rendered line per backup. Never called when `backups` is empty
 *   — {@link renderProjectScaffoldReceipt} omits the whole section instead
 *   (see that function's BOUNDARY note).
 */
function renderLoudBackupLines(backups: readonly string[]): string[] {
  return [...backups]
    .sort()
    .map((path) => `  ⚠ backed up existing file → ${path}\n    (original overwritten; restore from this path if needed)`);
}

/**
 * Renders `flows/setup-project-flow.ts::scaffoldProject()`'s outcome
 * (extended with the D1/D6 fields, see {@link ProjectScaffoldReceipt}) for
 * terminal output.
 *
 * @param receipt - The `--project` scaffold outcome to render.
 * @param ctx - Rendering context; only `targetDir` is used (`binPath`/`mcpErrorTail`
 *   are meaningless here — `--project` never touches the MCP registrar).
 * @returns A deterministic, multi-line plain-text report.
 * @throws Never.
 *
 * @example
 * renderProjectScaffoldReceipt(
 *   {
 *     init: { status: "done", detail: "/repo/.lore" },
 *     hooks: [],
 *     tree_yaml: { status: "done" },
 *     git_hooks_path: { status: "done", prior_value: null },
 *     backups: [],
 *     manifestPath: "/repo/.lore/.lore-project-manifest.json",
 *   },
 *   { targetDir: "/repo", binPath: "/usr/local/bin/lore" },
 * );
 * // => "✓ lore project scaffold → /repo\n\nInit: done (/repo/.lore)\n..."
 */
export function renderProjectScaffoldReceipt(receipt: ProjectScaffoldReceipt, ctx: SetupRenderCtx): string {
  const lines: string[] = [];

  lines.push(`✓ lore project scaffold → ${ctx.targetDir}`);
  lines.push("");

  lines.push(`Init: ${receipt.init.status}${receipt.init.detail ? ` (${receipt.init.detail})` : ""}`);
  lines.push("");

  lines.push("Hooks:");
  for (const hook of [...receipt.hooks].sort((a, b) => a.file.localeCompare(b.file))) {
    lines.push(`  ${hook.file}: ${hook.status}${hook.detail ? ` (${hook.detail})` : ""}`);
  }
  lines.push("");

  lines.push(
    `Tree blueprint: ${receipt.tree_yaml.status}${receipt.tree_yaml.detail ? ` (${receipt.tree_yaml.detail})` : ""}`,
  );
  lines.push(`.gitignore: ${receipt.gitignore.status}${receipt.gitignore.detail ? ` (${receipt.gitignore.detail})` : ""}`);
  lines.push(`CLAUDE.md: ${receipt.claude_md.status}${receipt.claude_md.detail ? ` (${receipt.claude_md.detail})` : ""}`);
  lines.push(
    `Git hooksPath: ${receipt.git_hooks_path.status} (prior: ${receipt.git_hooks_path.prior_value ?? "unset"})` +
      (receipt.git_hooks_path.detail ? ` — ${receipt.git_hooks_path.detail}` : ""),
  );
  lines.push("");

  // BOUNDARY: an empty `backups` array omits the WHOLE section — D6's "loud" intent
  // means silence when nothing happened, never a hollow "Backups: none" placeholder
  // line competing for attention with the runs that actually need to be noticed.
  if (receipt.backups.length > 0) {
    lines.push("Backups:");
    lines.push(...renderLoudBackupLines(receipt.backups));
    lines.push("");
  }

  lines.push(`Manifest: ${receipt.manifestPath}`);
  lines.push("");

  lines.push("Next steps:");
  for (const step of PROJECT_NEXT_STEPS) lines.push(`  - ${step}`);

  return lines.join("\n");
}
