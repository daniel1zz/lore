// @spawns assets/hooks/stop-handoff-coverage.mjs
/**
 * stop-handoff-coverage.test.ts — AC-RC-10 for
 * `assets/hooks/stop-handoff-coverage.mjs`
 * (spec-resume-ticket-coverage-a-shipped-upper-bound-left-the D9), task
 * task-t5-stop-handoff-coverage-hook-as-blind-pipe (T5).
 *
 * The property under test is a NEGATIVE one — the hook holds no grammar — plus
 * a relay-fidelity one: whatever `lore handoff coverage-check` decides is what
 * the hook reports. Both halves live under the `blind pipe` describe so the
 * AC's own oracle (`-t "blind pipe"`) matches them.
 *
 * ## Why the grammar tokens are DISCOVERED, never hand-copied
 *
 * A hand-written array of token literals silently stops covering a constant
 * that gets renamed or re-valued in `packages/core/src/session.ts` — the
 * "zero-match reads as pass" false-oracle vector this repo has measured five
 * times. Two independent derivations are combined instead:
 *
 *   1. `Object.entries(loreCore)` filtered by `GRAMMAR_EXPORT_NAME_PATTERN` —
 *      a namespace scan, so a NEW grammar constant added to the barrel is
 *      covered without touching this file.
 *   2. Five explicit named imports asserted to be MEMBERS of that scan — an
 *      identity reference, so a rename breaks the import (loud) and a pattern
 *      that stopped matching breaks the membership assertion (also loud).
 *
 * Neither derivation contains a token VALUE literal. The control assertions
 * (`>= EXPECTED_GRAMMAR_TOKEN_FLOOR` tokens discovered, hook source non-empty
 * and naming the verb) exist because "0 tokens searched for in a 0-byte file"
 * would otherwise pass vacuously — spec D7's live-detector requirement.
 *
 * ## Why matching is case-SENSITIVE
 *
 * The tokens are exact literals (`"KD"`, `"NS"`, `"done"`, …), and a
 * case-insensitive search is not merely stricter but IMPOSSIBLE to satisfy:
 * the hook must reference `transcript_path`, and "tra-ns-cript" carries "ns".
 * Grammar presence therefore means the exact literal, which is also what the
 * verb's parser keys on.
 *
 * ## Fixture shape
 *
 * Every case spawns the REAL checked-in hook file as a subprocess against a
 * throwaway `mkdtemp` dir holding an executable `lore` stub earlier on `PATH`
 * (the pattern proven by `hooks/session-start-freshness.test.ts`). No corpus,
 * no `.lore/`, no repo-tree writes — the hook is a pipe, so a scripted stub
 * fully characterizes its counterpart. The stub records its own argv and its
 * own stdin to files, which is what lets a test distinguish "the hook relayed
 * the verb's exit 0" from "the hook never invoked the verb at all".
 *
 * The hook is launched via `process.execPath` (absolute) rather than the name
 * `node`, so a test may set `PATH` to a directory containing no interpreter at
 * all in order to exercise the "verb binary absent" fault path.
 *
 * Six-dimension coverage:
 *   HAPPY:      verb exits 0 -> hook exits 0 with empty stderr; the two
 *               authoritative read channels arrive at the verb's stdin
 *   NEGATIVE:   AC-RC-10 grammar half (zero hits for every discovered token);
 *               malformed / empty / non-object stdin fail LOUD (never exit 0,
 *               and never reach the verb)
 *   BOUNDARY:   `stop_hook_active: false` still invokes the verb (proves the
 *               passthrough keys on the value `true`, not on field presence);
 *               a payload with no `last_assistant_message` forwards the key as
 *               ABSENT rather than substituting a default
 *   ERROR:      the verb binary missing from `PATH` -> loud non-zero, never a
 *               silent exit 0
 *   STATE:      the forwarded payload carries EXACTLY the two channels — the
 *               Stop payload's other fields (`session_id`, `cwd`,
 *               `stop_hook_active`) do not leak through
 *   REGRESSION: AC-RC-10 relay half — exit 3 plus its stderr verbatim, and
 *               three further arbitrary codes the hook has no special
 *               knowledge of, proving no code is special-cased
 *
 * @spec_ref spec-resume-ticket-coverage-a-shipped-upper-bound-left-the
 *   §Design Decisions D9; AC-RC-10
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import * as loreCore from "@lore/core";
import {
  RESUME_COVERAGE_FLOOR,
  RESUME_DISPOSITION_DEFERRED_PREFIX,
  RESUME_DISPOSITION_DONE,
  RESUME_DISPOSITION_MARKER,
  RESUME_ITEM_ID_PREFIX_KEY_DECISION,
  RESUME_ITEM_ID_PREFIX_NEXT_STEP,
} from "@lore/core";

// packages/lore/tests/unit/stop-handoff-coverage.test.ts -> repo root is 4 levels up.
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const HOOK_PATH = join(REPO_ROOT, "assets", "hooks", "stop-handoff-coverage.mjs");

if (!existsSync(HOOK_PATH)) {
  throw new Error(`test fixture bug: resolved HOOK_PATH does not exist: ${HOOK_PATH}`);
}

/** Names of the `@lore/core` exports that constitute the ticket/disposition grammar D9 forbids the hook from carrying. Scanned rather than listed by value — see this file's header. */
const GRAMMAR_EXPORT_NAME_PATTERN = /^RESUME_(?:ITEM_ID_PREFIX|DISPOSITION)_[A-Z0-9_]+$/;

/**
 * Minimum number of grammar tokens the namespace scan must discover. Five
 * exist today (two item-id prefixes, three disposition tokens); this is a
 * FLOOR, not an equality, so adding a sixth constant does not fail the test
 * while a pattern that silently matched nothing does.
 */
const EXPECTED_GRAMMAR_TOKEN_FLOOR = 5;

/** Every grammar constant reachable from the barrel, as `[exportName, tokenValue]`. */
function discoverGrammarTokens(): ReadonlyArray<readonly [string, string]> {
  return Object.entries(loreCore as Record<string, unknown>)
    .filter((entry): entry is [string, string] => GRAMMAR_EXPORT_NAME_PATTERN.test(entry[0]) && typeof entry[1] === "string")
    .sort((a, b) => a[0].localeCompare(b[0]));
}

const scratchDirs: string[] = [];

function mkScratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

interface StubSpec {
  /** Exit status the stub terminates with — relayed verbatim by a correct hook. */
  readonly exitCode: number;
  /** Written to the stub's stdout with no trailing newline. Must contain no single quote (it is embedded in a `sh` single-quoted literal). */
  readonly stdoutText?: string;
  /** Written to the stub's stderr with no trailing newline. Same quoting constraint. */
  readonly stderrText?: string;
}

interface Stub {
  /** Directory to prepend to `PATH` so this stub wins over any real `lore`. */
  readonly dir: string;
  /** Absolute path of the file the stub writes its space-joined argv to. Absent until the stub actually runs. */
  readonly argvLogPath: string;
  /** Absolute path of the file the stub `cat`s its own stdin into. Absent until the stub actually runs. */
  readonly stdinLogPath: string;
}

/**
 * Writes an executable `lore` stub whose behaviour is fully scripted, plus two
 * side-channel log files. Log-file ABSENCE is the oracle for "the hook never
 * invoked the verb", which is what separates a genuine passthrough from a hook
 * that merely happened to exit 0.
 */
function writeLoreStub(spec: StubSpec): Stub {
  const dir = mkScratchDir("stop-coverage-stub-");
  const argvLogPath = join(dir, "argv.log");
  const stdinLogPath = join(dir, "stdin.json");
  const stubPath = join(dir, "lore");
  const stdoutLine = spec.stdoutText === undefined ? "" : `printf '%s' '${spec.stdoutText}'\n`;
  const stderrLine = spec.stderrText === undefined ? "" : `printf '%s' '${spec.stderrText}' >&2\n`;
  writeFileSync(
    stubPath,
    `#!/bin/sh
printf '%s' "$*" > '${argvLogPath}'
cat > '${stdinLogPath}'
${stdoutLine}${stderrLine}exit ${spec.exitCode}
`,
  );
  chmodSync(stubPath, 0o755);
  return { dir, argvLogPath, stdinLogPath };
}

interface RunResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Spawns the real hook with `stdinText` on its stdin and `pathDirs` prepended
 * to `PATH`. `stdinText` is a raw string (not an object) so malformed and empty
 * payloads are expressible.
 */
function runHook(stdinText: string, pathDirs: readonly string[], pathMode: "prepend" | "replace" = "prepend"): RunResult {
  const basePath = process.env.PATH ?? "";
  const path = pathMode === "replace" ? pathDirs.join(":") : [...pathDirs, basePath].filter((p) => p.length > 0).join(":");
  const result = spawnSync(process.execPath, [HOOK_PATH], {
    input: stdinText,
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, PATH: path },
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** A realistic Stop payload. `transcript_path` need not exist on disk — the stub never reads it, and the hook must not either. */
function stopPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: "session-fixture-0001",
    transcript_path: "/tmp/stop-coverage-fixture/transcript.jsonl",
    last_assistant_message: "Report body.\nSecond line.",
    cwd: "/tmp/stop-coverage-fixture",
    ...overrides,
  };
}

describe("stop-handoff-coverage.mjs", () => {
  describe("AC-RC-10 — the hook is a blind pipe", () => {
    it("carries zero grammar: no discovered item-id prefix or disposition token appears in its source", () => {
      const hookSource = readFileSync(HOOK_PATH, "utf8");
      const tokens = discoverGrammarTokens();

      // Control 1 — the detector is live: the scan found tokens, and the file it
      // searches has content and really is the coverage hook. Without these,
      // "0 hits" is indistinguishable from "0 things searched in a 0-byte file".
      expect(tokens.length).toBeGreaterThanOrEqual(EXPECTED_GRAMMAR_TOKEN_FLOOR);
      expect(hookSource.length).toBeGreaterThan(0);
      expect(hookSource).toContain("coverage-check");

      // Control 2 — the scan covers the five constants this AC names, asserted by
      // identity reference rather than by value literal: a rename breaks the
      // import above, a broken pattern breaks this membership check.
      const discovered = new Map(tokens);
      for (const [name, expectedValue] of [
        ["RESUME_ITEM_ID_PREFIX_KEY_DECISION", RESUME_ITEM_ID_PREFIX_KEY_DECISION],
        ["RESUME_ITEM_ID_PREFIX_NEXT_STEP", RESUME_ITEM_ID_PREFIX_NEXT_STEP],
        ["RESUME_DISPOSITION_MARKER", RESUME_DISPOSITION_MARKER],
        ["RESUME_DISPOSITION_DONE", RESUME_DISPOSITION_DONE],
        ["RESUME_DISPOSITION_DEFERRED_PREFIX", RESUME_DISPOSITION_DEFERRED_PREFIX],
      ] as const) {
        expect(discovered.get(name), `grammar scan must cover ${name}`).toBe(expectedValue);
      }

      // The assertion itself.
      for (const [name, token] of tokens) {
        expect(hookSource.includes(token), `hook source must not carry grammar token ${name} (${JSON.stringify(token)})`).toBe(false);
      }

      // The floor declaration quotes every token above, so its absence is implied
      // — asserted anyway because it is the one string whose presence would mean
      // the hook had started explaining the grammar rather than relaying it.
      expect(hookSource.includes(RESUME_COVERAGE_FLOOR)).toBe(false);
    });

    it("relays the verb's exit code 3 and reproduces its stderr verbatim", () => {
      const stderrText = "STUB_MARKER: the verb refused, item accounting incomplete";
      const stub = writeLoreStub({ exitCode: 3, stderrText });

      const result = runHook(JSON.stringify(stopPayload()), [stub.dir]);

      expect(result.signal).toBeNull();
      expect(result.status).toBe(3);
      // Exact equality, not `toContain`: verbatim means the hook added nothing of
      // its own to the channel the verb used to explain itself.
      expect(result.stderr).toBe(stderrText);
      // Control — the verb really ran; exit 3 did not come from the hook itself.
      expect(existsSync(stub.argvLogPath)).toBe(true);
      expect(readFileSync(stub.argvLogPath, "utf8")).toBe("handoff coverage-check");
    });

    it.each([1, 5, 42])("relays exit code %i unchanged, a code it has no special knowledge of", (exitCode) => {
      const stub = writeLoreStub({ exitCode, stderrText: `STUB_MARKER: exit ${exitCode}` });

      const result = runHook(JSON.stringify(stopPayload()), [stub.dir]);

      expect(result.signal).toBeNull();
      expect(result.status).toBe(exitCode);
      expect(result.stderr).toBe(`STUB_MARKER: exit ${exitCode}`);
    });

    it("relays the verb's stdout verbatim alongside a non-zero status", () => {
      const stdoutText = '{"stub_stdout":true}';
      const stub = writeLoreStub({ exitCode: 4, stdoutText, stderrText: "STUB_MARKER: stderr too" });

      const result = runHook(JSON.stringify(stopPayload()), [stub.dir]);

      expect(result.status).toBe(4);
      expect(result.stdout).toBe(stdoutText);
      expect(result.stderr).toBe("STUB_MARKER: stderr too");
    });

    it("relays a clean verb verdict as exit 0 with nothing written to either channel", () => {
      const stub = writeLoreStub({ exitCode: 0 });

      const result = runHook(JSON.stringify(stopPayload()), [stub.dir]);

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      // Control — exit 0 is the RELAYED verdict, not a hook that skipped the verb.
      expect(existsSync(stub.argvLogPath)).toBe(true);
    });

    it("forwards exactly the two authoritative read channels and no other Stop payload field", () => {
      const stub = writeLoreStub({ exitCode: 0 });
      const payload = stopPayload();

      const result = runHook(JSON.stringify(payload), [stub.dir]);

      expect(result.status).toBe(0);
      expect(existsSync(stub.stdinLogPath)).toBe(true);
      const forwarded = JSON.parse(readFileSync(stub.stdinLogPath, "utf8")) as Record<string, unknown>;
      expect(forwarded).toEqual({
        transcript_path: payload.transcript_path,
        last_assistant_message: payload.last_assistant_message,
      });
      // Redundant with toEqual, but states the leak this asserts against.
      expect(Object.keys(forwarded).sort()).toEqual(["last_assistant_message", "transcript_path"]);
    });
  });

  describe("passthrough, payload boundary, and fault paths", () => {
    it("exits 0 without invoking the verb when stop_hook_active is true", () => {
      const stub = writeLoreStub({ exitCode: 3, stderrText: "STUB_MARKER: must never run" });

      const result = runHook(JSON.stringify(stopPayload({ stop_hook_active: true })), [stub.dir]);

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      // The whole point of the passthrough: no child process at all.
      expect(existsSync(stub.argvLogPath)).toBe(false);
    });

    it("still invokes the verb when stop_hook_active is false — the passthrough keys on the value, not field presence", () => {
      const stub = writeLoreStub({ exitCode: 3, stderrText: "STUB_MARKER: ran as expected" });

      const result = runHook(JSON.stringify(stopPayload({ stop_hook_active: false })), [stub.dir]);

      expect(result.status).toBe(3);
      expect(result.stderr).toBe("STUB_MARKER: ran as expected");
      expect(existsSync(stub.argvLogPath)).toBe(true);
    });

    it("fails loud on malformed stdin instead of degrading to exit 0", () => {
      const stub = writeLoreStub({ exitCode: 0 });

      const result = runHook("{not valid json", [stub.dir]);

      expect(result.status).not.toBe(0);
      expect(result.status).not.toBeNull();
      expect(result.stderr.length).toBeGreaterThan(0);
      expect(result.stderr).toContain("stop-handoff-coverage");
      // A payload it could not read must not be forwarded as if it were empty.
      expect(existsSync(stub.argvLogPath)).toBe(false);
    });

    it("fails loud on empty stdin instead of degrading to exit 0", () => {
      const stub = writeLoreStub({ exitCode: 0 });

      const result = runHook("", [stub.dir]);

      expect(result.status).not.toBe(0);
      expect(result.status).not.toBeNull();
      expect(result.stderr).toContain("stop-handoff-coverage");
      expect(existsSync(stub.argvLogPath)).toBe(false);
    });

    it.each(["42", '"a string payload"', "null", "[]"])("fails loud when stdin parses to the non-object payload %s", (stdinText) => {
      const stub = writeLoreStub({ exitCode: 0 });

      const result = runHook(stdinText, [stub.dir]);

      expect(result.status).not.toBe(0);
      expect(result.status).not.toBeNull();
      expect(result.stderr).toContain("stop-handoff-coverage");
      expect(existsSync(stub.argvLogPath)).toBe(false);
    });

    it("forwards a missing last_assistant_message as an ABSENT key, never as a substituted default", () => {
      const stub = writeLoreStub({ exitCode: 0 });
      const payload = stopPayload();
      delete payload.last_assistant_message;

      const result = runHook(JSON.stringify(payload), [stub.dir]);

      expect(result.status).toBe(0);
      expect(existsSync(stub.stdinLogPath)).toBe(true);
      const forwarded = JSON.parse(readFileSync(stub.stdinLogPath, "utf8")) as Record<string, unknown>;
      expect(Object.keys(forwarded)).toEqual(["transcript_path"]);
      expect(forwarded.transcript_path).toBe(payload.transcript_path);
    });

    it("forwards a missing transcript_path as an ABSENT key too, leaving the verdict to the verb", () => {
      const stub = writeLoreStub({ exitCode: 0 });
      const payload = stopPayload();
      delete payload.transcript_path;

      const result = runHook(JSON.stringify(payload), [stub.dir]);

      expect(result.status).toBe(0);
      const forwarded = JSON.parse(readFileSync(stub.stdinLogPath, "utf8")) as Record<string, unknown>;
      expect(Object.keys(forwarded)).toEqual(["last_assistant_message"]);
    });

    it("fails loud when the verb binary is absent from PATH instead of silently exiting 0", () => {
      const emptyDir = mkScratchDir("stop-coverage-nopath-");

      const result = runHook(JSON.stringify(stopPayload()), [emptyDir], "replace");

      expect(result.status).not.toBe(0);
      expect(result.status).not.toBeNull();
      expect(result.stderr).toContain("stop-handoff-coverage");
    });
  });
});
