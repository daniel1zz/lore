/**
 * Unit tests for the SPEC-051 D1 strict unknown-flag rejection helper
 * (`findUnknownFlag` / `wrapCommandStrict`). Pure — no `bun:sqlite`, no real
 * command modules — uses synthetic `citty` `CommandDef` fixtures so this
 * suite runs under vitest without a compiled binary or a real corpus.
 *
 * Coverage:
 *   HAPPY:      a declared long flag, `--x=value` inline form, a declared
 *               alias, `--no-X` negating a declared boolean, `--` passthrough
 *   NEGATIVE:   an undeclared flag anywhere in rawArgs is caught (first one
 *               reported); an undeclared flag AFTER a declared one
 *   BOUNDARY:   empty rawArgs; empty argsDef; a positional's own name used
 *               as `--<positionalName>` is rejected (positionals excluded
 *               from the declared set); `--no-X` where X is a STRING (not
 *               boolean) arg is rejected (negation only applies to booleans)
 *   ERROR:      wrapCommandStrict's produced `run` calls process.exit(2) on
 *               a violation (asserted via a spy) without invoking the
 *               wrapped original `run` — proves the "reject BEFORE the real
 *               command logic" ordering that is the entire point of D1
 *   STATE:      wrapCommandStrict recurses into nested subCommands (group
 *               commands like `gate`/`phase`) — a violation deep in the tree
 *               is caught at that leaf, and a valid deep invocation still
 *               reaches its real `run`
 *   REGRESSION: a fully-declared, valid invocation passes through unchanged
 *               (findUnknownFlag returns null; wrapCommandStrict's wrapped
 *               run still calls the original run with the same context)
 *
 * @spec_ref SPEC-051 §Design D1 §Acceptance Criteria AC-051-2
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { ArgsDef, CommandContext, CommandDef } from "citty";
import { findUnknownFlag, wrapCommandStrict } from "../../../src/adapters/cli/strict-flags.js";

// ─── findUnknownFlag ────────────────────────────────────────────────────────

describe("findUnknownFlag", () => {
  const linkArgs: ArgsDef = {
    from: { type: "positional", required: true },
    to: { type: "positional", required: true },
    type: { type: "string", default: "relates-to" },
    infer: { type: "boolean" },
    json: { type: "boolean" },
  };

  it("HAPPY: returns null for every declared long flag", () => {
    expect(findUnknownFlag(["A", "B", "--type", "blocks"], linkArgs)).toBeNull();
  });

  it("HAPPY: accepts the --x=value inline form", () => {
    expect(findUnknownFlag(["A", "B", "--type=blocks"], linkArgs)).toBeNull();
  });

  it("HAPPY: accepts a declared alias", () => {
    const args: ArgsDef = {
      "allow-new-commands": { type: "boolean", alias: "yes" },
    };
    expect(findUnknownFlag(["--yes"], args)).toBeNull();
  });

  it("HAPPY: --no-X negates a declared boolean X", () => {
    const args: ArgsDef = { force: { type: "boolean" } };
    expect(findUnknownFlag(["--no-force"], args)).toBeNull();
  });

  it("HAPPY: everything after a literal -- passthrough marker is untouched", () => {
    expect(findUnknownFlag(["A", "B", "--", "--anything-goes"], linkArgs)).toBeNull();
  });

  it("NEGATIVE: reproduces the real incident — link's --kind (real flag is --type)", () => {
    expect(findUnknownFlag(["A", "B", "--kind", "blocks"], linkArgs)).toBe("--kind");
  });

  it("NEGATIVE: reports the FIRST undeclared flag when multiple exist", () => {
    expect(findUnknownFlag(["--bogus1", "--bogus2"], linkArgs)).toBe("--bogus1");
  });

  it("NEGATIVE: an undeclared flag after a declared one is still caught", () => {
    expect(findUnknownFlag(["A", "B", "--type", "blocks", "--kind", "x"], linkArgs)).toBe("--kind");
  });

  it("BOUNDARY: empty rawArgs returns null", () => {
    expect(findUnknownFlag([], linkArgs)).toBeNull();
  });

  it("BOUNDARY: empty argsDef rejects any flag", () => {
    expect(findUnknownFlag(["--anything"], {})).toBe("--anything");
  });

  it("BOUNDARY: a positional's own name is NOT a valid --flag", () => {
    // "from" is declared as a positional — --from must not be admitted as a flag alias.
    expect(findUnknownFlag(["--from", "x"], linkArgs)).toBe("--from");
  });

  it("BOUNDARY: --no-X is rejected when X is a string arg, not boolean", () => {
    const args: ArgsDef = { type: { type: "string" } };
    expect(findUnknownFlag(["--no-type"], args)).toBe("--no-type");
  });
});

// ─── wrapCommandStrict ──────────────────────────────────────────────────────

describe("wrapCommandStrict", () => {
  afterEach(() => {
    // reason: exit/stderr spies are declared locally (const) per-test below —
    // sharing one outer `let` across process.exit/process.stderr.write spy
    // targets hit a TS structural-mismatch on ReturnType<typeof vi.spyOn>
    // (each overload resolves to a DIFFERENT MockInstance<...> signature).
    // restoreAllMocks() is the vitest-idiomatic per-test cleanup instead.
    vi.restoreAllMocks();
  });

  function makeLeaf(args: ArgsDef, runSpy: (ctx: CommandContext) => unknown): CommandDef {
    return {
      meta: { name: "leaf" },
      args,
      run: runSpy,
    };
  }

  it("ERROR: rejects an unknown flag with exit 2 BEFORE calling the real run", async () => {
    const runSpy = vi.fn();
    const leaf = makeLeaf(
      { type: { type: "string" } },
      runSpy as unknown as (ctx: CommandContext) => unknown,
    );
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const wrapped = await wrapCommandStrict(leaf, "lore link");
    await expect(
      wrapped.run?.({
        rawArgs: ["A", "B", "--kind", "blocks"],
        args: {} as never,
        cmd: wrapped,
      }),
    ).rejects.toMatchObject({ name: "CliExit", code: 2 });

    expect(runSpy).not.toHaveBeenCalled();
    expect(stderrSpy.mock.calls.join("\n")).toContain("Unknown option: --kind");
    expect(stderrSpy.mock.calls.join("\n")).toContain("lore link --help");
  });

  it("REGRESSION: a valid invocation still reaches the original run with the same context", async () => {
    const runSpy = vi.fn().mockResolvedValue(undefined);
    const leaf = makeLeaf(
      { type: { type: "string" } },
      runSpy as unknown as (ctx: CommandContext) => unknown,
    );

    const wrapped = await wrapCommandStrict(leaf, "lore link");
    const context = {
      rawArgs: ["A", "B", "--type", "blocks"],
      args: {} as never,
      cmd: wrapped,
    };
    await wrapped.run?.(context);

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy).toHaveBeenCalledWith(context);
  });

  it("STATE: recurses into nested subCommands and catches a violation at a deep leaf", async () => {
    const addRun = vi.fn();
    const group: CommandDef = {
      meta: { name: "phase" },
      subCommands: {
        add: {
          meta: { name: "add" },
          args: { plan: { type: "positional", required: true }, name: { type: "positional", required: true } },
          run: addRun as unknown as (ctx: CommandContext) => unknown,
        },
      },
    };
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const wrapped = await wrapCommandStrict(group, "lore phase");
    const addCmd = (wrapped.subCommands as Record<string, CommandDef>)["add"];
    expect(addCmd).toBeDefined();

    await expect(
      addCmd?.run?.({
        rawArgs: ["plan-1", "phase-1", "--bogus"],
        args: {} as never,
        cmd: addCmd as CommandDef,
      }),
    ).rejects.toMatchObject({ name: "CliExit", code: 2 });
    expect(addRun).not.toHaveBeenCalled();
    expect(stderrSpy.mock.calls.join("\n")).toContain("Unknown option: --bogus");
    expect(stderrSpy.mock.calls.join("\n")).toContain("lore phase add --help");
  });

  it("STATE: a valid deep invocation still reaches the nested leaf's real run", async () => {
    const addRun = vi.fn().mockResolvedValue(undefined);
    const group: CommandDef = {
      meta: { name: "phase" },
      subCommands: {
        add: {
          meta: { name: "add" },
          args: { plan: { type: "positional", required: true }, name: { type: "positional", required: true } },
          run: addRun as unknown as (ctx: CommandContext) => unknown,
        },
      },
    };

    const wrapped = await wrapCommandStrict(group, "lore phase");
    const addCmd = (wrapped.subCommands as Record<string, CommandDef>)["add"];
    await addCmd?.run?.({
      rawArgs: ["plan-1", "phase-1"],
      args: {} as never,
      cmd: addCmd as CommandDef,
    });

    expect(addRun).toHaveBeenCalledTimes(1);
  });

  it("REGRESSION: a group command with no top-level run stays runless after wrapping", async () => {
    const group: CommandDef = {
      meta: { name: "phase" },
      subCommands: {},
    };
    const wrapped = await wrapCommandStrict(group, "lore phase");
    expect(wrapped.run).toBeUndefined();
  });
});
