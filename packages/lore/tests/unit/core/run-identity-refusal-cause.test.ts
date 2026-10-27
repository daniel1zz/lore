/**
 * @spec_ref spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and#AC-RV-5
 * @task task-red-tests-export-prefix-ancestry-verification-refusal (RED; implementation lands in a later task of the same plan)
 *
 * A write from a process carrying the agent harness marker and NO run value is refused (exit 4, nothing written) and the
 * refusal names the REAL cause: with the Bash hook installed in the effective settings the value was removed between the
 * Bash call and lore (and `lore setup` is NOT advised); without the hook it names `lore setup`.
 *
 * @spawns packages/lore/src/index.ts
 * Behaviour level: the real CLI is spawned in a throwaway HOME and corpus; the "effective settings" are the throwaway
 * HOME's `.claude/settings.json`. No new symbol is imported.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";

const INDEX_TS = new URL("../../../src/index.ts", import.meta.url).pathname;

let root: string;
let home: string;
let corpus: string;

function lore(args: string[], env: Record<string, string | undefined>): { status: number; out: string } {
  const merged: Record<string, string | undefined> = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(root, "xdg"), EDITOR: "true", ...env };
  delete merged["LORE_HARNESS_RUN"];
  // reason: the test run's known-party spawn shim (scripts/test-known-party-spawn.ts) would otherwise start lore with a run
  // injected; this file tests the refusal of a start that carries none.
  merged["LORE_TEST_IDENTITY"] = "none";
  if (env["CLAUDECODE"] === undefined) delete merged["CLAUDECODE"];
  // reason: Bun.spawnSync, not node:child_process — under the Bun runtime the node call is patched twice by the test run's
  // spawn shims, and the second patch no longer sees the opt-out variable the first one stripped.
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], { cwd: corpus, env: merged as Record<string, string> });
  return { status: proc.exitCode ?? -1, out: `${proc.stdout.toString()}${proc.stderr.toString()}` };
}

function auditCount(): number {
  const db = new Database(join(corpus, ".lore", "lore.db"), { readonly: true });
  try {
    return (db.query("SELECT count(*) AS n FROM audit").get() as { n: number }).n;
  } finally {
    db.close();
  }
}

function installHookIntoSettings(): void {
  mkdirSync(join(home, ".claude"), { recursive: true });
  const command = `node ${join(home, ".claude", "hooks", "pre-tool-harness-run.mjs")}`;
  writeFileSync(
    join(home, ".claude", "settings.json"),
    JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command }] }] } }, null, 2),
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lore-refusal-cause-"));
  home = join(root, "home");
  corpus = join(root, "corpus");
  mkdirSync(home, { recursive: true });
  mkdirSync(corpus, { recursive: true });
  const init = lore(["init"], { CLAUDECODE: "1" });
  if (init.status !== 0) throw new Error(`lore init failed: ${init.out}`);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("AC-RV-5: the refusal of a write with the agent marker and no run value names the real cause", () => {
  it("hook installed: names the value removed between the Bash call and lore, never `lore setup`; exit 4; nothing written", () => {
    installHookIntoSettings();
    const before = auditCount();
    const r = lore(["create", "plan", "--title", "Refusal cause plan"], { CLAUDECODE: "1" });
    expect(r.status, r.out).toBe(4);
    expect(r.out).toContain("removed between the Bash call and lore");
    expect(r.out).not.toContain("lore setup");
    expect(auditCount()).toBe(before);
  }, 120_000);

  it("hook not installed: names `lore setup`; exit 4; nothing written", () => {
    const before = auditCount();
    const r = lore(["create", "plan", "--title", "Refusal cause plan"], { CLAUDECODE: "1" });
    expect(r.status, r.out).toBe(4);
    expect(r.out).toContain("lore setup");
    expect(r.out).not.toContain("removed between the Bash call and lore");
    expect(auditCount()).toBe(before);
  }, 120_000);
});
