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

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { parseIssueBody } from "@lore/core";

import { assertFreshBinary } from "../helpers/assert-fresh-binary";
import { cleanupPayloadGhStubDir, payloadGhStubDir } from "../helpers/payload-gh-stub";

const WORKTREE_ROOT = resolve(import.meta.dir, "..", "..", "..", "..", "..");
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
  const quote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
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
  const configPath = join(root, ".lore", "config.yaml");
  const existingConfig = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  writeFileSync(configPath, existingConfig + ["feedback:", "  upstream:", `    repo: ${FAKE_REPO}`, ""].join("\n"));
}

beforeAll(() => {
  const buildResult = Bun.spawnSync(["bun", "run", "build"], { cwd: WORKTREE_ROOT });
  if (buildResult.exitCode !== 0) {
    throw new Error(
      `'bun run build' failed (exit ${buildResult.exitCode}):\n` +
        `stdout: ${buildResult.stdout.toString()}\nstderr: ${buildResult.stderr.toString()}`,
    );
  }
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
  for (const path of [isolatedConfigHome, corpusRoot, humanCorpusRoot]) {
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
      afterBlock.indexOf(`**Repro command:** \`${REPRO}\``),
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
