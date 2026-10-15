/**
 * Compiled-binary e2e for AC-RS-13 (spec-rule-store-git-tracked-fragment-selection-on-demand-skill):
 * the shipped catalog (promoted lore-tool fragments + trimmed agent-rules) passes `lore fragments check`
 * in an empty temp HOME, keeps the hook:subagent-start lore-implementer render within the 9400-char cap,
 * and this repo's `.lore/context` scoped-oracles fragment reaches the main session (`rules:project`).
 *
 * Isolation: mkdtemp HOME / XDG_CONFIG_HOME (empty user layer) so only shipped + this repo's project layer load;
 * the repo `.lore/` corpus is only READ (cwd = repo root), never written.
 *
 * @spec_ref spec-rule-store-git-tracked-fragment-selection-on-demand-skill AC-RS-13
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
const SUBAGENT_FRAGMENT_CAP = 9400;
const PROMOTED_IDS = ["ac-design", "evidence-attestation", "dispatch-bundle", "worktree-dispatch"] as const;
const SCOPED_ORACLES_ID = "project-scoped-oracles-in-worktrees";

interface Spawned {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const roots: string[] = [];
let env: Record<string, string>;

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lore-rs13-")));
  roots.push(root);
  const home = join(root, "home");
  const xdg = join(root, "xdg");
  for (const d of [home, xdg]) mkdirSync(d, { recursive: true });
  env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["CLAUDE_CONFIG_DIR", "LORE_CONFIG_HOME", "LORE_AI_DEFAULT", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
  env["HOME"] = home;
  env["XDG_CONFIG_HOME"] = xdg;
  env["CLAUDECODE"] = "1";
});

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function lore(...args: string[]): Spawned {
  const proc = Bun.spawnSync([LORE_BIN, ...args], { cwd: REPO_ROOT, env });
  return { code: proc.exitCode ?? -1, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

function renderSubagent(agentType: string): string {
  const res = lore("fragments", "render", "--outlet", "hook:subagent-start", "--agent-type", agentType);
  expect(res.code).toBe(0);
  const parsed = JSON.parse(res.stdout) as { hookSpecificOutput: { additionalContext: string } };
  return parsed.hookSpecificOutput.additionalContext;
}

describe("AC-RS-13 shipped catalog passes check within caps", () => {
  it("AC-RS-13 fragments check --json exits 0 with no findings", () => {
    const res = lore("fragments", "check", "--json");
    expect(res.code).toBe(0);
    const report = JSON.parse(res.stdout) as { data: { ok: boolean; findings: unknown[] } };
    expect(report.data.ok).toBe(true);
    expect(report.data.findings).toEqual([]);
  });

  it("AC-RS-13 shipped ids include the four promoted lore-tool fragments", () => {
    const res = lore("context", "list", "--json");
    expect(res.code).toBe(0);
    const rows = (JSON.parse(res.stdout) as { data: { id: string; layer: string }[] }).data;
    const shipped = rows.filter((r) => r.layer === "shipped").map((r) => r.id);
    for (const id of PROMOTED_IDS) expect(shipped).toContain(id);
  });

  it("AC-RS-13 agent-rules keeps only its non-overlapping line", () => {
    const rendered = renderSubagent("lore-reader");
    expect(rendered).toContain("Never discard lore's own stdout/stderr");
    expect(rendered).not.toContain("Trust nothing you did not just measure");
    expect(rendered).not.toContain("Oracles are external");
    expect(rendered).not.toContain("No silent fallbacks");
    expect(rendered).not.toContain("A defect outside your task's anchors");
  });

  it("AC-RS-13 hook:subagent-start lore-implementer render is at most 9400 chars and carries the attestation fragment", () => {
    const rendered = renderSubagent("lore-implementer");
    expect(rendered.length).toBeLessThanOrEqual(SUBAGENT_FRAGMENT_CAP);
    expect(rendered).toContain("--capture");
    // main-only fragments must not leak into a subagent render
    expect(rendered).not.toContain("Bundle five sections");
  });

  it("AC-RS-13 this repo's rules:project includes the scoped-oracles fragment", () => {
    const res = lore("fragments", "check", "--json");
    const report = JSON.parse(res.stdout) as { data: { checks: { outlet: string; fragmentIds: string[] }[] } };
    const project = report.data.checks.find((c) => c.outlet === "rules:project");
    expect(project).toBeDefined();
    expect(project?.fragmentIds).toContain(SCOPED_ORACLES_ID);
    for (const id of PROMOTED_IDS) expect(project?.fragmentIds).toContain(id);
  });
});
