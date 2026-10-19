/**
 * ES-D: a failed OS user lookup does not stop the invocation; it stops only the write that needs an actor
 * (spec-process-state-end-state-one-invocation-per-entry-returned D1, rule AS-26).
 *
 * Covers: HAPPY (a read command with a failed lookup and no other name exits 0), ERROR (a write command in the same
 * setup exits 4 naming the reason), NEGATIVE (a write with a session name still works), STATE (the failed run wrote
 * nothing), REGRESSION (no substitute author appears in the corpus).
 *
 * The runs go through `runLoreInProcess` with a throwaway home and an env that carries no session id, so the only
 * tier left is the OS user, whose lookup the test makes fail.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";

const REASON = "ENOENT: no passwd entry for uid 4242";
const FAILED = { ok: false, reason: REASON } as const;

let root: string;
let home: string;
let cwd: string;

/** The run's environment: no session id (that tier would name the writer), PATH for git. */
function bareEnv(): Record<string, string> {
  return { HOME: home, PATH: process.env["PATH"] ?? "", EDITOR: "true" };
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "lore-es-os-user-"));
  home = join(root, "home");
  cwd = join(root, "corpus");
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const init = await runLoreInProcess(["init"], { cwd, home, env: bareEnv() });
  expect(init.exitCode).toBe(0);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("ES-D an unnamed invocation (failed OS user lookup, no other name)", () => {
  it("a read command proceeds: list exits 0", async () => {
    const result = await runLoreInProcess(["list", "--json"], { cwd, home, env: bareEnv(), osUser: FAILED });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("OS user lookup failed");
  });

  it("a write command fails with exit 4 naming the reason, and writes nothing", async () => {
    const write = await runLoreInProcess(["create", "plan", "--title", "Unnamed plan", "--no-ai"], { cwd, home, env: bareEnv(), osUser: FAILED });
    expect(write.exitCode).toBe(4);
    expect(write.stderr).toContain("OS user lookup failed");
    expect(write.stderr).toContain(REASON);

    const listed = await runLoreInProcess(["list", "--json"], { cwd, home, env: bareEnv(), osUser: FAILED });
    expect(listed.stdout).not.toContain("unnamed-plan");
  });

  it("the same write succeeds when a session names the writer, whatever the lookup says", async () => {
    const env = { ...bareEnv(), CLAUDE_CODE_SESSION_ID: "3de02220-aaaa-bbbb-cccc-111122223333" };
    const write = await runLoreInProcess(["create", "plan", "--title", "Named plan", "--no-ai"], { cwd, home, env, osUser: FAILED });
    expect(write.exitCode).toBe(0);
  });
});

describe("ES-D a gate bypass needs an actor to audit it", () => {
  const bypassArgs = ["gate", "spec-create", "--input-json", "{}"];

  it("is refused with exit 4 naming the reason when the invocation is unnamed: nothing is bypassed", async () => {
    const env = { ...bareEnv(), LORE_GATE_BYPASS: "1" };
    const result = await runLoreInProcess(bypassArgs, { cwd, home, env, osUser: FAILED });
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("OS user lookup failed");
    expect(result.stderr).toContain(REASON);
    expect(result.stderr).not.toContain("gate bypass NOT audited");
  });

  it("still proceeds (exit 0, audited) when a session names the writer", async () => {
    const env = { ...bareEnv(), LORE_GATE_BYPASS: "1", CLAUDE_CODE_SESSION_ID: "3de02220-aaaa-bbbb-cccc-111122223333" };
    const result = await runLoreInProcess(bypassArgs, { cwd, home, env, osUser: FAILED });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("gate bypass NOT audited");
  });
});
