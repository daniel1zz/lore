/**
 * @spec_ref spec-defect-clusters-round-2-part-b-review-pending-queue-corpus#AC-DC2-9 (D9, BR-268, BR-269, BR-960)
 *
 * The review judge sees the whole document under review; a judgment marked `truncated` can never approve; the baseline
 * rendering shows each rule's examples and the leaf's declared commands.
 *
 * Throwaway corpus (mkdtemp + `lore init`), commands run in-process, the AI is a shell-script test double wired through
 * `ai.provider.command` that captures the prompt it received; no real provider is called and the repo's own `.lore/` is
 * never touched. The test config sets the pre-change `ai.review.max_doc_chars` to 2000: that key must no longer bound
 * the document under review.
 *
 * @reads packages/lore/src/ai/review-template.ts
 * @reads packages/lore/src/service/review-service.ts
 * @reads packages/lore/src/service/checkpoint-registry.ts
 *
 * Coverage:
 *   HAPPY:      (a) a 4000-char body reaches the judge whole and the recorded judgment has no `truncated`;
 *               (b) an untruncated approve lets `lore approve` exit 0; (d) every example and command is rendered
 *   NEGATIVE:   (b) a truncated approve alone refuses with exit 4 and JUDGMENT_INPUT_TRUNCATED, spec stays draft;
 *               (c) a context-limit failure exits 6 and records nothing
 *   BOUNDARY:   (a) the body is twice the configured 2000-char key; a body under the key is also whole
 *   STATE:      (b) refusal then fresh judgment then approval, on one version; (c) no judgment row after the failure
 *   REGRESSION: green-but-broken guards: the under-budget body, an approve gate fed only untruncated rows, and a leaf
 *               that declares no commands (the control showing the commands assertion can fail)
 */
import { Database } from "bun:sqlite";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DocRecord, ReviewBundle } from "@lore/core";
import { saveConfig } from "@lore/core/node";
import { REVIEW_PROMPT_VERSION, REVIEW_TEMPLATES } from "../../src/ai/review-template";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { loosenOverrideClasses } from "./fixtures/autonomy-override-helpers.js";

const ID = "spec-defect-clusters-round-2-part-b-review-pending-queue-corpus#AC-DC2-9";
const LAST_LINE = "LAST-LINE-OF-THE-SPEC-BODY-4000-CHARS";

let dir = "";
let citedRule = "";
let prdSlug = "";
let branchSlug = "";
const promptFile = (): string => join(dir, "last-prompt.txt");
const modeFile = (): string => join(dir, "ai-mode");

async function lore(args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const r = await runLoreInProcess(args, {
    cwd: dir,
    home: dir,
    env: { ...process.env, HOME: dir, EDITOR: "true", LORE_ACTOR: "agent:dc2-9-test" },
  });
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
}

async function must(args: readonly string[]): Promise<string> {
  const r = await lore(args);
  if (r.exitCode !== 0) throw new Error(`lore ${args.join(" ")} exited ${r.exitCode}: ${r.stderr}${r.stdout}`);
  return r.stdout;
}

const slugOf = (stdout: string): string => {
  const slug = (stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/))?.[1];
  if (slug === undefined) throw new Error(`no slug in: ${stdout}`);
  return slug;
};

interface DocJson {
  readonly id: string;
  readonly status: string;
  readonly version: number;
}

async function docOf(slug: string): Promise<DocJson> {
  const parsed = JSON.parse(await must(["get", slug, "--json"])) as { data?: { doc?: DocJson }; doc?: DocJson };
  const doc = parsed.data?.doc ?? parsed.doc;
  if (doc === undefined) throw new Error("no doc in get --json");
  return doc;
}

/** AI test double: stores the prompt it was given, then approves (or fails with a context-limit error in that mode). */
function writeAiDouble(): string {
  const scriptPath = join(dir, "fake-ai.sh");
  const body = JSON.stringify({
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "looks fine" }],
    blocking_questions: [],
  });
  const script = [
    "#!/bin/sh",
    `cat > "${promptFile()}"`,
    `if grep -q ctxlimit "${modeFile()}" 2>/dev/null; then`,
    "  echo 'prompt is too long: maximum context length exceeded' >&2",
    "  exit 1",
    "fi",
    "cat <<'JSONEOF'",
    body,
    "JSONEOF",
    "",
  ].join("\n");
  writeFileSync(scriptPath, script, { mode: 0o755 });
  return scriptPath;
}

function setMode(mode: "ok" | "ctxlimit"): void {
  writeFileSync(modeFile(), mode);
}

function capturedPrompt(): string {
  return readFileSync(promptFile(), "utf8");
}

/** The body of a spec: `totalChars` characters ending in {@link LAST_LINE} on its own last line. */
function specBody(totalChars: number): string {
  const head = "## Overview/Goal\n\nFixture.\n\n## Scope\n\n";
  const tail = `\n${LAST_LINE}\n`;
  const filler = "x".repeat(Math.max(0, totalChars - head.length - tail.length));
  return head + filler + tail;
}

async function createSpec(title: string, content: string): Promise<string> {
  return slugOf(await must(["create", "spec", "--title", title, "--no-ai", "--content", content]));
}

async function addCitedAc(spec: string): Promise<void> {
  await must([
    "ac", "add", spec, "AC-1", "--statement", "the criterion holds", "--mode", "script", "--oracle", "other",
    "--command", "echo ran", "--cite", citedRule,
  ]);
}

/** Direct insert into `review_judgments` — the fact approve()'s gate reads; `truncated` set only when asked. */
function insertJudgment(doc: DocJson, decision: "approve" | "reject", truncated: boolean): void {
  const db = new Database(join(dir, ".lore", "lore.db"));
  try {
    db.run(
      `INSERT INTO review_judgments (id, doc_id, doc_version, decision, confidence, reasons, checks, blocking_questions,
         judge_provider, judge_model, judge_prompt_version, truncated, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `judgment-dc2-9-${Math.random().toString(36).slice(2, 10)}`, doc.id, doc.version, decision, 0.9,
        JSON.stringify([{ dimension: "completeness", finding: "seeded" }]), JSON.stringify([{ check: "schema", outcome: "pass" }]),
        "[]", "test-judge", "test-model", "v1", truncated ? 1 : null, new Date().toISOString(), "ai:test-judge:test-model:v1",
      ],
    );
  } finally {
    db.close();
  }
}

function judgmentCount(doc: DocJson): number {
  const db = new Database(join(dir, ".lore", "lore.db"), { readonly: true });
  try {
    return (db.query("SELECT count(*) AS n FROM review_judgments WHERE doc_id = ?").get(doc.id) as { n: number }).n;
  } finally {
    db.close();
  }
}

function truncatedFlagOfLatestJudgment(doc: DocJson): number | null {
  const db = new Database(join(dir, ".lore", "lore.db"), { readonly: true });
  try {
    const row = db.query("SELECT truncated FROM review_judgments WHERE doc_id = ? ORDER BY rowid DESC LIMIT 1").get(doc.id) as
      | { truncated: number | null }
      | null;
    if (row === null) throw new Error("no judgment recorded");
    return row.truncated;
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lore-dc2-9-"));
  await must(["init"]);
  saveConfig(dir, {
    project: { name: "dc2-9", author: "tester" },
    ai: {
      provider: "claude-cli",
      providers: { "claude-cli": { command: writeAiDouble(), args: [], timeout_ms: 20_000 } },
      templates: {},
      telemetry: false,
      // The pre-change document-section budget key: it must no longer bound the document under review.
      review: { max_doc_chars: 2000, max_context_chars: 8000 },
    },
  } as never);
  setMode("ok");
  await loosenOverrideClasses(dir, ["override-judgment"]);
  appendFileSync(
    join(dir, ".lore", "config.yaml"),
    [
      "workflow:", "  gates:",
      "    spec-create:", "      enabled: false",
      "    spec-promote:", "      enabled: false",
      "    plan-promote:", "      enabled: false",
      "    task-claim:", "      enabled: false",
      '    "task-create":', "      enabled: false",
      "",
    ].join("\n"),
  );
  prdSlug = slugOf(await must(["create", "prd", "--title", "DC2-9 PRD", "--content", "root", "--no-ai"]));
  const root = slugOf(await must(["baseline", "add", prdSlug, "--node", "root", "--label", "Root", "--title", "DC2-9 Root"]));
  branchSlug = slugOf(await must(["baseline", "add", root, "--node", "branch", "--label", "Branch", "--title", "DC2-9 Branch"]));
  const leaf = slugOf(await must(["baseline", "add", branchSlug, "--node", "leaf", "--label", "Leaf", "--title", "DC2-9 Cite Leaf"]));
  const rule = await must(["rule", "add", leaf, "--statement", "a live rule to cite", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "example one"]);
  citedRule = rule.match(/\bBR-\d+\b/)?.[0] ?? "";
  if (citedRule === "") throw new Error(`no rule id in: ${rule}`);
}, 180_000);

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe(ID, () => {
  it(`${ID} (a) a 4000-char body reaches the judge whole and the recorded judgment has no truncated field`, async () => {
    const body = specBody(4000);
    expect(body.length).toBe(4000);
    const spec = await createSpec("DC2-9 long body", body);
    setMode("ok");

    const r = await lore(["review", spec]);
    expect(r.exitCode, r.stderr + r.stdout).toBe(0);

    const prompt = capturedPrompt();
    expect(prompt).toContain(LAST_LINE);
    expect(prompt).toContain(body);
    expect(prompt).not.toContain("# Truncation Notice");
    expect(truncatedFlagOfLatestJudgment(await docOf(spec))).toBeNull();
  }, 60_000);

  it(`${ID} (a) guard: a body under the budget is also whole (what a cutting template passes), and the judgment is unmarked`, async () => {
    const body = specBody(1500);
    const spec = await createSpec("DC2-9 short body", body);
    const r = await lore(["review", spec]);
    expect(r.exitCode, r.stderr + r.stdout).toBe(0);
    expect(capturedPrompt()).toContain(body);
    expect(truncatedFlagOfLatestJudgment(await docOf(spec))).toBeNull();
  }, 60_000);

  it(`${ID} (b) a truncated approve alone cannot approve: exit 4, JUDGMENT_INPUT_TRUNCATED, spec stays draft; a fresh untruncated approve lets it through`, async () => {
    const spec = await createSpec("DC2-9 approve gate", specBody(500));
    await addCitedAc(spec);
    const doc = await docOf(spec);
    insertJudgment(doc, "approve", true);

    const refused = await lore(["approve", spec]);
    expect(refused.exitCode, refused.stderr + refused.stdout).toBe(4);
    expect(refused.stderr).toContain("JUDGMENT_INPUT_TRUNCATED");
    expect((await docOf(spec)).status).toBe("draft");

    insertJudgment(await docOf(spec), "approve", false);
    const approved = await lore(["approve", spec]);
    expect(approved.exitCode, approved.stderr + approved.stdout).toBe(0);
    expect((await docOf(spec)).status).toBe("approved");
  }, 90_000);

  it(`${ID} (b) guard: an untruncated approve alone approves (the gate is not simply closed), and a truncated reject still blocks`, async () => {
    const plain = await createSpec("DC2-9 plain approve", specBody(500));
    await addCitedAc(plain);
    insertJudgment(await docOf(plain), "approve", false);
    const ok = await lore(["approve", plain]);
    expect(ok.exitCode, ok.stderr + ok.stdout).toBe(0);

    const rejected = await createSpec("DC2-9 truncated reject", specBody(500));
    await addCitedAc(rejected);
    const doc = await docOf(rejected);
    insertJudgment(doc, "reject", true);
    insertJudgment(doc, "approve", false);
    const blocked = await lore(["approve", rejected]);
    expect(blocked.exitCode, blocked.stderr + blocked.stdout).toBe(4);
    expect(blocked.stderr).toContain("JUDGMENT_REJECTED");
  }, 90_000);

  it(`${ID} (c) a body larger than the provider limit exits 6 and records no judgment`, async () => {
    const spec = await createSpec("DC2-9 too large", specBody(4000));
    const doc = await docOf(spec);
    expect(judgmentCount(doc)).toBe(0);
    setMode("ctxlimit");
    try {
      const r = await lore(["review", spec]);
      expect(r.exitCode, r.stderr + r.stdout).toBe(6);
      expect(judgmentCount(doc)).toBe(0);
      expect(capturedPrompt()).toContain(LAST_LINE);
    } finally {
      setMode("ok");
    }
  }, 60_000);

  it(`${ID} (d) a baseline leaf's prompt carries every rule example and every declared command`, async () => {
    const leaf = slugOf(await must(["baseline", "add", branchSlug, "--node", "leaf", "--label", "Rendered", "--title", "DC2-9 Rendered Leaf"]));
    const examples = ["EXAMPLE-ALPHA-ONE", "EXAMPLE-BETA-TWO", "EXAMPLE-GAMMA-THREE"];
    await must([
      "rule", "add", leaf, "--statement", "rule one with examples", "--confidence", "established", "--enforced-by", "guaranteed",
      ...examples.flatMap((e) => ["--example", e]),
    ]);
    await must(["rule", "add", leaf, "--statement", "rule two", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "EXAMPLE-DELTA-FOUR"]);
    const commands = ["review", "approve"];
    await must(["baseline", "map", leaf, ...commands.flatMap((c) => ["--command", c])]);

    const r = await lore(["review", leaf]);
    expect(r.exitCode, r.stderr + r.stdout).toBe(0);
    const prompt = capturedPrompt();
    for (const example of [...examples, "EXAMPLE-DELTA-FOUR"]) expect(prompt, example).toContain(example);
    for (const command of commands) expect(prompt, command).toContain(`commands (${commands.length}): ${commands.join(" | ")}`);
  }, 120_000);

  it(`${ID} (d) guard: a leaf declaring no commands renders no commands line, so the commands assertion can fail`, () => {
    const leaf = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", slug: "baseline-no-commands", type: "baseline", role: "baseline", title: "No commands",
      status: "draft", priority: "medium", content: "body", parent_id: null, created_at: "2026-07-10T00:00:00.000Z",
      updated_at: "2026-07-10T00:00:00.000Z", created_by: "tester", version: 1, deleted_at: null, tags: [],
      extra: {
        node: "leaf",
        label: "L",
        rules: [{ id: "BR-1", statement: "s", confidence: "established", enforced_by: "guaranteed", examples: ["ONLY-EXAMPLE"], lifecycle: "live" }],
      },
    } as unknown as DocRecord;
    const bundle: ReviewBundle = { doc: leaf, links: [] };
    const { prompt } = REVIEW_TEMPLATES[REVIEW_PROMPT_VERSION]!(bundle, [], { max_context_chars: 8000 });
    expect(prompt).toContain("ONLY-EXAMPLE");
    expect(prompt).not.toMatch(/^commands \(\d+\):/m);
  });
});
