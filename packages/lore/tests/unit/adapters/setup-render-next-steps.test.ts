/**
 * Six-dimension test suite for `adapters/cli/setup-render.ts`'s SPEC-060 D5/D6
 * additions — `PROJECT_NEXT_STEPS` (the receipt next-steps block) and
 * `renderProjectScaffoldReceipt` (the `--project` scaffold receipt renderer,
 * including D6's loud backup-path reporting). Pure string-output assertions —
 * no store, no filesystem, no bun:sqlite involvement (vitest-safe), mirroring
 * `setup-render.test.ts`'s existing pattern for the machine-install receipt.
 *
 * AC-060-6: `lore setup --project --json` emits `next_steps` (>=3 entries) and
 * `backups` (array); text mode prints the same next-steps in the same order.
 * This suite covers the text-mode half plus `PROJECT_NEXT_STEPS` itself (the
 * single SSOT the CLI adapter's future `--json` wiring must read from too).
 */
import { describe, expect, it } from "vitest";
import type { ProjectScaffoldReport } from "../../../src/flows/setup-project-flow.js";
import {
  PROJECT_NEXT_STEPS,
  renderInstallPlan,
  renderInstallReceipt,
  renderProjectScaffoldReceipt,
  renderUninstallReceipt,
  type ProjectScaffoldReceipt,
  type SetupRenderCtx,
} from "../../../src/adapters/cli/setup-render.js";

const CTX: SetupRenderCtx = { targetDir: "/tmp/fake-repo", binPath: "/usr/local/bin/lore" };

function baseReport(overrides: Partial<ProjectScaffoldReport> = {}): ProjectScaffoldReport {
  return {
    init: { status: "done", detail: "/tmp/fake-repo/.lore" },
    hooks: [
      { file: "hooks/g1-spec-create.sh", status: "done" },
      { file: "hooks/g2-spec-promote.sh", status: "done" },
      { file: "hooks/g3-plan-promote.sh", status: "done" },
      { file: "hooks/g4-task-claim.sh", status: "done" },
      { file: "hooks/pre-push", status: "done" },
    ],
    tree_yaml: { status: "done", detail: "lore.tree.yaml" },
    gitignore: { status: "done", detail: ".gitignore" },
    claude_md: { status: "done", detail: "CLAUDE.md" },
    git_hooks_path: { status: "done", prior_value: null },
    manifest: { status: "done", detail: ".lore/.lore-project-manifest.json" },
    backups: [],
    ...overrides,
  };
}

function baseReceipt(overrides: Partial<ProjectScaffoldReceipt> = {}): ProjectScaffoldReceipt {
  return {
    ...baseReport(),
    backups: [],
    manifestPath: "/tmp/fake-repo/.lore/.lore-project-manifest.json",
    ...overrides,
  };
}

describe("PROJECT_NEXT_STEPS", () => {
  // HAPPY — the ordered list itself: >=3 entries (AC-060-6), each a non-empty string,
  // and the documented semantic order (init-context before kickoff before first prd).
  it("HAPPY: declares >=3 ordered, non-empty follow-up steps", () => {
    expect(PROJECT_NEXT_STEPS.length).toBeGreaterThanOrEqual(3);
    for (const step of PROJECT_NEXT_STEPS) {
      expect(typeof step).toBe("string");
      expect(step.length).toBeGreaterThan(0);
    }
  });

  // BOUNDARY — the exact prescribed ordering: init-context, then kickoff, then the
  // first corpus-write command, never any other order.
  it("BOUNDARY: orders /lore-init-context before /lore-kickoff before the first `lore create prd`", () => {
    const initContextIdx = PROJECT_NEXT_STEPS.findIndex((s) => s.includes("lore-init-context"));
    const kickoffIdx = PROJECT_NEXT_STEPS.findIndex((s) => s.includes("lore-kickoff"));
    const prdIdx = PROJECT_NEXT_STEPS.findIndex((s) => s.includes("lore create prd"));

    expect(initContextIdx).toBeGreaterThanOrEqual(0);
    expect(kickoffIdx).toBeGreaterThan(initContextIdx);
    expect(prdIdx).toBeGreaterThan(kickoffIdx);
  });
});

describe("renderProjectScaffoldReceipt", () => {
  // HAPPY — a full successful scaffold: prints next steps in the SAME order as
  // PROJECT_NEXT_STEPS (AC-060-6's "text mode prints the same next-steps in the same
  // order" requirement).
  it("HAPPY: renders next steps in the exact PROJECT_NEXT_STEPS order", () => {
    const out = renderProjectScaffoldReceipt(baseReceipt(), CTX);

    expect(out).toContain("✓ lore project scaffold → /tmp/fake-repo");
    expect(out).toContain("Next steps:");

    const stepIndices = PROJECT_NEXT_STEPS.map((step) => out.indexOf(step));
    for (const idx of stepIndices) expect(idx).toBeGreaterThan(-1);
    for (let i = 1; i < stepIndices.length; i++) {
      expect(stepIndices[i]).toBeGreaterThan(stepIndices[i - 1]!);
    }
  });

  // HAPPY — SPEC-060 D3/D4: the .gitignore and CLAUDE.md step rows render
  // alongside the pre-existing hooks/tree_yaml rows.
  it("HAPPY: renders .gitignore and CLAUDE.md step status lines", () => {
    const out = renderProjectScaffoldReceipt(baseReceipt(), CTX);

    expect(out).toContain(".gitignore: done");
    expect(out).toContain("CLAUDE.md: done");
  });

  // NEGATIVE — failed steps carry their error detail into the output rather than being
  // silently dropped (no-silent-fallback discipline) — a conflict-status hook file's
  // detail message must survive rendering.
  it("NEGATIVE: surfaces a failed step's detail message rather than swallowing it", () => {
    const receipt = baseReceipt({
      init: { status: "failed", detail: "EACCES: permission denied" },
      hooks: [
        { file: "hooks/g1-spec-create.sh", status: "conflict", detail: "existing file differs from the shipped asset — left untouched" },
      ],
    });

    const out = renderProjectScaffoldReceipt(receipt, CTX);

    expect(out).toContain("EACCES: permission denied");
    expect(out).toContain("existing file differs from the shipped asset — left untouched");
    expect(out).toContain("conflict");
    expect(out).toContain("failed");
  });

  // BOUNDARY — the D6-defining case: an empty `backups` array must NOT print a
  // "Backups:" section at all (loud reporting means silence when nothing happened,
  // never a hollow "Backups: none" line competing for the reader's attention).
  it("BOUNDARY: prints no Backups section at all when backups is an empty array", () => {
    const out = renderProjectScaffoldReceipt(baseReceipt({ backups: [] }), CTX);

    expect(out).not.toContain("Backups:");
  });

  // ERROR — when a backup DID occur, its path renders loudly (a visible marker, on its
  // own line, never folded into a single grey summary line a reader can skip past) — the
  // D6 "loud overwrite reporting" requirement (AC-060-5's sibling concern: this is the
  // rendering half, not the write half, which is out of this task's anchor).
  it("ERROR: renders a backed-up path with a loud, non-skippable marker", () => {
    const backupPath = "/tmp/fake-repo/.lore/.lore-backups/2026-07-21T00-00-00.000Z/CLAUDE.md";
    const out = renderProjectScaffoldReceipt(baseReceipt({ backups: [backupPath] }), CTX);

    expect(out).toContain("Backups:");
    expect(out).toContain(backupPath);
    // the backup line must carry an attention marker, not a bare indented path (contrast
    // renderInstallReceipt's quiet `renderPathList` convention — see this file's own
    // header comment for why the semantics diverge here).
    const backupLine = out.split("\n").find((line) => line.includes(backupPath));
    expect(backupLine).toBeDefined();
    expect(backupLine).toMatch(/⚠|WARNING|backed up/i);
  });

  // STATE — multiple backups in one run: every path renders on its own line (none
  // truncated/merged), and exactly one Manifest line appears regardless of backup count.
  it("STATE: renders every backup on its own line and exactly one Manifest line", () => {
    const backups = [
      "/tmp/fake-repo/.lore/.lore-backups/2026-07-21T00-00-00.000Z/CLAUDE.md",
      "/tmp/fake-repo/.lore/.lore-backups/2026-07-21T00-00-00.000Z/.gitignore",
    ];
    const out = renderProjectScaffoldReceipt(baseReceipt({ backups }), CTX);

    for (const path of backups) {
      expect(out).toContain(path);
    }
    const manifestLines = out.split("\n").filter((line) => line.includes("Manifest:"));
    expect(manifestLines).toHaveLength(1);
    expect(manifestLines[0]).toContain("/tmp/fake-repo/.lore/.lore-project-manifest.json");
  });

  // REGRESSION — the new renderer/export must not perturb the module's pre-existing
  // public surface at all: renderInstallReceipt / renderInstallPlan /
  // renderUninstallReceipt keep producing byte-identical output for the same fixtures
  // `setup-render.test.ts` already exercises.
  describe("REGRESSION: pre-existing renderers are byte-unchanged", () => {
    it("renderInstallReceipt: unchanged for a minimal receipt", () => {
      const receipt = {
        written: [],
        skipped: [],
        backups: [],
        mcp: "registered" as const,
        manifestPath: "/tmp/fake-claude-dir/.lore-setup-manifest.json",
        // SPEC-076 T5 — SetupReceipt gained this required field; renderInstallReceipt
        // itself never reads it (see this describe block's own REGRESSION intent), so
        // an empty list keeps the byte-identical-output assertion below meaningful.
        skippedDiverged: [],
      };
      const ctx: SetupRenderCtx = { targetDir: "/tmp/fake-claude-dir", binPath: "/usr/local/bin/lore" };

      const out = renderInstallReceipt(receipt, ctx);

      expect(out).toBe(
        [
          "✓ lore setup complete → /tmp/fake-claude-dir",
          "",
          "Written: none — all 0 up-to-date",
          "Skipped: 0",
          "",
          "Backups:",
          "  none",
          "",
          "MCP: registered ✓",
          "",
          "Manifest: /tmp/fake-claude-dir/.lore-setup-manifest.json",
          "",
          "Next steps:",
          "  - Start a new Claude Code session to pick up the new skills/agents/hooks.",
          "  - Run `lore setup --project` inside a repo to scaffold its project-level hooks too.",
        ].join("\n"),
      );
    });

    it("renderInstallPlan: unchanged for a minimal plan", () => {
      const plan = { writes: [], skips: [], backups: [], removals: [] };
      const ctx: SetupRenderCtx = { targetDir: "/tmp/fake-claude-dir", binPath: "/usr/local/bin/lore" };

      const out = renderInstallPlan(plan, ctx);

      expect(out).toBe(
        [
          "Plan for /tmp/fake-claude-dir (dry-run: nothing written)",
          "",
          "Would write: none",
          "  none",
          "",
          "Would skip: 0",
          "  none",
          "",
          "Would back up:",
          "  none",
          "",
          "dry-run: nothing written",
        ].join("\n"),
      );
    });

    it("renderUninstallReceipt: unchanged for a minimal receipt", () => {
      const receipt = {
        written: [],
        skipped: [],
        backups: [],
        mcp: "registered" as const,
        manifestPath: "/tmp/fake-claude-dir/.lore-setup-manifest.json",
        // SPEC-076 T5 — SetupReceipt gained this required field; renderInstallReceipt
        // itself never reads it (see this describe block's own REGRESSION intent), so
        // an empty list keeps the byte-identical-output assertion below meaningful.
        skippedDiverged: [],
      };
      const ctx: SetupRenderCtx = { targetDir: "/tmp/fake-claude-dir", binPath: "/usr/local/bin/lore" };

      const out = renderUninstallReceipt(receipt, ctx);

      expect(out).toBe(
        [
          "✓ lore setup uninstalled from /tmp/fake-claude-dir",
          "",
          "Removed (no backup existed): 0",
          "  none",
          "",
          "Restored from backup: 0",
          "  none",
          "",
          "MCP removal: de-registered ✓",
          "",
          "Manifest removed: /tmp/fake-claude-dir/.lore-setup-manifest.json",
        ].join("\n"),
      );
    });
  });
});
