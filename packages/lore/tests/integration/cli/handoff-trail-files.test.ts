// @spawns packages/lore/src/index.ts
/**
 * AC-ST-11: `lore handoff` fills the changed files from the caller's session trail.
 *
 * @spec_ref AC-ST-11 (spec-session-trail-a-session-local-record-of-what-each-run-4: Consumers/Handoff, D16)
 *
 * Drives the REAL CLI (`bun run packages/lore/src/index.ts`) against a mkdtemp corpus created
 * with `lore init`, a mkdtemp HOME, and a fixture trail under `CLAUDE_STATE_BASE_OVERRIDE` —
 * never this repo's `.lore/` or the real `~/.claude`.
 *
 * Coverage: HAPPY (flags, json-file) / NEGATIVE (no run) / BOUNDARY (multi-source path, author
 * file in and out of trail) / ERROR (unusable run id) / STATE (removed + unmeasured parts).
 */

import { ensureRequirementsDocSlug } from "../../helpers/parented-create.js";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(PACKAGE_ROOT, "src", "index.ts");

let dir: string;
let stateBase: string;

interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function lore(args: string[], run?: string): CliResult {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: dir,
    CLAUDECODE: "1",
    CLAUDE_STATE_BASE_OVERRIDE: stateBase,
    CLAUDE_CODE_SESSION_ID: "handoff-trail-author",
  };
  for (const name of ["LORE_ACTOR", "CLAUDE_SESSION_ID", "LORE_GATE_BYPASS"]) delete env[name];
  // The run rides in the per-call env value, as the Bash hook hands it to a real call.
  if (run !== undefined) env["LORE_HARNESS_RUN"] = run;
  const proc = spawnSync("bun", ["run", ENTRY, ...args], { cwd: dir, env, encoding: "utf8" });
  return { stdout: proc.stdout ?? "", stderr: proc.stderr ?? "", exitCode: proc.status ?? 1 };
}

function registerRun(run: string): void {
  const [, session] = run.split(":");
  const r = lore(["run", "register", "--harness", "claude-code", "--session", session!, "--harness-pid", String(process.pid)]);
  if (r.exitCode !== 0) throw new Error(`run register failed: ${r.stderr}${r.stdout}`);
}

interface ChangeFixture {
  readonly path: string;
  readonly status: "A" | "M" | "D";
  readonly source: { kind: "run"; run: string } | { kind: "vcs" } | { kind: "unknown" };
}

function writeTurn(session: string, turn: string, openedSecondsAgo: number, changes: ChangeFixture[] | null, reason?: string): void {
  const turnDir = join(stateBase, "sessions", session, turn);
  mkdirSync(turnDir, { recursive: true });
  const snapshot = join(turnDir, "turn-start-snapshot.json");
  writeFileSync(snapshot, "{}");
  const t = new Date(Date.now() - openedSecondsAgo * 1000);
  utimesSync(snapshot, t, t);
  if (changes === null && reason === undefined) return; // no changes.json at all: an unmeasured turn
  const body = {
    turn,
    at: t.toISOString(),
    shared_working_copy: false,
    changes: changes === null
      ? { measured: false, reason }
      : { measured: true, value: changes.map((c) => ({ ...c, lines: 1 })) },
  };
  writeFileSync(join(turnDir, "changes.json"), JSON.stringify(body));
}

const RUN = "cc:trail-s1";
const RUN_FILES: ChangeFixture[] = [
  { path: "src/a.ts", status: "M", source: { kind: "run", run: RUN } },
  { path: "src/b.ts", status: "M", source: { kind: "vcs" } },
  { path: "src/c.ts", status: "A", source: { kind: "unknown" } },
];

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "handoff-trail-")));
  stateBase = join(dir, "state");
  const init = lore(["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}${init.stdout}`);
  registerRun(RUN);
  registerRun("cc:trail-gaps");
  // reason: BR-709 — a handoff is filed under the requirements document when it names no plan, so the corpus needs one.
  ensureRequirementsDocSlug((args) => lore(args, RUN));
  // BR-1528: a handoff is created structured through the approved `knowledge/handoff` template.
  const seeded = lore(["migrate", "templates", "--apply"], RUN);
  if (seeded.exitCode !== 0) throw new Error(`lore migrate templates --apply failed: ${seeded.stderr}${seeded.stdout}`);

  // Session trail-s1: 6 distinct files over 2 turns; src/b.ts appears in both turns with two sources.
  writeTurn("trail-s1", "turn-1", 200, RUN_FILES);
  writeTurn("trail-s1", "turn-2", 100, [
    { path: "src/b.ts", status: "M", source: { kind: "unknown" } },
    { path: "src/d.ts", status: "M", source: { kind: "run", run: RUN } },
    { path: "src/e.ts", status: "D", source: { kind: "unknown" } },
    { path: "src/f.ts", status: "A", source: { kind: "vcs" } },
  ]);

  // Session trail-gaps: removed marker + a measured turn + an unmeasured turn.
  mkdirSync(join(stateBase, "sessions", "trail-gaps"), { recursive: true });
  writeFileSync(
    join(stateBase, "sessions", "trail-gaps", "removed.json"),
    JSON.stringify({ removed_at: "2026-09-01T00:00:00.000Z", started_at: "2026-08-01T00:00:00.000Z" }),
  );
  writeTurn("trail-gaps", "turn-m", 200, [{ path: "src/g.ts", status: "M", source: { kind: "vcs" } }]);
  writeTurn("trail-gaps", "turn-u", 100, null, "git diff failed");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface RecordedHandoff {
  readonly content: string;
  readonly handoff: {
    modified_files: string[];
    changed_files?: Array<{ path: string; sources: Array<{ kind: string; run?: string }>; named_by_author: boolean }>;
    changed_files_measured?: boolean;
  };
}

function recorded(r: CliResult): RecordedHandoff {
  expect(r.exitCode, r.stderr + r.stdout).toBe(0);
  const parsed = JSON.parse(r.stdout) as { data: { content: string; extra: { handoff: RecordedHandoff["handoff"] } } };
  return { content: parsed.data.content, handoff: parsed.data.extra.handoff };
}

function sourcesByPath(h: RecordedHandoff): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of h.handoff.changed_files ?? []) {
    out[f.path] = f.sources.map((s) => (s.kind === "run" ? `run:${s.run}` : s.kind)).sort();
  }
  return out;
}

const EXPECTED_SIX: Record<string, string[]> = {
  "src/a.ts": [`run:${RUN}`],
  "src/b.ts": ["unknown", "vcs"],
  "src/c.ts": ["unknown"],
  "src/d.ts": [`run:${RUN}`],
  "src/e.ts": ["unknown"],
  "src/f.ts": ["vcs"],
};

describe("AC-ST-11 lore handoff changed files from the session trail", () => {
  it("AC-ST-11 separate fields, no --file: records all 6 trail files with their sources, one entry per path", () => {
    const h = recorded(lore(["handoff", "--next", "continue", "--json"], RUN));
    expect(h.handoff.changed_files_measured).toBe(true);
    expect(h.handoff.changed_files).toHaveLength(6);
    expect(sourcesByPath(h)).toEqual(EXPECTED_SIX);
    expect(h.handoff.changed_files!.every((f) => f.named_by_author === false)).toBe(true);
    expect(h.handoff.modified_files).toEqual([]);
    expect(h.content).toContain("src/e.ts");
  });

  it("AC-ST-11 --json-file records the same 6 as the separate-fields way", () => {
    const file = join(dir, "payload.json");
    writeFileSync(file, JSON.stringify({ by: "ignored", next_steps: ["continue"] }));
    const viaFile = recorded(lore(["handoff", "--json-file", file, "--json"], RUN));
    expect(viaFile.handoff.changed_files).toHaveLength(6);
    expect(sourcesByPath(viaFile)).toEqual(EXPECTED_SIX);
  });

  it("AC-ST-11 an author --file absent from the trail is kept and marked; one in the trail is merged and marked", () => {
    const h = recorded(
      lore(["handoff", "--next", "continue", "--file", "docs/only-author.md", "--file", "src/a.ts", "--json"], RUN),
    );
    expect(h.handoff.modified_files).toEqual(["docs/only-author.md", "src/a.ts"]);
    const byPath = new Map(h.handoff.changed_files!.map((f) => [f.path, f]));
    expect(h.handoff.changed_files).toHaveLength(7);
    expect(byPath.get("docs/only-author.md")).toMatchObject({ named_by_author: true, sources: [] });
    expect(byPath.get("src/a.ts")).toMatchObject({ named_by_author: true });
    expect(byPath.get("src/a.ts")!.sources).toEqual([{ kind: "run", run: RUN }]);
    expect(byPath.get("src/c.ts")!.named_by_author).toBe(false);
    expect(h.content).toContain("named by author");
  });

  it("AC-ST-11 with no attested run the rendered handoff reads changed files: not measured", () => {
    const h = recorded(lore(["handoff", "--next", "continue", "--file", "x.ts", "--json"]));
    expect(h.content).toContain("changed files: not measured");
    expect(h.handoff.changed_files_measured).toBe(false);
    expect(h.handoff.changed_files).toEqual([{ path: "x.ts", sources: [], named_by_author: true }]);
  });

  it("AC-ST-11 an unregistered run id is REFUSED (exit 4, nothing written), so no trail file is read or recorded", () => {
    // A run the registry never saw is refused (BR-1351); it is no longer downgraded to an unattested handoff.
    const r = lore(["handoff", "--next", "continue", "--json"], "cc:never-registered");
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("cc:never-registered");
  });

  it("AC-ST-11 a removed part and an unmeasured turn render as removed and unmeasured, never as no change", () => {
    const h = recorded(lore(["handoff", "--next", "continue", "--json"], "cc:trail-gaps"));
    expect(h.handoff.changed_files_measured).toBe(true);
    expect(h.handoff.changed_files!.map((f) => f.path)).toEqual(["src/g.ts"]);
    expect(h.content).toMatch(/removed.*2026-09-01/);
    expect(h.content).toMatch(/not measured.*turn-u.*git diff failed/);
    expect(h.content).not.toContain("changed files: none");
  });
});
