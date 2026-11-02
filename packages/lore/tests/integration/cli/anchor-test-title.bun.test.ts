// @spawns packages/lore/src/index.ts
/**
 * Test-title anchors — `lore anchor add <doc> <test-file>#"describe title"` end to end
 * through the real CLI (task-gh-1343388703-178, lore issue #178).
 *
 * Grammar under test: `path#"title"` — a double-quoted title, only on `*.test.ts`
 * files, resolved by `lore status --check-drift` against `describe`/`it`/`test` titles.
 *
 * Spawns the CLI in SOURCE mode (`bun run src/index.ts`) so a red run reflects the
 * working tree, never a stale `dist/lore`. ⛔ Every spawn uses a THROWAWAY corpus
 * (`mkdtemp` + `lore init`, cwd inside it) — never the repo's own `.lore/`.
 *
 * Six-dimension coverage:
 *   HAPPY:      add accepted; drift resolved (exit 0) for a describe title and an it title
 *   NEGATIVE:   quoted title on a non-test file refused, exit 4, message says why
 *   BOUNDARY:   titles containing `#`, `:`, `(`; unterminated quote refused (exit 4)
 *   ERROR:      title absent from the file reports `symbol_missing` (exit 3)
 *   STATE:      rename of the title in the file flips resolved -> symbol_missing
 *   REGRESSION: identifier form `file#Symbol` on a non-test file still accepted
 */

import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { templatedFieldsArgs } from "../../helpers/templated-create.js";
import { join } from "path";
import { tmpdir } from "os";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function runOrThrow(args: string[], dir: string, label: string): RunResult {
  const result = runLore(args, dir);
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed (exit ${result.exitCode}): ${result.stderr}${result.stdout}`);
  }
  return result;
}

function parseJsonSlug(stdout: string): string {
  return (JSON.parse(stdout) as { data: { slug: string } }).data.slug;
}

interface DriftRowJson {
  anchor: string;
  kind: string;
}

function checkDrift(dir: string): { exitCode: number; drifts: DriftRowJson[] } {
  const result = runLore(["status", "--check-drift", "--json"], dir);
  const envelope = JSON.parse(result.stdout) as { data: { code_drift: { drifts: DriftRowJson[] } } };
  return { exitCode: result.exitCode, drifts: envelope.data.code_drift.drifts };
}

const tmpDir = mkdtempSync(join(tmpdir(), "lore-anchor-test-title-"));
runOrThrow(["init"], tmpDir, "lore init");
patchLoreConfig(
  tmpDir,
  ["workflow:", "  gates:", "    spec-create:", "      enabled: false", ""].join("\n"),
);

mkdirSync(join(tmpDir, "tests"), { recursive: true });
mkdirSync(join(tmpDir, "src"), { recursive: true });
const TEST_FILE = "tests/widget.test.ts";
const TEST_SOURCE = [
  'import { describe, it } from "vitest";',
  'describe("AC-W-1: widget renders (happy path)", () => {',
  '  it("shows the label #1", () => {});',
  "});",
  "",
].join("\n");
writeFileSync(join(tmpDir, TEST_FILE), TEST_SOURCE, "utf8");
writeFileSync(join(tmpDir, "src", "widget.ts"), "export function renderWidget() {}\n", "utf8");

const prdSlug = parseJsonSlug(
  runOrThrow(
    ["create", "prd", "--title", "Title Anchor Root", "--no-ai", ...templatedFieldsArgs("prd", { refTarget: "problem" }), "--json"],
    tmpDir,
    "create prd",
  ).stdout,
);
const docSlug = parseJsonSlug(
  runOrThrow(
    [
      "create", "knowledge", "--title", "Widget Title Anchor Fixture", "--sub-type", "reference",
      "--parent", prdSlug, "--no-ai", ...templatedFieldsArgs("knowledge", { kind: "reference" }), "--json",
    ],
    tmpDir,
    "create knowledge",
  ).stdout,
);

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const DESCRIBE_ANCHOR = `${TEST_FILE}#"AC-W-1: widget renders (happy path)"`;
const IT_ANCHOR = `${TEST_FILE}#"shows the label #1"`;

describe("HAPPY — a quoted title anchors a test file and resolves in --check-drift", () => {
  it("anchor add accepts describe-title and it-title anchors (exit 0)", () => {
    expect(runLore(["anchor", "add", docSlug, DESCRIBE_ANCHOR], tmpDir).exitCode).toBe(0);
    expect(runLore(["anchor", "add", docSlug, IT_ANCHOR], tmpDir).exitCode).toBe(0);
  });

  it("check-drift resolves both title anchors (exit 0, no rows)", () => {
    const { exitCode, drifts } = checkDrift(tmpDir);
    expect(drifts).toEqual([]);
    expect(exitCode).toBe(0);
  });
});

describe("STATE/ERROR — a renamed title is reported as symbol_missing", () => {
  it("after renaming the describe title, only that anchor drifts", () => {
    writeFileSync(join(tmpDir, TEST_FILE), TEST_SOURCE.replace("widget renders", "widget paints"), "utf8");
    const { exitCode, drifts } = checkDrift(tmpDir);
    expect(drifts.map((d) => [d.anchor, d.kind])).toEqual([[DESCRIBE_ANCHOR, "symbol_missing"]]);
    expect(exitCode).toBe(3);
  });
});

describe("NEGATIVE — a quoted title on a non-test file is refused", () => {
  it("exit 4 and the message explains the test-file restriction", () => {
    const result = runLore(["anchor", "add", docSlug, 'src/widget.ts#"some title"'], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr + result.stdout).toMatch(/test file/i);
  });

  it("an unterminated quote is refused (exit 4)", () => {
    expect(runLore(["anchor", "add", docSlug, `${TEST_FILE}#"unterminated`], tmpDir).exitCode).toBe(4);
  });
});

describe("REGRESSION — the identifier form keeps working", () => {
  it("file#Symbol on a non-test file is accepted (exit 0)", () => {
    expect(runLore(["anchor", "add", docSlug, "src/widget.ts#renderWidget"], tmpDir).exitCode).toBe(0);
  });
});
