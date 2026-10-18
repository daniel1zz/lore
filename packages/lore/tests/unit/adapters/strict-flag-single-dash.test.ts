/**
 * Unit tests for SPEC-073 (strict-flag hardening: single-dash multi-char
 * tokens fail loud + double-dash alias help rendering). Pure — no
 * `bun:sqlite`, no real command modules, no live `lore verify` execution —
 * uses synthetic `citty` `ArgsDef`/`CommandDef` fixtures (mirroring the
 * REAL declarations in `commands/list.ts` and `commands/verify.ts` at the
 * time this suite was written) so this suite runs under vitest without a
 * compiled binary or a real corpus.
 *
 * Coverage:
 *   HAPPY:      -json / -yes rejected with the correct suggestion;
 *               fixSingleDashAliasRendering turns -yes into --yes
 *   NEGATIVE:   -yes maps to allow-new-commands under citty's OWN parseArgs
 *               (D3 contract pin) rather than silently mis-parsing
 *   BOUNDARY:   declared single-char alias (-y) and a cluster of two
 *               declared single-char names (-ab) still parse; a negative
 *               number token (-5) is never flagged; tokens after a literal
 *               `--` terminator are never rejected; a 1-char alias (-h)
 *               renders unchanged; an ambiguous 2+-candidate prefix yields
 *               no suggestion rather than a wrong guess
 *   ERROR:      wrapCommandStrict's produced `run` exits 2 on a single-dash
 *               violation, BEFORE calling the wrapped original `run`
 *   STATE:      the double-dash check (findUnknownFlag) still wins when both
 *               a double-dash and single-dash violation are present
 *   REGRESSION: `--x=value`, positionals, and `--no-force` internal hyphens
 *               are untouched by both the D1 scan and the D2 render fix
 *
 * @spec_ref SPEC-073 §Design D1 D2 D3 §Acceptance Criteria AC-073-1 AC-073-2 AC-073-3 AC-073-4
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { parseArgs, renderUsage } from "citty";
import type { ArgsDef, CommandContext, CommandDef } from "citty";
import { findSingleDashViolation, findUnknownFlag, wrapCommandStrict } from "../../../src/adapters/cli/strict-flags.js";
import { fixSingleDashAliasRendering, renderUsageDoubleDash } from "../../../src/adapters/cli/usage-render.js";

// Mirrors commands/list.ts's declared args at time of writing — enough of
// the shape to exercise the --json flag AC-073-1 names.
const LIST_ARGS: ArgsDef = {
  type: { type: "string" },
  status: { type: "string" },
  json: { type: "boolean" },
};

// Mirrors commands/verify.ts's declared "allow-new-commands"/"yes" alias
// (measured fact: the ONLY citty `alias:` declaration in this codebase,
// packages/lore/src/adapters/cli/commands/verify.ts:309-311) — kept as a
// literal fixture here (not a live import) because verify.ts transitively
// imports loader.ts (bun:sqlite), unreachable from vitest.
const VERIFY_ALLOW_NEW_COMMANDS_ARGS: ArgsDef = {
  plan: { type: "positional", required: true },
  "allow-new-commands": {
    type: "boolean",
    alias: "yes",
    description: "Approve every new/changed verify command for this run without prompting",
  },
};

describe("findSingleDashViolation (SPEC-073 D1)", () => {
  it("AC-073-1: HAPPY — flags -json on a list-shaped ArgsDef, suggesting --json", () => {
    const violation = findSingleDashViolation(["-json"], LIST_ARGS);
    expect(violation).toEqual({ token: "-json", suggestion: "--json" });
  });

  it("AC-073-2: HAPPY — flags -yes on verify's ArgsDef, suggesting --yes (the declared alias)", () => {
    const violation = findSingleDashViolation(["-yes"], VERIFY_ALLOW_NEW_COMMANDS_ARGS);
    expect(violation).toEqual({ token: "-yes", suggestion: "--yes" });
  });

  it("AC-073-3: BOUNDARY — a declared single-char alias (-y) is never scanned (legitimate short flag)", () => {
    const args: ArgsDef = { verbose: { type: "boolean", alias: "y" } };
    expect(findSingleDashViolation(["-y"], args)).toBeNull();
  });

  it("AC-073-3: BOUNDARY — a cluster of two declared single-char names (-ab) still parses", () => {
    const args: ArgsDef = { a: { type: "boolean" }, b: { type: "boolean" } };
    expect(findSingleDashViolation(["-ab"], args)).toBeNull();
  });

  it("AC-073-3: BOUNDARY — a negative-number token (-5) is never flagged", () => {
    expect(findSingleDashViolation(["-5"], {})).toBeNull();
  });

  it("AC-073-3: BOUNDARY — a negative-float token (-3.14) is never flagged", () => {
    expect(findSingleDashViolation(["-3.14"], {})).toBeNull();
  });

  it("AC-073-3: BOUNDARY — tokens after a literal -- terminator are never rejected", () => {
    expect(findSingleDashViolation(["--", "-json", "-yes"], LIST_ARGS)).toBeNull();
  });

  it("BOUNDARY: an ambiguous prefix (2+ candidates) yields no suggestion", () => {
    // Both "job" and "joker" start with "jo" — two candidates, no safe guess.
    const args: ArgsDef = { job: { type: "boolean" }, joker: { type: "boolean" } };
    const violation = findSingleDashViolation(["-jo"], args);
    expect(violation).toEqual({ token: "-jo", suggestion: null });
  });

  it("BOUNDARY: an unambiguous prefix (exactly 1 candidate) yields a suggestion", () => {
    const args: ArgsDef = { json: { type: "boolean" } };
    const violation = findSingleDashViolation(["-jso"], args);
    expect(violation).toEqual({ token: "-jso", suggestion: "--json" });
  });

  it("BOUNDARY: no match at all (no exact, no prefix candidate) yields no suggestion", () => {
    const violation = findSingleDashViolation(["-zzz"], LIST_ARGS);
    expect(violation).toEqual({ token: "-zzz", suggestion: null });
  });

  it("BEWARE (design's own scope note): a value like -something following --title is NOT a flag position", () => {
    // The design's own caution: `lore create --title "-something"` — the
    // VALUE "-something" must not be rejected. citty's REAL parser
    // (confirmed empirically in the sibling describe block below, and via
    // the parseArgs contract test right after this one) greedily consumes
    // the token immediately following a declared STRING-typed flag as that
    // flag's value — REGARDLESS of what the token looks like (dash-prefixed
    // or not). findSingleDashViolation tracks this same value-position
    // exactly (consumesNextTokenAsValue, strict-flags.ts) so it never scans
    // a value token as a flag position.
    const args: ArgsDef = { title: { type: "string" } };
    expect(findSingleDashViolation(["--title", "-something"], args)).toBeNull();
  });

  it("BEWARE: a value like --something (double-dash) following --title is also skipped as a value token", () => {
    const args: ArgsDef = { title: { type: "string" } };
    expect(findSingleDashViolation(["--title", "--something"], args)).toBeNull();
  });

  it("BEWARE: a single-dash value following a declared single-char STRING alias is also skipped", () => {
    const args: ArgsDef = { title: { type: "string", alias: "t" } };
    expect(findSingleDashViolation(["-t", "-something"], args)).toBeNull();
  });

  it("BEWARE: --title=VALUE inline form does NOT consume the next token as a value", () => {
    // Inline "=" already supplies the value — the token that follows is a
    // genuine, independently-scanned next flag position.
    const args: ArgsDef = { title: { type: "string" }, json: { type: "boolean" } };
    expect(findSingleDashViolation(["--title=foo", "-json"], args)).toEqual({
      token: "-json",
      suggestion: "--json",
    });
  });

  it("REGRESSION: a token following a BOOLEAN flag is still scanned as its own flag position", () => {
    // Booleans never consume the next token (confirmed empirically — see
    // the parseArgs probe below) — a violation right after one must still
    // be caught, proving skipNextAsValue is scoped to STRING flags only.
    const args: ArgsDef = { json: { type: "boolean" } };
    expect(findSingleDashViolation(["--json", "-bogus"], args)).toEqual({
      token: "-bogus",
      suggestion: null,
    });
  });
});

describe("citty's real parser: the actual quirk the BEWARE cases above defend against", () => {
  // Empirically verified (this suite's own oracle, `bunx vitest run` — NOT
  // an assumption): citty's vendored mri-style parser, when the token
  // FOLLOWING a string-typed flag itself starts with `-`, does NOT consume
  // it as that flag's value — it short-circuits the flag to an EMPTY string
  // ("" — mri's own boolean-true-then-string-coerce path) and leaves the
  // dash-prefixed token to be independently re-parsed on the NEXT loop
  // iteration (where, if it's a single-dash multi-char token, mri's cluster
  // expansion silently splits it into unrelated single-char booleans — the
  // SAME root defect this module's header describes for `-json`). This is a
  // PRE-EXISTING citty behavior, out of SPEC-073's scope to fix at the
  // parser level. `consumesNextTokenAsValue` (`strict-flags.ts`) does NOT
  // mimic this quirk — it deliberately treats the token syntactically
  // following a declared string flag as a value position REGARDLESS, which
  // is the conservative, safe choice the D1 "Beware" note requires: our new
  // scanner must never turn citty's silent (if broken) value-swallow into a
  // LOUD rejection of a legitimate `--title "-something"` invocation.
  it("--title -something → title is EMPTY (citty's own quirk — NOT the value)", () => {
    const parsed = parseArgs(["--title", "-something"], { title: { type: "string" } });
    expect(parsed.title).toBe("");
  });

  it("--title --json → title is EMPTY; --json is independently parsed as its own declared boolean flag", () => {
    const parsed = parseArgs(["--title", "--json"], {
      title: { type: "string" },
      json: { type: "boolean" },
    });
    expect(parsed.title).toBe("");
    expect(parsed.json).toBe(true);
  });

  it("--title something (no leading dash) → title correctly receives the value, consuming that token", () => {
    const parsed = parseArgs(["--title", "something"], { title: { type: "string" } });
    expect(parsed.title).toBe("something");
  });

  it("--json -bogus → json is true; -bogus is NOT consumed as json's value (booleans never consume)", () => {
    const parsed = parseArgs(["--json", "-bogus"], { json: { type: "boolean" } });
    expect(parsed.json).toBe(true);
  });
});

describe("findSingleDashViolation composes with findUnknownFlag (STATE)", () => {
  it("STATE: findUnknownFlag (double-dash) is checked independently and unaffected by single-dash tokens", () => {
    // findUnknownFlag only scans --tokens; a single-dash token in the same
    // rawArgs must not be reported by it (proves the two scans are
    // independent, non-interfering passes — wrapCommandStrict below proves
    // the double-dash scan wins when BOTH are present).
    expect(findUnknownFlag(["-json", "--type", "blocks"], LIST_ARGS)).toBeNull();
    expect(findSingleDashViolation(["-json", "--type", "blocks"], LIST_ARGS)).toEqual({
      token: "-json",
      suggestion: "--json",
    });
  });
});

describe("--yes parse-seam contract (SPEC-073 D3 — no live verify execution)", () => {
  it("AC-073-2: NEGATIVE — --yes maps to allow-new-commands=true under citty's own parseArgs", () => {
    const parsed = parseArgs(["plan-1", "--yes"], VERIFY_ALLOW_NEW_COMMANDS_ARGS);
    expect(parsed["allow-new-commands"]).toBe(true);
  });

  it("REGRESSION: the canonical --allow-new-commands form still maps to itself", () => {
    const parsed = parseArgs(["plan-1", "--allow-new-commands"], VERIFY_ALLOW_NEW_COMMANDS_ARGS);
    expect(parsed["allow-new-commands"]).toBe(true);
  });

  it("REGRESSION: omitting both forms leaves allow-new-commands undefined (falsy)", () => {
    const parsed = parseArgs(["plan-1"], VERIFY_ALLOW_NEW_COMMANDS_ARGS);
    expect(parsed["allow-new-commands"]).toBeUndefined();
  });
});

describe("wrapCommandStrict single-dash rejection (ERROR, STATE)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeLeaf(args: ArgsDef, runSpy: (ctx: CommandContext) => unknown): CommandDef {
    return { meta: { name: "leaf" }, args, run: runSpy };
  }

  it("AC-073-1: ERROR — lore list -json exits 2 BEFORE calling the real run, naming -json and suggesting --json", async () => {
    const runSpy = vi.fn();
    const leaf = makeLeaf(LIST_ARGS, runSpy as unknown as (ctx: CommandContext) => unknown);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const wrapped = await wrapCommandStrict(leaf, "lore list");
    await expect(
      wrapped.run?.({ rawArgs: ["-json"], args: {} as never, cmd: wrapped }),
    ).rejects.toMatchObject({ name: "CliExit", code: 2 });

    expect(runSpy).not.toHaveBeenCalled();
    const stderrOutput = stderrSpy.mock.calls.join("\n");
    expect(stderrOutput).toContain("Unknown option: -json");
    expect(stderrOutput).toContain("Did you mean --json?");
    expect(stderrOutput).toContain("lore list --help");
  });

  it("AC-073-2: ERROR — lore verify -yes exits 2 suggesting --yes", async () => {
    const runSpy = vi.fn();
    const leaf = makeLeaf(VERIFY_ALLOW_NEW_COMMANDS_ARGS, runSpy as unknown as (ctx: CommandContext) => unknown);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const wrapped = await wrapCommandStrict(leaf, "lore verify");
    await expect(
      wrapped.run?.({ rawArgs: ["plan-1", "-yes"], args: {} as never, cmd: wrapped }),
    ).rejects.toMatchObject({ name: "CliExit", code: 2 });

    expect(runSpy).not.toHaveBeenCalled();
    const stderrOutput = stderrSpy.mock.calls.join("\n");
    expect(stderrOutput).toContain("Unknown option: -yes");
    expect(stderrOutput).toContain("Did you mean --yes?");
  });

  it("AC-073-3: REGRESSION — a declared single-char alias still reaches the real run", async () => {
    const args: ArgsDef = { verbose: { type: "boolean", alias: "y" } };
    const runSpy = vi.fn().mockResolvedValue(undefined);
    const leaf = makeLeaf(args, runSpy as unknown as (ctx: CommandContext) => unknown);

    const wrapped = await wrapCommandStrict(leaf, "lore leaf");
    const context = { rawArgs: ["-y"], args: {} as never, cmd: wrapped };
    await wrapped.run?.(context);

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy).toHaveBeenCalledWith(context);
  });

  it("AC-073-3: REGRESSION — a negative-number positional still reaches the real run", async () => {
    const args: ArgsDef = { offset: { type: "positional", required: false } };
    const runSpy = vi.fn().mockResolvedValue(undefined);
    const leaf = makeLeaf(args, runSpy as unknown as (ctx: CommandContext) => unknown);

    const wrapped = await wrapCommandStrict(leaf, "lore leaf");
    const context = { rawArgs: ["-5"], args: {} as never, cmd: wrapped };
    await wrapped.run?.(context);

    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it("AC-073-3: REGRESSION — tokens after -- terminator still reach the real run untouched", async () => {
    const runSpy = vi.fn().mockResolvedValue(undefined);
    const leaf = makeLeaf({}, runSpy as unknown as (ctx: CommandContext) => unknown);

    const wrapped = await wrapCommandStrict(leaf, "lore leaf");
    const context = { rawArgs: ["--", "-json", "-yes"], args: {} as never, cmd: wrapped };
    await wrapped.run?.(context);

    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it("STATE: a double-dash violation is reported before a single-dash one when both are present", async () => {
    const runSpy = vi.fn();
    const leaf = makeLeaf(LIST_ARGS, runSpy as unknown as (ctx: CommandContext) => unknown);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const wrapped = await wrapCommandStrict(leaf, "lore list");
    await expect(
      wrapped.run?.({ rawArgs: ["--kind", "blocks", "-json"], args: {} as never, cmd: wrapped }),
    ).rejects.toMatchObject({ name: "CliExit", code: 2 });

    const stderrOutput = stderrSpy.mock.calls.join("\n");
    expect(stderrOutput).toContain("Unknown option: --kind");
    expect(stderrOutput).not.toContain("-json");
  });
});

describe("fixSingleDashAliasRendering (SPEC-073 D2)", () => {
  it("AC-073-4: HAPPY — rewrites a single-dash multi-char alias to double-dash", () => {
    expect(fixSingleDashAliasRendering("`-yes, --allow-new-commands`")).toBe(
      "`--yes, --allow-new-commands`",
    );
  });

  it("AC-073-4: BOUNDARY — a single-char alias (-h) is left unchanged", () => {
    expect(fixSingleDashAliasRendering("`-h, --help`")).toBe("`-h, --help`");
  });

  it("AC-073-4: REGRESSION — an internal hyphen inside a flag name is left unchanged", () => {
    expect(fixSingleDashAliasRendering("`--no-force`")).toBe("`--no-force`");
    expect(fixSingleDashAliasRendering("`--allow-new-commands`")).toBe("`--allow-new-commands`");
  });

  it("AC-073-4: REGRESSION — text with no single-dash tokens is byte-identical", () => {
    const text = "USAGE `lore verify [OPTIONS] <PLAN>`\n\nOPTIONS\n\n  `--json`  Output as JSON";
    expect(fixSingleDashAliasRendering(text)).toBe(text);
  });

  it("AC-073-4: HAPPY — end-to-end against citty's REAL renderUsage for a verify-shaped CommandDef: no lone single-dash multi-char alias remains", async () => {
    const cmd: CommandDef = {
      meta: { name: "verify", description: "Execute a plan's script-mode acceptance criteria" },
      args: VERIFY_ALLOW_NEW_COMMANDS_ARGS,
    };
    const rawUsage = await renderUsage(cmd);
    // Sanity: prove citty's OWN renderer still emits the broken single-dash
    // form pre-fix (root-cause confirmation) — the fixture would go stale
    // silently if a citty upgrade ever changed this.
    expect(rawUsage).toContain("-yes, --allow-new-commands");

    const fixed = fixSingleDashAliasRendering(rawUsage);
    expect(fixed).toContain("--yes, --allow-new-commands");
    // No lone single-dash multi-char alias token should remain anywhere in
    // the fixed text (a "-yes" NOT preceded by another dash).
    expect(fixed).not.toMatch(/(?<![\w-])-yes\b/);
  });
});

describe("renderUsageDoubleDash (SPEC-073 D2 composition-site wrapper)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("AC-073-4: HAPPY — prints the fixed (double-dash) usage text via console.log", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const cmd: CommandDef = {
      meta: { name: "verify", description: "Execute a plan's script-mode acceptance criteria" },
      args: VERIFY_ALLOW_NEW_COMMANDS_ARGS,
    };

    await renderUsageDoubleDash(cmd);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const printed = logSpy.mock.calls[0]?.[0] as string;
    expect(printed).toContain("--yes, --allow-new-commands");
    expect(printed).not.toMatch(/(?<![\w-])-yes\b/);
  });
});
