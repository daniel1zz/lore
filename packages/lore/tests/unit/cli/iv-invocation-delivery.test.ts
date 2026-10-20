// @reads packages/lore/src/**
// @reads packages/core/src/**
/**
 * AC-IV-5 (spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D4): every command receives the one
 * resolved Invocation, and the identity module variable is gone.
 *
 * Enumeration mechanism: the test walks the REAL registry `COMMAND_LOADERS` (adapters/cli/index.ts, the same
 * map `buildMain` builds the citty tree from), imports every real command module, and collects every node
 * that has a `run` (top-level verbs AND nested leaves such as `phase add`, `gate spec-create`). For each such
 * path it calls the real `runCli(inv)` with `argv = <path>`. Only the leaf BODIES are replaced (through
 * `runCli`'s `transformCommand` seam, applied before strict-flag and delivery wrapping) by a recorder, so the
 * strict-flag seam, `deliverInvocation`, citty dispatch and `runMain` are the production code. A command added
 * to the registry is enumerated automatically; if delivery does not reach it, its path fails here.
 *
 * Side effects: none on disk (no command body runs); `process.argv` is restored after each run.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandDef } from "citty";
import type { Invocation, RunId } from "@lore/core";
import { buildMain, COMMAND_LOADERS, CommandTreeWithoutInvocationError } from "../../../src/adapters/cli/index";
import { runCli } from "../../../src/adapters/cli/run-cli";

type AnyCommand = CommandDef<any>;

async function resolveMaybe<T>(value: T | Promise<T> | (() => T | Promise<T>)): Promise<T> {
  return typeof value === "function" ? (value as () => T | Promise<T>)() : value;
}

/** Every path (words after `lore`) of a node with a `run`, depth first. */
async function collectRunnablePaths(command: AnyCommand, prefix: readonly string[]): Promise<string[][]> {
  const paths: string[][] = [];
  if (typeof command.run === "function") paths.push([...prefix]);
  if (command.subCommands !== undefined) {
    const subs = await resolveMaybe(command.subCommands);
    for (const [name, sub] of Object.entries(subs)) {
      const resolved = (await resolveMaybe(sub)) as AnyCommand;
      paths.push(...(await collectRunnablePaths(resolved, [...prefix, name])));
    }
  }
  return paths;
}

/** Copy of a command tree whose every `run` records the context it was handed; flag/arg schemas are dropped. */
async function stubRuns(command: AnyCommand, record: (context: { inv?: unknown }) => void): Promise<AnyCommand> {
  const stub: AnyCommand = command.meta === undefined ? {} : { meta: command.meta };
  if (command.subCommands !== undefined) {
    const subs = await resolveMaybe(command.subCommands);
    const nested: Record<string, AnyCommand> = {};
    for (const [name, sub] of Object.entries(subs)) {
      nested[name] = await stubRuns((await resolveMaybe(sub)) as AnyCommand, record);
    }
    stub.subCommands = nested;
  }
  if (typeof command.run === "function") stub.run = (context) => record(context as { inv?: unknown });
  return stub;
}

function makeInvocation(argv: readonly string[]): Invocation {
  const sink = { write: (_text: string): boolean => true };
  return Object.freeze({
    cwd: "/nonexistent/iv-5-cwd",
    env: Object.freeze({}),
    argv: Object.freeze([...argv]),
    paths: Object.freeze({
      home: "/nonexistent/iv-5-home",
      claudeDir: "/nonexistent/iv-5-home/.claude",
      userConfigDir: "/nonexistent/iv-5-home/.config/lore",
      projectRoot: null,
      tmpDir: "/nonexistent/iv-5-tmp",
    }),
    host: "iv-5-host",
    execPath: "/nonexistent/lore",
    isCompiled: false,
    identity: Object.freeze({ harnessRun: "cc:iv-5-test-session" as RunId, claimed: "agent:iv-5-test", claimedSource: "run" as const }),
    io: Object.freeze({ stdout: sink, stderr: sink, stdin: Readable.from([]), stdinIsTTY: false }),
  });
}

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...listSourceFiles(full));
    else if (entry.endsWith(".ts")) files.push(full);
  }
  return files;
}

describe("AC-IV-5: every registered command receives the one resolved Invocation", () => {
  let savedArgv: string[];
  beforeEach(() => {
    savedArgv = process.argv;
  });
  afterEach(() => {
    process.argv = savedArgv;
  });

  it("AC-IV-5 enumerates the real registry and every runnable path gets the identity-equal Invocation", async () => {
    const names = Object.keys(COMMAND_LOADERS);
    expect(names.length).toBeGreaterThan(50);
    const delivered: string[] = [];
    for (const name of names) {
      const loader = COMMAND_LOADERS[name];
      expect(loader, `registry entry ${name}`).toBeTypeOf("function");
      const real = (await (loader as () => Promise<{ default: AnyCommand }>)()).default;
      const paths = await collectRunnablePaths(real, [name]);
      expect(paths.length, `command "${name}" has no runnable node`).toBeGreaterThan(0);
      for (const path of paths) {
        const inv = makeInvocation(path);
        const seen: unknown[] = [];
        await runCli(inv, {
          transformCommand: (commandName, command) =>
            commandName === name ? stubRuns(command, (context) => seen.push(context.inv)) : command,
        });
        expect(seen.length, `lore ${path.join(" ")}: run called once`).toBe(1);
        expect(seen[0] === inv, `lore ${path.join(" ")}: ctx.inv is the same object runCli received`).toBe(true);
        delivered.push(path.join(" "));
      }
    }
    // reason: the registry must reach nested leaves, not only top-level verbs.
    expect(delivered.some((path) => path.split(" ").length >= 2)).toBe(true);
    expect(delivered.length).toBeGreaterThanOrEqual(names.length);
  }, 300_000);

  it("the registry and the citty tree list the same commands (no verb outside COMMAND_LOADERS)", async () => {
    const tree = buildMain(null);
    const subs = await resolveMaybe(tree.subCommands ?? {});
    expect(Object.keys(subs).sort()).toEqual(Object.keys(COMMAND_LOADERS).sort());
  });

  it("a tree built without an Invocation refuses to run a leaf instead of running without one", async () => {
    const tree = buildMain(null);
    const subs = await resolveMaybe(tree.subCommands ?? {});
    const get = (await resolveMaybe((subs as Record<string, unknown>)["get"])) as AnyCommand;
    expect(() => (get.run as (context: unknown) => unknown)({ args: {}, rawArgs: [], cmd: get })).toThrow(
      CommandTreeWithoutInvocationError,
    );
  });

  it("adapters/cli/invocation-identity.ts is gone and no source module exports a setter for the identity", () => {
    const root = join(__dirname, "../../..");
    expect(() => statSync(join(root, "src/adapters/cli/invocation-identity.ts"))).toThrow();
    const offenders = [...listSourceFiles(join(root, "src")), ...listSourceFiles(join(root, "../core/src"))].filter(
      (file) => /setInvocationIdentity|replaceInvocationIdentity|resetInvocationIdentityForNextRun/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
