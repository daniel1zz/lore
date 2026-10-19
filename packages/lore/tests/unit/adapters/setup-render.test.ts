/**
 * Six-dimension test suite for `adapters/cli/setup-render.ts` (SPEC-046 §Acceptance
 * Criteria AC-046-E "render coverage half"). Pure string-output assertions — no store,
 * no filesystem, no bun:sqlite involvement (vitest-safe).
 */
import { describe, expect, it } from "vitest";
import type { InstallPlan, SetupEntry } from "@lore/core";
import type { SetupReceipt } from "../../../src/service/setup-service.js";
import {
  renderInstallPlan,
  renderInstallReceipt,
  renderUninstallReceipt,
  type SetupRenderCtx,
} from "../../../src/adapters/cli/setup-render.js";

const CTX: SetupRenderCtx = { targetDir: "/tmp/fake-claude-dir", binPath: "/usr/local/bin/lore" };

function entry(path: string, kind: SetupEntry["kind"], writtenAt = "2026-07-16T00:00:00.000Z"): SetupEntry {
  return { path, kind, sha256: `sha-${path}`, written_at: writtenAt };
}

function baseReceipt(overrides: Partial<SetupReceipt> = {}): SetupReceipt {
  return {
    written: [],
    skipped: [],
    backups: [],
    mcp: "registered",
    manifestPath: "/tmp/fake-claude-dir/.lore-setup-manifest.json",
    // SPEC-076 T5 — SetupReceipt gained this required field; neither renderer this
    // suite exercises reads it, so an empty default keeps every existing fixture's
    // rendered-output assertions unchanged.
    skippedDiverged: [],
    removed: [],
    ...overrides,
  };
}

describe("renderInstallReceipt", () => {
  // HAPPY — a full first-ever install: several kinds written, some skipped, some backed
  // up, MCP registered, manifest path present.
  it("HAPPY: renders a full install with grouped kind counts, backups, and mcp registered", () => {
    const receipt = baseReceipt({
      written: [
        entry("skills/lore/SKILL.md", "skill"),
        entry("skills/lore-kickoff/SKILL.md", "skill"),
        entry("agents/lore-explorer.md", "agent"),
        entry("hooks/session-start-resume.mjs", "hook"),
        entry("hooks/stop-turn-review.mjs", "hook"),
        entry("hooks/subagent-context.mjs", "hook"),
        entry("governance/corpus-workflow.md", "governance"),
      ],
      skipped: ["skills/lore-doctor/SKILL.md"],
      backups: ["settings.json"],
      mcp: "registered",
    });

    const out = renderInstallReceipt(receipt, CTX);

    expect(out).toContain("✓ lore setup complete → /tmp/fake-claude-dir");
    expect(out).toContain("2 skills");
    expect(out).toContain("1 agent");
    expect(out).toContain("3 hooks");
    expect(out).toContain("governance ✓");
    expect(out).toContain("Skipped: 1");
    expect(out).toContain("settings.json");
    expect(out).toContain("MCP: registered ✓");
    expect(out).toContain("Manifest: /tmp/fake-claude-dir/.lore-setup-manifest.json");
    expect(out).toContain("Next steps:");
    expect(out).toContain("lore setup --project");
  });

  // NEGATIVE — MCP outcomes that are NOT a clean success: claude absent (skipped, with
  // the manual registration command surfaced) and a registrar failure (stderr tail).
  describe("NEGATIVE: non-success mcp outcomes", () => {
    it("shows MCP as skipped AND surfaces the manual registration command", () => {
      const receipt = baseReceipt({ written: [entry("skills/lore/SKILL.md", "skill")], mcp: "skipped" });

      const out = renderInstallReceipt(receipt, CTX);

      expect(out).toContain("MCP: skipped");
      expect(out).toContain("claude not found");
      expect(out).toContain("claude mcp add -s user lore -- /usr/local/bin/lore --mcp-server");
    });

    it("shows MCP as skipped (already registered) — task-lore-setup-mcp-add-step-is-non-idempotent-already-exists", () => {
      const receipt = baseReceipt({ written: [entry("skills/lore/SKILL.md", "skill")], mcp: "already_registered" });

      const out = renderInstallReceipt(receipt, CTX);

      expect(out).toContain("MCP: skipped (already registered)");
      expect(out).not.toContain("MCP: registered ✓");
      expect(out).not.toContain("MCP: failed");
    });

    it("shows MCP as failed with the caller-supplied stderr tail present in output", () => {
      const receipt = baseReceipt({ written: [entry("skills/lore/SKILL.md", "skill")], mcp: "failed" });

      const out = renderInstallReceipt(receipt, { ...CTX, mcpErrorTail: "claude: command exited with code 1" });

      expect(out).toContain("MCP: failed");
      expect(out).toContain("claude: command exited with code 1");
    });

    it("shows MCP as failed with no detail when no stderr tail was supplied", () => {
      const receipt = baseReceipt({ mcp: "failed" });

      const out = renderInstallReceipt(receipt, CTX);

      expect(out).toContain("MCP: failed");
      expect(out).not.toContain("MCP: failed (");
    });
  });

  // BOUNDARY — a re-run against an already-installed target: everything skipped, nothing
  // written, no backups; and the degenerate empty-payload boundary (zero of everything).
  describe("BOUNDARY: zero-write scenarios", () => {
    it("renders 'all N up-to-date' when written is empty but entries exist (idempotent re-run)", () => {
      const receipt = baseReceipt({
        skipped: ["skills/lore/SKILL.md", "agents/lore-explorer.md", "hooks/session-start-resume.mjs"],
      });

      const out = renderInstallReceipt(receipt, CTX);

      expect(out).toContain("Written: none — all 3 up-to-date");
      expect(out).toContain("Skipped: 3");
    });

    it("renders a fully empty payload (zero written, zero skipped, no backups) without throwing", () => {
      const receipt = baseReceipt();

      const out = renderInstallReceipt(receipt, CTX);

      expect(out).toContain("Written: none — all 0 up-to-date");
      expect(out).toContain("Skipped: 0");
      expect(out).toMatch(/Backups:\n\s+none/);
    });
  });

  // ERROR — a run where some target paths were foreign/user-owned and had to be backed
  // up before being overwritten (setup-service.ts's "differing on-disk content" path) —
  // exercises the non-"none" backups listing, sorted and one-per-line.
  it("ERROR: renders every backed-up path when a partial/conflicting write occurred", () => {
    const receipt = baseReceipt({
      written: [entry("settings.json", "settings-hook"), entry("hooks/pre-push", "hook")],
      backups: ["hooks/pre-push", "settings.json"],
    });

    const out = renderInstallReceipt(receipt, CTX);

    expect(out).toContain("hooks/pre-push");
    expect(out).toContain("settings.json");
    expect(out).toContain("settings ✓");
    expect(out).toContain("1 hook");
  });

  // STATE — written vs skipped counts must both be independently visible (an install
  // that both writes new content AND leaves some already-correct content alone).
  it("STATE: distinguishes written count from skipped count in the same receipt", () => {
    const receipt = baseReceipt({
      written: [entry("skills/lore/SKILL.md", "skill"), entry("skills/lore-kickoff/SKILL.md", "skill")],
      skipped: ["agents/lore-explorer.md"],
    });

    const out = renderInstallReceipt(receipt, CTX);

    expect(out).toContain("Written: 2 skills");
    expect(out).toContain("Skipped: 1");
  });

  // REGRESSION — byte-stable format: identical input renders identically twice, and
  // shuffling array order (writer/reader ports may resolve concurrently) must not
  // change the rendered string at all (sorted-before-render determinism).
  describe("REGRESSION: deterministic ordering", () => {
    it("renders the identical string for the identical input across two calls", () => {
      const receipt = baseReceipt({
        written: [entry("skills/lore/SKILL.md", "skill"), entry("agents/lore-explorer.md", "agent")],
        skipped: ["hooks/pre-push"],
        backups: ["settings.json"],
      });

      expect(renderInstallReceipt(receipt, CTX)).toBe(renderInstallReceipt(receipt, CTX));
    });

    it("renders the identical string regardless of input array order (shuffled entries)", () => {
      const written = [
        entry("skills/lore/SKILL.md", "skill"),
        entry("agents/lore-explorer.md", "agent"),
        entry("hooks/pre-push", "hook"),
      ];
      const backups = ["settings.json", "hooks/pre-push", "skills/lore/SKILL.md"];

      const inOrder = renderInstallReceipt(baseReceipt({ written, backups }), CTX);
      const shuffled = renderInstallReceipt(
        baseReceipt({ written: [written[2]!, written[0]!, written[1]!], backups: [...backups].reverse() }),
        CTX,
      );

      expect(shuffled).toBe(inOrder);
    });
  });
});

describe("renderInstallPlan", () => {
  function basePlan(overrides: Partial<InstallPlan> = {}): InstallPlan {
    return { writes: [], skips: [], backups: [], removals: [], divergedRemovals: [], ...overrides };
  }

  it("is clearly labeled as a dry-run plan with no writes performed", () => {
    const plan = basePlan({
      writes: [{ path: "skills/lore/SKILL.md", kind: "skill", content: "x", sha256: "abc" }],
    });

    const out = renderInstallPlan(plan, CTX);

    expect(out).toContain("dry-run: nothing written");
    expect(out).toContain("Plan for /tmp/fake-claude-dir");
    expect(out).toContain("Would write");
    expect(out).toContain("skills/lore/SKILL.md");
  });

  it("lists would-skip and would-back-up paths distinctly", () => {
    const plan = basePlan({
      skips: [{ path: "skills/lore-doctor/SKILL.md", kind: "skill", sha256: "abc" }],
      backups: ["settings.json"],
    });

    const out = renderInstallPlan(plan, CTX);

    expect(out).toContain("Would skip: 1");
    expect(out).toContain("skills/lore-doctor/SKILL.md");
    expect(out).toContain("Would back up:");
    expect(out).toContain("settings.json");
  });
});

describe("renderUninstallReceipt", () => {
  // STATE — install-then-uninstall receipt pair consistency: the paths an install
  // receipt recorded as `backups` must be exactly the paths the corresponding
  // uninstall receipt recorded as `backups` (restored), by construction of
  // SetupReceipt's shared shape (setup-service.ts's per-field uninstall semantics).
  it("STATE: restored paths on the uninstall receipt equal the earlier install receipt's backups", () => {
    const installBackups = ["settings.json", "hooks/pre-push"];
    const installReceipt = baseReceipt({
      written: [entry("settings.json", "settings-hook"), entry("hooks/pre-push", "hook")],
      backups: installBackups,
    });
    const uninstallReceipt = baseReceipt({
      written: [],
      skipped: ["skills/lore/SKILL.md"], // removed, no backup existed
      backups: installBackups, // restored from the same backup set install created
      mcp: "registered",
    });

    const installOut = renderInstallReceipt(installReceipt, CTX);
    const uninstallOut = renderUninstallReceipt(uninstallReceipt, CTX);

    for (const path of installBackups) {
      expect(installOut).toContain(path);
      expect(uninstallOut).toContain(path);
    }
    expect(uninstallOut).toContain("Restored from backup: 2");
    expect(uninstallOut).toContain("Removed (no backup existed): 1");
    expect(uninstallOut).toContain("skills/lore/SKILL.md");
  });

  it("renders MCP de-registration and manifest removal lines", () => {
    const receipt = baseReceipt({ mcp: "registered" });

    const out = renderUninstallReceipt(receipt, CTX);

    expect(out).toContain("✓ lore setup uninstalled from /tmp/fake-claude-dir");
    expect(out).toContain("MCP removal: de-registered ✓");
    expect(out).toContain("Manifest removed: /tmp/fake-claude-dir/.lore-setup-manifest.json");
  });

  it("renders MCP removal as skipped when no tracked mcp entry existed", () => {
    const receipt = baseReceipt({ mcp: "skipped" });

    const out = renderUninstallReceipt(receipt, CTX);

    expect(out).toContain("MCP removal: skipped (no tracked mcp entry)");
  });

  it("renders MCP removal as failed with a stderr tail when supplied", () => {
    const receipt = baseReceipt({ mcp: "failed" });

    const out = renderUninstallReceipt(receipt, { ...CTX, mcpErrorTail: "claude: not authenticated" });

    expect(out).toContain("MCP removal: failed (claude: not authenticated)");
  });
});
