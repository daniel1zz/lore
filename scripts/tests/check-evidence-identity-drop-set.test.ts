// @spawns packages/lore/src/index.ts
// @spawns scripts/generate-evidence-identity-drop-set.ts
// @spawns scripts/check-evidence-identity-drop-set.ts
/**
 * @layer unit AC-EI-3 — unit/fixture coverage of the drop-set checker script; the AC itself is owned by scripts/check-evidence-identity-drop-set.ts
 * AC-EI-3 (spec-evidence-identity-an-attested-row-counts-only-for-the): the drop-set checker exits 0 only
 * when every listed AC is attested_pass now or is not attested_pass AND names a non-archived task; exit 1
 * names each other AC; exit 2 when the file is absent or empty while the corpus has script ACs; the
 * generator diffs two `lore ac list --json` dumps into the file's row format.
 *
 * Six-dimension coverage:
 *   HAPPY:      green and explained rows -> exit 0, counts printed; generator emits one row per drop
 *   NEGATIVE:   a row with no task and a non-attested state -> exit 1, named (the AC control)
 *   BOUNDARY:   an archived task or a missing task does not explain; an AC missing from the corpus is state absent
 *   ERROR:      absent file / empty file / empty array with script ACs -> exit 2; malformed JSON -> exit 3
 *   STATE:      absent file with NO script ACs is not a failure; non-script ACs and still-green ACs are not drops
 *   REGRESSION: end to end against a throwaway corpus (mkdtemp + lore init), exact exit codes; never the repo's .lore/
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type CorpusReader, type DropSetRow, evaluateDropSet, readDropSet, runCheck } from "../check-evidence-identity-drop-set.js";
import { type Dump, diffDumps } from "../generate-evidence-identity-drop-set.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const CHECKER = join(REPO_ROOT, "scripts", "check-evidence-identity-drop-set.ts");
const GENERATOR = join(REPO_ROOT, "scripts", "generate-evidence-identity-drop-set.ts");

function fakeCorpus(
  states: Record<string, string>,
  tasks: Record<string, string> = {},
  scriptAcs = 1,
): CorpusReader {
  return {
    getAcState: (spec, ac) => states[`${spec}/${ac}`] ?? null,
    getTaskStatus: (slug) => tasks[slug] ?? null,
    countScriptAcs: () => scriptAcs,
  };
}

const row = (over: Partial<DropSetRow> = {}): DropSetRow => ({
  spec: "spec-a",
  ac: "AC-A-1",
  before: "attested_pass",
  after: "not_measured",
  ...over,
});

function collect(rows: DropSetRow[] | null, corpus: CorpusReader): { code: number; out: string } {
  const lines: string[] = [];
  const code = runCheck(rows, corpus, (l) => lines.push(l));
  return { code, out: lines.join("\n") };
}

describe("check-evidence-identity-drop-set - AC-EI-3 pure evaluation", () => {
  it("HAPPY: a green row and an explained row exit 0 and the counts are printed", () => {
    const r = collect(
      [row(), row({ ac: "AC-A-2", task: "task-x" })],
      fakeCorpus({ "spec-a/AC-A-1": "attested_pass", "spec-a/AC-A-2": "fail" }, { "task-x": "draft" }),
    );
    expect(r.code).toBe(0);
    expect(r.out).toContain("green=1 explained=1 unexplained=0");
  });

  it("NEGATIVE: a row with no task and a non-attested state exits 1 naming spec and AC", () => {
    const r = collect([row()], fakeCorpus({ "spec-a/AC-A-1": "not_measured" }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("unexplained spec=spec-a ac=AC-A-1 state=not_measured");
    expect(r.out).toContain("green=0 explained=0 unexplained=1");
  });

  it("BOUNDARY: an archived task does not explain a non-attested AC", () => {
    const r = collect([row({ task: "task-x" })], fakeCorpus({ "spec-a/AC-A-1": "fail" }, { "task-x": "archived" }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("task task-x is archived");
  });

  it("BOUNDARY: a task slug that does not exist does not explain", () => {
    const r = collect([row({ task: "task-nope" })], fakeCorpus({ "spec-a/AC-A-1": "fail" }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("task task-nope not found");
  });

  it("BOUNDARY: an AC missing from the live corpus is state absent and unexplained without a task", () => {
    const outcomes = evaluateDropSet([row()], fakeCorpus({}));
    expect(outcomes[0]).toMatchObject({ kind: "unexplained", state: "absent" });
  });

  it("BOUNDARY: an attested_pass AC is green even when it names an archived task (re-verified wins)", () => {
    const outcomes = evaluateDropSet([row({ task: "task-x" })], fakeCorpus({ "spec-a/AC-A-1": "attested_pass" }, { "task-x": "archived" }));
    expect(outcomes[0]?.kind).toBe("green");
  });

  it("ERROR: no rows while the corpus has script ACs exits 2", () => {
    const r = collect(null, fakeCorpus({}, {}, 5));
    expect(r.code).toBe(2);
    expect(r.out).toContain("5 script AC(s)");
  });

  it("STATE: no rows and no script ACs is nothing to check, exit 0", () => {
    expect(collect(null, fakeCorpus({}, {}, 0)).code).toBe(0);
  });
});

describe("check-evidence-identity-drop-set - readDropSet file handling", () => {
  function withFile(content: string | null, fn: (path: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), "ei3-file-"));
    try {
      const path = join(dir, "drop-set.json");
      if (content !== null) writeFileSync(path, content, "utf8");
      fn(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("ERROR: absent file, empty file, whitespace file and [] all read as null", () => {
    withFile(null, (p) => expect(readDropSet(p)).toBeNull());
    withFile("", (p) => expect(readDropSet(p)).toBeNull());
    withFile("  \n", (p) => expect(readDropSet(p)).toBeNull());
    withFile("[]", (p) => expect(readDropSet(p)).toBeNull());
  });

  it("ERROR: malformed JSON and a wrong row shape throw instead of passing", () => {
    withFile("{not json", (p) => expect(() => readDropSet(p)).toThrow(/not valid JSON/));
    withFile('[{"spec":"s"}]', (p) => expect(() => readDropSet(p)).toThrow(/unexpected shape/));
  });

  it("HAPPY: valid rows parse with the optional task", () => {
    withFile(JSON.stringify([row(), row({ ac: "AC-A-2", task: "t" })]), (p) => expect(readDropSet(p)).toHaveLength(2));
  });
});

function dump(specs: Record<string, Array<[string, string, string]>>): Dump {
  return {
    specs: Object.fromEntries(
      Object.entries(specs).map(([slug, acs]) => [
        slug,
        { data: { coverage: acs.map(([ac_id, mode, state]) => ({ ac_id, mode, state })) } },
      ]),
    ),
  };
}

describe("generate-evidence-identity-drop-set - AC-EI-3 diff of two dumps", () => {
  const before = dump({
    "spec-a": [
      ["AC-A-1", "script", "attested_pass"],
      ["AC-A-2", "script", "attested_pass"],
      ["AC-A-3", "script", "fail"],
      ["AC-A-4", "human", "attested_pass"],
    ],
    "spec-b": [["AC-B-1", "script", "attested_pass"]],
  });

  it("HAPPY: only script ACs attested_pass before and not after become rows {spec, ac, before, after}", () => {
    const after = dump({
      "spec-a": [
        ["AC-A-1", "script", "attested_pass"],
        ["AC-A-2", "script", "not_measured"],
        ["AC-A-3", "script", "attested_pass"],
        ["AC-A-4", "human", "none"],
      ],
      "spec-b": [["AC-B-1", "script", "fail"]],
    });
    expect(diffDumps(before, after)).toEqual([
      { spec: "spec-a", ac: "AC-A-2", before: "attested_pass", after: "not_measured" },
      { spec: "spec-b", ac: "AC-B-1", before: "attested_pass", after: "fail" },
    ]);
  });

  it("BOUNDARY: an AC or spec missing from the after dump is a drop with after=absent; identical dumps give no rows", () => {
    const rows = diffDumps(before, dump({ "spec-a": [["AC-A-1", "script", "attested_pass"]] }));
    expect(rows.map((r) => `${r.spec}/${r.ac}:${r.after}`)).toEqual(["spec-a/AC-A-2:absent", "spec-b/AC-B-1:absent"]);
    expect(diffDumps(before, before)).toEqual([]);
  });

  it("STATE: owners map fills the row's task by spec/AC key", () => {
    const after = dump({ "spec-a": [["AC-A-2", "script", "fail"]], "spec-b": [["AC-B-1", "script", "attested_pass"]] });
    const rows = diffDumps(before, after, { "spec-a/AC-A-2": "task-owner" });
    expect(rows).toContainEqual({ spec: "spec-a", ac: "AC-A-2", before: "attested_pass", after: "fail", task: "task-owner" });
  });

  it("REGRESSION: generator output feeds the checker's row schema (round trip through the CLI diff verb)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ei3-gen-"));
    try {
      const b = join(dir, "before.json");
      const a = join(dir, "after.json");
      const out = join(dir, "rows.json");
      writeFileSync(b, JSON.stringify(before), "utf8");
      writeFileSync(a, JSON.stringify(dump({ "spec-a": [["AC-A-2", "script", "fail"]] })), "utf8");
      const r = spawnSync("bun", [GENERATOR, "diff", b, a, "--out", out], { cwd: dir, encoding: "utf8" });
      expect(r.status).toBe(0);
      expect(readDropSet(out)).toHaveLength(3);
      const bad = spawnSync("bun", [GENERATOR, "diff", join(dir, "missing.json"), a], { cwd: dir, encoding: "utf8" });
      expect(bad.status).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});

describe("check-evidence-identity-drop-set - AC-EI-3 end to end (mkdtemp + lore init)", () => {
  function lore(args: string[], cwd: string): { status: number; stdout: string } {
    const r = spawnSync("bun", ["run", LORE_ENTRY, ...args], { cwd, encoding: "utf8", env: { ...process.env, CLAUDECODE: "1" } });
    return { status: r.status ?? -1, stdout: r.stdout ?? "" };
  }
  function check(dir: string, file: string): { status: number; out: string } {
    const r = spawnSync("bun", [CHECKER, "--file", file, "--corpus", dir, "--lore-entry", LORE_ENTRY], { cwd: dir, encoding: "utf8", env: { ...process.env, CLAUDECODE: "1" } });
    return { status: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
  }

  it("exact exit codes: 2 absent, 2 empty, 1 unexplained row (named), 0 explained control, 3 malformed", () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-ei3-"));
    try {
      expect(lore(["init", "--json"], dir).status).toBe(0);
      const body = "## Overview/Goal\n\nF.\n\n## Scope\n\nF.\n\n## Acceptance Criteria\n\nSee ac list.\n";
      const spec = (JSON.parse(lore(["create", "spec", "--title", "EI3 fixture", "--content", body, "--json"], dir).stdout) as { data: { slug: string } }).data.slug;
      const added = lore(
        ["ac", "add", spec, "AC-EF-1", "--statement", "Fixture AC", "--mode", "script", "--oracle", "test", "--command", "bunx vitest run x.test.ts", "--allow-missing-path", "fixture: absent", "--json"],
        dir,
      );
      expect(added.status).toBe(0);
      const plan = (JSON.parse(lore(["create", "plan", "--title", "EI3 plan", "--content", "Goal: fixture.", "--json"], dir).stdout) as { data: { slug: string } }).data.slug;
      const task = (JSON.parse(lore(["create", "task", "--plan-id", plan, "--title", "EI3 owner task", "--content", "Estimate: S\nApproach: fixture.", "--json"], dir).stdout) as { data: { slug: string } }).data.slug;

      const file = join(dir, "drop-set.json");
      const absent = check(dir, file);
      expect(absent.status).toBe(2);
      expect(absent.out).toContain("absent or empty");

      writeFileSync(file, "", "utf8");
      expect(check(dir, file).status).toBe(2);

      const dropped = { spec, ac: "AC-EF-1", before: "attested_pass", after: "none" };
      writeFileSync(file, JSON.stringify([dropped]), "utf8");
      const red = check(dir, file);
      expect(red.status).toBe(1);
      expect(red.out).toContain(`unexplained spec=${spec} ac=AC-EF-1`);

      writeFileSync(file, JSON.stringify([{ ...dropped, task }]), "utf8");
      const ok = check(dir, file);
      expect(ok.out).toContain("explained=1");
      expect(ok.status).toBe(0);

      writeFileSync(file, "{not json", "utf8");
      expect(check(dir, file).status).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180000);
});
