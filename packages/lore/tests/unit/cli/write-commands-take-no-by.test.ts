/**
 * AC-ROI-1 (spec-run-only-write-identity-and-run-end-claim-release): no WRITE surface takes `by`.
 *
 * Walks the REAL citty command registry (`adapters/cli/index.ts`, every leaf of every group) and pins the
 * read-side `by` filters as EXACTLY the {@link READ_SIDE_BY_FILTERS} constant — equality, so neither a new `by` on a write
 * verb nor an unlisted read filter can slip in.
 *
 * Coverage:
 *   HAPPY:      the set of CLI leaves declaring `by` equals the pinned CLI allowlist
 *   NEGATIVE:   no leaf declares the `reviewer` alias (approve/reject took it as `--by`'s alias)
 *   BOUNDARY:   group commands with nested leaves (gate, phase, ac, anchor, ...) are walked, not skipped
 *   REGRESSION: an unknown `--by` on a write command is rejected by the strict-flag seam (exit 2 path)
 */

import { describe, it, expect, vi } from "vitest";
import type { CommandDef } from "citty";
import { READ_SIDE_BY_FILTERS } from "../../../src/adapters/read-side-by-filters.js";
import { findUnknownFlag } from "../../../src/adapters/cli/strict-flags.js";

// reason: command modules import `loader.ts` -> `app.ts` -> `bun:sqlite`, which vitest (node) cannot
// resolve. Registry WALKING never opens a store, so an inert stand-in is enough.
vi.mock("bun:sqlite", () => ({ Database: class {} }));

type Resolvable<T> = T | Promise<T> | (() => T | Promise<T>);

async function resolveValue<T>(value: Resolvable<T> | undefined): Promise<T | undefined> {
  if (value === undefined) return undefined;
  return typeof value === "function" ? await (value as () => T | Promise<T>)() : await value;
}

interface CliLeaf {
  readonly path: string;
  readonly topLevel: string;
  readonly argNames: readonly string[];
  readonly def: CommandDef;
}

async function walk(def: CommandDef, path: string[], topLevel: string, out: CliLeaf[]): Promise<void> {
  const subCommands = (await resolveValue(def.subCommands as Resolvable<Record<string, Resolvable<CommandDef>>>)) ?? {};
  const args = (await resolveValue(def.args as Resolvable<Record<string, unknown>>)) ?? {};
  const names = Object.keys(subCommands);
  if (typeof def.run === "function" || names.length === 0) {
    out.push({ path: path.join(" "), topLevel, argNames: Object.keys(args), def });
  }
  for (const name of names) {
    const child = await resolveValue(subCommands[name]);
    if (child !== undefined) await walk(child, [...path, name], topLevel, out);
  }
}

async function collectCliLeaves(): Promise<CliLeaf[]> {
  const main = (await import("../../../src/adapters/cli/index.js")).default as CommandDef;
  const top = (await resolveValue(main.subCommands as Resolvable<Record<string, Resolvable<CommandDef>>>)) ?? {};
  const out: CliLeaf[] = [];
  for (const name of Object.keys(top)) {
    const def = await resolveValue(top[name]);
    if (def === undefined) throw new Error(`registry entry ${name} resolved to nothing`);
    await walk(def, [name], name, out);
  }
  return out;
}

// reason: `ac supersede --by <spec>:<AC>` names the AC that REPLACES the superseded one; it is a criterion reference, not a
// writer's name, so it neither attributes the write nor belongs in the read-side actor filters. Pinned by name so a second
// non-actor `by` cannot slip in unnoticed.
const NON_ACTOR_BY_LEAVES: readonly string[] = ["ac supersede"];

const CLI_ALLOWED = [...READ_SIDE_BY_FILTERS.map((f) => f.verb), ...NON_ACTOR_BY_LEAVES].sort();

describe("AC-ROI-1 write commands take no `by`", () => {
  it("AC-ROI-1: the CLI leaves declaring `by` are exactly the pinned read-side allowlist", async () => {
    const leaves = await collectCliLeaves();
    expect(leaves.length).toBeGreaterThan(60);
    const declaring = leaves.filter((l) => l.argNames.includes("by")).map((l) => l.path).sort();
    expect(declaring).toEqual(CLI_ALLOWED);
  });

  it("AC-ROI-1: no CLI leaf declares the `reviewer` alias of `by`", async () => {
    const leaves = await collectCliLeaves();
    expect(leaves.filter((l) => l.argNames.includes("reviewer")).map((l) => l.path)).toEqual([]);
  });

  it("AC-ROI-1: nested group leaves are walked (gate/phase/ac/anchor/scope are in the walk)", async () => {
    const paths = (await collectCliLeaves()).map((l) => l.path);
    for (const expected of ["gate task-claim", "phase add", "ac add", "anchor add", "scope add", "rule add", "baseline add"]) {
      expect(paths, `${expected} missing from the registry walk`).toContain(expected);
    }
  });

  it("AC-ROI-1: the strict-flag seam rejects `--by` on a write command", async () => {
    const leaves = await collectCliLeaves();
    const claim = leaves.find((l) => l.path === "claim");
    expect(claim).toBeDefined();
    const args = (await resolveValue(claim!.def.args as Resolvable<Record<string, unknown>>)) ?? {};
    expect(findUnknownFlag(["t", "--by", "x"], args as never)).toBe("--by");
  });
});
