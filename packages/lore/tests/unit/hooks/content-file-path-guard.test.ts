/**
 * content-file-path-guard.test.ts — BUG-014 fix.
 *
 * g1-spec-create.sh's `--content-file` flag extraction (`extract_flag`) reads
 * the RAW Bash command string with zero shell-quoting awareness, then `cat`s
 * whatever path it finds — BEFORE the real `lore create spec` write ever
 * runs. Pre-fix, that `cat` had NO path constraint: an agent coaxed into
 * `lore create spec --content-file ~/.ssh/id_rsa` (or any other readable
 * path outside the corpus) would have this shim read the file into the gate
 * payload, and — on a gate deny — echo it back verbatim in the deny reason.
 *
 * The fix (`resolve_realpath` + `is_content_file_path_allowed` in
 * hooks/g1-spec-create.sh) constrains a resolved --content-file path to one
 * of: TARGET_CWD, /tmp, /private/tmp, or $TMPDIR (each independently
 * realpath'd, closing the macOS /var/folders <-> /private/var/folders alias
 * and any repo-internal symlink pointing outside every allowed root). A path
 * that resolves outside all four keeps the file's PRE-EXISTING fail-open
 * contract (UNRESOLVED_CONTENT_FILE -> allow, CONTENT never populated,
 * `lore gate` never even invoked) rather than denying — false-denies violate
 * this shim's own documented philosophy (SPEC-050), and the service-layer
 * GateEnforcer re-gates the REAL resolved content at write time regardless.
 *
 * Every scenario spawns the REAL checked-in `hooks/g1-spec-create.sh` as a
 * bash subprocess (mirrors gate-cross-corpus-fix.test.ts's pattern) against
 * a throwaway scratch dir with a stub `lore` binary that LOGS every
 * invocation (path + full arg string) — so "the gate was never invoked at
 * all" and "the gate's payload contains file X's content" are both directly
 * observable, never inferred from the hook's own stdout/stderr alone.
 *
 * Coverage dimensions: HAPPY / BOUNDARY / ERROR / REGRESSION.
 *
 * @spec_ref BUG-014 (audit finding, hooks/g1-spec-create.sh:183-202 pre-fix)
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  chmodSync,
  readFileSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir, homedir } from "node:os";

// packages/lore/tests/unit/hooks/content-file-path-guard.test.ts -> repo root is 5 levels up.
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const G1_HOOK = join(REPO_ROOT, "hooks", "g1-spec-create.sh");

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
 * resolves to it. Every invocation is logged (`$PWD\t$1\t$*`) to `logPath`
 * BEFORE the stub decides anything — an EMPTY log after running the hook
 * proves the gate was never reached (the strongest possible proof that a
 * disallowed --content-file's content never left the shim). `gate
 * spec-create` always succeeds (exit 0, `{}`) — these tests care about
 * WHETHER/WHAT was sent to the gate, not the gate's own verdict.
 */
function writeStubLore(scratchDir: string, logPath: string): void {
  const distDir = join(scratchDir, "dist");
  mkdirSync(distDir, { recursive: true });
  writeFileSync(
    join(distDir, "lore"),
    `#!/usr/bin/env bash
printf '%s\\t%s\\t%s\\n' "$PWD" "$1" "$*" >> "${logPath}"
if [ "$1" = "gate" ] && [ "$2" = "spec-create" ]; then
  echo '{}'
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

function runHook(
  payload: HookPayload,
  cwd: string,
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync("bash", [G1_HOOK], {
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

// ─── ERROR — a --content-file outside every allowed prefix fails open, content never read ───

describe("BUG-014 ERROR — --content-file outside every allowed prefix", () => {
  it("a path under $HOME (simulating a sensitive file) fails open: allow, UNRESOLVED_CONTENT_FILE logged, gate NEVER invoked, secret never in stdout", () => {
    const scratch = mkScratchDir("bug014-error-");
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath);

    // A throwaway directory under the REAL $HOME — outside TARGET_CWD, /tmp,
    // /private/tmp, and $TMPDIR alike, standing in for a sensitive path like
    // ~/.ssh/id_rsa without touching any actual credential file.
    const sensitiveDir = mkdtempSync(join(homedir(), ".bug014-sensitive-"));
    cleanupDirs.push(sensitiveDir);
    const secretPath = join(sensitiveDir, "secret.md");
    const SECRET_MARKER = "SUPER_SECRET_MARKER_DO_NOT_LEAK_BUG014";
    writeFileSync(secretPath, `# fake secret\n${SECRET_MARKER}\n`);

    const result = runHook(
      {
        tool_name: "Bash",
        tool_input: {
          command: `lore create spec --title "Attack" --parent some-parent --content-file "${secretPath}"`,
        },
        cwd: scratch,
      },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    expect(decision.permissionDecision).toBe("allow");
    expect(result.stderr).toContain("UNRESOLVED_CONTENT_FILE");
    // Fail-open exits BEFORE building the gate payload — the log must be
    // completely empty (the gate binary was never invoked at all).
    expect(readLog(logPath)).toEqual([]);
    // Paranoid double-check: the secret content never made it into the
    // hook's own stdout (it only ever emits the {"hookSpecificOutput":...}
    // allow JSON on this path).
    expect(result.stdout).not.toContain(SECRET_MARKER);
  });
});

// ─── HAPPY — content files inside TARGET_CWD keep working (relative + absolute) ───

describe("BUG-014 HAPPY — --content-file inside TARGET_CWD (legitimate usage)", () => {
  it("a RELATIVE path inside TARGET_CWD is read and forwarded to the gate", () => {
    const scratch = mkScratchDir("bug014-happy-rel-");
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath);

    const MARKER = "HAPPY_RELATIVE_CONTENT_MARKER";
    writeFileSync(join(scratch, "my-spec.md"), `# Spec\n${MARKER}\n`);

    const result = runHook(
      {
        tool_name: "Bash",
        tool_input: {
          command: `lore create spec --title "Good" --parent some-parent --content-file my-spec.md`,
        },
        cwd: scratch,
      },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    expect(decision.permissionDecision).toBe("allow");
    expect(result.stderr).not.toContain("UNRESOLVED_CONTENT_FILE");
    const log = readLog(logPath);
    expect(log.length).toBeGreaterThan(0);
    expect(log.some((line) => line.includes(MARKER))).toBe(true);
  });

  it("an ABSOLUTE path inside TARGET_CWD is read and forwarded to the gate (CLAUDE.md 'pass literal absolute paths' discipline)", () => {
    const scratch = mkScratchDir("bug014-happy-abs-");
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath);

    const MARKER = "HAPPY_ABSOLUTE_CONTENT_MARKER";
    const specPath = join(scratch, "my-abs-spec.md");
    writeFileSync(specPath, `# Spec\n${MARKER}\n`);

    const result = runHook(
      {
        tool_name: "Bash",
        tool_input: {
          command: `lore create spec --title "Good" --parent some-parent --content-file "${specPath}"`,
        },
        cwd: scratch,
      },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    expect(decision.permissionDecision).toBe("allow");
    expect(result.stderr).not.toContain("UNRESOLVED_CONTENT_FILE");
    const log = readLog(logPath);
    expect(log.length).toBeGreaterThan(0);
    expect(log.some((line) => line.includes(MARKER))).toBe(true);
  });
});

// ─── BOUNDARY — /tmp scratchpad paths allowed independent of TARGET_CWD; symlink escape blocked ───

describe("BUG-014 BOUNDARY — scratch-dir allowance and symlink-escape protection", () => {
  it("a --content-file under a DIFFERENT /tmp scratch dir (not under TARGET_CWD) is still read (scratchpad discipline)", () => {
    const scratch = mkScratchDir("bug014-boundary-target-");
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath);

    // A wholly separate scratch tree — proves the /tmp (or $TMPDIR) allow
    // rule is independent of TARGET_CWD, matching the documented scratchpad
    // usage pattern (spec content authored under the agent's own scratch dir).
    const otherScratch = mkScratchDir("bug014-boundary-content-");
    const MARKER = "BOUNDARY_SCRATCHPAD_CONTENT_MARKER";
    const specPath = join(otherScratch, "spec-from-scratchpad.md");
    writeFileSync(specPath, `# Spec\n${MARKER}\n`);

    const result = runHook(
      {
        tool_name: "Bash",
        tool_input: {
          command: `lore create spec --title "Good" --parent some-parent --content-file "${specPath}"`,
        },
        cwd: scratch,
      },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    expect(decision.permissionDecision).toBe("allow");
    expect(result.stderr).not.toContain("UNRESOLVED_CONTENT_FILE");
    const log = readLog(logPath);
    expect(log.length).toBeGreaterThan(0);
    expect(log.some((line) => line.includes(MARKER))).toBe(true);
  });

  it("a symlink INSIDE TARGET_CWD pointing to a path outside every allowed prefix fails open (realpath escape caught)", () => {
    const scratch = mkScratchDir("bug014-boundary-symlink-");
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath);

    const sensitiveDir = mkdtempSync(join(homedir(), ".bug014-symlink-target-"));
    cleanupDirs.push(sensitiveDir);
    const SECRET_MARKER = "SYMLINK_ESCAPE_SECRET_MARKER";
    const secretPath = join(sensitiveDir, "secret.md");
    writeFileSync(secretPath, `# fake secret\n${SECRET_MARKER}\n`);

    // The symlink itself lives INSIDE TARGET_CWD (readable there), but its
    // realpath target resolves OUTSIDE every allowed prefix.
    const linkPath = join(scratch, "link-to-secret.md");
    symlinkSync(secretPath, linkPath);

    const result = runHook(
      {
        tool_name: "Bash",
        tool_input: {
          command: `lore create spec --title "Attack" --parent some-parent --content-file link-to-secret.md`,
        },
        cwd: scratch,
      },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    expect(decision.permissionDecision).toBe("allow");
    expect(result.stderr).toContain("UNRESOLVED_CONTENT_FILE");
    expect(readLog(logPath)).toEqual([]);
    expect(result.stdout).not.toContain(SECRET_MARKER);
  });
});

// ─── REGRESSION — pre-existing unreadable/unexpanded-variable path still fails open exactly as before ───

describe("BUG-014 REGRESSION — pre-existing UNRESOLVED_CONTENT_FILE behavior is preserved", () => {
  it("an unexpanded shell-variable path (e.g. \"$SP/spec.md\") still fails open, unchanged by the BUG-014 fix", () => {
    const scratch = mkScratchDir("bug014-regression-");
    const logPath = join(scratch, "log.txt");
    writeStubLore(scratch, logPath);

    const result = runHook(
      {
        tool_name: "Bash",
        tool_input: {
          // Raw command string literally contains `$SP` — the hook only ever
          // sees the UNEXPANDED text, never the invoking shell's expansion.
          command: `lore create spec --title "Good" --parent some-parent --content-file "$SP/spec.md"`,
        },
        cwd: scratch,
      },
      scratch,
    );

    const decision = parseDecision(result.stdout);
    expect(decision.permissionDecision).toBe("allow");
    expect(result.stderr).toContain("UNRESOLVED_CONTENT_FILE");
    expect(readLog(logPath)).toEqual([]);
  });
});
