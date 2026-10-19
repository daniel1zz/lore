/**
 * ES-E: stdin and whether it is a terminal come from the Invocation, not from the process
 * (spec-process-state-end-state-one-invocation-per-entry-returned Goal 1 / D1, rule AS-26).
 *
 * Covers: HAPPY (an interactive "y" proceeds), NEGATIVE (an interactive "n" aborts; no terminal = the
 * non-interactive path), BOUNDARY (an input that ends without an answer is "no"), STATE (the two runs of one
 * test share nothing), REGRESSION (a spy on `process.stdin` records zero reads while the prompts run).
 *
 * `lore setup --project --uninstall` and `lore verify` are driven through `runLoreInProcess` with an Invocation
 * whose `io.stdin` is a test stream; both commands used to read `process.stdin` / `process.stdin.isTTY`.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";

let root: string;
let stdinSpy: MockInstance;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "lore-es-stdin-"));
  // reason: the first run in a file loads the command modules, and the runtime touches `process.stdin` once while it
  // does (a native frame, no lore code on the stack); warm that up so the spy below measures only the commands.
  const { home, cwd } = freshDirs("warmup");
  await runLoreInProcess(["setup", "--project", "--uninstall"], { cwd, home });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  // reason: `process.stdin` is a lazy getter; spying on the getter records every access the code under test makes.
  stdinSpy = vi.spyOn(process, "stdin", "get");
});

afterEach(() => {
  stdinSpy.mockRestore();
});

/** A fresh throwaway home and project directory. */
function freshDirs(name: string): { home: string; cwd: string } {
  const base = mkdtempSync(join(root, `${name}-`));
  const home = join(base, "home");
  const cwd = join(base, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  return { home, cwd };
}

describe("ES-E lore setup prompt reads the Invocation's stdin", () => {
  const args = ["setup", "--project", "--uninstall"];

  it("a terminal answering n aborts with exit 0 and says nothing was changed", async () => {
    const { home, cwd } = freshDirs("setup-n");
    const result = await runLoreInProcess(args, { cwd, home, stdin: Readable.from(["n\n"]), stdinIsTTY: true });
    expect(result.stdout).toContain("Proceed? [y/N] ");
    expect(result.stdout).toContain("Aborted — no changes made.");
    expect(result.exitCode).toBe(0);
    expect(stdinSpy).not.toHaveBeenCalled();
  });

  it("a terminal answering y proceeds past the prompt", async () => {
    const { home, cwd } = freshDirs("setup-y");
    const result = await runLoreInProcess(args, { cwd, home, stdin: Readable.from(["y\n"]), stdinIsTTY: true });
    expect(result.stdout).toContain("Proceed? [y/N] ");
    expect(result.stdout).not.toContain("Aborted");
    expect(stdinSpy).not.toHaveBeenCalled();
  });

  it("an input that ends without an answer is no", async () => {
    const { home, cwd } = freshDirs("setup-eof");
    const result = await runLoreInProcess(args, { cwd, home, stdin: Readable.from([]), stdinIsTTY: true });
    expect(result.stdout).toContain("Aborted — no changes made.");
    expect(result.exitCode).toBe(0);
  });

  it("without a terminal it takes the non-interactive path: refuses with exit 2 and never reads the input", async () => {
    const { home, cwd } = freshDirs("setup-notty");
    const read = vi.fn();
    const stdin = {
      [Symbol.asyncIterator]() {
        read();
        return Readable.from(["y\n"])[Symbol.asyncIterator]();
      },
    };
    const result = await runLoreInProcess(args, { cwd, home, stdin, stdinIsTTY: false });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("non-interactive");
    expect(result.stdout).not.toContain("Proceed?");
    expect(read).not.toHaveBeenCalled();
    expect(stdinSpy).not.toHaveBeenCalled();
  });
});

// ─── lore verify ────────────────────────────────────────────────────────────

/** A corpus with one plan whose single script AC has never been approved (so `verify` must ask). */
async function verifyFixture(name: string): Promise<{ home: string; cwd: string; plan: string; taskSlug: string }> {
  const { home, cwd } = freshDirs(name);
  const run = async (args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    const result = await runLoreInProcess(args, { cwd, home, env: { ...process.env, HOME: home, CLAUDECODE: "1" } });
    if (result.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${String(result.exitCode)}): ${result.stderr}`);
    return result;
  };
  const slugOf = (stdout: string): string => {
    const slug = /Slug:\s+(\S+)/.exec(stdout)?.[1];
    if (slug === undefined) throw new Error(`no slug in: ${stdout}`);
    return slug;
  };
  await run(["init"]);
  patchLoreConfig(
    cwd,
    [
      "workflow:",
      "  gates:",
      "    spec-create:",
      "      enabled: false",
      "    spec-promote:",
      "      enabled: false",
      "    plan-promote:",
      "      enabled: false",
      "    task-claim:",
      "      enabled: false",
      '    "task-create":',
      "      enabled: false",
      "",
    ].join("\n"),
  );
  const spec = slugOf((await run(["create", "spec", "--title", "Stdin spec", "--no-ai", "--content", "body"])).stdout);
  const plan = slugOf((await run(["create", "plan", "--title", "Stdin plan", "--parent", spec, "--no-ai", "--content", "body"])).stdout);
  await run(["ac", "add", spec, "AC-STDIN-1", "--statement", "the command prints a marker", "--mode", "script", "--oracle", "other", "--command", "echo es-stdin-marker"]);
  const taskSlug = slugOf(
    (await run(["create", "task", "--title", "Stdin task", "--parent", plan, "--plan-id", plan, "--no-ai", "--content", "body", "--ac-scope", "AC-STDIN-1"])).stdout,
  );
  return { home, cwd, plan, taskSlug };
}

describe("ES-E lore verify confirm prompt reads the Invocation's stdin", () => {
  it("a terminal answering y runs the new command after asking", async () => {
    const { home, cwd, plan, taskSlug } = await verifyFixture("verify-y");
    const result = await runLoreInProcess(["verify", plan, "--task", taskSlug], { cwd, home, stdin: Readable.from(["y\n"]), stdinIsTTY: true });
    expect(result.stdout).toContain('Run new/changed verify command "echo es-stdin-marker" for AC-STDIN-1? [y/N] ');
    expect(result.exitCode).toBe(0);
    expect(stdinSpy).not.toHaveBeenCalled();
  });

  it("a terminal answering n does not run the command", async () => {
    const { home, cwd, plan, taskSlug } = await verifyFixture("verify-n");
    const result = await runLoreInProcess(["verify", plan, "--task", taskSlug], { cwd, home, stdin: Readable.from(["n\n"]), stdinIsTTY: true });
    expect(result.stdout).toContain("Run new/changed verify command");
    expect(result.exitCode).not.toBe(0);
    expect(stdinSpy).not.toHaveBeenCalled();
  });

  it("without a terminal it never prompts and never reads the input", async () => {
    const { home, cwd, plan, taskSlug } = await verifyFixture("verify-notty");
    const read = vi.fn();
    const stdin = {
      [Symbol.asyncIterator]() {
        read();
        return Readable.from(["y\n"])[Symbol.asyncIterator]();
      },
    };
    const result = await runLoreInProcess(["verify", plan, "--task", taskSlug], { cwd, home, stdin, stdinIsTTY: false });
    expect(result.stdout).not.toContain("Run new/changed verify command");
    expect(result.exitCode).not.toBe(0);
    expect(read).not.toHaveBeenCalled();
    expect(stdinSpy).not.toHaveBeenCalled();
  });
});
