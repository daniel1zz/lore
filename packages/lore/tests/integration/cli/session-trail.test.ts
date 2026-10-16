/**
 * AC-ST-6 — `lore session trail` lists the caller's own session trail.
 *
 * Drives the real CLI (`bun run src/index.ts`) against a mkdtemp corpus (`lore init`) and a mkdtemp state
 * base (`CLAUDE_STATE_BASE_OVERRIDE`); never the real `~/.claude` or this repo's `.lore/`. The caller's run
 * is attested through `--harness-run <id>` after `lore run register`, exactly as the PreToolUse hook rewrites it.
 *
 * Fixture session S: turn t1 (measured: a.ts run main, b.ts vcs, c.ts unknown), turn t2 (measured: d.ts run
 * helper A), turn t3 (changes.json absent -> unmeasured), helper A with an isolated measured change.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { formatTrail, narrowTrail } from "../../../src/adapters/cli/session-trail-render.js";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(PACKAGE_ROOT, "src", "index.ts");
const SESSION = "sess-trail-1";
const RULE = "BR-1143";

interface Run {
  stdout: string;
  stderr: string;
  exitCode: number;
}

let root: string;
let corpus: string;
let stateBase: string;

function lore(args: string[], run?: string): Run {
  const argv = run === undefined ? args : ["--harness-run", run, ...args];
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: corpus,
    CLAUDECODE: "1",
    CLAUDE_STATE_BASE_OVERRIDE: stateBase,
  };
  // The ambient identity of whoever runs this suite must never decide a verdict.
  for (const name of ["LORE_ACTOR", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"]) delete env[name];
  const p = spawnSync("bun", ["run", ENTRY, ...argv], { cwd: corpus, encoding: "utf8", env });
  return { stdout: p.stdout ?? "", stderr: p.stderr ?? "", exitCode: p.status ?? 1 };
}

function must(r: Run, what: string): Run {
  if (r.exitCode !== 0) throw new Error(`${what} failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

function write(path: string, body: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(body));
}

const change = (path: string, status: "A" | "M" | "D", source: object) => ({ path, status, lines: 3, source });

function seedTrail(): void {
  const dir = join(stateBase, "sessions", SESSION);
  write(join(dir, "session.json"), { started_at: "2026-10-16T08:00:00.000Z" });
  for (const t of ["t1", "t2", "t3"]) write(join(dir, t, "turn-start-snapshot.json"), {});
  write(join(dir, "t1", "changes.json"), {
    turn: "t1",
    at: "2026-10-16T08:10:00.000Z",
    shared_working_copy: false,
    changes: {
      measured: true,
      value: [
        change("src/a.ts", "A", { kind: "run", run: `cc:${SESSION}` }),
        change("src/b.ts", "M", { kind: "vcs" }),
        change("src/c.ts", "D", { kind: "unknown" }),
      ],
    },
  });
  write(join(dir, "t2", "changes.json"), {
    turn: "t2",
    at: "2026-10-16T08:20:00.000Z",
    shared_working_copy: true,
    changes: { measured: true, value: [change("src/d.ts", "M", { kind: "run", run: `cc:${SESSION}:A` })] },
  });
  write(join(dir, "helpers", "A.json"), {
    run: `cc:${SESSION}:A`,
    started_at: "2026-10-16T08:11:00.000Z",
    ended_at: "2026-10-16T08:15:00.000Z",
    end_count: 1,
    isolated: true,
    changes: {
      measured: true,
      value: { base: "abc123", files: [change("src/h.ts", "A", { kind: "run", run: `cc:${SESSION}:A` })] },
    },
  });
}

function json(r: Run): { ok: boolean; data: any } {
  return JSON.parse(r.stdout);
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lore-session-trail-")));
  corpus = join(root, "corpus");
  stateBase = join(root, "state");
  mkdirSync(corpus, { recursive: true });
  mkdirSync(stateBase, { recursive: true });
  must(lore(["init"]), "lore init");
  must(lore(["run", "register", "--harness", "claude-code", "--session", SESSION]), "register main");
  must(
    lore(["run", "register", "--harness", "claude-code", "--session", SESSION, "--agent-id", "A", "--agent-type", "lore-implementer"]),
    "register helper",
  );
  must(lore(["run", "register", "--harness", "claude-code", "--session", "no-such-sess"]), "register absent-trail session");
  seedTrail();
}, 120_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("AC-ST-6 lore session trail", () => {
  it("HAPPY: under cc:S returns every file of session S with status and source", () => {
    const r = lore(["session", "trail", "--json"], `cc:${SESSION}`);
    expect(r.exitCode).toBe(0);
    const d = json(r).data;
    expect(d.session).toBe(SESSION);
    const files = d.files.map((f: any) => [f.turn, f.path, f.status, f.source.kind]);
    expect(files).toEqual([
      ["t1", "src/a.ts", "A", "run"],
      ["t1", "src/b.ts", "M", "vcs"],
      ["t1", "src/c.ts", "D", "unknown"],
      ["t2", "src/d.ts", "M", "run"],
    ]);
    expect(d.files[0].source.run).toBe(`cc:${SESSION}`);
  }, 60_000);

  it("--turn narrows to exactly that turn", () => {
    const d = json(lore(["session", "trail", "--turn", "t2", "--json"], `cc:${SESSION}`)).data;
    expect(d.turns.map((t: any) => t.turn)).toEqual(["t2"]);
    expect(d.files.map((f: any) => f.path)).toEqual(["src/d.ts"]);
  }, 60_000);

  it("--run narrows to the files that run changed", () => {
    const d = json(lore(["session", "trail", "--run", `cc:${SESSION}:A`, "--json"], `cc:${SESSION}`)).data;
    expect(d.files.map((f: any) => f.path)).toEqual(["src/d.ts"]);
    expect(d.helpers.map((h: any) => h.run)).toEqual([`cc:${SESSION}:A`]);
  }, 60_000);

  it("a helper run cc:S:A sees session S", () => {
    const r = lore(["session", "trail", "--json"], `cc:${SESSION}:A`);
    expect(r.exitCode).toBe(0);
    const d = json(r).data;
    expect(d.session).toBe(SESSION);
    expect(d.files).toHaveLength(4);
  }, 60_000);

  it("an unmeasured turn is returned as unmeasured with its reason, never as empty", () => {
    const d = json(lore(["session", "trail", "--turn", "t3", "--json"], `cc:${SESSION}`)).data;
    expect(d.turns).toHaveLength(1);
    expect(d.turns[0].changes).toEqual({ measured: false, reason: "changes.json absent" });
    expect(d.files).toEqual([]);
    const text = lore(["session", "trail", "--turn", "t3"], `cc:${SESSION}`);
    expect(text.stdout).toContain("unmeasured");
    expect(text.stdout).toContain("changes.json absent");
  }, 60_000);

  it("NEGATIVE: no attested run exits 4 naming the rule and prints no file", () => {
    const r = lore(["session", "trail", "--json"]);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain(RULE);
    expect(r.stdout).toBe("");
  }, 60_000);

  it("NEGATIVE: a session with no trail in the state base exits 4 naming the rule", () => {
    const r = lore(["session", "trail", "--json"], "cc:no-such-sess");
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain(RULE);
    expect(r.stdout).toBe("");
  }, 60_000);

  it("NEGATIVE: an unknown turn exits 3 and an unknown flag is rejected", () => {
    expect(lore(["session", "trail", "--turn", "nope", "--json"], `cc:${SESSION}`).exitCode).toBe(3);
    expect(lore(["session", "trail", "--session", SESSION], `cc:${SESSION}`).exitCode).not.toBe(0);
  }, 60_000);
});

describe("session-trail-render (pure)", () => {
  const trail = {
    session: "S",
    started_at: null,
    removed: { removed_at: "2026-10-01T00:00:00.000Z", started_at: null },
    turns: [],
    helpers: [],
  };

  it("a removed trail renders as removed with its date, not as empty", () => {
    const text = formatTrail(narrowTrail(trail, {}));
    expect(text).toContain("removed");
    expect(text).toContain("2026-10-01");
  });

  it("an unmeasured helper measurement renders as unmeasured", () => {
    const t = {
      ...trail,
      removed: null,
      helpers: [
        {
          run: "cc:S:A",
          agent_id: "A",
          started_at: "x",
          end_count: 1,
          judged_end_count: 0,
          changes: { measured: false as const, reason: "not isolated" },
        },
      ],
    };
    expect(formatTrail(narrowTrail(t, {}))).toContain("unmeasured (not isolated)");
  });
});
