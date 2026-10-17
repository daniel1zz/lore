// @reads assets/**
/**
 * Compiled-binary e2e for AC-RS-8 (spec-rule-store-git-tracked-fragment-selection-on-demand-skill):
 * `lore fragments check` fails with exit 4 on a whitespace-normalized duplicate line across layers
 * (`[duplicate_line]` on stderr naming both files), passes once it is removed, and refuses a
 * `context.fragments.disable` in `.lore/config.yaml` naming `selection.yaml`.
 *
 * Isolation: mkdtemp HOME / XDG_CONFIG_HOME / throwaway `lore init` corpus as cwd; never the repo `.lore/`.
 * Negative cases carry a liveness control (clean fixture exits 0) so exit 4 cannot be vacuous.
 *
 * @spec_ref spec-rule-store-git-tracked-fragment-selection-on-demand-skill AC-RS-8
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface Sandbox {
  readonly root: string;
  readonly xdg: string;
  readonly corpus: string;
  readonly env: Record<string, string>;
}

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

async function lore(sb: Sandbox, ...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = await runLoreInProcess(args, { cwd: sb.corpus, env: sb.env });
  return { code: proc.exitCode, stdout: proc.stdout, stderr: proc.stderr };
}

async function makeSandbox(): Promise<Sandbox> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lore-rs8-")));
  expect(root.startsWith(REPO_ROOT)).toBe(false);
  roots.push(root);
  const home = join(root, "home");
  const xdg = join(root, "xdg");
  const corpus = join(root, "corpus");
  for (const d of [home, xdg, corpus]) mkdirSync(d, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["CLAUDE_CONFIG_DIR", "LORE_CONFIG_HOME", "LORE_AI_DEFAULT", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
  env["HOME"] = home;
  env["XDG_CONFIG_HOME"] = xdg;
  env["CLAUDECODE"] = "1";
  const sb: Sandbox = { root, xdg, corpus, env };
  const init = await lore(sb, "init");
  if (init.code !== 0) throw new Error(`harness: lore init failed: ${init.stderr}`);
  return sb;
}

function writeHelperFragment(dir: string, id: string, body: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.md`);
  // reason: helper-audience dynamic fixture — a dynamic MAIN fragment is itself a `dynamic_main` check finding (BR-1066), so it cannot be a clean control.
  writeFileSync(path, `---\nid: ${id}\ntitle: fixture ${id}\naudience: ["subagent:*"]\nmode: dynamic\n---\n${body}\n`, "utf8");
  return path;
}

describe("AC-RS-8 lore fragments check duplicate and selection findings", () => {
  it("a clean fixture exits 0 (liveness control)", async () => {
    const sb = await makeSandbox();
    const res = await lore(sb, "fragments", "check");
    expect(res.stderr).not.toContain("[duplicate_line]");
    expect(res.code).toBe(0);
  });

  it("a whitespace-normalized duplicate across layers exits 4 naming both files; removing it exits 0", async () => {
    const sb = await makeSandbox();
    const projectFile = writeHelperFragment(join(sb.corpus, ".lore", "context"), "rs8-project", "Always run the scoped oracle before release.");
    const userFile = writeHelperFragment(join(sb.xdg, "lore", "context"), "rs8-user", "Always   run the  scoped oracle before release. ");
    const bad = await lore(sb, "fragments", "check");
    expect(bad.code).toBe(4);
    expect(bad.stderr).toContain("[duplicate_line]");
    expect(bad.stderr).toContain(projectFile);
    expect(bad.stderr).toContain(userFile);
    rmSync(userFile);
    const good = await lore(sb, "fragments", "check");
    expect(good.stderr).toBe("");
    expect(good.code).toBe(0);
  });

  it("a selection.yaml disabling one side of a cross-layer duplicate clears it (adapter loads selection files)", async () => {
    const sb = await makeSandbox();
    writeHelperFragment(join(sb.corpus, ".lore", "context"), "rs8-project", "Always run the scoped oracle before release.");
    writeHelperFragment(join(sb.xdg, "lore", "context"), "rs8-user", "Always run the scoped oracle before release.");
    expect((await lore(sb, "fragments", "check")).code).toBe(4);
    writeFileSync(join(sb.xdg, "lore", "context", "selection.yaml"), "schemaVersion: 1\ndisable: [rs8-user]\n", "utf8");
    const res = await lore(sb, "fragments", "check");
    expect(res.stderr).toBe("");
    expect(res.code).toBe(0);
  });

  it("a project selection.yaml disabling an unknown id exits 4 with selection_unknown_id", async () => {
    const sb = await makeSandbox();
    mkdirSync(join(sb.corpus, ".lore", "context"), { recursive: true });
    writeFileSync(join(sb.corpus, ".lore", "context", "selection.yaml"), "schemaVersion: 1\ndisable: [no-such-fragment]\n", "utf8");
    const res = await lore(sb, "fragments", "check");
    expect(res.code).toBe(4);
    expect(res.stderr).toContain("[selection_unknown_id]");
  });

  it("a skill-delivery fragment whose id collides with a shipped skill exits 4 with skill_collision", async () => {
    const sb = await makeSandbox();
    const dir = join(sb.corpus, ".lore", "context");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "ai-native-coding.md"),
      `---\nid: ai-native-coding\ntitle: collides\naudience: ["main"]\nmode: static\ndelivery: skill\ndescription: collides with a shipped skill\n---\nCollision body line.\n`,
      "utf8",
    );
    const res = await lore(sb, "fragments", "check");
    expect(res.stderr).toContain("[skill_collision]");
    expect(res.code).toBe(4);
  });

  it("context.fragments.disable in .lore/config.yaml exits 4 naming selection.yaml", async () => {
    const sb = await makeSandbox();
    writeFileSync(join(sb.corpus, ".lore", "config.yaml"), "context:\n  fragments:\n    disable: [agent-rules]\n", "utf8");
    const res = await lore(sb, "fragments", "check");
    expect(res.code).toBe(4);
    expect(res.stderr).toContain("selection.yaml");
  });
});
