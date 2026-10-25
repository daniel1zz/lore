// @spawns packages/lore/src/index.ts
/**
 * spec-defect-clusters-round-2-part-b-review-pending-queue-corpus#AC-DC2-13 (BR-87): a citation is repaired
 * through `lore ac cite` without demoting the spec, and a refused create's hint re-runs `lore create spec`.
 *
 * Root cause under test: `findAcCiteViolations` re-judged every EXISTING cite of a changed criterion, so a
 * criterion citing a retired rule could neither gain a live cite nor lose the retired one; and the feeding
 * pack named `lore ac add <slug>` for a create that wrote nothing.
 *
 * Throwaway repo + corpus (mkdtemp, HOME in the temp dir); never the repo's own `.lore/`.
 * Dimensions: HAPPY (repair add, repair remove), NEGATIVE (retired add, last live removed, create refused),
 * STATE (spec stays approved, version of refused write unchanged, nothing created), REGRESSION (live-only cites).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoreConfigSchema, type CreateDocInput } from "@lore/core";
import { createApp } from "../../src/app.js";
import { liveAmbient, liveWriteContext } from "../live-invocation.js";
import { dropLoreConfigKey, patchLoreConfig } from "../helpers/patch-lore-config.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const SPEC_QUALIFIED = "spec-defect-clusters-round-2-part-b-review-pending-queue-corpus#AC-DC2-13";
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let dir = "";

function runLore(args: string[]): RunResult {
  const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, "xdg"), CLAUDECODE: "1", LORE_ACTOR: "agent:dc2-13" };
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd: dir, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[]): RunResult {
  const r = runLore(args);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

function addRule(leaf: string, statement: string): string {
  const out = mustRun(["rule", "add", leaf, "--statement", statement, "--confidence", "established", "--enforced-by", "guaranteed", "--example", "example one"]);
  const id = out.stdout.match(/\bBR-\d+\b/)?.[0];
  if (id === undefined) throw new Error(`no rule id in: ${out.stdout}`);
  // a direct add is a pending add (not live, not citable) until its leaf is approved; the suite's override class is loosened
  mustRun(["approve", leaf, "--override-no-judgment"]);
  leafOfRules = leaf;
  return id;
}

/** The leaf holding the suite's rules (a retirement is a pending revision of it until approved). */
let leafOfRules = "";

function retire(rule: string): void {
  mustRun(["rule", "set", rule, "--lifecycle", "retired", "--note", "retired for the test"]);
  mustRun(["approve", leafOfRules, "--override-no-judgment"]);
}

interface AcJson {
  readonly id: string;
  readonly cites?: readonly string[];
}

function citesOf(spec: string, acId: string): string[] {
  const parsed = JSON.parse(mustRun(["ac", "list", spec, "--json"]).stdout) as { data?: { criteria?: AcJson[] } | AcJson[] } & Record<string, unknown>;
  const raw = parsed.data ?? parsed;
  const list: AcJson[] = Array.isArray(raw) ? raw : ((raw as { criteria?: AcJson[] }).criteria ?? []);
  const found = list.find((c) => c.id === acId);
  if (found === undefined) throw new Error(`no ${acId} in ac list: ${JSON.stringify(parsed)}`);
  return [...(found.cites ?? [])];
}

function statusOf(spec: string): string {
  const parsed = JSON.parse(mustRun(["get", spec, "--json"]).stdout) as { data?: { doc?: { status: string } }; doc?: { status: string } };
  const doc = parsed.data?.doc ?? parsed.doc;
  if (doc === undefined) throw new Error("no doc in get --json");
  return doc.status;
}

let branch = "";
let liveRule = "";
let liveRule2 = "";
let retiredA = "";
let retiredB = "";
let retiredC = "";
let approvedSpec = "";
let draftSpec = "";

function newSpec(title: string, cites: string[]): string {
  const slug = slugOf(mustRun(["create", "spec", "--title", title, "--content", "## Spec\n\nbody", "--no-ai"]).stdout);
  mustRun(["ac", "add", slug, "AC-1", "--statement", "the behaviour holds", "--mode", "human", "--note", "n", ...cites.flatMap((c) => ["--cite", c])]);
  return slug;
}

beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "dc2-13-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "fixture\n");
  mustRun(["init"]);
  // reason: `lore init` seeds the verification profiles (a feature spec needs a `test` oracle to be approved); this
  // suite's subject is the citation gate, so the profiles are removed (an absent profile is a vacuous pass).
  dropLoreConfigKey(dir, ["workflow", "verification_profiles"]);
  const prd = slugOf(mustRun(["create", "prd", "--title", "DC2-13 PRD", "--content", "root", "--no-ai"]).stdout);
  const root = slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "Root", "--title", "DC2-13 Root"]).stdout);
  branch = slugOf(mustRun(["baseline", "add", root, "--node", "branch", "--label", "Branch", "--title", "DC2-13 Branch"]).stdout);
  const leaf = slugOf(mustRun(["baseline", "add", branch, "--node", "leaf", "--label", "Leaf", "--title", "DC2-13 Leaf"]).stdout);
  liveRule = addRule(leaf, "a live rule the spec can cite");
  liveRule2 = addRule(leaf, "a second live rule");
  retiredA = addRule(leaf, "retired rule A");
  retiredB = addRule(leaf, "retired rule B");
  retiredC = addRule(leaf, "retired rule C");

  // S: approved, AC-1 cites retiredA (live at approval time), then retiredA is retired.
  approvedSpec = newSpec("DC2-13 Approved Spec", [retiredA]);
  mustRun(["approve", approvedSpec, "--override-no-judgment"]);
  // S3: draft, AC-1 cites liveRule + retiredC, then retiredC is retired.
  draftSpec = newSpec("DC2-13 Draft Spec", [liveRule, retiredC]);
  retire(retiredA);
  retire(retiredB);
  retire(retiredC);

  patchLoreConfig(dir, `workflow:\n  gates:\n    ac-cite:\n      mode: enforce\n      armed_branches:\n        - ${branch}\n`);
});

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe(`${SPEC_QUALIFIED} (a) repair without demotion`, () => {
  it("adding a live cite then removing the retired one both exit 0 and the approved spec stays approved", () => {
    expect(statusOf(approvedSpec)).toBe("approved");
    expect(citesOf(approvedSpec, "AC-1")).toEqual([retiredA]);

    const added = runLore(["ac", "cite", approvedSpec, "AC-1", liveRule]);
    expect(added.exitCode).toBe(0);
    expect(statusOf(approvedSpec)).toBe("approved");

    const removed = runLore(["ac", "cite", approvedSpec, "AC-1", retiredA, "--remove"]);
    expect(removed.exitCode).toBe(0);
    expect(citesOf(approvedSpec, "AC-1")).toEqual([liveRule]);
    expect(statusOf(approvedSpec)).toBe("approved");
  });
});

describe(`${SPEC_QUALIFIED} (b)(c) the gate still refuses what it must`, () => {
  it("(b) citing another retired rule is refused: exit 4, AC_CITE_REQUIRED naming it", () => {
    const r = runLore(["ac", "cite", approvedSpec, "AC-1", retiredB]);
    const out = `${r.stdout}${r.stderr}`;
    expect(r.exitCode).toBe(4);
    expect(out).toContain("AC_CITE_REQUIRED");
    expect(out).toContain(retiredB);
    expect(citesOf(approvedSpec, "AC-1")).toEqual([liveRule]);
  });

  it("(c) removing the only live cite of an AC whose other cite is retired is refused: exit 4", () => {
    expect(citesOf(draftSpec, "AC-1").sort()).toEqual([liveRule, retiredC].sort());
    const r = runLore(["ac", "cite", draftSpec, "AC-1", liveRule, "--remove"]);
    expect(r.exitCode).toBe(4);
    expect(`${r.stdout}${r.stderr}`).toContain("AC_CITE_REQUIRED");
    expect(citesOf(draftSpec, "AC-1").sort()).toEqual([liveRule, retiredC].sort());
  });

  it("REGRESSION: an AC citing only live rules still takes a second live cite and loses one", () => {
    expect(runLore(["ac", "cite", approvedSpec, "AC-1", liveRule2]).exitCode).toBe(0);
    expect(runLore(["ac", "cite", approvedSpec, "AC-1", liveRule2, "--remove"]).exitCode).toBe(0);
    expect(citesOf(approvedSpec, "AC-1")).toEqual([liveRule]);
  });
});

describe(`${SPEC_QUALIFIED} (d) a refused create's hint re-runs create`, () => {
  it("an uncited inline criterion is refused AC_CITE_REQUIRED, `Cite one:` starts with `lore create spec`, nothing is created", async () => {
    const config = LoreConfigSchema.parse({
      project: { name: "dc2-13", author: "tester" },
      workflow: { gates: { "ac-cite": { mode: "enforce", armed_branches: [branch] } } },
    });
    const made = createApp(join(dir, ".lore", "lore.db"), config, liveAmbient(), liveWriteContext());
    if ("ok" in made) throw new Error(`createApp failed: ${JSON.stringify(made)}`);
    try {
      const created = await made.corpusService.create({
        type: "spec",
        title: "DC2-13 Born Uncited",
        content: "## Overview/Goal\n\nx\n\n## Scope\n\nx\n\n## Acceptance Criteria\n\nx",
        extra: {
          acceptance_criteria: [
            { id: "AC-N-1", statement: "born uncited", verify: { mode: "script", oracle: "test", command: "bun test x" } },
          ],
        },
      } as CreateDocInput);
      expect(created.ok).toBe(false);
      if (created.ok) return;
      expect(created.error.code).toBe("AC_CITE_REQUIRED");
      if (created.error.code !== "AC_CITE_REQUIRED") return;
      const line = created.error.feeding_pack?.cite_line ?? "";
      expect(line.startsWith("lore create spec")).toBe(true);
      expect(line).not.toContain("lore ac add");
    } finally {
      made.close();
    }
    const wouldBe = runLore(["get", "dc2-13-born-uncited"]);
    expect(wouldBe.exitCode).toBe(3);
  });
});
