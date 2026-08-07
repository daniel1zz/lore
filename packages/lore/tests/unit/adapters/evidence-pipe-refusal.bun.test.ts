/**
 * Tests the FIFTH `lore evidence` self-report guard —
 * `commandHasUnsafePipe`/`findPipeRefusal`
 * (`../../../src/adapters/cli/evidence-precheck.ts`) — closes
 * task-refuse-a-self-reported-evidence-command-containing-a-shell (SPEC
 * oracle-tier-falsifiability-a-criterion-never-observed-red M2, ADR
 * falsifiability-moves-from-the-task-tier-to-the-oracle-tier).
 *
 * Defect (THIRD recurrence in this repo — handoff-71 KD2 recorded two, this
 * session a third): a self-reported `lore evidence --oracle test --result
 * pass` whose `--command` ends in a shell pipe (`bun run test:changed <base>
 * 2>&1 | tail -100`) records cleanly with `$?` sourced from `tail`, which
 * always exits 0 regardless of what the piped-FROM command actually did. The
 * recorded `pass` was never measured against the oracle it claims to
 * describe.
 *
 * Exit-code assertions in this file use `exitCode()` from `../../../src/
 * adapters/cli/utils.ts` (imported, unedited) applied to `findPipeRefusal`'s
 * OWN return value — the exact function BOTH adapters (`commands/
 * evidence.ts`'s CLI command, `../mcp/tools.ts`'s `lore_evidence_add` MCP
 * handler) would call at their shared precheck sequence point once wired
 * (see `findPipeRefusal`'s own module-header note: this guard is authored and
 * exported, but not yet wired into either adapter's call sequence — that is
 * a necessary follow-up outside this task's file anchors, named in its
 * completion report). `exitCode(refusal)` is therefore the SAME numeric
 * answer `process.exitCode` would carry the moment either adapter adds its
 * one new call — this file measures the decision function directly rather
 * than a real subprocess exit code, but through the identical mapping
 * function the real CLI surface uses.
 *
 * ⛔ Load-bearing CONTROL (per this task's own dispatch instructions): a
 * "refuse every piped command unconditionally" implementation would ALSO
 * pass every NEGATIVE-dimension assertion below. PIPE-H1 is what catches
 * that — it asserts the IDENTICAL command string refuses without `--capture`
 * AND returns `null` (proceeds) WITH `--capture`, in the SAME test. A
 * blanket-refusal implementation fails the `--capture` half of PIPE-H1.
 *
 * Quote/`||` boundary (explicit dispatch requirement — "do not leave this as
 * unstated behavior"): a `|` inside a quoted run (`grep 'a|b'`) is a LITERAL
 * character, not a shell operator — PIPE-B1 pins this as NOT refused. A `||`
 * logical-OR is not a pipeline at all (`$?` belongs unambiguously to
 * whichever branch ran) — PIPE-B2 pins this as NOT refused too.
 *
 * Six-dimension coverage:
 *   HAPPY      — PIPE-H1: the load-bearing capture control (see above)
 *   NEGATIVE   — PIPE-N1: an unquoted pipe with no --capture refuses,
 *                naming the pipe and the mechanism; PIPE-N2: a pipe buried
 *                mid-chain (`cmd1 | cmd2 && cmd3`) still refuses
 *   BOUNDARY   — PIPE-B1: a quoted pipe (`grep 'a|b'`) is NOT refused;
 *                PIPE-B2: a `||` logical OR is NOT refused; PIPE-B3: a
 *                leading/trailing edge pipe with no adjacent `|` still counts
 *                as unsafe (scan doesn't require whitespace around it)
 *   ERROR      — PIPE-E1: every refusal is VALIDATION_ERROR mapping to exit
 *                code 4 via the SAME `exitCode()` every other guard's
 *                refusal in this module maps through
 *   STATE      — PIPE-S1: `commandHasUnsafePipe` is a PURE function — calling
 *                it twice on the same input yields the same answer (no
 *                hidden mutable state / no memoization drift)
 *   REGRESSION — PIPE-R1: every existing out-of-scope combination this
 *                module's other guards already leave alone (fail/expected-
 *                fail results, non-test/e2e oracles) is untouched by this
 *                guard too, pipe or no pipe
 *
 * @spec_ref task-refuse-a-self-reported-evidence-command-containing-a-shell
 */

import { describe, it, expect } from "bun:test";
import {
  commandHasUnsafePipe,
  findPipeRefusal,
} from "../../../src/adapters/cli/evidence-precheck.js";
import { exitCode } from "../../../src/adapters/cli/utils.js";

const PIPED_COMMAND = "bun run test:changed abc123 2>&1 | tail -100";

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("findPipeRefusal — HAPPY", () => {
  it("PIPE-H1: pipe-refusal — a self-reported pass with an unquoted pipe refuses (exit 4), while --capture on the IDENTICAL command returns null (exit 0)", () => {
    const withoutCapture = findPipeRefusal({
      oracle: "test",
      result: "pass",
      command: PIPED_COMMAND,
      capture: false,
    });
    if (withoutCapture === null) throw new Error("expected a refusal, got null");
    expect(withoutCapture.code).toBe("VALIDATION_ERROR");
    expect(exitCode(withoutCapture)).toBe(4);

    // load-bearing control: SAME command string, --capture measures the real
    // exit code itself, so the pipe hazard does not apply — a blanket
    // "refuse every pipe" implementation fails THIS half.
    const withCapture = findPipeRefusal({
      oracle: "test",
      result: "pass",
      command: PIPED_COMMAND,
      capture: true,
    });
    expect(withCapture).toBeNull();
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("findPipeRefusal — NEGATIVE", () => {
  it("PIPE-N1: names the pipe and the last-stage-exit-code mechanism in the refusal message", () => {
    const refusal = findPipeRefusal({
      oracle: "test",
      result: "pass",
      command: PIPED_COMMAND,
      capture: false,
    });
    if (refusal === null) throw new Error("expected a refusal, got null");
    if (refusal.code !== "VALIDATION_ERROR") {
      throw new Error(`expected VALIDATION_ERROR, got ${refusal.code}`);
    }
    expect(refusal.field).toBe("command");
    expect(refusal.message).toContain(PIPED_COMMAND);
    expect(refusal.message.toLowerCase()).toContain("last stage");
    expect(refusal.message).toContain("--capture");
  });

  it("PIPE-N2: a pipe buried mid-chain still refuses", () => {
    const refusal = findPipeRefusal({
      oracle: "e2e",
      result: "pass",
      command: "bun run build && bun test foo.bun.test.ts | tail -50 && echo done",
      capture: false,
    });
    expect(refusal).not.toBeNull();
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("findPipeRefusal — BOUNDARY", () => {
  it("PIPE-B1: a pipe INSIDE a quoted run (grep 'a|b') is a literal character, never refused", () => {
    expect(commandHasUnsafePipe("grep 'a|b' file.ts")).toBe(false);
    const result = findPipeRefusal({
      oracle: "test",
      result: "pass",
      command: "grep 'a|b' file.ts",
      capture: false,
    });
    expect(result).toBeNull();
  });

  it("PIPE-B2: a logical OR (||) is not a pipeline and is never refused", () => {
    expect(commandHasUnsafePipe("bun run lint || bun run lint:fix")).toBe(false);
    const result = findPipeRefusal({
      oracle: "test",
      result: "pass",
      command: "bun run lint || bun run lint:fix",
      capture: false,
    });
    expect(result).toBeNull();
  });

  it("PIPE-B3: a bare pipe with no surrounding whitespace is still detected as unsafe", () => {
    expect(commandHasUnsafePipe("a|b")).toBe(true);
  });

  it("PIPE-B4: a double-quoted pipe and a backtick-quoted pipe are both treated as literal", () => {
    expect(commandHasUnsafePipe('echo "a|b"')).toBe(false);
    expect(commandHasUnsafePipe("echo `a|b`")).toBe(false);
  });

  it("PIPE-B5: a command with NO pipe at all is never refused", () => {
    expect(commandHasUnsafePipe("bun run typecheck")).toBe(false);
    const result = findPipeRefusal({
      oracle: "test",
      result: "pass",
      command: "bun run typecheck",
      capture: false,
    });
    expect(result).toBeNull();
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("findPipeRefusal — ERROR", () => {
  it("PIPE-E1: every refusal is VALIDATION_ERROR, mapping to exit code 4", () => {
    const commands = [
      PIPED_COMMAND,
      "a | b",
      "bun run x | grep foo | wc -l",
    ];
    for (const command of commands) {
      const refusal = findPipeRefusal({
        oracle: "test",
        result: "pass",
        command,
        capture: false,
      });
      if (refusal === null) throw new Error(`expected a refusal for command: ${command}`);
      expect(refusal.code).toBe("VALIDATION_ERROR");
      expect(exitCode(refusal)).toBe(4);
    }
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("findPipeRefusal — STATE", () => {
  it("PIPE-S1: commandHasUnsafePipe is pure — repeated calls on the same input agree", () => {
    expect(commandHasUnsafePipe(PIPED_COMMAND)).toBe(true);
    expect(commandHasUnsafePipe(PIPED_COMMAND)).toBe(true);
    expect(commandHasUnsafePipe(PIPED_COMMAND)).toBe(true);

    expect(commandHasUnsafePipe("grep 'a|b'")).toBe(false);
    expect(commandHasUnsafePipe("grep 'a|b'")).toBe(false);
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("findPipeRefusal — REGRESSION", () => {
  it("PIPE-R1: out-of-scope oracle kinds are untouched, pipe or no pipe", () => {
    for (const oracle of ["tsc", "lint", "build", "manual", "other"]) {
      const result = findPipeRefusal({
        oracle,
        result: "pass",
        command: PIPED_COMMAND,
        capture: false,
      });
      expect(result).toBeNull();
    }
  });

  it("PIPE-R2: out-of-scope results (fail / expected-fail) are untouched, pipe or no pipe", () => {
    for (const result of ["fail", "expected-fail"]) {
      const refusal = findPipeRefusal({
        oracle: "test",
        result,
        command: PIPED_COMMAND,
        capture: false,
      });
      expect(refusal).toBeNull();
    }
  });

  it("PIPE-R3: an e2e oracle claiming pass is in scope, same as test", () => {
    const refusal = findPipeRefusal({
      oracle: "e2e",
      result: "pass",
      command: PIPED_COMMAND,
      capture: false,
    });
    expect(refusal).not.toBeNull();
  });
});
