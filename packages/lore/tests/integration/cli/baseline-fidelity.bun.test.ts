// @spawns packages/lore/src/index.ts
// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
/**
 * End-to-end test of `lore baseline fidelity` (Baseline slice 2c C7, AC-BLS2-21, AC-BLS2-23) through the
 * real CLI against a throwaway corpus (`lore init` in a temp dir; the repo's own `.lore/` is never touched).
 *
 * The AI judge is a fixed shell script wired in through `ai.providers.claude-cli.command` (the repo's
 * hermetic idiom, see assess-ai.bun.test.ts): it records the prompt it received and prints a scripted reply.
 *
 * Dimensions: HAPPY (record stored as a research knowledge doc + printed), NEGATIVE (size > pool -> 2;
 * agent surface without --ai -> 2, judge never spawned), ERROR (unparseable judge reply -> 6, nothing
 * stored), STATE (the stored doc names the seed and share; a refused run stores nothing).
 *
 * @spec_ref spec-baseline-slice-2-completeness-census-per-branch-citation#AC-BLS2-21
 * @spec_ref spec-baseline-slice-2-completeness-census-per-branch-citation#AC-BLS2-23
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { approveFixtureNodes } from "../../helpers/cli-live-rule.js";
import { templatedFieldsArgs } from "../../helpers/templated-create.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(120_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let corpus = "";
let capture = "";
let judgeScript = "";
let replyFile = "";
let specSlug = "";

function runLore(args: string[], surface: "agent" | "human" = "human"): RunResult {
  const env: Record<string, string | undefined> = { ...process.env, HOME: corpus, LORE_ACTOR: "agent:fid-test" };
  if (surface === "agent") env["CLAUDECODE"] = "1";
  else delete env["CLAUDECODE"];
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd: corpus, env });
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

/** Script the judge's next reply; the stub prints the file's content verbatim. */
function scriptReply(content: string): void {
  writeFileSync(replyFile, content);
  if (existsSync(capture)) rmSync(capture);
}

/** Full titles of every knowledge doc (the text `list` table truncates them). */
function researchTitles(): string {
  const listed = JSON.parse(mustRun(["list", "--type", "knowledge", "--json"]).stdout) as { data: { docs: Array<{ title: string }> } };
  return listed.data.docs.map((d) => d.title).join("\n");
}

beforeAll(() => {
  corpus = realpathSync(mkdtempSync(join(tmpdir(), "fid-cli-")));
  if (corpus.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  capture = join(corpus, "captured-prompt.txt");
  replyFile = join(corpus, "scripted-reply.txt");
  judgeScript = join(corpus, "fake-judge.sh");
  writeFileSync(judgeScript, `#!/bin/sh\ncat > "${capture}"\nn=$(grep -o '### Item [0-9]*' "${capture}" | grep -o '[0-9]*' | head -1)\nsed "s/@N@/$n/g" "${replyFile}"\n`, { mode: 0o755 });
  mustRun(["init"]);
  // BR-1528: the fidelity record is created structured through the approved `knowledge/research` template.
  mustRun(["migrate", "templates", "--apply"]);
  patchLoreConfig(
    corpus,
    [
      "project:",
      "  name: fid-cli-test",
      "  author: tester",
      "ai:",
      "  provider: claude-cli",
      "  providers:",
      "    claude-cli:",
      `      command: ${judgeScript}`,
      "      args: []",
      "      timeout_ms: 20000",
      "  templates: {}",
      "  telemetry: false",
      "",
    ].join("\n"),
  );
  const prd = slugOf(mustRun(["create", "prd", "--title", "Fid PRD", ...templatedFieldsArgs("prd"), "--no-ai"]).stdout);
  const root = slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "root", "--title", "Fid Root", ...templatedFieldsArgs("baseline", { kind: "root" })]).stdout);
  const branch = slugOf(mustRun(["baseline", "add", root, "--node", "branch", "--label", "br", "--title", "Fid Branch", ...templatedFieldsArgs("baseline", { kind: "branch" })]).stdout);
  const leaf = slugOf(mustRun(["baseline", "add", branch, "--node", "leaf", "--label", "lf", "--title", "Fid Leaf", ...templatedFieldsArgs("baseline", { kind: "leaf" })]).stdout);
  mustRun(["rule", "add", leaf, "--statement", "an AC id is unique within its spec", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "duplicate id refused"]);
  approveFixtureNodes(corpus, [leaf]); // a direct add is a pending add: the fidelity pool counts live (approved) rules
  const spec = slugOf(mustRun(["create", "spec", "--title", "Fid Spec", ...templatedFieldsArgs("spec", { kind: "feature" }), "--no-ai"]).stdout);
  specSlug = spec;
  mustRun(["ac", "add", spec, "AC-FID-1", "--statement", "a duplicate criterion id is refused", "--mode", "human", "--cite", "BR-1"]);
});

afterAll(() => {
  if (corpus !== "") rmSync(corpus, { recursive: true, force: true });
});

describe("lore baseline fidelity (CLI)", () => {
  it("HAPPY: judges the sample, prints the record and stores it as a research knowledge doc naming seed and share", () => {
    scriptReply(JSON.stringify([{ n: 1, verdict: "faithful", reason: "the criterion checks the rule" }]));
    const r = runLore(["baseline", "fidelity", "--size", "1", "--seed", "7", "--ai", "--json"], "agent");
    expect(r.stderr).not.toContain("Error:");
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout) as { ok: boolean; data: { record: { seed: number; size: number; pool: number; faithful_share: number }; doc: { slug: string } } };
    expect(out.ok).toBe(true);
    expect(out.data.record).toMatchObject({ seed: 7, size: 1, pool: 1, faithful_share: 1 });
    expect(readFileSync(capture, "utf8")).toContain("<<DATA-");
    const titles = researchTitles();
    expect(titles).toContain("seed 7");
    const doc = JSON.parse(mustRun(["get", out.data.doc.slug, "--json"]).stdout) as { data: { doc?: { extra: { sub_type?: string; template_ref?: string }; content: string }; extra?: { sub_type?: string; template_ref?: string }; content?: string } };
    const stored = doc.data.doc ?? doc.data;
    expect(stored.extra?.sub_type).toBe("research");
    // BR-1528: the body is rendered from the research template's fields: the share is the conclusion, each sampled item a finding
    expect(stored.extra).toMatchObject({ template_ref: "knowledge-research-template@1" });
    expect(stored.content).toContain("100.0% of 1 sampled citations judged faithful");
    expect(stored.content).toContain("## Findings");
    // and the stored document passes the template's own check (fields valid, dimensions answered, refs resolving)
    expect(runLore(["template", "check", out.data.doc.slug], "agent").exitCode).toBe(0);
  });

  it("STATE: a different judge reply changes the stored share (0 when the judge says not_faithful)", () => {
    scriptReply(JSON.stringify([{ n: 1, verdict: "not_faithful", reason: "unrelated" }]));
    const r = runLore(["baseline", "fidelity", "--size", "1", "--seed", "8", "--ai", "--json"], "agent");
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout) as { data: { record: { faithful_share: number } } };
    expect(out.data.record.faithful_share).toBe(0);
    expect(researchTitles()).toContain("seed 8");
  });

  it("NEGATIVE: size larger than the pool exits 2 and stores nothing", () => {
    scriptReply("[]");
    const r = runLore(["baseline", "fidelity", "--size", "5", "--seed", "9", "--ai"], "agent");
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("size");
    expect(existsSync(capture)).toBe(false); // the judge was never spawned
    expect(researchTitles()).not.toContain("seed 9");
  });

  it("ERROR: an unparseable judge reply exits 6 and stores nothing", () => {
    scriptReply("these all look fine to me");
    const r = runLore(["baseline", "fidelity", "--size", "1", "--seed", "10", "--ai"], "agent");
    expect(r.exitCode).toBe(6);
    expect(researchTitles()).not.toContain("seed 10");
  });

  it("NEGATIVE: on an agent surface without --ai the command refuses loudly (exit 2) and never spawns the judge", () => {
    scriptReply(JSON.stringify([{ n: 1, verdict: "faithful", reason: "r" }]));
    const r = runLore(["baseline", "fidelity", "--size", "1", "--seed", "11"], "agent");
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("--ai");
    expect(existsSync(capture)).toBe(false);
    expect(researchTitles()).not.toContain("seed 11");
  });

  it("BOUNDARY: --judges 3 is refused with exit 2", () => {
    const r = runLore(["baseline", "fidelity", "--size", "1", "--seed", "12", "--judges", "3", "--ai"], "agent");
    expect(r.exitCode).toBe(2);
  });

  it("AS-17: human output prints a NOT SEEN line naming the unreadable test file and a not_seen count, never BAD for it", () => {
    mustRun([
      "ac", "add", specSlug, "AC-FID-2", "--statement", "a criterion whose test file is missing", "--mode", "script",
      "--oracle", "test", "--command", "bunx vitest run tests/missing-fid.test.ts", "--cite", "BR-1", "--allow-missing-path", "fixture: file intentionally absent",
    ]);
    // the judge sees only the readable item; its position is not known in advance, so the stub fills @N@.
    scriptReply('[{"n": @N@, "verdict": "faithful", "reason": "ok"}]');
    const r = runLore(["baseline", "fidelity", "--size", "2", "--seed", "13", "--ai"]);
    expect(r.stderr).not.toContain("Error:");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("NOT SEEN tests/missing-fid.test.ts");
    expect(r.stdout).not.toMatch(/BAD .*AC-FID-2/);
    expect(r.stdout).toContain("not_seen: 1");
    expect(readFileSync(capture, "utf8")).not.toContain("missing-fid");
    const slug = r.stdout.match(/Stored (\S+):/)?.[1] ?? "";
    const doc = JSON.parse(mustRun(["get", slug, "--json"]).stdout) as { data: { doc?: { content: string }; content?: string } };
    expect((doc.data.doc ?? doc.data).content).toContain("not_seen 1");
  });
});
