// @spawns packages/lore/src/index.ts
/**
 * Requirement coverage and the requirement-removal guard scan EVERY spec that is not deleted
 * (AC-BLS3B-6; BR-418, BR-420, BR-692, BR-2).
 *
 * A spec takes no parent, so the PRD's children are never the universe of specs. A throwaway corpus
 * (`mkdtemp` + `lore init`, outside the repo) holds a PRD with two unmigrated requirements and PARENTLESS
 * specs:
 *   - R-1 is named by a criterion of a parentless draft spec: `lore status --check-requirements` counts it
 *     covered, and `lore requirement rm` of R-1 is refused while that criterion names it; with the
 *     criterion removed the withdrawal succeeds;
 *   - R-2 is named only by a criterion of an ARCHIVED parentless spec (BR-420: whatever its status):
 *     still covered, and its withdrawal is refused too (BR-692);
 *   - control: a requirement nothing names is uncovered (exit 3 for a P0).
 *
 * Dimensions: HAPPY (covered by a parentless spec), NEGATIVE (withdraw refused, exit 4; nothing written),
 * BOUNDARY (archived spec still counts), STATE (criterion removed -> uncovered -> withdraw succeeds),
 * REGRESSION (uncovered P0 control keeps exit 3).
 * The repo's own `.lore/` is never touched. (CLI verb is `lore requirement rm`; the rule text says "withdraw".)
 *
 * @spec_ref AC-BLS3B-6
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { actedStore } from "../../live-invocation.js";

setDefaultTimeout(300_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ACTOR = "agent:requirement-coverage-corpus-wide-test";
const SKELETON = "## Overview\n\nx\n\n## Scope\n\nx\n\n## Acceptance Criteria\n\nx\n";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let dir = "";

function runLore(args: string[]): RunResult {
  const env = { ...process.env, HOME: dir, CLAUDECODE: "1", LORE_ACTOR: ACTOR };
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd: dir, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[]): RunResult {
  const r = runLore(args);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

interface CoverageEntry {
  readonly slug: string;
  readonly uncovered: string[];
  readonly uncovered_p0: string[];
}

function coverage(): { exitCode: number; entry: CoverageEntry } {
  const r = runLore(["status", "--check-requirements", "--json"]);
  const parsed = JSON.parse(r.stdout) as { data: { requirements: { prds: CoverageEntry[] } } };
  const entry = parsed.data.requirements.prds.find((p) => p.slug === prdSlug);
  if (entry === undefined) throw new Error(`PRD ${prdSlug} missing from ${r.stdout}`);
  return { exitCode: r.exitCode, entry };
}

function declaredRequirementIds(): string[] {
  const parsed = JSON.parse(mustRun(["requirement", "list", prdSlug, "--json"]).stdout) as { data: Array<{ id: string }> };
  return parsed.data.map((r) => r.id);
}

async function archive(slug: string): Promise<void> {
  const store = actedStore(new SQLiteStore(join(dir, ".lore", "lore.db")));
  try {
    const doc = await store.findBySlug(slug);
    if (!doc.ok || doc.value === null) throw new Error(`no doc ${slug}`);
    const r = await store.update(doc.value.id, { status: "archived" });
    if (!r.ok) throw new Error("status seed failed");
  } finally {
    store.close();
  }
}

let prdSlug = "";
let liveSpec = "";
let archivedSpec = "";

beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "reqcov-corpuswide-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  const git = (args: string[]): void => void execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "rcw@example.invalid"]);
  git(["config", "user.name", "req cov wide"]);
  writeFileSync(join(dir, "README.md"), "fixture\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  mustRun(["init"]);
  appendFileSync(
    join(dir, ".lore", "config.yaml"),
    ["workflow:", "  gates:", "    spec-create:", "      enabled: false", "    spec-promote:", "      enabled: false", ""].join("\n"),
  );
  prdSlug = slugOf(mustRun(["create", "prd", "--title", "Coverage PRD", "--content", "root", "--no-ai"]).stdout);
  for (const [id, statement] of [
    ["R-1", "The export finishes within 5 seconds for 100 documents"],
    ["R-2", "The import rejects a file larger than 10 megabytes"],
    ["R-3", "The search returns at least 5 results for a title query"],
  ] as const) {
    mustRun(["requirement", "add", prdSlug, id, "--statement", statement, "--priority", "P0"]);
  }
  liveSpec = slugOf(mustRun(["create", "spec", "--title", "Live Parentless", "--content", SKELETON, "--no-ai"]).stdout);
  archivedSpec = slugOf(mustRun(["create", "spec", "--title", "Archived Parentless", "--content", SKELETON, "--no-ai"]).stdout);
  mustRun(["ac", "add", liveSpec, "AC-LIVE-1", "--statement", "x holds", "--mode", "script", "--oracle", "other", "--command", "true", "--covers", "R-1"]);
  mustRun(["ac", "add", archivedSpec, "AC-OLD-1", "--statement", "y holds", "--mode", "script", "--oracle", "other", "--command", "true", "--covers", "R-2"]);
  await archive(archivedSpec);
});

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe("requirement coverage scans every spec (AC-BLS3B-6)", () => {
  it("HAPPY: the specs under test have no parent (the PRD owns none of them)", () => {
    for (const slug of [liveSpec, archivedSpec]) {
      const parsed = JSON.parse(mustRun(["get", slug, "--json"]).stdout) as { data: { doc: { parent_id: string | null } } };
      expect(parsed.data.doc.parent_id).toBeNull();
    }
  });

  it("HAPPY/BOUNDARY: a criterion of a parentless spec — draft or archived — covers its requirement (BR-418, BR-420)", () => {
    const { entry } = coverage();
    expect(entry.uncovered).not.toContain("R-1");
    expect(entry.uncovered).not.toContain("R-2");
  });

  it("REGRESSION control: a requirement no criterion names stays uncovered, and an uncovered P0 exits 3", () => {
    const { exitCode, entry } = coverage();
    expect(entry.uncovered).toEqual(["R-3"]);
    expect(entry.uncovered_p0).toEqual(["R-3"]);
    expect(exitCode).toBe(3);
  });

  it("NEGATIVE: withdrawing R-1 is refused (exit 4) while a parentless spec's criterion names it; nothing is written (BR-692)", () => {
    const r = runLore(["requirement", "rm", prdSlug, "R-1"]);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("R-1");
    expect(declaredRequirementIds()).toContain("R-1");
  });

  it("BOUNDARY: withdrawing R-2 is refused too — its only naming criterion sits on an archived spec (BR-692)", () => {
    const r = runLore(["requirement", "rm", prdSlug, "R-2"]);
    expect(r.exitCode).toBe(4);
    expect(declaredRequirementIds()).toContain("R-2");
  });

  it("STATE: with the criterion removed R-1 is uncovered and its withdrawal succeeds", () => {
    mustRun(["ac", "rm", liveSpec, "AC-LIVE-1"]);
    const { entry } = coverage();
    expect(entry.uncovered).toContain("R-1");

    const r = runLore(["requirement", "rm", prdSlug, "R-1"]);
    expect(r.exitCode).toBe(0);
    expect(declaredRequirementIds()).not.toContain("R-1");
    expect(declaredRequirementIds()).toContain("R-2");
  });
});
