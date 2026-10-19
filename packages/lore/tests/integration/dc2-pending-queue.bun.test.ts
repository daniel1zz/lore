// @reads assets/governance/write-spec-rule.md
// @reads assets/project/lore-config-template.yaml
/**
 * spec-defect-clusters-round-2-part-b-review-pending-queue-corpus D11 — the review queue
 * includes in-review documents and says what it hides (BR-300, BR-301; reports #68, #93, #69).
 *
 * Throwaway corpus per test (mkdtemp + `lore init`, never the repo's own `.lore`). The AI is a
 * shell-script test double wired through `ai.provider.command`; no real provider is called.
 * Commands run in-process (adr-tg-1 option b), so no case spawns a binary.
 *
 * @reads packages/lore/src/adapters/cli/commands/pending.ts
 * @reads packages/lore/src/service/review-service.ts
 *
 * Coverage:
 *   HAPPY:      in-review spec + draft spec both listed by `pending --json`; `review --pending` judges the in-review one
 *   NEGATIVE:   `--type task` without `--all` exits 2 naming `--all`
 *   BOUNDARY:   `--type task --all --json` lists the draft task; the fixture really holds an in-review document
 *   STATE:      a knowledge draft archives through `lore set --status archived` (exit 0)
 *   REGRESSION: pending.ts / review-service.ts no longer state the false "draft never reaches archived" claim
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { saveConfig } from "@lore/core/node";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

const SPEC = "spec-defect-clusters-round-2-part-b-review-pending-queue-corpus";
const SRC = new URL("../../src/", import.meta.url).pathname;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, { cwd, home: cwd, env: { ...process.env, HOME: cwd, EDITOR: "true" } });
  return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.exitCode };
}

function slugOf(stdout: string): string {
  return (JSON.parse(stdout) as { data: { slug: string } }).data.slug;
}

/** AI test double: always approves with one reason. */
function writeApproveScript(dir: string): string {
  const scriptPath = join(dir, "fake-approve.sh");
  const body = JSON.stringify({
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "looks fine" }],
    blocking_questions: [],
  });
  writeFileSync(scriptPath, `#!/bin/sh\ncat > /dev/null\ncat <<'JSONEOF'\n${body}\nJSONEOF\n`, { mode: 0o755 });
  return scriptPath;
}

const SPEC_BODY = "## Overview/Goal\n\nFixture.\n\n## Scope\n\nFixture.\n\n## Acceptance Criteria\n\nNone yet.\n";

let dir: string;
let inReviewSpec: string;
let draftSpec: string;
let draftTask: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "lore-dc2-pending-"));
  const init = await runLore(["init"], dir);
  if (init.exitCode !== 0) throw new Error(`init failed: ${init.stderr}`);
  saveConfig(dir, {
    project: { name: "dc2-pending", author: "tester" },
    ai: {
      provider: "claude-cli",
      providers: { "claude-cli": { command: writeApproveScript(dir), args: [], timeout_ms: 5000 } },
      templates: {},
      telemetry: false,
    },
  } as never);

  const create = async (type: string, title: string, extra: string[] = []): Promise<string> => {
    const r = await runLore(["create", type, "--title", title, "--no-ai", "--content", type === "spec" ? SPEC_BODY : "Body.", "--json", ...extra], dir);
    if (r.exitCode !== 0) throw new Error(`create ${type} failed: ${r.stderr}${r.stdout}`);
    return slugOf(r.stdout);
  };
  inReviewSpec = await create("spec", "Queued in review spec");
  draftSpec = await create("spec", "Plain draft spec");
  const plan = await create("plan", "Queue plan");
  draftTask = await create("task", "Draft queue task", ["--parent", plan, "--plan-id", plan]);

  const move = await runLore(["set", inReviewSpec, "--status", "in-review"], dir);
  if (move.exitCode !== 0) throw new Error(`move to in-review failed: ${move.stderr}${move.stdout}`);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe(`${SPEC}#AC-DC2-11`, () => {
  it(`${SPEC}#AC-DC2-11 (a) pending lists the in-review and the draft spec; review --pending judges the in-review one`, async () => {
    // Green-but-broken guard: the fixture must really hold an in-review document.
    const got = await runLore(["get", inReviewSpec, "--json"], dir);
    expect(got.stdout).toContain('"status": "in-review"');

    const pending = await runLore(["pending", "--json"], dir);
    expect(pending.exitCode).toBe(0);
    const docs = (JSON.parse(pending.stdout) as { data: { docs: Array<{ slug: string; status: string }> } }).data.docs;
    expect(docs.find((d) => d.slug === inReviewSpec)?.status).toBe("in-review");
    expect(docs.map((d) => d.slug)).toContain(draftSpec);

    const review = await runLore(["review", "--pending", "--json"], dir);
    expect(review.exitCode).toBe(0);
    const results = (JSON.parse(review.stdout) as { data: { results: Array<{ title: string; judgment?: unknown }> } }).data.results;
    const judged = results.find((r) => r.title === "Queued in review spec");
    expect(judged?.judgment).toBeDefined();
  }, 60_000);

  it(`${SPEC}#AC-DC2-11 (b) --type task without --all exits 2 naming --all; with --all it lists the task`, async () => {
    const refused = await runLore(["pending", "--type", "task"], dir);
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain("--all");

    const listed = await runLore(["pending", "--type", "task", "--all", "--json"], dir);
    expect(listed.exitCode).toBe(0);
    const docs = (JSON.parse(listed.stdout) as { data: { docs: Array<{ slug: string }> } }).data.docs;
    expect(docs.map((d) => d.slug)).toContain(draftTask);
  }, 60_000);

  it(`${SPEC}#AC-DC2-11 (c) pending --help names the hidden classes`, async () => {
    const help = await runLore(["pending", "--help"], dir);
    const text = help.stdout + help.stderr;
    expect(text).toContain("tasks");
    expect(text).toContain("ledger records");
    expect(text).toContain("invalidated");
  }, 60_000);

  it(`${SPEC}#AC-DC2-11 (d) comments cite VALID_TRANSITIONS and a knowledge draft archives directly`, async () => {
    for (const file of ["adapters/cli/commands/pending.ts", "service/review-service.ts"]) {
      const source = readFileSync(join(SRC, file), "utf8");
      expect(source, file).not.toContain("never transitions to `archived`");
      expect(source, file).not.toContain("no draft->archived");
      expect(source, file).toContain("VALID_TRANSITIONS");
    }
    const k = await runLore(
      ["create", "knowledge", "--title", "Archivable note", "--sub-type", "reference", "--no-ai", "--content", "Body.", "--json"],
      dir,
    );
    expect(k.exitCode).toBe(0);
    const archived = await runLore(["set", slugOf(k.stdout), "--status", "archived"], dir);
    expect(archived.exitCode).toBe(0);
  }, 60_000);
});
