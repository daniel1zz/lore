#!/usr/bin/env node
/**
 * npm-pkg/postinstall.mjs — SPEC-048 Design D1 (nudge-only postinstall).
 *
 * Purpose: the ONLY script npm runs after installing the packaged `lore`
 * CLI. Its entire job is to print a single-line nudge pointing the
 * installer at `lore setup` (which the human/agent runs explicitly and
 * separately). This file NEVER runs `lore setup` itself, NEVER touches the
 * Claude Code config directory or any generated agent-settings file, and
 * NEVER performs MCP registration or any other side-effecting action — see
 * the "conformance invariants" block below for the enforced boundary.
 *
 * Side-effect class: IO (stdout/stderr write + process.exit) when run as
 * the npm lifecycle script; the exported `decide()` function itself is
 * PURE (no IO, no globals read internally — every input is a parameter).
 *
 * Public surface: `decide({ isTTY, env }) → { action, message }` (pure,
 * imported directly by unit tests). Everything else is private to the
 * lifecycle-script entry path guarded by `isMainModule()`.
 *
 * Dependency-free by contract (SPEC-048 Scope IN #4): this file imports
 * ONLY Node builtins (`node:url`), never a third-party package — a
 * postinstall script with any real dependency graph could itself fail to
 * install and break the parent `npm install`. This is also why boundary
 * input here is NOT run through Zod (the project's normal boundary-data
 * convention, see @lore/core): pulling in `zod` would violate the zero-dep
 * constraint this file exists to satisfy. `env`/`isTTY` are narrow,
 * already-primitive process facts, not externally-supplied structured
 * data, so the risk this rule normally guards against does not apply here.
 *
 * npm >=7 backgrounds lifecycle scripts (stdio piped to a log, not a TTY)
 * for the overwhelming majority of installs, so `isTTY` is false almost
 * always in practice; the TTY+non-CI branch only matters for the rare
 * `--foreground-scripts` invocation. Interactive prompts are out of scope
 * entirely (PRD "no silent wiring", SPEC-048 Design D1).
 *
 * Conformance invariants (enforced by
 * packages/lore/tests/unit/distribution/postinstall.test.ts, INV-4):
 *   - zero non-builtin import/require specifiers anywhere in this file
 *   - no process-spawning module import, no `exec`/`spawn` family call, no
 *     literal reference to the Claude config dotdir or a generated
 *     settings file — i.e. nothing in this file is CAPABLE of running
 *     `lore setup`, writing config, or doing MCP execution, even though
 *     the printed message text mentions `lore setup` BY NAME as the
 *     suggested next step for the human
 *   - the lifecycle entry path is wrapped try/catch and exits 0 on every
 *     path (a failed nudge must never fail `npm install`)
 *
 * @spec_ref SPEC-048 Design "postinstall contract", D1; AC-048-A
 */

import { pathToFileURL } from "node:url";

/**
 * Decide which nudge to print and where, from process facts alone.
 *
 * Contract: `env.CI` truthy OR `!isTTY` → non-interactive branch
 * (stderr); TTY and no CI → interactive branch (stdout). The message
 * text is IDENTICAL in both branches — only the destination differs.
 * There is no third action.
 *
 * This function reads no globals (`process.env`, `process.stdout.isTTY`)
 * itself — every fact it needs is a parameter — so it is trivially
 * unit-testable without spawning a real process or mocking `process`.
 *
 * @param {{ isTTY: boolean, env: Record<string, string | undefined> }} input
 *   `isTTY` — whether the lifecycle script's stdout is attached to a TTY.
 *   `env` — the process environment (or a fake in tests). REQUIRED: this
 *   function does not default a missing `env` — a caller that omits it
 *   is a caller bug, not a state this function should silently paper
 *   over (throws a TypeError reading `env.CI`, same "fail loud on a
 *   required field" posture as the rest of this codebase).
 * @returns {{ action: "nudge-stderr" | "nudge-stdout", message: string }}
 */
export function decide({ isTTY, env }) {
  const message = "lore installed — run `lore setup` to wire skills/hooks";
  const nonInteractive = Boolean(env.CI) || !isTTY;
  return nonInteractive
    ? { action: "nudge-stderr", message }
    : { action: "nudge-stdout", message };
}

/**
 * True iff this file is the process entry point (npm invoked it directly
 * as the postinstall script), false when it is merely `import`-ed (e.g.
 * by the unit test importing `decide`). Guards every side effect below.
 *
 * @returns {boolean}
 */
function isMainModule() {
  const entryPath = process.argv[1];
  if (!entryPath) return false;
  try {
    return import.meta.url === pathToFileURL(entryPath).href;
  } catch {
    return false;
  }
}

/**
 * The lifecycle-script entry action: print the nudge decided by
 * `decide()`, then exit 0 UNCONDITIONALLY. Every failure mode (a throw
 * from `decide()`, a write failure) is swallowed here on purpose — a
 * postinstall script that exits non-zero fails the whole `npm install`,
 * which is a far worse outcome than a missing nudge.
 *
 * @returns {void}
 */
function main() {
  try {
    const { action, message } = decide({
      isTTY: Boolean(process.stdout.isTTY),
      env: process.env,
    });
    if (action === "nudge-stderr") {
      process.stderr.write(`${message}\n`);
    } else {
      process.stdout.write(`${message}\n`);
    }
  } catch {
    // A failed nudge must never break `npm install` — swallow and exit 0.
  } finally {
    process.exit(0);
  }
}

if (isMainModule()) {
  main();
}
