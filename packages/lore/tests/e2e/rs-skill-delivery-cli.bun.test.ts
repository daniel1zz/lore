// @reads assets/**
/**
 * Compiled-binary e2e for skill-delivered fragments
 * (spec-rule-store-git-tracked-fragment-selection-on-demand-skill, Scope 7, AC-RS-10, BR-1061;
 * task task-rs-t10-context-list-add-remove-verbs-and-skill-refresh-via).
 *
 * Contract: a user fragment with `delivery: skill` and a nonce makes `lore context refresh --scope user`
 * write `$HOME/.claude/skills/lore-<id>/SKILL.md` and NO `$HOME/.claude/rules/lore-<id>.md`; the nonce is
 * absent from the `hook:subagent-start` render for lore-implementer (the `hook:session-start` render is retired; it exits 2).
 * Pruning the fragment removes the SKILL.md and its now-empty `lore-<id>/` directory.
 *
 * Isolation: mkdtemp HOME + XDG + `lore init` corpus; never touches the repo's `.lore/` or the real HOME.
 *
 * @spec_ref spec-rule-store-git-tracked-fragment-selection-on-demand-skill AC-RS-10
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const FRAGMENT_ID = "rs-skill-probe";
const NONCE = "NONCE-7f3a91c2-skill-delivery";

interface Sandbox {
  readonly root: string;
  readonly home: string;
  readonly corpus: string;
  readonly userContextDir: string;
  readonly env: Record<string, string>;
}

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const sandboxRoots: string[] = [];
afterAll(() => {
  for (const root of sandboxRoots) rmSync(root, { recursive: true, force: true });
});

async function lore(sb: Sandbox, ...args: string[]): Promise<Run> {
  const proc = await runLoreInProcess(args, { cwd: sb.corpus, env: sb.env });
  return { code: proc.exitCode, stdout: proc.stdout, stderr: proc.stderr };
}

async function makeSandbox(): Promise<Sandbox> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lore-rs-skill-")));
  expect(root.startsWith(REPO_ROOT)).toBe(false);
  sandboxRoots.push(root);
  const home = join(root, "home");
  const xdg = join(root, "xdg");
  const corpus = join(root, "corpus");
  for (const d of [home, xdg, corpus]) mkdirSync(d, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["CLAUDE_CONFIG_DIR", "LORE_CONFIG_HOME", "LORE_AI_DEFAULT", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) {
    delete env[k];
  }
  env["HOME"] = home;
  env["XDG_CONFIG_HOME"] = xdg;
  env["CLAUDECODE"] = "1";
  const sb: Sandbox = { root, home, corpus, userContextDir: join(xdg, "lore", "context"), env };
  const init = await lore(sb, "init");
  if (init.code !== 0) throw new Error(`harness: lore init failed in fixture setup: ${init.stderr}`);
  return sb;
}

function writeSkillFragment(sb: Sandbox): string {
  mkdirSync(sb.userContextDir, { recursive: true });
  const path = join(sb.userContextDir, `${FRAGMENT_ID}.md`);
  const front = [
    "---",
    `id: ${FRAGMENT_ID}`,
    "title: skill probe",
    'audience: ["main"]',
    "mode: static",
    "delivery: skill",
    "description: Use when probing skill delivery in the e2e fixture",
    "---",
    "",
  ].join("\n");
  writeFileSync(path, `${front}Skill body carrying ${NONCE}.\n`, "utf8");
  return path;
}

const skillDir = (sb: Sandbox): string => join(sb.home, ".claude", "skills", `lore-${FRAGMENT_ID}`);

describe("AC-RS-10 skill-delivered fragment", () => {
  it("refresh --scope user writes the SKILL.md and no rules file", async () => {
    const sb = await makeSandbox();
    writeSkillFragment(sb);
    const refresh = await lore(sb, "context", "refresh", "--scope", "user");
    expect(refresh.code).toBe(0);
    const skillFile = join(skillDir(sb), "SKILL.md");
    expect(existsSync(skillFile)).toBe(true);
    expect(readFileSync(skillFile, "utf8")).toContain(NONCE);
    expect(existsSync(join(sb.home, ".claude", "rules", `lore-${FRAGMENT_ID}.md`))).toBe(false);
  });

  it("the nonce is absent from the lore-implementer subagent-start render; the retired session-start render refuses", async () => {
    const sb = await makeSandbox();
    writeSkillFragment(sb);
    // Liveness control: a dynamic helper-audience fragment in the SAME user layer does reach the render,
    // so the nonce's absence below is not because user-layer fragments are skipped.
    const controlNonce = "CONTROL-NONCE-5d2e";
    writeFileSync(
      join(sb.userContextDir, "rs-render-control.md"),
      `---\nid: rs-render-control\ntitle: control\naudience: ["subagent:lore-implementer"]\nmode: dynamic\n---\nControl line ${controlNonce}.\n`,
      "utf8",
    );
    expect((await lore(sb, "context", "refresh", "--scope", "user")).code).toBe(0);
    const session = await lore(sb, "fragments", "render", "--outlet", "hook:session-start");
    expect(session.code).toBe(2);
    expect(session.stderr).toMatch(/retired/i);
    const subagent = await lore(sb, "fragments", "render", "--outlet", "hook:subagent-start", "--agent-type", "lore-implementer");
    expect(subagent.code).toBe(0);
    expect(subagent.stdout).toContain(controlNonce);
    expect(subagent.stdout).not.toContain(NONCE);
  }, 60_000);

  it("removing the fragment prunes the SKILL.md and its now-empty lore-<id>/ directory", async () => {
    const sb = await makeSandbox();
    const fragment = writeSkillFragment(sb);
    expect((await lore(sb, "context", "refresh", "--scope", "user")).code).toBe(0);
    expect(existsSync(skillDir(sb))).toBe(true);
    rmSync(fragment);
    expect((await lore(sb, "context", "refresh", "--scope", "user")).code).toBe(0);
    expect(existsSync(join(skillDir(sb), "SKILL.md"))).toBe(false);
    expect(existsSync(skillDir(sb))).toBe(false);
  });
});
