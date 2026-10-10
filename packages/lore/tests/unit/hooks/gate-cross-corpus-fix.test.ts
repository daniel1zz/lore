/**
 * gate-cross-corpus-fix.test.ts — SPEC-050 AC-050-2.
 *
 * Behavioral tests for the g1-spec-create.sh / g4-task-claim.sh PreToolUse
 * gate shims' SPEC-050 fixes:
 *
 *   D1 — leading `cd <path> &&`/`cd <path> ;` prefix parsing: TARGET_CWD
 *        follows a resolvable leading `cd` (bare/quoted/env-assignment-
 *        prefixed forms), and a `$`-bearing path token disqualifies the
 *        match (falls back to the pre-existing HOOK_CWD derivation).
 *   D2 — RETIRED by BR-2 (baseline-slice-3b): g1 used to fail open (log
 *        UNRESOLVED_PARENT) when a declared --parent still came back
 *        PARENT_REQUIRED. A spec takes no parent now, so that lookup anomaly
 *        no longer exists; every gate verdict of 4 is denied, with or without
 *        a --parent. The D2 block below pins the NEW behaviour.
 *   D4 — command-position trigger matching: the trigger phrase must sit at
 *        a command position (start of string, or right after &&/||/;/|/$(/
 *        backtick) — a mention of the phrase inside a quoted argument value
 *        no longer trips the matcher, while real positive shapes (including
 *        chained-after-&& and path-prefixed forms) still match.
 *
 * Every scenario spawns the REAL checked-in hook script (`hooks/g1-spec-
 * create.sh` / `hooks/g4-task-claim.sh`) as a bash subprocess via
 * node:child_process (vitest — no `Bun.spawnSync`, mirrors
 * session-seat-injection.test.ts's pattern), against a throwaway scratch
 * dir with a stub `lore` binary at `<scratch>/dist/lore` (CLAUDE_PROJECT_DIR
 * points the hook's REPO_ROOT/LORE_BIN derivation there) — never spawns the
 * real compiled binary or touches the repo's own `.lore/` corpus.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * @spec_ref SPEC-050 D1/D2/D4, AC-050-2
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// packages/lore/tests/unit/hooks/gate-cross-corpus-fix.test.ts -> repo root is 5 levels up.
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const G1_HOOK = join(REPO_ROOT, "hooks", "g1-spec-create.sh");
const G4_HOOK = join(REPO_ROOT, "hooks", "g4-task-claim.sh");

const cleanupDirs: string[] = [];

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

function mkScratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

/**
 * Writes a stub `lore` binary at `<scratch>/dist/lore` so the hook's
 * REPO_ROOT/LORE_BIN derivation (`CLAUDE_PROJECT_DIR` -> `$REPO_ROOT/dist/lore`)
 * resolves to it. `gateSpecCreateBehavior` controls the `gate spec-create`
 * response: "parent-required" always denies with PARENT_REQUIRED unless the
 * input JSON's `parent_id` equals "resolvable-parent" (simulates a
 * successful in-corpus lookup); "always-parent-required" denies regardless
 * of parent_id (simulates an unresolvable/cross-corpus parent — the D2
 * anomaly case).
 */
function writeStubLore(
  scratchDir: string,
  logPath: string,
  opts: { gateSpecCreateBehavior?: "parent-required" | "always-parent-required" } = {},
): void {
  const distDir = join(scratchDir, "dist");
  mkdirSync(distDir, { recursive: true });
  const behavior = opts.gateSpecCreateBehavior ?? "parent-required";
  const gateBody =
    behavior === "always-parent-required"
      ? `echo '[stub] PARENT_REQUIRED: parent did not resolve in this corpus' ; exit 4`
      : `if echo "$4" | grep -q '"parent_id".*"resolvable-parent"'; then echo '{}'; exit 0; else echo '[stub] PARENT_REQUIRED: spec must declare --parent'; exit 4; fi`;
  writeFileSync(
    join(distDir, "lore"),
    `#!/usr/bin/env bash
printf '%s\\t%s\\t%s\\n' "$PWD" "$1" "$*" >> "${logPath}"
if [ "$1" = "gate" ] && [ "$2" = "spec-create" ]; then
  ${gateBody}
fi
if [ "$1" = "gate" ] && [ "$2" = "task-claim" ]; then
  echo '{}'
  exit 0
fi
if [ "$1" = "get" ]; then
  echo '{"data":{"doc":{"type":"task"}}}'
  exit 0
fi
exit 0
`,
  );
  chmodSync(join(distDir, "lore"), 0o755);
}

interface HookPayload {
  readonly tool_name: string;
  readonly tool_input: Record<string, unknown>;
  readonly cwd: string;
}

function runHook(hookPath: string, payload: HookPayload, cwd: string): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync("bash", [hookPath], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

function parseDecision(stdout: string): { permissionDecision: string; permissionDecisionReason?: string } {
  const parsed = JSON.parse(stdout.trim()) as {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason?: string };
  };
  return parsed.hookSpecificOutput;
}

function readLog(logPath: string): string[] {
  if (!existsSync(logPath)) return [];
  const content = readFileSync(logPath, "utf8").trim();
  return content.length === 0 ? [] : content.split("\n");
}

// ─── D1 — leading `cd <path> &&`/`cd <path> ;` prefix parsing ────────────────

describe("SPEC-050 D1 — g1-spec-create.sh cd-prefix TARGET_CWD", () => {
  it("HAPPY: bare `cd <path> &&` prefix redirects TARGET_CWD to the resolvable dir", () => {
    const scratch = mkScratchDir("d1-bare-");
    const otherDir = join(scratch, "other");
    mkdirSync(otherDir);
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath);

    const result = runHook(
      G1_HOOK,
      {
        tool_name: "Bash",
        tool_input: { command: `cd ${otherDir} && lore create spec --title "Bad" --parent resolvable-parent` },
        cwd: scratch,
      },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    expect(decision.permissionDecision).toBe("allow");
    const log = readLog(logPath);
    expect(log.some((line) => line.startsWith(`${otherDir}\t`))).toBe(true);
  });

  it("HAPPY: double-quoted `cd \"<path>\" &&` prefix redirects TARGET_CWD", () => {
    const scratch = mkScratchDir("d1-dq-");
    const otherDir = join(scratch, "other space dir");
    mkdirSync(otherDir);
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath);

    const result = runHook(
      G1_HOOK,
      {
        tool_name: "Bash",
        tool_input: { command: `cd "${otherDir}" && lore create spec --title "Bad" --parent resolvable-parent` },
        cwd: scratch,
      },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    expect(decision.permissionDecision).toBe("allow");
    const log = readLog(logPath);
    expect(log.some((line) => line.startsWith(`${otherDir}\t`))).toBe(true);
  });

  it("HAPPY: single-quoted `cd '<path>' ;` prefix redirects TARGET_CWD", () => {
    const scratch = mkScratchDir("d1-sq-");
    const otherDir = join(scratch, "other");
    mkdirSync(otherDir);
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath);

    const result = runHook(
      G1_HOOK,
      {
        tool_name: "Bash",
        tool_input: { command: `cd '${otherDir}' ; lore create spec --title "Bad" --parent resolvable-parent` },
        cwd: scratch,
      },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    expect(decision.permissionDecision).toBe("allow");
    const log = readLog(logPath);
    expect(log.some((line) => line.startsWith(`${otherDir}\t`))).toBe(true);
  });

  it("STATE: a leading simple VAR=value env assignment before `cd` is tolerated", () => {
    const scratch = mkScratchDir("d1-env-");
    const otherDir = join(scratch, "other");
    mkdirSync(otherDir);
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath);

    const result = runHook(
      G1_HOOK,
      {
        tool_name: "Bash",
        tool_input: {
          command: `FOO=bar cd ${otherDir} && lore create spec --title "Bad" --parent resolvable-parent`,
        },
        cwd: scratch,
      },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    expect(decision.permissionDecision).toBe("allow");
    const log = readLog(logPath);
    expect(log.some((line) => line.startsWith(`${otherDir}\t`))).toBe(true);
  });

  it("NEGATIVE/BOUNDARY: a `$`-bearing cd-prefix path is disqualified, falls back to HOOK_CWD", () => {
    const scratch = mkScratchDir("d1-dollar-");
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath);

    const result = runHook(
      G1_HOOK,
      {
        tool_name: "Bash",
        tool_input: {
          command: `cd $SOME_VAR/other && lore create spec --title "Bad" --parent resolvable-parent`,
        },
        cwd: scratch,
      },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    // resolvable-parent only satisfies the stub gate when TARGET_CWD is the
    // fallback scratch dir (no cd-prefix override) — same PWD as the stub
    // logged for the top-level scratch corpus.
    expect(decision.permissionDecision).toBe("allow");
    const log = readLog(logPath);
    expect(log.some((line) => line.startsWith(`${scratch}\t`))).toBe(true);
  });

  it("REGRESSION: no leading cd prefix at all falls back to the pre-existing HOOK_CWD derivation", () => {
    const scratch = mkScratchDir("d1-none-");
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath);

    const result = runHook(
      G1_HOOK,
      {
        tool_name: "Bash",
        tool_input: { command: `lore create spec --title "Bad" --parent resolvable-parent` },
        cwd: scratch,
      },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    expect(decision.permissionDecision).toBe("allow");
    const log = readLog(logPath);
    expect(log.some((line) => line.startsWith(`${scratch}\t`))).toBe(true);
  });
});

// ─── D2 — g1 PARENT_REQUIRED lookup-anomaly fail-open ─────────────────────────

describe("SPEC-050 D2 (retired by BR-2) — g1-spec-create.sh denies every gate verdict of 4", () => {
  it("STATE: a declared --parent the gate refuses is DENIED — no lookup-anomaly fail-open, UNRESOLVED_PARENT is never logged", () => {
    const scratch = mkScratchDir("d2-anomaly-");
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath, { gateSpecCreateBehavior: "always-parent-required" });

    const result = runHook(
      G1_HOOK,
      {
        tool_name: "Bash",
        tool_input: {
          command: `lore create spec --title "Bad" --parent cross-corpus-parent`,
        },
        cwd: scratch,
      },
      scratch,
    );

    // re-baseline (BR-2): this used to assert allow + UNRESOLVED_PARENT. A spec takes no parent, so a
    // declared --parent is itself the violation the gate reports; the shim relays that deny.
    const decision = parseDecision(result.stdout);
    expect(decision.permissionDecision).toBe("deny");
    expect(decision.permissionDecisionReason ?? "").toContain("PARENT_REQUIRED");
    expect(result.stderr).not.toContain("UNRESOLVED_PARENT");
  });

  it("NEGATIVE: NO declared --parent is denied too when the gate says 4", () => {
    const scratch = mkScratchDir("d2-noparent-");
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath, { gateSpecCreateBehavior: "always-parent-required" });

    const result = runHook(
      G1_HOOK,
      {
        tool_name: "Bash",
        tool_input: { command: `lore create spec --title "Bad"` },
        cwd: scratch,
      },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    expect(decision.permissionDecision).toBe("deny");
    expect(decision.permissionDecisionReason ?? "").toContain("PARENT_REQUIRED");
  });

  it("REGRESSION: when the gate passes (exit 0) the call is allowed normally, with or without a --parent", () => {
    const scratch = mkScratchDir("d2-happy-");
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath, { gateSpecCreateBehavior: "parent-required" });

    const result = runHook(
      G1_HOOK,
      {
        tool_name: "Bash",
        tool_input: { command: `lore create spec --title "Good" --parent resolvable-parent` },
        cwd: scratch,
      },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    expect(decision.permissionDecision).toBe("allow");
    expect(result.stderr).not.toContain("UNRESOLVED_PARENT");
  });
});

// ─── D4 — command-position trigger matching ──────────────────────────────────

describe("SPEC-050 D4 — command-position trigger matching (g1)", () => {
  it("NEGATIVE: a quoted --statement value that merely MENTIONS the trigger phrase no longer trips the matcher", () => {
    const scratch = mkScratchDir("d4-fp-g1-");
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath);

    const result = runHook(
      G1_HOOK,
      {
        tool_name: "Bash",
        tool_input: {
          command: `lore ac add spec-x AC-1 --statement "please run the lore create spec workflow"`,
        },
        cwd: scratch,
      },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    expect(decision.permissionDecision).toBe("allow");
    // Never invoked the gate at all — the trigger match itself must fail.
    expect(readLog(logPath)).toEqual([]);
  });

  it("HAPPY: the trigger phrase at the true start of the command still matches", () => {
    const scratch = mkScratchDir("d4-tp-start-");
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath);

    const result = runHook(
      G1_HOOK,
      {
        tool_name: "Bash",
        tool_input: { command: `lore create spec --title "Good" --parent resolvable-parent` },
        cwd: scratch,
      },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    expect(decision.permissionDecision).toBe("allow");
    expect(readLog(logPath).length).toBeGreaterThan(0);
  });

  it("HAPPY: the trigger phrase right after `&&` still matches (command position, not string start)", () => {
    const scratch = mkScratchDir("d4-tp-and-");
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath, { gateSpecCreateBehavior: "always-parent-required" });

    const result = runHook(
      G1_HOOK,
      {
        tool_name: "Bash",
        tool_input: { command: `echo hi && lore create spec --title "Bad"` },
        cwd: scratch,
      },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    // No --parent declared -> real PARENT_REQUIRED deny (D2 keeps this denied);
    // reaching a deny at all proves the trigger DID match after `&&`.
    expect(decision.permissionDecision).toBe("deny");
    expect(readLog(logPath).length).toBeGreaterThan(0);
  });

  it("HAPPY: a path-prefixed invocation (`./dist/lore create spec`) still matches at command position", () => {
    const scratch = mkScratchDir("d4-tp-path-");
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath);

    const result = runHook(
      G1_HOOK,
      {
        tool_name: "Bash",
        tool_input: {
          command: `./dist/lore create spec --title "Good" --parent resolvable-parent`,
        },
        cwd: scratch,
      },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    expect(decision.permissionDecision).toBe("allow");
    expect(readLog(logPath).length).toBeGreaterThan(0);
  });

  it("REGRESSION: an unrelated Bash command is still allowed without any gate invocation", () => {
    const scratch = mkScratchDir("d4-unrelated-");
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath);

    const result = runHook(
      G1_HOOK,
      { tool_name: "Bash", tool_input: { command: "ls -la" }, cwd: scratch },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    expect(decision.permissionDecision).toBe("allow");
    expect(readLog(logPath)).toEqual([]);
  });
});

describe("SPEC-050 D4 — command-position trigger matching (g4-task-claim.sh)", () => {
  it("NEGATIVE: a quoted argument that merely MENTIONS `lore claim <id>` no longer trips the matcher", () => {
    const scratch = mkScratchDir("d4-fp-g4-");
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath);

    const result = runHook(
      G4_HOOK,
      {
        tool_name: "Bash",
        tool_input: { command: `echo --message "please lore claim task-x soon"` },
        cwd: scratch,
      },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    expect(decision.permissionDecision).toBe("allow");
    expect(readLog(logPath)).toEqual([]);
  });

  it("HAPPY: `lore claim <id>` at the true start of the command still matches (get + gate invoked)", () => {
    const scratch = mkScratchDir("d4-tp-g4-");
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath);

    const result = runHook(
      G4_HOOK,
      {
        tool_name: "Bash",
        tool_input: { command: `lore claim task-x --by tester` },
        cwd: scratch,
      },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    expect(decision.permissionDecision).toBe("allow");
    const log = readLog(logPath);
    expect(log.some((line) => line.includes("\tget\t"))).toBe(true);
    expect(log.some((line) => line.includes("\tgate\t"))).toBe(true);
  });
});

// ─── D1 — g4-task-claim.sh cd-prefix (cross-hook regression) ─────────────────

describe("SPEC-050 D1 — g4-task-claim.sh cd-prefix TARGET_CWD (cross-hook regression)", () => {
  it("HAPPY: `cd <path> &&` before `lore claim` redirects the get/gate lookups to <path>", () => {
    const scratch = mkScratchDir("d1-g4-");
    const otherDir = join(scratch, "other");
    mkdirSync(otherDir);
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath);

    const result = runHook(
      G4_HOOK,
      {
        tool_name: "Bash",
        tool_input: { command: `cd ${otherDir} && lore claim task-x --by tester` },
        cwd: scratch,
      },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    expect(decision.permissionDecision).toBe("allow");
    const log = readLog(logPath);
    expect(log.every((line) => line.startsWith(`${otherDir}\t`))).toBe(true);
    expect(log.length).toBeGreaterThan(0);
  });
});
