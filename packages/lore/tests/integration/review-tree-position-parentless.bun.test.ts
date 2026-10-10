/**
 * `lore review` mechanical tree_position check must accept a PARENTLESS spec (BR-261 revised, BR-400, BR-2).
 *
 * Root cause pinned: after baseline slice 3b every spec is parentless, but `checkTreePosition` had no parentless
 * case and failed with "doc's parent type '(none)' does not match any modeled position for 'spec'" — so no spec
 * could pass review/approve. The SSOT for "parentless" is `isParentlessType` (doc-type-rules), shared with
 * tree-check-service.
 *
 * Drives the real CLI in a mkdtemp corpus (`lore init` + `lore setup --project`, so the SHIPPED blueprint is used).
 * AI is off (CLAUDECODE=1): only the deterministic checks table is asserted.
 *
 * Dimensions: HAPPY (parentless spec -> tree_position pass). Controls are unit-level (see the note at the end).
 *
 * @spec_ref AC-FIP-1
 */

import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "yaml";

setDefaultTimeout(300_000);

// tests/integration/ -> repo root is 4 levels up.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ACTOR = "agent:review-tree-position-test";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** MOCK RISK: none; HOME is redirected into the fixture so setup can never reach the real ~/.claude. */
function runLore(args: string[], cwd: string): RunResult {
  const env = { ...process.env, HOME: cwd, CLAUDECODE: "1", LORE_ACTOR: ACTOR };
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function makeCorpus(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-review-treepos-")));
  scratch.push(dir);
  execFileSync("git", ["init", "-q", "."], { cwd: dir, stdio: "ignore" });
  const init = runLore(["init"], dir);
  expect(init.exitCode, init.stderr + init.stdout).toBe(0);
  const setup = runLore(["setup", "--project", "--yes"], dir);
  expect(setup.exitCode, setup.stderr + setup.stdout).toBe(0);
  stubJudge(dir);
  return dir;
}

/**
 * `lore review` has no non-AI mode and only reaches the judge when the deterministic checks do not already reject,
 * so a green tree_position needs a provider. A fake claude-cli shell script (hermetic idiom of cli-staleness) answers
 * with a fixed approve verdict; the assertion is on the deterministic checks table, never on this verdict.
 */
function stubJudge(dir: string): void {
  const script = join(dir, "fake-judge.sh");
  const verdict = JSON.stringify({
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "stub", finding: "stub judge" }],
    blocking_questions: [],
  });
  writeFileSync(script, `#!/bin/sh\ncat > /dev/null\ncat <<'JSONEOF'\n${verdict}\nJSONEOF\n`, { mode: 0o755 });
  const configPath = join(dir, ".lore", "config.yaml");
  const config = (yaml.parse(readFileSync(configPath, "utf8")) ?? {}) as Record<string, unknown>;
  config["ai"] = {
    provider: "claude-cli",
    providers: { "claude-cli": { command: script, args: [], timeout_ms: 20_000 } },
    templates: {},
    telemetry: false,
  };
  writeFileSync(configPath, yaml.stringify(config));
}

/** The tree_position row from `lore review --json`, wherever the checks array sits in the payload. */
function treePositionCheck(dir: string, slug: string): { outcome: string; detail?: string } {
  const review = runLore(["review", slug, "--json"], dir);
  const text = review.stdout.trim();
  const start = text.indexOf("{");
  expect(start, `no JSON in review output:\n${review.stdout}\n${review.stderr}`).toBeGreaterThanOrEqual(0);
  const payload: unknown = JSON.parse(text.slice(start));
  const found = findCheck(payload);
  expect(found, `no tree_position check in:\n${review.stdout}`).toBeDefined();
  return found as { outcome: string; detail?: string };
}

function findCheck(node: unknown): { outcome: string; detail?: string } | undefined {
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findCheck(item);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  if (node !== null && typeof node === "object") {
    const rec = node as Record<string, unknown>;
    if (rec["check"] === "tree_position" && typeof rec["outcome"] === "string") {
      return rec as { outcome: string; detail?: string };
    }
    for (const value of Object.values(rec)) {
      const hit = findCheck(value);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

describe("review tree_position accepts a parentless spec (AC-FIP-1)", () => {
  it("AC-FIP-1: a parentless spec passes tree_position under the shipped blueprint", () => {
    const dir = makeCorpus();
    const created = runLore(
      ["create", "spec", "--title", "Parentless probe spec", "--content", "## Goal\n\nProbe.\n"],
      dir,
    );
    expect(created.exitCode, created.stderr + created.stdout).toBe(0);
    const check = treePositionCheck(dir, "spec-parentless-probe-spec");
    expect(check.outcome, check.detail).toBe("pass");
  });

  // Controls (a parentless task, a parented spec) cannot be created through the CLI — `lore create` refuses both —
  // so they live in packages/core/src/review-checks.test.ts against runDeterministicChecks directly.
});
