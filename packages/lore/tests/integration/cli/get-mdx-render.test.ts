// @spawns packages/lore/src/index.ts
/**
 * Integration tests for `lore get` MDX text-projection splice (SPEC-032 §3.3).
 * Runs the real CLI via subprocess against an isolated temp SQLite DB.
 *
 * Coverage:
 *   HAPPY (AC-3):      `lore get <id>` (non-raw) prints a rendered child list,
 *                       not the literal `<ChildrenOf />` tag — round-trip:
 *                       raw tag in (stored content) → rendered list out (stdout)
 *   BOUNDARY (AC-3):   `lore get <id> --raw` prints the literal tag unchanged
 *   STATE (AC-7):      `lore get <id> --json` exposes non-empty
 *                       `data.resolved_components` for a doc containing a
 *                       whitelisted placeholder, while `data.doc.content` stays
 *                       the raw, unspliced source (SSOT preserved for API
 *                       consumers — only the human-readable stdout is spliced)
 *   NEGATIVE (audit T2, spec-prd-as-living-root §4): `lore get <id>` on a doc
 *                       containing a non-whitelisted component (e.g.
 *                       `<ScriptInjection />`) strips the tag entirely from
 *                       stdout AND surfaces the strip as a warning on stderr —
 *                       the whitelist is a security validation boundary, so the
 *                       tag's bytes must never survive into rendered output.
 *   REGRESSION:        a doc with NO placeholders renders identically whether
 *                       --raw is passed or not
 *
 * @spec_ref AC-3, AC-7 — SPEC-032 §3.3; audit T2 — spec-prd-as-living-root §4
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync, appendFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Path setup ───────────────────────────────────────────────────────────────

// From packages/lore/tests/integration/cli/ → ../../../ → packages/lore/
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

// ─── Types ───────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true" },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

/** Create a PRD with the given content and return its slug. */
function createPrd(title: string, content: string, cwd: string): string {
  const r = runLore(["create", "prd", "--title", title, "--no-ai", "--content", content], cwd);
  if (r.exitCode !== 0) throw new Error(`create prd failed: ${r.stderr}`);
  const slugM = r.stdout.match(/Slug:\s+(\S+)/);
  const slug = slugM?.[1];
  if (!slug) throw new Error(`Could not extract prd slug from: ${r.stdout}`);
  return slug;
}

/**
 * Create an ADR under the given prd parent and return its slug.
 *
 * re-baseline (BR-1, BR-2): this helper used to create a SPEC and rely on it landing under
 * the PRD. A spec now takes no parent (it relates to the trees through citations), so a spec
 * is no longer a child of any PRD and `<ChildrenOf />` on a PRD can never list one. The
 * placeholder's semantics are unchanged — it lists a doc's children — so the fixture uses a
 * doc type that is still legitimately parented to a PRD.
 */
function createChildAdr(title: string, parentSlug: string, cwd: string): string {
  const r = runLore(
    ["create", "adr", "--title", title, "--no-ai", "--content", "body", "--parent", parentSlug, "--decision-status", "accepted"],
    cwd,
  );
  if (r.exitCode !== 0) throw new Error(`create adr failed: ${r.stderr}`);
  const slugM = r.stdout.match(/Slug:\s+(\S+)/);
  const slug = slugM?.[1];
  if (!slug) throw new Error(`Could not extract adr slug from: ${r.stdout}`);
  return slug;
}

/**
 * Disables all four `lore gate` service-layer checkpoints for this fixture's corpus
 * (retro follow-up item 8 test-fallout reconciliation — GateEnforcer is now wired ON
 * by default in every production `createApp`, which every subprocess-spawned `lore`
 * command in this file goes through). None of this file's ACs exercise spec-create
 * gating — `createChildAdr`'s fixed "body" content is purely a `ChildrenOf` list member,
 * never itself asserted. Mirrors the config shape
 * `tests/integration/gate-config-disable.bun.test.ts` establishes
 * (`workflow.gates.<checkpoint>.enabled`, `@lore/core::resolveGateEnabled`).
 */
function disableAllGates(dir: string): void {
  appendFileSync(
    join(dir, ".lore", "config.yaml"),
    [
      "workflow:",
      "  gates:",
      "    spec-create:",
      "      enabled: false",
      "    spec-promote:",
      "      enabled: false",
      "    plan-promote:",
      "      enabled: false",
      "    task-claim:",
      "      enabled: false",
      "",
    ].join("\n"),
  );
}

// ─── Fixture ─────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `lore-get-mdx-render-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });

  const init = runLore(["init"], tmpDir);
  if (init.exitCode !== 0) {
    throw new Error(`lore init failed: ${init.stderr}`);
  }
  disableAllGates(tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ─── HAPPY: non-raw get splices the placeholder (AC-3) ────────────────────────

describe("HAPPY — `lore get` (non-raw) renders <ChildrenOf /> as a bulleted list (AC-3)", () => {
  it("stdout shows the rendered child list, not the literal tag", () => {
    const prdSlug = createPrd("Root With Children", "# Root With Children\n\n<ChildrenOf />", tmpDir);
    createChildAdr("Child Adr One", prdSlug, tmpDir);

    const result = runLore(["get", prdSlug], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("<ChildrenOf");
    expect(result.stdout).toContain("- [adr] Child Adr One (draft)");
  });
});

// ─── BOUNDARY: --raw skips resolution entirely (AC-3) ─────────────────────────

describe("BOUNDARY — `lore get --raw` prints the literal tag unchanged (AC-3)", () => {
  it("stdout contains the raw <ChildrenOf /> tag, not a rendered list", () => {
    const prdSlug = createPrd("Root Raw", "# Root Raw\n\n<ChildrenOf />", tmpDir);
    createChildAdr("Child Adr Raw", prdSlug, tmpDir);

    const result = runLore(["get", prdSlug, "--raw"], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("<ChildrenOf />");
    expect(result.stdout).not.toContain("Child Adr Raw (draft)");
  });
});

// ─── STATE: --json exposes resolved_components, keeps doc.content raw (AC-7) ──

describe("STATE — `lore get --json` exposes non-empty resolved_components (AC-7)", () => {
  it("data.resolved_components is non-empty for a doc with a whitelisted placeholder", () => {
    const prdSlug = createPrd("Root Json", "# Root Json\n\n<ChildrenOf />", tmpDir);
    createChildAdr("Child Adr Json", prdSlug, tmpDir);

    const result = runLore(["get", prdSlug, "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: { doc: { content: string }; resolved_components?: unknown[] };
    };

    expect(Array.isArray(parsed.data.resolved_components)).toBe(true);
    expect(parsed.data.resolved_components!.length).toBeGreaterThan(0);
    // SSOT preserved: the JSON doc payload stays raw/unspliced — only stdout's
    // human-readable body is spliced (dashboard/API consumers get the source).
    expect(parsed.data.doc.content).toContain("<ChildrenOf />");
  });

  it("data.resolved_components is absent when --raw is passed", () => {
    const prdSlug = createPrd("Root Json Raw", "# Root Json Raw\n\n<ChildrenOf />", tmpDir);

    const result = runLore(["get", prdSlug, "--json", "--raw"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data: Record<string, unknown> };
    expect(parsed.data).not.toHaveProperty("resolved_components");
  });
});

// ─── NEGATIVE: non-whitelisted component stripped + stderr warning (audit T2) ─

describe("NEGATIVE — `lore get` strips a non-whitelisted component and warns on stderr (audit T2)", () => {
  it("stdout has the tag removed, not passed through verbatim", () => {
    const prdSlug = createPrd(
      "Root With Injection",
      "# Root With Injection\n\nBefore. <ScriptInjection /> After.",
      tmpDir,
    );

    const result = runLore(["get", prdSlug], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("ScriptInjection");
    expect(result.stdout).toContain("Before.");
    expect(result.stdout).toContain("After.");
  });

  it("stderr carries the strip warning naming the unknown component", () => {
    const prdSlug = createPrd(
      "Root With Injection Stderr",
      "# Root With Injection Stderr\n\n<ScriptInjection />",
      tmpDir,
    );

    const result = runLore(["get", prdSlug], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("ScriptInjection");
    expect(result.stderr.toLowerCase()).toContain("warning");
  });

  it("--raw preserves the literal tag and emits no stderr warning", () => {
    const prdSlug = createPrd(
      "Root With Injection Raw",
      "# Root With Injection Raw\n\n<ScriptInjection />",
      tmpDir,
    );

    const result = runLore(["get", prdSlug, "--raw"], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("<ScriptInjection />");
    expect(result.stderr).not.toContain("ScriptInjection");
  });
});

// ─── REGRESSION: doc without placeholders is unaffected by --raw ──────────────

describe("REGRESSION — a doc without placeholders renders identically with/without --raw", () => {
  it("stdout body is identical for --raw and non-raw when there is nothing to splice", () => {
    const prdSlug = createPrd("Plain Root", "# Plain Root\n\nJust prose, no placeholders.", tmpDir);

    const withRaw = runLore(["get", prdSlug, "--raw"], tmpDir);
    const withoutRaw = runLore(["get", prdSlug], tmpDir);

    expect(withRaw.exitCode).toBe(0);
    expect(withoutRaw.exitCode).toBe(0);
    expect(withRaw.stdout).toBe(withoutRaw.stdout);
  });
});
