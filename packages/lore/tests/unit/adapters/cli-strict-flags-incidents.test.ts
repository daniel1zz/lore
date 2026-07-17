/**
 * D3 incident regressions (SPEC-051 §Design D3) — reproduces the two REAL
 * dogfood incidents that motivated this spec, byte-for-byte, against the
 * real CLI source (spawned via `bun run src/index.ts`, mirroring
 * `tests/integration/cli/phase.test.ts`'s proven subprocess pattern) and a
 * throwaway temp corpus (`lore init` — NEVER the repo's own `.lore/`, per
 * project CLAUDE.md).
 *
 * Placed under `tests/unit/adapters/` (not `tests/integration/cli/`) because
 * SPEC-051's own structured AC-051-2 pins these regressions to
 * `bunx vitest run packages/lore/tests/unit/adapters`.
 *
 * Coverage:
 *   REGRESSION (incident a): `lore link A B --kind blocks` (real flag is
 *     --type; --kind was silently swallowed pre-SPEC-051, defaulting to
 *     "relates-to") now exits 2, names --kind, and creates NO link row.
 *   REGRESSION (incident b): `lore approve X --by daniel` (pre-SPEC-051 only
 *     --reviewer existed, so --by silently fell through to $LORE_ACTOR/OS
 *     username) now attributes the resulting version row to "daniel".
 *   HAPPY: the D2 --reviewer alias still works unchanged (REGRESSION guard
 *     for the pre-existing flag).
 *   ERROR: --by and --reviewer given CONFLICTING values on approve exits 2.
 *
 * @spec_ref SPEC-051 §Design D3 §Acceptance Criteria AC-051-2 AC-051-4
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// tests/unit/adapters/ → tests/unit/ → tests/ → packages/lore/
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir (mirrors phase.test.ts). */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true" },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

function extractSlug(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract slug from: ${stdout}`);
  return slug;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `lore-strict-flags-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });

  const init = runLore(["init"], tmpDir);
  if (init.exitCode !== 0) {
    throw new Error(`lore init failed: ${init.stderr}`);
  }
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup errors */
  }
});

function createKnowledgeDoc(title: string): string {
  const r = runLore(
    ["create", "knowledge", "--sub-type", "reference", "--title", title, "--content", "body", "--no-ai"],
    tmpDir,
  );
  if (r.exitCode !== 0) throw new Error(`create knowledge failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

describe("D3 incident (a): lore link A B --kind blocks", () => {
  it("REGRESSION: exits 2, names --kind, and writes NO link row", () => {
    const a = createKnowledgeDoc("Link Source Doc");
    const b = createKnowledgeDoc("Link Target Doc");

    const linked = runLore(["link", a, b, "--kind", "blocks"], tmpDir);
    expect(linked.exitCode).toBe(2);
    expect(linked.stderr).toContain("Unknown option: --kind");
    expect(linked.stderr).toContain("lore link --help");

    // Proof of "no link row written": doc A's navigation footer renders a
    // "Related:" line ONLY when nav.related is non-empty (formatNavigation
    // has no else branch for it) — a silently-created relates-to link (the
    // pre-SPEC-051 bug) would have produced that line, naming doc B.
    const got = runLore(["get", a], tmpDir);
    expect(got.exitCode).toBe(0);
    expect(got.stdout).not.toContain("Related:");
  });
});

describe("D3 incident (b): lore approve X --by daniel", () => {
  it("REGRESSION: the resulting version row is attributed to 'daniel'", () => {
    const doc = createKnowledgeDoc("Approve By Alias Doc");

    const approved = runLore(["approve", doc, "--by", "daniel"], tmpDir);
    expect(approved.exitCode).toBe(0);

    const log = runLore(["log", doc, "--json"], tmpDir);
    expect(log.exitCode).toBe(0);
    // reason: VersionService.log() returns entries NEWEST-FIRST (verified via a
    // manual run: [{version:2, action:"approve", created_by:"daniel"},
    // {version:1, action:"create", created_by:"system"}]) — entries[0] is the
    // approve row this test is proving attribution for, not entries[length-1].
    const parsed = JSON.parse(log.stdout) as { data: { entries: Array<{ action: string; created_by: string }> } };
    const approveEntry = parsed.data.entries[0];
    expect(approveEntry?.action).toBe("approve");
    expect(approveEntry?.created_by).toBe("daniel");
  });

  it("HAPPY: the pre-existing --reviewer alias still attributes correctly (REGRESSION guard)", () => {
    const doc = createKnowledgeDoc("Approve Reviewer Alias Doc");

    const approved = runLore(["approve", doc, "--reviewer", "alice"], tmpDir);
    expect(approved.exitCode).toBe(0);

    const log = runLore(["log", doc, "--json"], tmpDir);
    const parsed = JSON.parse(log.stdout) as { data: { entries: Array<{ action: string; created_by: string }> } };
    const approveEntry = parsed.data.entries[0];
    expect(approveEntry?.action).toBe("approve");
    expect(approveEntry?.created_by).toBe("alice");
  });

  it("ERROR: --by and --reviewer with CONFLICTING values exits 2", () => {
    const doc = createKnowledgeDoc("Approve Conflicting Actor Doc");

    const approved = runLore(["approve", doc, "--by", "daniel", "--reviewer", "alice"], tmpDir);
    expect(approved.exitCode).toBe(2);
    expect(approved.stderr).toContain("--by and --reviewer");
  });
});
