// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-defect-clusters-round-2-part-b-review-pending-queue-corpus D14
 *
 * `lore ac add` refuses a criterion detail that belongs to another verify mode (exit 4),
 * with the SAME message `lore ac set` gives, via one shared validator (`findModeForeignDetail`).
 * Throwaway corpus only (mkdtemp + `lore init`); never the repo's own `.lore/`.
 *
 * Coverage: NEGATIVE (a, b: falsifier / command / timeout refused on add, nothing stored),
 * REGRESSION (c: add and set messages identical), HAPPY (d: valid script add stores falsifier).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../helpers/clean-tree-repo.js";

const ID = "spec-defect-clusters-round-2-part-b-review-pending-queue-corpus#AC-DC2-14";
const INDEX_TS = join(new URL("../../", import.meta.url).pathname.replace(/\/$/, ""), "src", "index.ts");

function runLore(args: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: FIXTURE_HOME_OUTSIDE_REPO, CLAUDECODE: "1", LORE_ACTOR: "agent:dc2-14-test" },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

const FALSIFIER = ["--falsifier-path", "a.ts", "--falsifier-find", "x", "--falsifier-replace", "y", "--falsifier-exit-code", "1"];

let dir: string;
let spec: string;

function criteriaIds(): string[] {
  const out = runLore(["ac", "list", spec, "--json"], dir);
  expect(out.exitCode).toBe(0);
  return [...out.stdout.matchAll(/"id":\s*"([^"]+)"/g)].map((m) => m[1] as string);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-dc2-14-"));
  makeCleanTreeRepo(dir);
  expect(runLore(["init"], dir).exitCode).toBe(0);
  const created = runLore(["create", "spec", "--title", "DC2 14 corpus", "--content", "## Overview\nx", "--no-ai"], dir);
  expect(created.exitCode).toBe(0);
  spec = created.stdout.match(/Slug:\s+(\S+)/)?.[1] as string;
  expect(spec).toBeTruthy();
  expect(runLore(["ac", "add", spec, "AC-EXIST", "--statement", "s", "--mode", "human", "--note", "n"], dir).exitCode).toBe(0);
}, 60_000);

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe(ID, () => {
  it(`${ID} (a) human add with falsifier flags exits 4, names falsifier and human, stores nothing`, () => {
    const r = runLore(["ac", "add", spec, "AC-H", "--statement", "s", "--mode", "human", "--note", "n", ...FALSIFIER], dir);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("falsifier");
    expect(r.stderr).toContain("human");
    expect(criteriaIds()).not.toContain("AC-H");
  }, 90_000);

  it(`${ID} (b) ai add with --command and human add with --timeout-ms exit 4 naming the detail and mode`, () => {
    const cmd = runLore(["ac", "add", spec, "AC-A", "--statement", "s", "--mode", "ai", "--rubric", "r", "--command", "c"], dir);
    expect(cmd.exitCode).toBe(4);
    expect(cmd.stderr).toContain("command");
    expect(cmd.stderr).toContain("ai");
    const to = runLore(["ac", "add", spec, "AC-T", "--statement", "s", "--mode", "human", "--note", "n", "--timeout-ms", "5"], dir);
    expect(to.exitCode).toBe(4);
    expect(to.stderr).toContain("timeout");
    expect(to.stderr).toContain("human");
    expect(criteriaIds()).not.toContain("AC-A");
    expect(criteriaIds()).not.toContain("AC-T");
  }, 120_000);

  it(`${ID} (c) ac set on an existing human criterion refuses the same inputs with the same message text`, () => {
    const add = runLore(["ac", "add", spec, "AC-EXIST", "--statement", "s", "--mode", "human", "--note", "n", ...FALSIFIER], dir);
    const set = runLore(["ac", "set", spec, "AC-EXIST", ...FALSIFIER], dir);
    expect(add.exitCode).toBe(4);
    expect(set.exitCode).toBe(4);
    const text = (s: string): string => (s.match(/--falsifier-\*[^\n]*/)?.[0] ?? "<none>").trim();
    expect(text(add.stderr)).not.toBe("<none>");
    expect(text(add.stderr)).toBe(text(set.stderr));
  }, 90_000);

  it(`${ID} (d) a valid script add with all four falsifier flags exits 0 and stores the falsifier`, () => {
    const r = runLore(
      ["ac", "add", spec, "AC-S", "--statement", "s", "--mode", "script", "--oracle", "test", "--command", "true", "--allow-missing-path", "fixture has no a.ts", ...FALSIFIER],
      dir,
    );
    expect(r.exitCode).toBe(0);
    const list = runLore(["ac", "list", spec, "--json"], dir);
    expect(list.stdout).toContain('"falsifier"');
    expect(list.stdout).toContain('"a.ts"');
  }, 90_000);
});
