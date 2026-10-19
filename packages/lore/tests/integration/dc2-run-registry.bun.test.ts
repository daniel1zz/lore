// @spawns packages/lore/src/index.ts
// @reads assets/context
// @reads assets/context/*.md
/**
 * @spec_ref spec-defect-clusters-round-2-part-d-store-selection-runs#AC-DC2-24
 *
 * D24 / BR-1027 / BR-1028: a run records what it was given and only facts it knows.
 *   (a) a MAIN run's composition is the union of the `rules:user` + `rules:project` fragment selections
 *       (id + sha256 of the fragment file), non-empty with the shipped fragments;
 *   (b) a helper registered without `--parent` stores `parentRunId` null and `lore run show` prints
 *       `parent: unknown`; with `--parent` it records exactly that parent.
 *
 * SIMPLEST GREEN-BUT-BROKEN CASE: a one-level helper whose real starter IS the main run — the old guess
 * (parent = main run) happens to be right there, so the test asserts null when no parent is supplied.
 *
 * Isolation: mkdtemp HOME + XDG_CONFIG_HOME + a throwaway `lore init` corpus; never touches the repo's `.lore/`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFragmentsRender } from "../../src/flows/fragments-flow.js";
import { buildFlowDeps } from "../../src/adapters/cli/commands/fragments.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const SPEC = "spec-defect-clusters-round-2-part-d-store-selection-runs";
const SESSION = "S";

let root = "";
let corpus = "";

function envFor(): Record<string, string> {
  return { ...(process.env as Record<string, string>), HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, "xdg"), EDITOR: "true", CLAUDECODE: "1" };
}

function runLore(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], { cwd: corpus, env: envFor() });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

interface RunRecord {
  id: string;
  kind: string;
  parentRunId: string | null;
  composition: { fragments: { id: string; sha256: string }[] };
}

function showJson(id: string): RunRecord {
  const r = runLore(["run", "show", id, "--json"]);
  expect(r.exitCode, r.stderr).toBe(0);
  return (JSON.parse(r.stdout) as { data: RunRecord }).data;
}

/** The expected set, measured through the fragments flow for each rules outlet (explain rows + file bytes). */
async function expectedRulesFragments(): Promise<Map<string, string>> {
  const inv = {
    cwd: corpus,
    env: envFor(),
    paths: { home: join(root, "home") },
    isCompiled: false,
    execPath: process.execPath,
  } as unknown as Parameters<typeof buildFlowDeps>[1];
  const deps = buildFlowDeps(corpus, inv);
  if (!deps.ok) throw new Error(`buildFlowDeps: ${deps.error.message}`);
  const out = new Map<string, string>();
  for (const outlet of ["rules:user", "rules:project"] as const) {
    const rendered = await runFragmentsRender(deps.value, { outlet });
    if (!rendered.ok) throw new Error(`render ${outlet}: ${rendered.error.message}`);
    for (const row of rendered.value.explain) out.set(row.id, createHash("sha256").update(readFileSync(row.path)).digest("hex"));
  }
  return out;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "lore-dc2-24-"));
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "xdg"), { recursive: true });
  corpus = join(root, "corpus");
  mkdirSync(corpus, { recursive: true });
  const init = runLore(["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
}, 120_000);

afterAll(() => {
  if (root !== "") rmSync(root, { recursive: true, force: true });
});

describe(`${SPEC}#AC-DC2-24`, () => {
  it(`${SPEC}#AC-DC2-24 (a) a main run lists the rules:user + rules:project fragments, id and sha256`, async () => {
    const reg = runLore(["run", "register", "--harness", "claude-code", "--session", SESSION]);
    expect(reg.exitCode, reg.stderr).toBe(0);
    const expected = await expectedRulesFragments();
    expect(expected.size).toBeGreaterThan(0);

    const stored = showJson(`cc:${SESSION}`);
    expect(stored.kind).toBe("main");
    expect(stored.composition.fragments.length).toBeGreaterThan(0);
    const got = new Map(stored.composition.fragments.map((f) => [f.id, f.sha256] as const));
    expect(got.size).toBe(stored.composition.fragments.length); // no duplicate ids
    expect([...got].sort()).toEqual([...expected].sort());
  }, 120_000);

  it(`${SPEC}#AC-DC2-24 (b) a helper registered without --parent stores null and shows parent: unknown`, () => {
    const reg = runLore(["run", "register", "--harness", "claude-code", "--session", SESSION, "--agent-id", "A", "--agent-type", "t"]);
    expect(reg.exitCode, reg.stderr).toBe(0);
    // green-but-broken guard: the main run exists and is the real starter, yet it must NOT be guessed as the parent
    expect(showJson(`cc:${SESSION}`).parentRunId).toBeNull();
    expect(showJson(`cc:${SESSION}:A`).parentRunId).toBeNull();
    const text = runLore(["run", "show", `cc:${SESSION}:A`]);
    expect(text.exitCode, text.stderr).toBe(0);
    expect(text.stdout).toMatch(/^parent: unknown$/im);
  }, 120_000);

  it(`${SPEC}#AC-DC2-24 (b) a helper registered with --parent records exactly that parent`, () => {
    const parent = `cc:${SESSION}:A`;
    const reg = runLore(["run", "register", "--harness", "claude-code", "--session", SESSION, "--agent-id", "B", "--agent-type", "t", "--parent", parent]);
    expect(reg.exitCode, reg.stderr).toBe(0);
    expect(showJson(`cc:${SESSION}:B`).parentRunId).toBe(parent);
  }, 120_000);
});
