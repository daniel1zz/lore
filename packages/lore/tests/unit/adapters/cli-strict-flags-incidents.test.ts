// @spawns packages/lore/src/index.ts
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
 *   REGRESSION (incident b): `lore approve X --by daniel` once fell through
 *     silently to the OS username. `--by` (and its `--reviewer` alias) are now
 *     REMOVED from every write command (AC-ROI-1): both exit 2 naming the flag,
 *     and an approve is attributed to the invoking session identity.
 *
 * @spec_ref SPEC-051 §Design D3 §Acceptance Criteria AC-051-2 AC-051-4
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { sessionActorFor, withSessionIdentity } from "../../helpers/session-actor.js";

// tests/unit/adapters/ → tests/unit/ → tests/ → packages/lore/
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir (mirrors phase.test.ts). */
function runLore(args: string[], cwd: string, actor: string | null = null): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: withSessionIdentity({ ...process.env, HOME: cwd, EDITOR: "true" }, actor) as Record<string, string>,
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

describe("D3 incident (b): lore approve X --by daniel (the writer flags were later removed — spec-run-only-write-identity-and-run-end-claim-release#AC-ROI-1)", () => {
  it("REGRESSION: --by is rejected loudly (exit 2, names the flag) and writes nothing", () => {
    const doc = createKnowledgeDoc("Approve By Retired Doc");

    const approved = runLore(["approve", doc, "--by", "daniel"], tmpDir);
    expect(approved.exitCode).toBe(2);
    expect(approved.stderr).toContain("Unknown option: --by");
    expect(approved.stderr).toContain("lore approve --help");

    const log = runLore(["log", doc, "--json"], tmpDir);
    const parsed = JSON.parse(log.stdout) as { data: { entries: Array<{ action: string }> } };
    expect(parsed.data.entries.some((e) => e.action === "approve")).toBe(false);
  });

  it("REGRESSION: the former --reviewer alias is rejected loudly too (exit 2)", () => {
    const doc = createKnowledgeDoc("Approve Reviewer Retired Doc");

    const approved = runLore(["approve", doc, "--reviewer", "alice"], tmpDir);
    expect(approved.exitCode).toBe(2);
    expect(approved.stderr).toContain("Unknown option: --reviewer");
  });

  it("HAPPY: an approve is attributed to the invoking session identity", () => {
    const doc = createKnowledgeDoc("Approve Session Identity Doc");

    const approved = runLore(["approve", doc], tmpDir, "daniel");
    expect(approved.exitCode).toBe(0);

    const log = runLore(["log", doc, "--json"], tmpDir);
    expect(log.exitCode).toBe(0);
    // reason: VersionService.log() returns entries NEWEST-FIRST — entries[0] is the approve row.
    const parsed = JSON.parse(log.stdout) as { data: { entries: Array<{ action: string; created_by: string }> } };
    const approveEntry = parsed.data.entries[0];
    expect(approveEntry?.action).toBe("approve");
    expect(approveEntry?.created_by).toBe(sessionActorFor("daniel"));
  });
});
