// @spawns dist/lore
/**
 * @spec_ref spec-p0-requirement-coverage-falsifying-criteria-for-the-8 AC-P0C-1
 * @task task-test-br-494-report-issue-filed-body-contract
 *
 * BR-494 (baseline-file-a-defect-report): a filing creates one GitHub issue
 * whose text opens with the filing field block (severity, category, tags,
 * reporter corpus, reporter root document, unique filing key), followed — in
 * this order — by the description, the expected and actual behaviour and the
 * reproducing command. The command prints the issue number and address and
 * exits 0.
 *
 * Offline: the spawned compiled `dist/lore` sees a stub `gh` as its only PATH
 * entry. The stub is `payloadGhStubDir`'s payload-serving script wrapped so the
 * `body=` argument of the issue-create POST is recorded to a file — that
 * recorded body is the "filed issue text" this suite asserts on. Throwaway
 * corpus (`mkdtemp` + `lore init`), never this repo's `.lore/`.
 *
 * Falsifiers (mutations run by the author, see task evidence):
 *   - buildIssueDescriptionBlock drops the `**Repro command:**` line
 *   - buildIssueDescriptionBlock swaps `**Expected:**` and `**Actual:**`
 *   - the command stops printing the issue address / number
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { LoreConfigSchema, NoOpTelemetry, parseIssueBody } from "@lore/core";
import type { LoreConfig } from "@lore/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { assertFreshBinary } from "../helpers/assert-fresh-binary";
import { cleanupPayloadGhStubDir, payloadGhStubDir } from "../helpers/payload-gh-stub";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";

const WORKTREE_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const DIST_LORE = join(WORKTREE_ROOT, "dist", "lore");
const TMP_ROOT = tmpdir();

const FAKE_REPO = "acme-test/br494-defect-channel";
const STUB_REPO_ID = 704_494_001;
const STUB_ISSUE_NUMBER = 49_494;
const STUB_ISSUE_URL = `https://github.com/${FAKE_REPO}/issues/${STUB_ISSUE_NUMBER}`;
const ACTOR = "agent:br494-body-contract";

const DESCRIPTION = "BR494-DESCRIPTION the filed body must carry this sentence after the field block.";
const EXPECTED = "BR494-EXPECTED value shown first";
const ACTUAL = "BR494-ACTUAL value shown second";
const REPRO = "lore br494-repro --flag";
const TITLE = "BR-494 body contract: filed issue text order";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let ghStubDir: string;
let isolatedConfigHome: string;
let corpusRoot: string;
let humanCorpusRoot: string;
let recordedBodyPath: string;
let fileResult: RunResult;
let humanResult: RunResult;
let filedBody: string;
/** Throwaway corpora the AC-RI-2 cases create (one per filing: the stub's fixed issue number collides within a corpus). */
const extraRoots: string[] = [];

function run(args: string[], cwd: string = corpusRoot): RunResult {
  const proc = Bun.spawnSync([DIST_LORE, ...args], {
    cwd,
    env: {
      ...process.env,
      CLAUDECODE: "1",
      LORE_CONFIG_HOME: isolatedConfigHome,
      PATH: ghStubDir,
      LORE_ACTOR: ACTOR,
    },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function fileArgs(title: string, extra: string[]): string[] {
  return [
    "report-issue",
    "--title",
    title,
    "--description",
    DESCRIPTION,
    "--expected",
    EXPECTED,
    "--actual",
    ACTUAL,
    "--repro-command",
    REPRO,
    "--severity",
    "high",
    "--category",
    "regression",
    "--tags",
    "br494,body-contract",
    ...extra,
  ];
}

/** Wraps the payload stub's `gh` so the issue-create POST's `body=` argument is written (verbatim, no trailing newline) to `recordTo`. */
function wrapStubToRecordBody(dir: string, recordTo: string): void {
  const quote = (value: string): string => ["'", value.split("'").join("'\\''"), "'"].join("");
  renameSync(join(dir, "gh"), join(dir, "gh-payload"));
  const wrapper = `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    body=*) printf '%s' "\${arg#body=}" > ${quote(recordTo)} ;;
  esac
done
exec /bin/sh ${quote(join(dir, "gh-payload"))} "$@"
`;
  writeFileSync(join(dir, "gh"), wrapper);
  chmodSync(join(dir, "gh"), 0o755);
}

/** `lore init` + a root PRD + the GitHub `feedback.upstream` config inside `root` (a throwaway dir — never this repo's `.lore/`). */
function prepareCorpus(root: string): void {
  const initResult = run(["init"], root);
  if (initResult.exitCode !== 0) throw new Error(`'lore init' failed (exit ${initResult.exitCode}): ${initResult.stderr}`);
  const prdResult = run(
    [
      "create",
      "prd",
      "--title",
      "BR-494 throwaway root PRD",
      "--content",
      "Throwaway root PRD for the BR-494 filed-body contract test. Not read by anything else.",
    ],
    root,
  );
  if (prdResult.exitCode !== 0) {
    throw new Error(`root PRD creation failed (exit ${prdResult.exitCode}): ${prdResult.stderr}`);
  }
  patchLoreConfig(root, ["feedback:", "  upstream:", `    repo: ${FAKE_REPO}`, ""].join("\n"));
}

beforeAll(() => {
  // dist/lore is built ONCE per run by the runner (scripts/test-global-setup.ts); a test never rebuilds it (TG-24).
  assertFreshBinary(DIST_LORE, [
    join(WORKTREE_ROOT, "packages", "lore", "src"),
    join(WORKTREE_ROOT, "packages", "core", "src"),
  ]);

  ghStubDir = payloadGhStubDir({
    repoId: STUB_REPO_ID,
    createdNumber: STUB_ISSUE_NUMBER,
    createdUrl: STUB_ISSUE_URL,
  });
  recordedBodyPath = join(ghStubDir, "recorded-body.txt");
  wrapStubToRecordBody(ghStubDir, recordedBodyPath);

  isolatedConfigHome = mkdtempSync(join(TMP_ROOT, "lore-br494-config-home-"));
  corpusRoot = mkdtempSync(join(TMP_ROOT, "lore-br494-corpus-"));
  humanCorpusRoot = mkdtempSync(join(TMP_ROOT, "lore-br494-corpus-human-"));
  // reason: the stub always answers the same issue number, and a filed issue mints corpus task `task-gh-<repo>-<number>` — a second filing into the SAME corpus collides (DUPLICATE_SLUG), so the human-output filing gets its own corpus.
  for (const root of [corpusRoot, humanCorpusRoot]) prepareCorpus(root);

  // Filing 1 (--json): the structured contract + the recorded body. Filing 2 (human output, own corpus): the printed text.
  fileResult = run(fileArgs(TITLE, ["--json"]));
  filedBody = existsSync(recordedBodyPath) ? readFileSync(recordedBodyPath, "utf8") : "";
  humanResult = run(fileArgs(TITLE, []), humanCorpusRoot);
}, 180_000);

afterAll(() => {
  if (ghStubDir !== undefined) cleanupPayloadGhStubDir(ghStubDir);
  for (const path of [isolatedConfigHome, corpusRoot, humanCorpusRoot, ...extraRoots]) {
    if (path === undefined) continue;
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // reason: best-effort cleanup only.
    }
  }
});

describe("BR-494 filed issue body", () => {
  it("HAPPY: the filing exits 0 and the stub gh received an issue body", () => {
    expect(fileResult.exitCode, `stdout: ${fileResult.stdout}\nstderr: ${fileResult.stderr}`).toBe(0);
    expect(filedBody.length).toBeGreaterThan(0);
  });

  it("the filed text opens with the filing field block carrying severity, category, tags, reporter corpus, root document and a filing key", () => {
    expect(filedBody.startsWith("---\n")).toBe(true);
    const parsed = parseIssueBody(filedBody);
    expect(parsed.present).toBe(true);
    if (!parsed.present) return;
    expect(parsed.fields.severity).toBe("high");
    expect(parsed.fields.category).toBe("regression");
    expect(parsed.fields.tags).toEqual(["br494", "body-contract"]);
    expect(parsed.fields.reporter_corpus.length).toBeGreaterThan(0);
    expect(parsed.fields.reporter_root_prd.length).toBeGreaterThan(0);
    expect(parsed.fields.idempotency_key.length).toBeGreaterThan(0);
  });

  it("after the field block the text carries description, expected, actual and repro command in that order", () => {
    const closeIdx = filedBody.indexOf("\n---", 4);
    expect(closeIdx).toBeGreaterThan(0);
    const afterBlock = filedBody.slice(closeIdx + "\n---".length);

    const positions = [
      afterBlock.indexOf(DESCRIPTION),
      afterBlock.indexOf(`**Expected:** ${EXPECTED}`),
      afterBlock.indexOf(`**Actual:** ${ACTUAL}`),
      afterBlock.indexOf(`**Repro command:**\n\`\`\`\n${REPRO}\n\`\`\``),
    ];
    for (const position of positions) expect(position).toBeGreaterThanOrEqual(0);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // The field block is first: nothing of the free-form content precedes the closing delimiter.
    expect(filedBody.slice(0, closeIdx)).not.toContain(DESCRIPTION);
  });

  it("each of expected, actual and repro command appears exactly once", () => {
    for (const marker of ["**Expected:**", "**Actual:**", "**Repro command:**"]) {
      expect(filedBody.split(marker).length - 1, marker).toBe(1);
    }
  });

  it("--json stdout names the issue number and address from the stub's response", () => {
    const parsed = JSON.parse(fileResult.stdout) as { ok: true; data: { number: number; url: string } };
    expect(parsed.data.number).toBe(STUB_ISSUE_NUMBER);
    expect(parsed.data.url).toBe(STUB_ISSUE_URL);
  });

  it("human output prints the issue number and address and exits 0", () => {
    expect(humanResult.exitCode, `stdout: ${humanResult.stdout}\nstderr: ${humanResult.stderr}`).toBe(0);
    expect(humanResult.stdout).toContain(STUB_ISSUE_URL);
    expect(humanResult.stdout).toContain(String(STUB_ISSUE_NUMBER));
  });
});

// ─── AC-RI-2 — body sections, optional parts, prose repro refused before GitHub ───

const intakeFileIssue = vi.fn();
// reason: the MCP case below drives the in-process handler; the intake port is mocked so "posts nothing" is observable.
// The compiled-binary cases above and below are separate processes and unaffected by this mock.
vi.mock("../../../src/service/github-intake-port.js", () => ({
  GitHubIntakePort: vi.fn().mockImplementation(() => ({
    verifyTarget: vi.fn(),
    searchDuplicates: vi.fn(),
    fileIssue: intakeFileIssue,
  })),
}));

/** A filing's inputs minus the optional parts; each AC-RI-2 case adds its own. */
function baseArgs(title: string): string[] {
  return [
    "report-issue",
    "--title",
    title,
    "--description",
    DESCRIPTION,
    "--expected",
    EXPECTED,
    "--actual",
    ACTUAL,
    "--severity",
    "high",
    "--category",
    "regression",
    "--json",
  ];
}

/** Files into a fresh corpus and returns the run plus the body the stub recorded (empty string when no POST happened). */
function fileInFreshCorpus(args: string[]): { result: RunResult; body: string } {
  const root = mkdtempSync(join(TMP_ROOT, "lore-ri2-corpus-"));
  extraRoots.push(root);
  prepareCorpus(root);
  rmSync(recordedBodyPath, { force: true });
  const result = run(args, root);
  const body = existsSync(recordedBodyPath) ? readFileSync(recordedBodyPath, "utf8") : "";
  return { result, body };
}

/** Index of `marker` in the body, asserting it appears exactly once. */
function onlyOccurrence(body: string, marker: string): number {
  expect(body.split(marker).length - 1, marker).toBe(1);
  return body.indexOf(marker);
}

const REPRO_WITH_TICKS = "lore br494-repro ```x```";
const STEPS = "RI2-STEPS first line\nRI2-STEPS second line";
const FIX = "RI2-FIX change the thing";
const PROSE_REPRO = "with an old fragment: lore integrate x";

describe("AC-RI-2", () => {
  it("a filing with every optional part records the sections once, in order, with a longer fence for a command containing backticks", () => {
    const { result, body } = fileInFreshCorpus([
      ...baseArgs("RI-2 all parts"),
      "--repro-command",
      REPRO_WITH_TICKS,
      "--repro-steps",
      STEPS,
      "--suggested-fix",
      FIX,
      "--refs",
      "spec-one AC-1",
      "--refs",
      "#123",
    ]);
    expect(result.exitCode, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);

    // `**Context:**` is attached by the context-attachment task (AC-RI-3/4/6), so it is absent here: no test file is named.
    const positions = [
      DESCRIPTION,
      "**Expected:**",
      "**Actual:**",
      "**Repro command:**",
      "**Repro steps:**",
      "**Suggested fix:**",
      "**Refs:**",
      "Reported by:",
    ].map((marker) => onlyOccurrence(body, marker));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    expect(body).toContain(`**Repro command:**\n\`\`\`\`\n${REPRO_WITH_TICKS}\n\`\`\`\`\n`);
    expect(body).toContain(`**Repro steps:**\n${STEPS}`);
    expect(body).toContain(`**Suggested fix:**\n${FIX}`);
    expect(body).toContain("**Refs:**\n- spec-one AC-1\n- #123\n");
    const parsed = parseIssueBody(body);
    expect(parsed.present).toBe(true);
    if (parsed.present) expect(parsed.fields.severity).toBe("high");
  });

  it("a filing whose repro names a test file shows **Context:** after Refs and before Reported by", () => {
    const root = mkdtempSync(join(TMP_ROOT, "lore-ri2-ctx-corpus-"));
    extraRoots.push(root);
    prepareCorpus(root);
    mkdirSync(join(root, "tests"));
    writeFileSync(join(root, "tests", "ctx.test.ts"), "// @spec_ref spec-ri2-ctx ctx-marker-one\nimport { it } from \"vitest\";\nit(\"x\", () => {});\n");
    rmSync(recordedBodyPath, { force: true });
    const result = run(
      [...baseArgs("RI-2 context order"), "--repro-command", "lore x tests/ctx.test.ts", "--refs", "spec-one AC-1"],
      root,
    );
    const body = existsSync(recordedBodyPath) ? readFileSync(recordedBodyPath, "utf8") : "";
    expect(result.exitCode, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const positions = ["**Refs:**", "**Context:**", "Reported by:"].map((marker) => onlyOccurrence(body, marker));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(body).toContain("**Context:** tests/ctx.test.ts");
    expect(body).toContain("// @spec_ref spec-ri2-ctx ctx-marker-one");
  });

  it("a filing with none of the optional parts has no Repro, Suggested fix, Refs or Context heading and still round-trips", () => {
    const { result, body } = fileInFreshCorpus(baseArgs("RI-2 bare"));
    expect(result.exitCode, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    for (const marker of ["**Repro command:**", "**Repro steps:**", "**Suggested fix:**", "**Refs:**", "**Context:**"]) {
      expect(body, marker).not.toContain(marker);
    }
    const parsed = parseIssueBody(body);
    expect(parsed.present).toBe(true);
    if (parsed.present) expect(parsed.fields.severity).toBe("high");
  });

  it("a prose --repro-command exits exactly 2 naming the reason and records no issue POST", () => {
    const { result, body } = fileInFreshCorpus([...baseArgs("RI-2 prose"), "--repro-command", PROSE_REPRO]);
    expect(result.exitCode, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(2);
    expect(result.stderr).toContain("program_not_found");
    expect(result.stderr).toContain("with");
    expect(result.stderr).toContain("--repro-steps");
    expect(body).toBe("");
  });

  it("the same prose through the MCP handler returns VALIDATION_ERROR and posts nothing", async () => {
    const { registerTools } = await import("../../../src/adapters/mcp/tools.js");
    const { liveInvocation } = await import("../../live-invocation.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const config = LoreConfigSchema.parse({
      project: { name: "test", author: "test" },
      feedback: { upstream: { repo: FAKE_REPO } },
    }) as LoreConfig;
    // reason: the check refuses before the handler touches the app, so a bare app stub is enough for this case.
    const app = { warn: () => undefined, close: () => undefined, telemetry: new NoOpTelemetry() } as never;
    registerTools(server, app, () => config, liveInvocation());
    const tools = (
      server as unknown as {
        _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<CallToolResult> }>;
      }
    )._registeredTools;
    const tool = tools["lore_report_issue"];
    if (tool === undefined) throw new Error("lore_report_issue is not registered");
    const result = await tool.handler(
      {
        by: ACTOR,
        title: "RI-2 mcp prose",
        description: DESCRIPTION,
        expected: EXPECTED,
        actual: ACTUAL,
        severity: "high",
        category: "regression",
        repro_command: PROSE_REPRO,
      },
      {},
    );
    expect(result.isError).toBe(true);
    const first = result.content[0];
    const error = JSON.parse(first !== undefined && first.type === "text" ? first.text : "{}") as Record<string, string>;
    expect(error["code"]).toBe("VALIDATION_ERROR");
    expect(error["field"]).toBe("repro_command");
    expect(error["message"]).toContain("program_not_found");
    expect(intakeFileIssue).not.toHaveBeenCalled();
  });
});
