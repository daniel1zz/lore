// @reads assets/project/lore-config-template.yaml
// @reads assets/templates/**
/**
 * `lore get` structured-`extra` loss notice — COMPILED-BINARY end-to-end contract
 * (task-lore-get-s-default-render-silently-omits-structured-extra, AC-1/AC-2/AC-4/AC-5).
 *
 * Why this file exists next to the pure vitest suite
 * (`get-structured-extra-notice.test.ts`): that suite exercises the render functions
 * directly, so it would pass unchanged against a formatter that is never called — the
 * silently-inert false-oracle vector (root CLAUDE.md, "False oracles"). Only a real spawn
 * proves the notice reaches an operator's stdout, and only a real spawn can compare the
 * `--json` payload byte-for-byte.
 *
 * Spawns the COMPILED `dist/lore` from THIS WORKTREE against a THROWAWAY corpus
 * (`mkdtempSync` + `lore init`) — NEVER the repo's own `.lore/` (project CLAUDE.md hard
 * rule). `assertFreshBinary` fails loud before any test runs if `dist/lore` is missing or
 * older than the newest source, so a stale binary can never fake a pass; requires
 * `bun run build` first.
 *
 * Deliberately LEAN (the 9-spawn/5s-budget lesson): ONE corpus for the whole suite, built
 * once in `beforeAll`, with every fixture step asserted loud — a fixture that silently
 * failed to write `extra` would make every assertion below vacuous.
 *
 * Fixtures use only REAL dedicated writers, so the `extra` shapes are authentic:
 *   `lore create task --anchor`  → `extra.file_anchors`  (array of string)
 *   `lore handoff`               → `extra.handoff`       (object)
 *   `lore invalidate`            → `extra.validity`      (object, banner-backed)
 * `extra.issue_report` — the shape that motivated the fix — has no single-corpus CLI
 * writer (`lore report-issue` writes into a configured UPSTREAM corpus, SPEC-072), and the
 * detector is key-AGNOSTIC by construction, so its exact shape is pinned in the vitest
 * suite's `ISSUE_REPORT_FIXTURE` instead of a second corpus pair here.
 *
 * Coverage:
 *   HAPPY:      AC-1 — `lore get <task>` stdout names the withheld key, its shape, and the
 *               exact `--json` command (independent lone tokens, never one sentence)
 *   NEGATIVE:   AC-2 — a doc whose `extra` holds only SCALARS (`sub_type`) emits no notice
 *               at all, so AC-1 cannot be satisfied by an always-printing implementation
 *   BOUNDARY:   `--raw` still emits the notice, and announces MORE (the banner and the MDX
 *               projections are absent there, so `validity` becomes a real loss)
 *   ERROR:      n/a here — malformed-value degradation is exhaustively covered at the pure
 *               layer; no CLI writer can produce a malformed `extra` to spawn against
 *   STATE:      AC-5 — an invalidated doc still prints its SPEC-043 banner, the banner
 *               comes FIRST, and the notice does not list the banner-backed `validity`
 *   REGRESSION: AC-4 — `lore get --json` stdout is byte-identical to a pure
 *               `JSON.stringify(JSON.parse(stdout), null, 2)` round-trip (proving the
 *               human-only notice added no byte anywhere) and still carries `extra`
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";

// tests/unit/adapters/ → tests/unit/ → tests/ → packages/lore/ → packages/ → repo root.
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");

/** The notice's two stable lone tokens — asserted independently, never as one phrase. */
const NOTICE_MARKER = "structured";
const NOTICE_COMMAND_TOKEN = "show values";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

/** Runs a fixture step and fails LOUD — a silently-failed write makes every assertion vacuous. */
async function mustRun(args: string[], cwd: string): Promise<RunResult> {
  const result = await runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`fixture step failed (exit ${result.exitCode}): lore ${args.join(" ")}\n${result.stderr}`);
  }
  return result;
}

function parseSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from output: ${stdout}`);
  return slug;
}

/**
 * Extracts ONLY the notice's field-inventory lines (header + one line per withheld key),
 * excluding its trailing `show values: lore get <slug> --json` line.
 *
 * reason: the field names under test (`handoff`, `validity`) also occur in the doc's own
 * SLUG and in sibling titles printed by Navigation, so a whole-stdout `toContain` would
 * pass on the slug alone — the over-matching face of the substring-matcher lesson (root
 * CLAUDE.md). Every field-name assertion below must run against this slice.
 */
function extractNoticeInventory(stdout: string): string {
  const start = stdout.indexOf(NOTICE_MARKER);
  const end = stdout.indexOf(NOTICE_COMMAND_TOKEN);
  if (start === -1 || end === -1 || end < start) throw new Error(`no notice block found in output:\n${stdout}`);
  return stdout.slice(start, end);
}

let tmpDir: string;
let taskSlug: string;
let plainKnowledgeSlug: string;
let handoffSlug: string;

beforeAll(async () => {

  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-get-structured-extra-"));
  await mustRun(["init"], tmpDir);

  const prdSlug = parseSlug((await mustRun(["create", "prd", "--title", "Extra Notice Root", "--no-ai", "--content", "body"], tmpDir)).stdout);
  const planSlug = parseSlug(
    (await mustRun(["create", "plan", "--title", "Extra Notice Plan", "--no-ai", "--parent", prdSlug, "--content", "body"], tmpDir)).stdout,
  );
  taskSlug = parseSlug(
    (await mustRun(
      [
        "create", "task",
        "--title", "Extra Notice Task",
        "--parent", planSlug,
        "--plan-id", planSlug,
        "--no-ai",
        "--content", "Task body.",
        "--anchor", "src/first.ts",
        "--anchor", "src/second.ts",
      ],
      tmpDir,
    )).stdout,
  );
  plainKnowledgeSlug = parseSlug(
    (await mustRun(
      ["create", "knowledge", "--title", "Extra Notice Plain", "--sub-type", "reference", "--no-ai", "--parent", prdSlug, "--content", "Plain body."],
      tmpDir,
    )).stdout,
  );
  // BR-1528: `lore handoff` creates the document structured through the approved `knowledge/handoff` template.
  await mustRun(["migrate", "templates", "--apply"], tmpDir);
  handoffSlug = parseSlug(
    (await mustRun(["handoff", "--decision", "probe decision@0.9", "--next", "probe next step", "--plan", planSlug], tmpDir))
      .stdout,
  );

  // Fixture verification: the writers really did persist structured `extra` (read via the
  // --json surface, which this feature must leave untouched).
  const taskExtra = JSON.parse((await mustRun(["get", taskSlug, "--json"], tmpDir)).stdout).data.doc.extra;
  if (!Array.isArray(taskExtra.file_anchors) || taskExtra.file_anchors.length !== 2) {
    throw new Error(`fixture task lacks the expected extra.file_anchors: ${JSON.stringify(taskExtra)}`);
  }
  const plainExtra = JSON.parse((await mustRun(["get", plainKnowledgeSlug, "--json"], tmpDir)).stdout).data.doc.extra;
  const plainStructuredKeys = Object.keys(plainExtra).filter((key) => typeof plainExtra[key] === "object" && plainExtra[key] !== null);
  if (plainStructuredKeys.length > 0) {
    throw new Error(`negative-control doc unexpectedly carries structured extra: ${plainStructuredKeys.join(", ")}`);
  }
});

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

// ─── HAPPY (AC-1) ───────────────────────────────────────────────────────────

describe("lore get — AC-1 HAPPY (withheld structured extra is announced on stdout)", () => {
  it("AC-1 names the key, its shape, and the exact --json command", async () => {
    const result = await runLore(["get", taskSlug], tmpDir);
    expect(result.exitCode).toBe(0);

    // Independent lone tokens.
    expect(result.stdout).toContain("file_anchors");
    expect(result.stdout).toContain(NOTICE_MARKER);
    expect(result.stdout).toContain(NOTICE_COMMAND_TOKEN);
    expect(result.stdout).toContain("--json");
    expect(result.stdout).toContain(taskSlug);
    // Shape summary, not values.
    expect(result.stdout).toContain("2 item(s)");
  });

  it("AC-1 the notice sits after the body and before the Navigation footer", async () => {
    const { stdout } = await runLore(["get", taskSlug], tmpDir);
    const bodyIndex = stdout.indexOf("Task body.");
    const noticeIndex = stdout.indexOf(NOTICE_COMMAND_TOKEN);
    const navigationIndex = stdout.indexOf("Navigation");
    expect(bodyIndex).toBeGreaterThan(-1);
    expect(noticeIndex).toBeGreaterThan(bodyIndex);
    expect(navigationIndex).toBeGreaterThan(noticeIndex);
  });
});

// ─── NEGATIVE (AC-2): the vacuity guard ────────────────────────────────────

describe("lore get — AC-2 NEGATIVE control (scalars-only extra emits no notice)", () => {
  it("AC-2 a knowledge doc whose extra holds only sub_type prints no marker at all", async () => {
    const result = await runLore(["get", plainKnowledgeSlug], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Plain body."); // the render still works
    expect(result.stdout).not.toContain(NOTICE_COMMAND_TOKEN);
    expect(result.stdout).not.toContain(NOTICE_MARKER);
  });
});

// ─── REGRESSION (AC-4): --json gains no byte ───────────────────────────────

describe("lore get --json — AC-4 REGRESSION (payload untouched)", () => {
  it("AC-4 stdout is exactly a pretty-printed JSON document — nothing prepended or appended", async () => {
    const { stdout, exitCode } = await runLore(["get", taskSlug, "--json"], tmpDir);
    expect(exitCode).toBe(0);
    // Byte-level: re-serialising the parsed payload with the command's own formatting
    // reproduces stdout exactly, so no notice line (or any other byte) leaked in.
    expect(stdout).toBe(`${JSON.stringify(JSON.parse(stdout), null, 2)}\n`);
    expect(stdout).not.toContain(NOTICE_COMMAND_TOKEN);
    expect(JSON.parse(stdout).data.doc.extra.file_anchors).toEqual(["src/first.ts", "src/second.ts"]);
  });
});

// ─── STATE (AC-5) + BOUNDARY (--raw) ───────────────────────────────────────

describe("lore get — AC-5 STATE (invalidation banner keeps its place)", () => {
  it("AC-5 the banner still prints, comes FIRST, and the notice does not list validity", async () => {
    await mustRun(["invalidate", handoffSlug, "--reason", "probe retraction"], tmpDir);

    const { stdout, exitCode } = await runLore(["get", handoffSlug], tmpDir);
    expect(exitCode).toBe(0);
    const bannerIndex = stdout.indexOf("INVALIDATED");
    const noticeIndex = stdout.indexOf(NOTICE_COMMAND_TOKEN);
    expect(bannerIndex).toBeGreaterThan(-1); // banner not displaced
    expect(noticeIndex).toBeGreaterThan(bannerIndex);
    // `handoff` is withheld; `validity` is NOT — the banner above already showed it.
    const inventory = extractNoticeInventory(stdout);
    expect(inventory).toContain("handoff");
    expect(inventory).not.toContain("validity");
  });

  it("--raw prints the notice too, and announces validity because no banner rendered there", async () => {
    const { stdout, exitCode } = await runLore(["get", handoffSlug, "--raw"], tmpDir);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("INVALIDATED"); // --raw never carries the banner (SPEC-043)
    expect(stdout).toContain(NOTICE_COMMAND_TOKEN);
    const inventory = extractNoticeInventory(stdout);
    expect(inventory).toContain("validity");
    expect(inventory).toContain("handoff");
  });
});
