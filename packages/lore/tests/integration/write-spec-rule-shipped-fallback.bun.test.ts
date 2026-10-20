// @spawns packages/lore/src/index.ts
// @reads assets/governance/write-spec-rule.md
/**
 * @spec_ref spec-the-write-spec-rule-ships-with-the-binary-lore-init-writes#AC-WSR-2
 *
 * The write-spec rule the spec-create gate feeds ships with the binary (BR-1359): in a fresh corpus the refused
 * gate's feeding pack quotes `assets/governance/write-spec-rule.md` and says so on its source line; a project's own
 * approved knowledge doc (skill.applies_to spec) wins and its slug is named; with the shipped asset gone from the
 * install and no project doc, the gate fails loud naming the asset.
 *
 * Every case runs in a throwaway git repo with HOME/XDG in temp dirs (never the repo's `.lore/`). The missing-asset
 * case runs a COPY of the compiled binary in a directory with no `assets/` beside it, so no repo file is removed.
 *
 * Coverage:
 *   HAPPY:      fresh corpus -> source line names the shipped asset, non-empty `## Rule`, no dev-repo script
 *   STATE:      an approved project doc with applies_to spec wins; the source names its slug, not the asset
 *   NEGATIVE:   a DRAFT project doc (or one scoped to another type) is not a project rule: the asset is still named
 *   ERROR:      shipped asset missing + no project doc -> non-zero exit naming the asset, no pack printed
 *   REGRESSION: the missing asset is irrelevant while a project doc exists (the project doc still feeds)
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertFreshBinary } from "./helpers/assert-fresh-binary";
import { createApp } from "../../src/app.js";
import { liveAmbient, liveWriteContext } from "../live-invocation.js";
import type { CreateDocInput } from "@lore/core";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const SPEC = "spec-the-write-spec-rule-ships-with-the-binary-lore-init-writes";
const ASSET_PATH = "assets/governance/write-spec-rule.md";
const SHIPPED_SOURCE_LINE = `[source: shipped asset ${ASSET_PATH}, trust: team-authored]`;
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const DIST_BINARY = join(REPO_ROOT, "dist", "lore");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

const scratch: string[] = [];
let bareBinary = "";

function envFor(home: string): Record<string, string> {
  return { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), CLAUDECODE: "1" } as Record<string, string>;
}

function spawnLore(command: string[], cwd: string, home: string): RunResult {
  const proc = Bun.spawnSync(command, { cwd, env: envFor(home) });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function runLore(args: string[], cwd: string, home: string): RunResult {
  return spawnLore(["bun", "run", ENTRY, ...args], cwd, home);
}

/** A git repo with a plain `lore init` and an isolated HOME. */
function makeCorpus(): { repo: string; home: string } {
  const repo = mkdtempSync(join(tmpdir(), "wsr-repo-"));
  const home = mkdtempSync(join(tmpdir(), "wsr-home-"));
  scratch.push(repo, home);
  const git = Bun.spawnSync(["git", "init", "-q"], { cwd: repo });
  expect(git.exitCode).toBe(0);
  const init = runLore(["init"], repo, home);
  expect(init.exitCode, `init failed: ${init.stdout}${init.stderr}`).toBe(0);
  return { repo, home };
}

const REFUSED_CANDIDATE = JSON.stringify({
  type: "spec",
  title: "Candidate",
  parent_id: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
  content: "no skeleton",
});

function gateSpecCreate(repo: string, home: string, viaBareBinary = false): RunResult {
  const base = viaBareBinary ? [bareBinary] : ["bun", "run", ENTRY];
  return spawnLore([...base, "gate", "spec-create", "--input-json", REFUSED_CANDIDATE], repo, home);
}

/** Files a knowledge doc scoped to `appliesTo` into the corpus at `repo`; approved or left as a draft. */
async function fileSkillDoc(repo: string, opts: { title: string; appliesTo: string; approve: boolean }): Promise<string> {
  const app = createApp(join(repo, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
  try {
    const created = await app.corpusService.create({
      type: "knowledge",
      title: opts.title,
      content: `## Project rule\n\nMarker text of ${opts.title}.`,
      extra: { sub_type: "skill", skill: { applies_to: opts.appliesTo } },
    } as CreateDocInput);
    if (!created.ok) throw new Error(`skill doc create failed: ${JSON.stringify(created.error)}`);
    if (!opts.approve) return created.value.slug;
    const approved = await app.corpusService.set(created.value.id, { status: "approved" });
    if (!approved.ok) throw new Error(`skill doc approve failed: ${JSON.stringify(approved.error)}`);
    return approved.value.slug;
  } finally {
    app.close();
  }
}

beforeAll(() => {
  assertFreshBinary(DIST_BINARY, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);
  // reason: the binary reads its assets from `<binary dir>/../assets`; a copy under `<root>/bin` with no `<root>/assets`
  // is an install whose shipped asset is missing, without touching any repo file.
  const root = mkdtempSync(join(tmpdir(), "wsr-bare-"));
  scratch.push(root);
  mkdirSync(join(root, "bin"));
  bareBinary = join(root, "bin", "lore");
  copyFileSync(DIST_BINARY, bareBinary);
  chmodSync(bareBinary, 0o755);
}, 300_000);

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe(`${SPEC}#AC-WSR-2 the shipped write-spec rule is the named fallback`, () => {
  it(`${SPEC}#AC-WSR-2 a fresh corpus's refused pack names the shipped asset and quotes its rule`, () => {
    const { repo, home } = makeCorpus();
    const gate = gateSpecCreate(repo, home);
    const output = gate.stdout + gate.stderr;
    expect(gate.exitCode, output).toBe(4);
    expect(gate.stdout.split("\n")[0], output).toBe(SHIPPED_SOURCE_LINE);
    const ruleSection = gate.stdout.split("## Rule")[1];
    expect(ruleSection, output).toBeDefined();
    expect(ruleSection!.trim().length).toBeGreaterThan(0);
    expect(ruleSection).toContain("Overview");
    expect(output).not.toContain("bun scripts/");
    expect(output).not.toContain("No approved rule doc found");
  });

  it(`${SPEC}#AC-WSR-2 an approved project doc with applies_to spec wins and its slug is the source`, async () => {
    const { repo, home } = makeCorpus();
    const slug = await fileSkillDoc(repo, { title: "Our own spec rules", appliesTo: "spec", approve: true });
    const gate = gateSpecCreate(repo, home);
    expect(gate.exitCode, gate.stdout + gate.stderr).toBe(4);
    expect(gate.stdout.split("\n")[0]).toBe(`[source: ${slug}, trust: team-authored]`);
    expect(gate.stdout).toContain("Marker text of Our own spec rules.");
    expect(gate.stdout).not.toContain("shipped asset");
  });

  it(`${SPEC}#AC-WSR-2 a draft project doc, or one scoped to another type, does not displace the shipped rule`, async () => {
    const { repo, home } = makeCorpus();
    await fileSkillDoc(repo, { title: "Draft spec rules", appliesTo: "spec", approve: false });
    await fileSkillDoc(repo, { title: "Plan rules", appliesTo: "plan", approve: true });
    const gate = gateSpecCreate(repo, home);
    expect(gate.exitCode, gate.stdout + gate.stderr).toBe(4);
    expect(gate.stdout.split("\n")[0]).toBe(SHIPPED_SOURCE_LINE);
  });

  it(`${SPEC}#AC-WSR-2 with the shipped asset missing and no project doc the gate fails loud naming the asset`, () => {
    const { repo, home } = makeCorpus();
    const gate = gateSpecCreate(repo, home, true);
    const output = gate.stdout + gate.stderr;
    expect(gate.exitCode, output).not.toBe(0);
    expect(gate.exitCode, output).not.toBe(4);
    expect(output).toContain(ASSET_PATH);
    expect(output).not.toContain("[source:");
    expect(existsSync(join(repo, ".lore", "lore.db"))).toBe(true);
  });

  it(`${SPEC}#AC-WSR-2 a project doc still feeds the gate when the shipped asset is missing`, async () => {
    const { repo, home } = makeCorpus();
    const slug = await fileSkillDoc(repo, { title: "Our own spec rules", appliesTo: "spec", approve: true });
    const gate = gateSpecCreate(repo, home, true);
    expect(gate.exitCode, gate.stdout + gate.stderr).toBe(4);
    expect(gate.stdout.split("\n")[0]).toBe(`[source: ${slug}, trust: team-authored]`);
  });
});
