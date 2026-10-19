// @spawns packages/lore/src/index.ts
// @reads assets/**
// @reads packages/lore/package.json
// @reads package.json
// @reads scripts/embed-assets-manifest.mjs
// @reads packages/lore/src/generated/assets-manifest.ts
/**
 * @spec_ref spec-defect-clusters-round-2-part-c-criterion-data-demotion  AC-DC2-21, D21; business rules BR-205, BR-110.
 *
 * The red step lives in the implementing task: one task captures red, implements, captures green. The shipped
 * lore-plan skill never tells a planner to create a separate RED test task or to block the implement task on it.
 *
 * Coverage: (a) HAPPY/REGRESSION — SKILL.md AND mode-create.md AND the embedded manifest copy carry no pairing
 * instruction and do describe red-first (the green-but-broken case is checking SKILL.md alone, so each file is
 * asserted separately); (b) HAPPY/STATE — throwaway git repo + corpus: one red-first task closes red then green via
 * `lore done`, with no second task and no blocks edge. NEGATIVE — the predicate catches the pairing step re-added.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { tmpdir } from "os";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../helpers/clean-tree-repo.js";
import { EMBEDDED_ASSETS_MANIFEST } from "../../src/generated/assets-manifest.js";
import { buildManifest } from "../../../../scripts/embed-assets-manifest.mjs";

const ID = "spec-defect-clusters-round-2-part-c-criterion-data-demotion#AC-DC2-21";
const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const REPO_ROOT = join(PROJECT_ROOT, "..", "..");
const ASSETS_ROOT = join(REPO_ROOT, "assets");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");
const ACTOR = "agent:dc2-tdd-red-pairing-test";

const SHIPPED = ["skills/lore-plan/SKILL.md", "skills/lore-plan/references/mode-create.md"] as const;

/** Instructions that make a planner pair a RED test task with its implementer. */
const PAIRING_PATTERNS: readonly RegExp[] = [
  /\[Skill:test\][^\n]*RED/i,
  /RED[^\n]*\[Skill:test\]/i,
  /lore link\s+<test-task>\s+<impl-task>\s+--type=blocks/,
  /test blocks impl/i,
  /Paired-Impl/,
  /TDD-Role/,
];

function pairingHits(text: string): string[] {
  return PAIRING_PATTERNS.filter((p) => p.test(text)).map((p) => String(p));
}

describe(`${ID} (a) — shipped skill text describes red-first on the implement task`, () => {
  for (const rel of SHIPPED) {
    it(`${ID}: ${rel} carries no pairing instruction and names the red-first route`, () => {
      const text = readFileSync(join(ASSETS_ROOT, rel), "utf8");
      expect(pairingHits(text)).toEqual([]);
      expect(text).toContain("lore red-first");
      expect(text).toMatch(/expected-fail/);
    });

    it(`${ID}: the embedded manifest copy of ${rel} is the current, fixed file`, () => {
      const embedded = EMBEDDED_ASSETS_MANIFEST.entries.find((e) => e.path === rel);
      const fresh = buildManifest(ASSETS_ROOT, REPO_ROOT).entries.find((e: { path: string }) => e.path === rel);
      expect(embedded).toBeDefined();
      expect(fresh).toBeDefined();
      expect(embedded?.sha256).toBe(fresh?.sha256);
    });
  }

  it(`${ID}: NEGATIVE — the predicate catches the pairing step re-added to mode-create.md`, () => {
    const text = readFileSync(join(ASSETS_ROOT, SHIPPED[1]), "utf8");
    expect(pairingHits(`${text}\n3. **Wire dependency** — \`lore link <test-task> <impl-task> --type=blocks\`\n`)).not.toEqual([]);
    expect(pairingHits(`${text}\nlore create task --title "[Skill:test] x — RED test scenarios"\n`)).not.toEqual([]);
  });
});

describe(`${ID} (b) — one red-first task closes red then green`, () => {
  let dir: string;

  function runLore(args: string[], cwd: string): { exitCode: number; stdout: string; text: string } {
    const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
      cwd,
      env: { ...process.env, HOME: FIXTURE_HOME_OUTSIDE_REPO, CLAUDECODE: "1", LORE_ACTOR: ACTOR },
    });
    const stdout = proc.stdout.toString();
    return { exitCode: proc.exitCode ?? 1, stdout, text: `${stdout}\n${proc.stderr.toString()}` };
  }
  function mustRun(args: string[], cwd: string): string {
    const r = runLore(args, cwd);
    if (r.exitCode !== 0) throw new Error(`lore ${args.join(" ")} exited ${r.exitCode}: ${r.text}`);
    return r.stdout;
  }
  const git = (args: string[], cwd: string): string => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
  const slugOf = (out: string): string => {
    const s = out.match(/Slug:\s+(\S+)/)?.[1];
    if (s === undefined) throw new Error(`no slug in: ${out}`);
    return s;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lore-dc2-tdd-red-"));
    makeCleanTreeRepo(dir);
    mustRun(["init"], dir);
  });
  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it(`${ID}: red captured, module implemented, pass captured, lore done exits 0 with no second task and no blocks edge`, () => {
    mustRun(["create", "prd", "--title", "Red Root", "--content", "root", "--no-ai"], dir);
    const task = slugOf(mustRun(["create", "task", "--title", "Impl with red", "--adhoc", "--ac-scope", "", "--content", "x", "--no-ai"], dir));
    mustRun(["red-first", task], dir);

    // The red and the implementation happen on T's branch, so the red never lands on main alone.
    git(["checkout", "-q", "-b", "feat-red-first"], dir);
    mustRun(["claim", task, "--worktree", "feat-red-first"], dir);
    writeFileSync(
      join(dir, "mod.test.js"),
      [
        'let m = null;',
        'try { m = require("./mod.js"); } catch { m = null; }',
        'if (!m || m.add(1, 2) !== 3) { console.log("1 fail"); console.log("Ran 1 tests across 1 files"); process.exit(1); }',
        'console.log("1 pass"); console.log("Ran 1 tests across 1 files");',
        "",
      ].join("\n"),
    );
    git(["add", "mod.test.js"], dir);
    git(["commit", "-q", "-m", "red test on the task branch"], dir);
    const cmd = "node mod.test.js";
    mustRun(["evidence", task, "--oracle", "test", "--command", cmd, "--result", "expected-fail", "--capture"], dir);

    writeFileSync(join(dir, "mod.js"), "module.exports = { add: (a, b) => a + b };\n");
    git(["add", "mod.js"], dir);
    git(["commit", "-q", "-m", "implementation"], dir);
    mustRun(["evidence", task, "--oracle", "test", "--command", cmd, "--result", "pass", "--capture"], dir);
    git(["checkout", "-q", "main"], dir);
    // landed through `lore integrate`, which records the landing `lore done` requires (BR-1291)
    appendFileSync(join(dir, ".git", "info", "exclude"), ".claude/\n");
    appendFileSync(join(dir, ".lore", "config.yaml"), 'workflow:\n  integrate:\n    floor_command: "true"\n', "utf8");
    mustRun(["integrate", "feat-red-first", "--session", "dc2-red-session"], dir);

    const closed = runLore(["done", task], dir);
    expect(closed.text).not.toMatch(/\[floor:/);
    expect(closed.exitCode).toBe(0);

    const doc = JSON.parse(mustRun(["get", task, "--json"], dir)) as { data: { doc: { status: string; extra: Record<string, unknown> } } };
    expect(doc.data.doc.status).toBe("archived");
    expect(doc.data.doc.extra["red_first"]).toBe(true);

    const tasks = JSON.parse(mustRun(["list", "--type", "task", "--json"], dir)) as { data: unknown };
    expect(JSON.stringify(tasks.data).match(/"slug"/g)?.length).toBe(1);
    expect(mustRun(["get", task, "--json"], dir)).not.toMatch(/"blocks"/);
  }, 300_000);
});
