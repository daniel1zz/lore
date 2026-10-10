/**
 * RED suite for slice 3a BL-16 (outline retirement), driven through the real CLI against a throwaway
 * corpus (`mkdtemp` + `lore init`, cwd inside it; the repo's own `.lore/` is never touched).
 *
 * @spec_ref AC-BLS3-6
 *
 * Spec: spec-baseline-slice-3a-architecture-tree-baseline-root (Design "Outline"); rule BR-985:
 *   "Writing, removing or exempting an outline section is refused with outcome code 4, naming the
 *    baseline action that replaces it; listing existing outline entries still works."
 *   Plus: the dead `renderLinkOnlyOutlineForBootstrap` (outline-migration-service.ts) no longer exists.
 *
 * CONTRACT (this RED task's interface choices):
 *   - `lore outline set | rm | exempt` exit 4 (VALIDATION_ERROR class); stderr (or, with --json, the
 *     `error.message` of the stdout envelope `{ok:false,error:{code:"VALIDATION_ERROR",message}}`)
 *     contains the literal text `lore baseline add`.
 *   - "write nothing": the PRD row's `version` and `extra` are byte-identical afterwards and the plan
 *     row carries no `prd_sync_exempt`; no new audit-visible version is created.
 *   - `lore outline list` keeps exit 0 and lists every stored entry (text and --json).
 *   - The outline fixture is seeded by a direct SQLite UPDATE of `docs.extra` (the write verbs are the
 *     thing being retired, so they cannot seed their own fixture).
 *   - Dead-renderer check: dynamic import of the module; the module may be deleted outright (import
 *     fails) or kept without the export - either satisfies "no longer exists", the export being
 *     present does not.
 *
 * Dimensions: NEGATIVE (3 verbs x refused), STATE (nothing written), HAPPY control (list), REGRESSION
 * (dead export). Control that holds on main today: `outline list`.
 */

import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(300_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ACTOR = "agent:outline-retired-test";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const env = { ...process.env, HOME: cwd, CLAUDECODE: "1", LORE_ACTOR: ACTOR };
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[], cwd: string): RunResult {
  const r = runLore(args, cwd);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created \w+ (\S+) \(/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

function entry(n: number): Record<string, unknown> {
  return {
    section: `section-${n}`,
    title: `Section ${n}`,
    tier: "domain",
    direction: `Bounded summary for section ${n}.`,
    decision_pointers: [],
    constraints: [],
    links: [],
  };
}

interface Row {
  version: number;
  extra: string;
}
function row(dir: string, slug: string): Row {
  const db = new Database(join(dir, ".lore", "lore.db"), { readonly: true });
  try {
    return db.query("SELECT version, extra FROM docs WHERE slug = ?").get(slug) as Row;
  } finally {
    db.close();
  }
}

let dir = "";
let seq = 0;
let sharedSpec = "";

/** A fresh PRD with two stored outline entries, so a write verb that wrongly succeeds in one test cannot poison another. */
function freshPrd(): { slug: string; before: Row } {
  seq += 1;
  const slug = slugOf(mustRun(["create", "prd", "--title", `Outline PRD ${seq}`, "--content", "root", "--no-ai"], dir).stdout);
  // Seed WITHOUT the (retired) write verbs.
  const db = new Database(join(dir, ".lore", "lore.db"));
  try {
    const cur = db.query("SELECT extra FROM docs WHERE slug = ?").get(slug) as { extra: string };
    const extra = { ...(JSON.parse(cur.extra) as Record<string, unknown>), outline: [entry(1), entry(2)] };
    db.query("UPDATE docs SET extra = ? WHERE slug = ?").run(JSON.stringify(extra), slug);
  } finally {
    db.close();
  }
  return { slug, before: row(dir, slug) };
}

function freshPlan(): { slug: string; before: Row } {
  seq += 1;
  const slug = slugOf(
    mustRun(["create", "plan", "--title", `Outline Plan ${seq}`, "--parent", sharedSpec, "--no-ai", "--content", "body"], dir).stdout,
  );
  return { slug, before: row(dir, slug) };
}

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "outline-retired-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@example.invalid"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "fixture\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  mustRun(["init"], dir);
  const root = slugOf(mustRun(["create", "prd", "--title", "Spec Parent PRD", "--content", "root", "--no-ai"], dir).stdout);
  sharedSpec = slugOf(
    mustRun(["create", "spec", "--title", "Outline Spec","--no-ai", "--content", "## Overview\nbody"], dir).stdout,
  );
});

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe("outline writes retired (BL-16)", () => {
  it("fixture sanity: the seeded outline is stored on the PRD", () => {
    const { before } = freshPrd();
    expect((JSON.parse(before.extra) as { outline: unknown[] }).outline).toHaveLength(2);
  });

  it("outline set exits 4 naming `lore baseline add`", () => {
    const { slug } = freshPrd();
    const r = runLore(["outline", "set", slug, "--section", "section-3", "--title", "Section 3", "--tier", "domain", "--direction", "new"], dir);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("lore baseline add");
  });

  it("outline set writes nothing: the PRD version and extra are unchanged", () => {
    const { slug, before } = freshPrd();
    runLore(["outline", "set", slug, "--section", "section-1", "--title", "Changed", "--tier", "core", "--direction", "changed"], dir);
    const after = row(dir, slug);
    expect(after.version).toBe(before.version);
    expect(after.extra).toBe(before.extra);
  });

  it("outline rm exits 4 naming `lore baseline add`", () => {
    const { slug } = freshPrd();
    const r = runLore(["outline", "rm", slug, "section-1"], dir);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("lore baseline add");
  });

  it("outline rm of a section that does NOT exist is also refused with 4 naming `lore baseline add` (retired, not a per-section check)", () => {
    const { slug } = freshPrd();
    const r = runLore(["outline", "rm", slug, "no-such-section"], dir);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("lore baseline add");
  });

  it("outline rm writes nothing: both stored entries survive and the version is unchanged", () => {
    const { slug, before } = freshPrd();
    runLore(["outline", "rm", slug, "section-2"], dir);
    const after = row(dir, slug);
    expect(after.version).toBe(before.version);
    expect((JSON.parse(after.extra) as { outline: unknown[] }).outline).toHaveLength(2);
  });

  it("outline exempt exits 4 naming `lore baseline add`", () => {
    const { slug } = freshPlan();
    const r = runLore(["outline", "exempt", slug, "--reason", "no outline change needed"], dir);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("lore baseline add");
  });

  it("outline exempt writes nothing: the plan has no prd_sync_exempt and its version is unchanged", () => {
    const { slug, before } = freshPlan();
    runLore(["outline", "exempt", slug, "--reason", "x y z"], dir);
    const after = row(dir, slug);
    expect(after.version).toBe(before.version);
    expect(JSON.parse(after.extra)).not.toHaveProperty("prd_sync_exempt");
  });

  it("--json: a refused write is the error envelope with code VALIDATION_ERROR naming `lore baseline add`", () => {
    const { slug } = freshPrd();
    const r = runLore(["outline", "rm", slug, "section-1", "--json"], dir);
    expect(r.exitCode).toBe(4);
    const env = JSON.parse(r.stdout) as { ok: boolean; error: { code: string; message: string } };
    expect(env.ok).toBe(false);
    expect(env.error.code).toBe("VALIDATION_ERROR");
    expect(env.error.message).toContain("lore baseline add");
  });

  it("outline list still exits 0 and lists every stored entry", () => {
    const { slug } = freshPrd();
    const r = runLore(["outline", "list", slug], dir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("section-1");
    expect(r.stdout).toContain("section-2");
  });

  it("outline list --json returns exactly the stored entries, in order", () => {
    const { slug } = freshPrd();
    const r = runLore(["outline", "list", slug, "--json"], dir);
    expect(r.exitCode).toBe(0);
    const env = JSON.parse(r.stdout) as { ok: boolean; data: Array<{ section: string; title: string }> };
    expect(env.data.map((e) => e.section)).toEqual(["section-1", "section-2"]);
    expect(env.data.map((e) => e.title)).toEqual(["Section 1", "Section 2"]);
  });

  it("the dead bootstrap outline renderer no longer exists", async () => {
    const specifier = ["..", "..", "..", "src", "service", "outline-migration-service.js"].join("/");
    let mod: Record<string, unknown> | undefined;
    try {
      mod = (await import(specifier)) as Record<string, unknown>;
    } catch {
      mod = undefined; // module deleted outright: also "no longer exists"
    }
    expect(mod?.["renderLinkOnlyOutlineForBootstrap"]).toBeUndefined();
  });
});
