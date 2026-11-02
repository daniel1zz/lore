// @spawns packages/lore/src/index.ts
/**
 * `lore bootstrap` names the ARCHITECTURE tree root next to the business baseline root, so a session can find
 * the current-state architecture from the session-start overview (SPEC-205 BL-6: bootstrap root pointer).
 *
 * CONTRACT:
 *   A1. `data.root` is unchanged (the business baseline root, `{slug,title}`) — every `data.root` consumer keeps working.
 *   A2. `data.architecture` = `{tree:"architecture", id, slug, title}` of the architecture root.
 *   A3. A corpus with NO architecture root reports `data.architecture === null` (key present, never omitted).
 *   A4. Text mode prints an `Architecture:` line naming the root, or `Architecture: (none)`.
 *
 * Every corpus is an `mkdtemp` + `lore init` outside the repo; the repo's own `.lore/` is never touched.
 *
 * Dimensions: HAPPY (both roots), NEGATIVE (no architecture root -> null, not omitted), REGRESSION (root unchanged),
 * BOUNDARY (architecture root with no business root), STATE (text and JSON agree).
 *
 * @spec_ref SPEC-205 BL-6
 */

import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { templatedFieldsArgs } from "../../helpers/templated-create.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

// tests/integration/cli/ -> repo root is 5 levels up.
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const SESSION_ID = "ba5e0a1c-aaaa-bbbb-cccc-222222222222";

function runLore(args: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  const env = { ...process.env, HOME: cwd, CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: SESSION_ID };
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[], cwd: string): string {
  const r = runLore(args, cwd);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/) ?? stdout.match(/Run `lore get (\S+)`/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

interface Fixture {
  readonly dir: string;
  readonly businessRoot: string | undefined;
  readonly architectureRoot: string | undefined;
}

function makeCorpus(opts: { business: boolean; architecture: boolean }): Fixture {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "bootarch-")));
  scratch.push(dir);
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "bootarch@example.invalid"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "bootarch test"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "fixture\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  mustRun(["init"], dir);
  const prd = slugOf(mustRun(["create", "prd", "--title", "Fixture PRD", ...templatedFieldsArgs("prd"), "--no-ai"], dir));
  const businessRoot = opts.business
    ? slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "biz", "--title", "Biz Root", ...templatedFieldsArgs("baseline", { kind: "root" })], dir))
    : undefined;
  const architectureRoot = opts.architecture
    ? slugOf(mustRun(["baseline", "add", prd, "--tree", "architecture", "--node", "root", "--label", "arch", "--title", "Arch Root", ...templatedFieldsArgs("baseline", { kind: "root" })], dir))
    : undefined;
  return { dir, businessRoot, architectureRoot };
}

interface ArchRef {
  tree: string;
  id: string;
  slug: string;
  title: string;
}

function bootstrapData(dir: string): { root: { slug: string; title: string } | null; architecture?: ArchRef | null } {
  return (JSON.parse(mustRun(["bootstrap", "--json"], dir)) as { data: { root: { slug: string; title: string } | null; architecture?: ArchRef | null } }).data;
}

describe("lore bootstrap — architecture tree root", () => {
  it("AC-BOOT-ARCH-1 HAPPY: both roots reported; data.root stays the business root", () => {
    const f = makeCorpus({ business: true, architecture: true });
    const data = bootstrapData(f.dir);
    expect(data.root).toEqual({ slug: f.businessRoot, title: "Biz Root" });
    expect(data.architecture).toMatchObject({ tree: "architecture", slug: f.architectureRoot, title: "Arch Root" });
    expect(data.architecture?.id).toMatch(/^[0-9A-Z]{26}$/);
    const got = mustRun(["get", data.architecture!.id, "--json"], f.dir);
    expect(got).toContain(f.architectureRoot);
  });

  it("AC-BOOT-ARCH-2 NEGATIVE: only a business root -> architecture is explicitly null, key present", () => {
    const f = makeCorpus({ business: true, architecture: false });
    const raw = JSON.parse(mustRun(["bootstrap", "--json"], f.dir)) as { data: Record<string, unknown> };
    expect("architecture" in raw.data).toBe(true);
    expect(raw.data["architecture"]).toBeNull();
    expect(raw.data["root"]).toEqual({ slug: f.businessRoot, title: "Biz Root" });
  });

  it("AC-BOOT-ARCH-2 BOUNDARY: architecture root without a business root is still reported; root falls back to the PRD", () => {
    const f = makeCorpus({ business: false, architecture: true });
    const data = bootstrapData(f.dir);
    expect(data.architecture).toMatchObject({ slug: f.architectureRoot });
    expect(data.root).toMatchObject({ title: "Fixture PRD" });
  });

  it("AC-BOOT-ARCH-3 STATE: text mode shows the architecture root, or (none)", () => {
    const both = makeCorpus({ business: true, architecture: true });
    const text = mustRun(["bootstrap"], both.dir);
    expect(text).toContain(`Root: ${both.businessRoot} "Biz Root"`);
    expect(text).toContain(`Architecture: ${both.architectureRoot} "Arch Root"`);
    const bizOnly = makeCorpus({ business: true, architecture: false });
    expect(mustRun(["bootstrap"], bizOnly.dir)).toContain("Architecture: (none)");
  });
});
