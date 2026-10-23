// @reads assets/**
/**
 * Compiled-binary e2e for `lore context list | add | remove`
 * (spec-rule-store-git-tracked-fragment-selection-on-demand-skill, Scope 7, AC-RS-7, BR-1063;
 * task task-rs-t10-context-list-add-remove-verbs-and-skill-refresh-via).
 *
 * Contract: `list --json` lists every fragment with layer/inject/selected; `remove <id>` records the id
 * in `.lore/context/selection.yaml` and deletes the project rules file; a repeat exits 0 and leaves the
 * selection file byte-equal; `add` restores the rules file; an unknown id exits 4.
 *
 * Exit 5 (CONFLICT) race: a spawned race is not deterministic, so the compare-and-swap is driven
 * IN-PROCESS through `runSelectionChange` (the flow the verb calls) over the real filesystem, with a port
 * that lands a foreign write between the flow's read and its CAS re-read. The flow's error is then mapped
 * with the CLI's own `exitCode()` — the exact function the verb uses to set the process exit code.
 *
 * Isolation: mkdtemp HOME + XDG + `lore init` corpus; never touches the repo's `.lore/` or the real HOME.
 *
 * @spec_ref spec-rule-store-git-tracked-fragment-selection-on-demand-skill AC-RS-7
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import type { FsWritePort } from "@lore/core";
import { exitCode } from "../../src/adapters/cli/utils";
import { makeRealContextFsPort } from "../../src/adapters/cli/commands/context";
import { runSelectionChange } from "../../src/flows/selection-flow";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const FRAGMENT_ID = "corpus-workflow-close";

interface Sandbox {
  readonly root: string;
  readonly corpus: string;
  readonly userConfigDir: string;
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
  const proc = await runLoreInProcess(args, { cwd: sb.corpus, home: join(sb.root, "home"), env: sb.env });
  return { code: proc.exitCode, stdout: proc.stdout, stderr: proc.stderr };
}

async function makeSandbox(): Promise<Sandbox> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lore-rs-selection-")));
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
  const sb: Sandbox = { root, corpus, userConfigDir: join(xdg, "lore"), env };
  for (const step of [["init"], ["context", "init", "--no-ai"], ["context", "refresh"]]) {
    const run = await lore(sb, ...step);
    if (run.code !== 0) throw new Error(`harness: lore ${step.join(" ")} failed in fixture setup: ${run.stderr}`);
  }
  return sb;
}

const rulesFile = (sb: Sandbox): string => join(sb.corpus, ".claude", "rules", `lore-${FRAGMENT_ID}.md`);
const selectionFile = (sb: Sandbox): string => join(sb.corpus, ".lore", "context", "selection.yaml");

describe("AC-RS-7 lore context list | add | remove", () => {
  it("fixture liveness: the rules file exists before any selection change", async () => {
    const sb = await makeSandbox();
    expect(existsSync(rulesFile(sb))).toBe(true);
    expect(existsSync(selectionFile(sb))).toBe(false);
  });

  it("list --json lists every fragment with layer, inject and selected", async () => {
    const sb = await makeSandbox();
    const run = await lore(sb, "context", "list", "--json");
    expect(run.code).toBe(0);
    const report = JSON.parse(run.stdout) as {
      ok: boolean;
      data: { id: string; layer: string; inject: string[]; selected: boolean }[];
    };
    expect(report.ok).toBe(true);
    expect(report.data.length).toBeGreaterThan(5);
    for (const row of report.data) {
      expect(["shipped", "user", "project"]).toContain(row.layer);
      expect(Array.isArray(row.inject) && row.inject.length > 0).toBe(true);
      expect(row).not.toHaveProperty("delivery");
      expect(typeof row.selected).toBe("boolean");
    }
    const close = report.data.find((row) => row.id === FRAGMENT_ID);
    expect(close).toMatchObject({ layer: "shipped", selected: true });
    expect(report.data.every((row) => row.selected)).toBe(true);
  });

  it("remove records the id in selection.yaml and deletes the rules file; repeat exits 0 byte-equal; add restores it", async () => {
    const sb = await makeSandbox();

    const removed = await lore(sb, "context", "remove", FRAGMENT_ID);
    expect(removed.code).toBe(0);
    expect(readFileSync(selectionFile(sb), "utf8")).toContain(FRAGMENT_ID);
    expect(existsSync(rulesFile(sb))).toBe(false);
    const listed = JSON.parse((await lore(sb, "context", "list", "--json")).stdout) as { data: { id: string; selected: boolean }[] };
    expect(listed.data.find((row) => row.id === FRAGMENT_ID)?.selected).toBe(false);

    const before = readFileSync(selectionFile(sb));
    const again = await lore(sb, "context", "remove", FRAGMENT_ID);
    expect(again.code).toBe(0);
    expect(Buffer.compare(readFileSync(selectionFile(sb)), before)).toBe(0);
    expect(existsSync(rulesFile(sb))).toBe(false);

    const added = await lore(sb, "context", "add", FRAGMENT_ID);
    expect(added.code).toBe(0);
    expect(existsSync(rulesFile(sb))).toBe(true);
    expect(readFileSync(selectionFile(sb), "utf8")).not.toContain(FRAGMENT_ID);
  }, 60_000);

  it("remove of an unknown fragment id exits 4 and writes no selection file", async () => {
    const sb = await makeSandbox();
    const run = await lore(sb, "context", "remove", "no-such-fragment");
    expect(run.code).toBe(4);
    expect(run.stderr).toContain("no-such-fragment");
    expect(existsSync(selectionFile(sb))).toBe(false);
    expect(existsSync(rulesFile(sb))).toBe(true);
  });

  it("a write that lands between the flow's read and its CAS re-read exits 5 and leaves the foreign bytes", async () => {
    const sb = await makeSandbox();
    const path = selectionFile(sb);
    const foreign = "schemaVersion: 1\ndisable:\n  - agent-rules\n";
    const real = makeRealContextFsPort(sb.corpus, [sb.corpus]);
    let reads = 0;
    const racing: FsWritePort = {
      ...real,
      async readFile(p: string): Promise<string | null> {
        if (p === path && ++reads === 2) {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, foreign, "utf8");
        }
        return real.readFile(p);
      },
    };
    const result = await runSelectionChange(
      {
        fs: racing,
        roots: {
          shipped: join(REPO_ROOT, "assets", "context"),
          user: join(sb.userConfigDir, "context"),
          project: join(sb.corpus, ".lore", "context"),
        },
        selectionPaths: { project: path, user: join(sb.userConfigDir, "context", "selection.yaml") },
      },
      { action: "remove", id: FRAGMENT_ID, scope: "project" },
    );
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CONFLICT");
    expect(exitCode(result.error)).toBe(5);
    expect(readFileSync(path, "utf8")).toBe(foreign);
  });
});
