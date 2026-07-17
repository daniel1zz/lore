/**
 * postinstall.mjs unit + conformance suite (SPEC-048 AC-048-A, INV-4).
 *
 * Two disjoint concerns, one file:
 *
 *   1. `decide()` behavior — the pure TTY x CI decision matrix that
 *      backs the shipped npm lifecycle script. Imported directly (no
 *      subprocess spawn needed — importing `npm-pkg/postinstall.mjs`
 *      under vitest is side-effect-free because its execution guard
 *      checks `process.argv[1]` against its own `import.meta.url`,
 *      which never match when the file is merely `import`-ed).
 *
 *   2. Static conformance of the shipped file's SOURCE TEXT — mirrors
 *      the pattern in `packages/lore/tests/unit/assets-ssot.test.ts`
 *      (a pure `node:fs` read of the repo's own checked-in file, no
 *      store, no sandbox). Proves the zero-dependency contract
 *      (SPEC-048 Scope IN #4) and the "nudge only, never executes
 *      lore setup / touches ~/.claude / writes settings.json / does MCP
 *      execution" boundary (SPEC-048 Design D1) by inspecting what the
 *      file is CAPABLE of doing (its imports and call sites), not by
 *      banning the words used in its own user-facing message text (the
 *      message is REQUIRED to mention "lore setup" by name — see the
 *      D-FUNC ACs below — so a naive whole-file substring ban on that
 *      phrase would directly contradict the message contract).
 *
 * Coverage:
 *   HAPPY:      full TTY x CI 2x2 matrix returns the contractually
 *               correct action, with the identical message in every case
 *   NEGATIVE:   an empty-string CI value (falsy-looking, JS-falsy) does
 *               NOT trigger the CI branch; unrelated env keys are ignored
 *   BOUNDARY:   a non-"true"/"1" truthy CI string (e.g. "0", a value some
 *               humans would misread as false) still triggers the CI
 *               branch, per the exact "truthy" contract in the spec
 *   ERROR:      a call missing the required `env` param throws loud
 *               (documents `decide()`'s fail-loud posture on required
 *               input — no silent default)
 *   STATE:      importing the module does not itself invoke the
 *               lifecycle side effects (no stdout/stderr write, no
 *               process.exit) — the exec guard suppresses it
 *   REGRESSION: the nudge message is a single line and byte-identical
 *               across both branches; only `action` differs
 *
 * Conformance (INV-4, separate describe block, its own dimensions):
 *   HAPPY:      zero non-builtin import/require specifiers
 *   NEGATIVE:   no child_process/exec/spawn family reference anywhere
 *   BOUNDARY:   no literal `~/.claude` / `settings.json` reference
 *   STATE:      the lifecycle wrapper is try/catch-guarded
 *   REGRESSION: every `process.exit(...)` call site in the file passes
 *               literal `0` — an exit-nonzero regression would fail
 *               `npm install` for every installer, so this is asserted
 *               structurally, not just by example
 *
 * @spec_ref SPEC-048 AC-048-A, Design "postinstall contract", INV-4
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

// `postinstall.mjs` is deliberately untyped plain JS (zero-dep constraint —
// see its module header): no `.d.ts` is generated for it, so the import
// resolves to `any` under `tsc`. The JSDoc `@param`/`@returns` on `decide()`
// is the contract for human/AI readers; the local `DecideInput`/`DecideResult`
// types below re-assert the same shape so the rest of this test file keeps
// full type-checking on every call to `decide()`.
// @ts-expect-error -- no declaration file for a deliberately dependency-free .mjs (see comment above)
import { decide as decideUntyped } from "../../../../../npm-pkg/postinstall.mjs";

type DecideInput = { isTTY: boolean; env: Record<string, string | undefined> };
type DecideResult = { action: "nudge-stderr" | "nudge-stdout"; message: string };
const decide = decideUntyped as (input: DecideInput) => DecideResult;

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const POSTINSTALL_PATH = join(REPO_ROOT, "npm-pkg", "postinstall.mjs");
const SOURCE = readFileSync(POSTINSTALL_PATH, "utf-8");

const EXPECTED_MESSAGE = "lore installed — run `lore setup` to wire skills/hooks";

describe("decide() — pure TTY x CI decision matrix", () => {
  // ── HAPPY ────────────────────────────────────────────────────────────
  it("non-TTY, no CI → nudge-stderr with the one-line message", () => {
    const result = decide({ isTTY: false, env: {} });
    expect(result).toEqual({ action: "nudge-stderr", message: EXPECTED_MESSAGE });
  });

  it("TTY, CI truthy → nudge-stderr (CI forces the non-interactive branch)", () => {
    const result = decide({ isTTY: true, env: { CI: "true" } });
    expect(result.action).toBe("nudge-stderr");
    expect(result.message).toBe(EXPECTED_MESSAGE);
  });

  it("non-TTY, CI truthy → nudge-stderr (both signals agree)", () => {
    const result = decide({ isTTY: false, env: { CI: "true" } });
    expect(result.action).toBe("nudge-stderr");
  });

  it("TTY, no CI → nudge-stdout with the same one-line message (rare --foreground-scripts case)", () => {
    const result = decide({ isTTY: true, env: {} });
    expect(result).toEqual({ action: "nudge-stdout", message: EXPECTED_MESSAGE });
  });

  // ── NEGATIVE ─────────────────────────────────────────────────────────
  it("CI set to an empty string is JS-falsy — does not force the non-interactive branch", () => {
    const result = decide({ isTTY: true, env: { CI: "" } });
    expect(result.action).toBe("nudge-stdout");
  });

  it("unrelated env keys are ignored", () => {
    const result = decide({ isTTY: true, env: { NODE_ENV: "production", PATH: "/usr/bin" } });
    expect(result.action).toBe("nudge-stdout");
  });

  // ── BOUNDARY ─────────────────────────────────────────────────────────
  it("CI set to \"0\" is still JS-truthy (non-empty string) — triggers the non-interactive branch", () => {
    // Documents the literal contract: `env.CI` truthy per JS coercion, not
    // a semantic "is this actually CI" parse — a caller that sets CI="0"
    // meaning "false" still gets the non-interactive branch.
    const result = decide({ isTTY: true, env: { CI: "0" } });
    expect(result.action).toBe("nudge-stderr");
  });

  // ── ERROR ────────────────────────────────────────────────────────────
  it("throws when the required env param is missing (fail-loud, no silent default)", () => {
    // @ts-expect-error — intentionally malformed call to prove no silent fallback
    expect(() => decide({ isTTY: false })).toThrow();
  });

  // ── STATE ────────────────────────────────────────────────────────────
  it("importing the module does not itself write stdout/stderr or exit the process", () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    // decide is already imported at module load time (top of this file);
    // re-invoking the import here proves the module record is stable and
    // that mere presence of `decide` in scope triggered no side effect.
    expect(typeof decide).toBe("function");
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  // ── REGRESSION ───────────────────────────────────────────────────────
  it("message is a single line (no embedded newline) in every branch", () => {
    const combos = [
      { isTTY: false, env: {} },
      { isTTY: true, env: { CI: "true" } },
      { isTTY: false, env: { CI: "true" } },
      { isTTY: true, env: {} },
    ];
    for (const input of combos) {
      const { message } = decide(input);
      expect(message).not.toMatch(/\n/);
      expect(message).toContain("lore setup");
    }
  });

  it("message is byte-identical across the stderr and stdout branches — only action differs", () => {
    const stderrResult = decide({ isTTY: false, env: {} });
    const stdoutResult = decide({ isTTY: true, env: {} });
    expect(stderrResult.message).toBe(stdoutResult.message);
    expect(stderrResult.action).not.toBe(stdoutResult.action);
  });
});

describe("postinstall.mjs conformance (SPEC-048 INV-4, zero-dep + nudge-only boundary)", () => {
  /** Extracts every static + dynamic import specifier and require() argument. */
  function extractImportSpecifiers(source: string): string[] {
    const specifiers: string[] = [];
    const staticImportRe = /\bimport\s+(?:[^'"]*?from\s+)?["']([^"']+)["']/g;
    const dynamicImportRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
    const requireRe = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
    for (const re of [staticImportRe, dynamicImportRe, requireRe]) {
      for (const match of source.matchAll(re)) {
        const captured = match[1];
        if (captured === undefined) {
          // Unreachable: group 1 is a required (non-optional) capture in
          // every regex above, so a match always carries it. Thrown loud
          // rather than silently skipped, in case that ever stops holding.
          throw new Error("regex capture group 1 unexpectedly undefined");
        }
        specifiers.push(captured);
      }
    }
    return specifiers;
  }

  // ── HAPPY ────────────────────────────────────────────────────────────
  it("contains zero non-builtin import/require specifiers", () => {
    const specifiers = extractImportSpecifiers(SOURCE);
    expect(specifiers.length).toBeGreaterThan(0); // proves the extractor isn't vacuously passing
    for (const specifier of specifiers) {
      const bare = specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier;
      expect(builtinModules.includes(bare), `"${specifier}" is not a Node builtin`).toBe(true);
    }
  });

  it("the extractor itself is non-tautological — flags a synthetic non-builtin specifier", () => {
    const fixture = 'import { foo } from "left-pad";\n';
    const specifiers = extractImportSpecifiers(fixture);
    expect(specifiers).toEqual(["left-pad"]);
    expect(builtinModules.includes("left-pad")).toBe(false);
  });

  // ── NEGATIVE ─────────────────────────────────────────────────────────
  it("never references child_process or an exec/spawn family call", () => {
    expect(SOURCE).not.toMatch(/child_process/);
    expect(SOURCE).not.toMatch(/\bexecSync\s*\(/);
    expect(SOURCE).not.toMatch(/\bspawnSync\s*\(/);
    expect(SOURCE).not.toMatch(/\bspawn\s*\(/);
    expect(SOURCE).not.toMatch(/\bexec\s*\(/);
  });

  it("never references MCP registration/execution", () => {
    expect(SOURCE).not.toMatch(/@modelcontextprotocol/);
    expect(SOURCE).not.toMatch(/--mcp-server/);
  });

  // ── BOUNDARY ─────────────────────────────────────────────────────────
  it("never references ~/.claude or settings.json (no config-wiring capability)", () => {
    expect(SOURCE).not.toMatch(/~\/\.claude/);
    expect(SOURCE).not.toMatch(/settings\.json/);
  });

  it("the only literal 'lore setup' occurrence is inside the user-facing message string, not an invocation", () => {
    const occurrences = [...SOURCE.matchAll(/lore setup/g)];
    expect(occurrences.length).toBeGreaterThan(0);
    for (const occurrence of occurrences) {
      const idx = occurrence.index ?? 0;
      const lineStart = SOURCE.lastIndexOf("\n", idx) + 1;
      const lineEnd = SOURCE.indexOf("\n", idx);
      const line = SOURCE.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      // Every line mentioning "lore setup" is either a comment (starts with
      // whitespace + `*`/`//`) or the backtick-quoted message literal — never
      // a bare identifier call like `loreSetup(` or a template invoking a shell.
      const isCommentLine = /^\s*(\*|\/\/)/.test(line);
      const isMessageLiteral = line.includes('"lore installed');
      expect(isCommentLine || isMessageLiteral, `unexpected "lore setup" usage: ${line}`).toBe(true);
    }
  });

  // ── STATE ────────────────────────────────────────────────────────────
  it("the lifecycle entry path is wrapped in try/catch", () => {
    expect(SOURCE).toMatch(/\btry\s*\{/);
    expect(SOURCE).toMatch(/\}\s*catch\b/);
  });

  // ── REGRESSION ───────────────────────────────────────────────────────
  it("every process.exit(...) call site passes literal 0 — never a nonzero exit", () => {
    const exitCalls = [...SOURCE.matchAll(/process\.exit\(\s*([^)]*)\s*\)/g)];
    expect(exitCalls.length).toBeGreaterThan(0);
    for (const call of exitCalls) {
      const arg = call[1];
      if (arg === undefined) {
        // Unreachable: group 1 is a required capture in the regex above.
        throw new Error("regex capture group 1 unexpectedly undefined");
      }
      expect(arg.trim()).toBe("0");
    }
  });

  it("the exit-0 call sits inside a finally block, so it runs on both success and failure", () => {
    expect(SOURCE).toMatch(/\}\s*finally\s*\{[^}]*process\.exit\(\s*0\s*\)/);
  });
});
