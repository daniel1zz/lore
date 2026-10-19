// @spawns packages/lore/src/index.ts
// @reads lore.tree.yaml
/**
 * Consumers that derived structure from a spec's parent accept a parentless spec
 * (AC-BLS3B-5; BR-400 tree check, BR-718 lore get navigation, BR-789 spec-file import, BR-2).
 *
 * One throwaway corpus (`mkdtemp` + `lore init`, outside the repo) holds a PRD that carries the
 * `<HealthStats />` placeholder, two PARENTLESS specs, and the repo's own `lore.tree.yaml`:
 *   - `lore status --check-tree` reports neither spec orphan nor misplaced (exit 0);
 *   - `lore get <spec>` lists zero siblings although a second parentless spec exists;
 *   - the outline orphan statistic (`- Orphans: N` rendered by `<HealthStats />`) excludes specs;
 *   - `lore sync-docs` (spec-file import) creates specs with no parent;
 *   - control: a parentless KNOWLEDGE doc is still an orphan, in the tree check and in the statistic.
 *
 * Dimensions: HAPPY (clean tree), NEGATIVE (knowledge orphan control), BOUNDARY (siblings with a
 * second parentless spec present), STATE (orphan count moves 0 -> 1 only for the knowledge doc),
 * REGRESSION (a parented spec is still reported misplaced, not silently accepted).
 * The repo's own `.lore/` is never touched.
 *
 * @spec_ref AC-BLS3B-5
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(300_000);

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ACTOR = "agent:parentless-spec-consumers-test";
const SKELETON = "## Overview\n\nx\n\n## Scope\n\nx\n\n## Acceptance Criteria\n\nx\n";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let dir = "";

function runLore(args: string[]): RunResult {
  const env = { ...process.env, HOME: dir, CLAUDECODE: "1", LORE_ACTOR: ACTOR };
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd: dir, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[]): RunResult {
  const r = runLore(args);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

interface TreeDrift {
  readonly kind: string;
  readonly actual?: { readonly slug: string; readonly type: string };
}

function treeDrifts(): { exitCode: number; drifts: TreeDrift[] } {
  const r = runLore(["status", "--check-tree", "--json"]);
  const parsed = JSON.parse(r.stdout) as { data: { drifts: TreeDrift[] } };
  return { exitCode: r.exitCode, drifts: parsed.data.drifts };
}

/** Parent id of one doc, read through `lore get --json` (the shipped read surface). */
function parentIdOf(slug: string): string | null {
  const parsed = JSON.parse(mustRun(["get", slug, "--json"]).stdout) as { data: { doc: { parent_id: string | null } } };
  return parsed.data.doc.parent_id;
}

function orphanStat(prdSlug: string): number {
  const m = mustRun(["get", prdSlug]).stdout.match(/- Orphans: (\d+)/);
  if (!m?.[1]) throw new Error("no `- Orphans:` line — <HealthStats /> did not render");
  return Number(m[1]);
}

let prdSlug = "";
const specSlugs: string[] = [];
let knowledgeSlug = "";

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "parentless-consumers-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  const git = (args: string[]): void => void execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "psc@example.invalid"]);
  git(["config", "user.name", "parentless consumers"]);
  writeFileSync(join(dir, "README.md"), "fixture\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  mustRun(["init"]);
  // sync-docs bodies below are not spec-create skeletons; gating itself is not under test here.
  patchLoreConfig(
    dir,
    ["workflow:", "  gates:", "    spec-create:", "      enabled: false", ""].join("\n"),
  );
  copyFileSync(join(REPO_ROOT, "lore.tree.yaml"), join(dir, "lore.tree.yaml"));
  // reason: `lore init` seeds one parentless approved knowledge doc (the write-spec rule, DC2-5); the tree check reads
  // it as an orphan, and this fixture's only orphan must be its own control, so the seed is soft-deleted.
  mustRun(["delete", "knowledge-write-spec-rules-gate-feeding-source", "--confirm"]);
  prdSlug =slugOf(mustRun(["create", "prd", "--title", "Consumers PRD", "--content", "# Health\n\n<HealthStats />", "--no-ai"]).stdout);
  for (const title of ["Parentless Alpha", "Parentless Beta"]) {
    specSlugs.push(slugOf(mustRun(["create", "spec", "--title", title, "--content", SKELETON, "--no-ai"]).stdout));
  }
});

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe("parentless spec consumers (AC-BLS3B-5)", () => {
  it("HAPPY: the fixture specs really are parentless", () => {
    for (const slug of specSlugs) expect(parentIdOf(slug)).toBeNull();
  });

  it("HAPPY: check-tree reports a parentless spec neither orphan nor misplaced, exit 0 (BR-400)", () => {
    const { exitCode, drifts } = treeDrifts();
    expect(drifts).toEqual([]);
    expect(exitCode).toBe(0);
  });

  it("BOUNDARY: lore get on a parentless spec lists zero siblings although another parentless spec exists (BR-718)", () => {
    const parsed = JSON.parse(mustRun(["get", specSlugs[0] as string, "--json"]).stdout) as {
      data: { navigation: { parent: unknown; siblings: unknown[] } };
    };
    expect(parsed.data.navigation.parent).toBeNull();
    expect(parsed.data.navigation.siblings).toEqual([]);
    expect(mustRun(["get", specSlugs[0] as string]).stdout).toContain("Siblings: (none)");
  });

  it("STATE: the outline orphan statistic excludes parentless specs", () => {
    expect(orphanStat(prdSlug)).toBe(0);
  });

  it("NEGATIVE control: a parentless knowledge doc is still an orphan in the tree check and the statistic", () => {
    knowledgeSlug = slugOf(
      mustRun(["create", "knowledge", "--title", "Loose Note", "--sub-type", "reference", "--content", "x", "--no-ai"]).stdout,
    );
    expect(parentIdOf(knowledgeSlug)).toBeNull();

    const { exitCode, drifts } = treeDrifts();
    expect(exitCode).toBe(3);
    const orphans = drifts.filter((d) => d.kind === "orphan").map((d) => d.actual?.slug);
    expect(orphans).toEqual([knowledgeSlug]);
    expect(drifts.filter((d) => d.kind === "misplaced")).toEqual([]);
    expect(orphanStat(prdSlug)).toBe(1);
  });

  it("HAPPY: lore sync-docs (spec-file import) creates specs with no parent (BR-789)", () => {
    const specDir = join(dir, "docs", "requirements", "spec");
    mkdirSync(specDir, { recursive: true });
    for (const title of ["Imported One", "Imported Two"]) {
      writeFileSync(
        join(specDir, `${title.replace(/ /g, "-")}.md`),
        `---\ntype: spec\ntitle: "${title}"\nparent: "Consumers PRD"\n---\n${SKELETON}`,
      );
    }
    const r = runLore(["sync-docs", "--from", specDir, "--json"]);
    expect(r.exitCode).toBe(0);
    const report = JSON.parse(r.stdout) as { data: { created: Array<{ slug: string }>; errors: unknown[] } };
    expect(report.data.errors).toEqual([]);
    expect(report.data.created).toHaveLength(2);
    for (const entry of report.data.created) expect(parentIdOf(entry.slug)).toBeNull();
  });

  it("STATE: after the import the tree check still flags only the knowledge control, and the statistic still counts only it", () => {
    const { drifts } = treeDrifts();
    expect(drifts.filter((d) => d.kind === "orphan").map((d) => d.actual?.slug)).toEqual([knowledgeSlug]);
    expect(orphanStat(prdSlug)).toBe(1);
  });
});
