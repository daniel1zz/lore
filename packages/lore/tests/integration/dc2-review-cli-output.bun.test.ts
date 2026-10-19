/**
 * spec-defect-clusters-round-2-part-b-review-pending-queue-corpus D10 — review command output states what
 * happened (BR-294, BR-271).
 *
 * Throwaway corpus per test (mkdtemp + `lore init`, never the repo's own `.lore`). The AI is a shell-script
 * test double wired through `ai.provider.command`; no real provider is called. Commands run in-process.
 *
 * @reads packages/lore/src/adapters/cli/commands/reject.ts
 * @reads packages/lore/src/adapters/cli/review-render.ts
 * @reads packages/lore/src/adapters/cli/commands/review.ts
 *
 * Coverage:
 *   HAPPY:      reject of an in-review doc prints `(in-review -> draft)`; judgment prints `prompt <version>` once;
 *               an all-AI-failure batch exits 6
 *   NEGATIVE:   output never contains `remains` or `vv`; a batch with a judged doc stays exit 0
 *   BOUNDARY:   reject of a draft prints `(status unchanged: draft)`; a bare-number stored version prints verbatim
 *   ERROR:      all-VALIDATION_ERROR batch exits 4 (not 6); mixed causes exit 1 listing both counts
 *   STATE:      `--json` `.data.from_status` is the status held before the call
 *   REGRESSION: the exit policy is no longer a blanket `return 6` for any all-failed batch
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { LoreError, ReviewJudgment } from "@lore/core";
import { saveConfig } from "@lore/core/node";
import { REVIEW_PROMPT_VERSION } from "../../src/ai/review-template";
import { formatJudgmentSummary, summarizeBatchFailures } from "../../src/adapters/cli/review-render";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

const SPEC = "spec-defect-clusters-round-2-part-b-review-pending-queue-corpus";
const REVIEW_SRC = new URL("../../src/adapters/cli/commands/review.ts", import.meta.url).pathname;

async function runLore(args: string[], cwd: string) {
  const proc = await runLoreInProcess(args, { cwd, home: cwd, env: { ...process.env, HOME: cwd, EDITOR: "true" } });
  return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.exitCode };
}

/** AI test double: approves, or exits 1 (an AI provider failure) when asked to fail. */
function writeAiDouble(dir: string, mode: "approve" | "fail"): string {
  const scriptPath = join(dir, "fake-ai.sh");
  const body = JSON.stringify({
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "looks fine" }],
    blocking_questions: [],
  });
  const script =
    mode === "fail"
      ? "#!/bin/sh\ncat > /dev/null\necho 'provider down' >&2\nexit 1\n"
      : `#!/bin/sh\ncat > /dev/null\ncat <<'JSONEOF'\n${body}\nJSONEOF\n`;
  writeFileSync(scriptPath, script, { mode: 0o755 });
  return scriptPath;
}

function configureAi(dir: string, mode: "approve" | "fail"): void {
  saveConfig(dir, {
    project: { name: "dc2-review-output", author: "tester" },
    ai: {
      provider: "claude-cli",
      providers: { "claude-cli": { command: writeAiDouble(dir, mode), args: [], timeout_ms: 5000 } },
      templates: {},
      telemetry: false,
    },
  } as never);
}

const SPEC_BODY = "## Overview/Goal\n\nFixture.\n\n## Scope\n\nFixture.\n\n## Acceptance Criteria\n\nNone yet.\n";

let dir: string;

async function createSpec(title: string): Promise<string> {
  const r = await runLore(["create", "spec", "--title", title, "--no-ai", "--content", SPEC_BODY, "--json"], dir);
  if (r.exitCode !== 0) throw new Error(`create failed: ${r.stderr}${r.stdout}`);
  return (JSON.parse(r.stdout) as { data: { slug: string } }).data.slug;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "lore-dc2-review-out-"));
  const init = await runLore(["init"], dir);
  if (init.exitCode !== 0) throw new Error(`init failed: ${init.stderr}`);
  configureAi(dir, "approve");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function judgmentWith(promptVersion: string): ReviewJudgment {
  return {
    id: "j1",
    doc_id: "d1",
    doc_version: 1,
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "ok" }],
    checks: [],
    blocking_questions: [],
    judge: { provider: "claude-cli", model: "m", prompt_version: promptVersion },
    created_at: "2026-01-01T00:00:00.000Z",
    created_by: "ai:claude-cli:m:x",
  } as ReviewJudgment;
}

const validation: LoreError = { code: "VALIDATION_ERROR", field: "f", message: "bad" };
const aiError = { code: "AI_PROVIDER_ERROR", provider: "p", message: "down" } as unknown as LoreError;

describe(`${SPEC}#AC-DC2-10`, () => {
  it(`${SPEC}#AC-DC2-10 (a) reject names the transition for an in-review doc and a draft doc`, async () => {
    const inReview = await createSpec("Reject in review");
    const draft = await createSpec("Reject draft");
    const moved = await runLore(["set", inReview, "--status", "in-review"], dir);
    expect(moved.exitCode).toBe(0);

    const a = await runLore(["reject", inReview, "--reason", "no"], dir);
    expect(a.exitCode).toBe(0);
    expect(a.stdout).toContain("(in-review -> draft)");
    expect(a.stdout).not.toContain("remains");

    const b = await runLore(["reject", draft, "--reason", "no"], dir);
    expect(b.exitCode).toBe(0);
    expect(b.stdout).toContain("(status unchanged: draft)");
    expect(b.stdout).not.toContain("remains");
  }, 60_000);

  it(`${SPEC}#AC-DC2-10 (a) reject --json carries data.from_status for both starting states`, async () => {
    const inReview = await createSpec("Json in review");
    const draft = await createSpec("Json draft");
    await runLore(["set", inReview, "--status", "in-review"], dir);

    const a = await runLore(["reject", inReview, "--json"], dir);
    expect((JSON.parse(a.stdout) as { data: { from_status: string } }).data.from_status).toBe("in-review");
    const b = await runLore(["reject", draft, "--json"], dir);
    expect((JSON.parse(b.stdout) as { data: { from_status: string } }).data.from_status).toBe("draft");
  }, 60_000);

  it(`${SPEC}#AC-DC2-10 (b) the judge line prints the stored version once, never 'vv'`, () => {
    const text = formatJudgmentSummary(judgmentWith(REVIEW_PROMPT_VERSION));
    expect(text).toContain(`prompt ${REVIEW_PROMPT_VERSION})`);
    expect(text).not.toContain("vv");
    // Green-but-broken guard: a bare-number stored version is printed verbatim, not given a made-up prefix.
    const bare = formatJudgmentSummary(judgmentWith("5"));
    expect(bare).toContain("prompt 5)");
    expect(bare).not.toContain("prompt v5");
  });

  it(`${SPEC}#AC-DC2-10 (b) a real review prints the version once`, async () => {
    const slug = await createSpec("Review output");
    const r = await runLore(["review", slug], dir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`prompt ${REVIEW_PROMPT_VERSION})`);
    expect(r.stdout).not.toContain("vv");
  }, 60_000);

  it(`${SPEC}#AC-DC2-10 (c) the batch exit code reflects the failure codes`, () => {
    expect(summarizeBatchFailures([validation, validation], 2).exitCode).toBe(4);
    expect(summarizeBatchFailures([aiError, aiError], 2).exitCode).toBe(6);
    const mixed = summarizeBatchFailures([validation, aiError], 2);
    expect(mixed.exitCode).toBe(1);
    expect(Object.fromEntries(mixed.byCode)).toEqual({ VALIDATION_ERROR: 1, AI_PROVIDER_ERROR: 1 });
    // Some docs judged: exit 0 whatever failed; nothing failed: exit 0.
    expect(summarizeBatchFailures([validation], 2).exitCode).toBe(0);
    expect(summarizeBatchFailures([], 2).exitCode).toBe(0);
  });

  it(`${SPEC}#AC-DC2-10 (c) review --pending: all-AI-failure exits 6 and names the count; judged docs keep exit 0`, async () => {
    await createSpec("Batch one");
    await createSpec("Batch two");
    configureAi(dir, "fail");
    const allFailed = await runLore(["review", "--pending"], dir);
    expect(allFailed.exitCode).toBe(6);
    expect(allFailed.stderr).toContain("AI_PROVIDER_ERROR: 2");

    configureAi(dir, "approve");
    const judged = await runLore(["review", "--pending"], dir);
    expect(judged.exitCode).toBe(0);
  }, 120_000);

  it(`${SPEC}#AC-DC2-10 (c) review.ts no longer returns a blanket 6 for any all-failed batch`, () => {
    const source = readFileSync(REVIEW_SRC, "utf8");
    expect(source).not.toMatch(/failures\.length === outcomes\.length\) \{\s*return 6;/);
    expect(source).toContain("summarizeBatchFailures");
  });
});
