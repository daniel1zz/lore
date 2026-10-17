// @reads CLAUDE.md
// @reads assets/**
// @reads packages/core/src/**
// @reads packages/lore/src/**
/**
 * AC-ROI-8 (spec-run-only-write-identity-and-run-end-claim-release): a retired identity mechanism is
 * never named in shipped text — not even as a prohibition.
 *
 * `LORE_ACTOR` must have ZERO occurrences in: every CLI help string (command/arg descriptions of the
 * real registry), non-test source (`packages/lore/src`, `packages/core/src`, comments included), the
 * shipped `assets/**`, and the repo `CLAUDE.md`. The positive counterpart pins that the two operator-facing
 * recovery texts name the agent-integration path (`lore setup`) instead.
 *
 * Files are read as raw bytes (`Buffer#includes`), never through a grep exit code: a binary file would
 * make grep print "Binary file matches" / exit differently and a zero-hit verdict would be untrustworthy.
 *
 * Coverage:
 *   NEGATIVE:   the needle is absent from help strings, src, core src, assets, CLAUDE.md
 *   BOUNDARY:   every walked tree is non-trivially populated (an empty walk cannot pass), binary-safe read
 *   HAPPY:      the OS-fallback warning and the anchor-overlap / actor-identity recovery hints name `lore setup`
 *   REGRESSION: the recovery hints name no removed `--by` flag
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { CommandDef } from "citty";
import { checkpointRegistry, selectFailures } from "../../../src/service/checkpoint-registry.js";
import type { GateContext } from "../../../src/service/checkpoint-registry.js";

// reason: command modules import `loader.ts` -> `app.ts` -> `bun:sqlite` (unresolvable under vitest/node);
// walking the registry never opens a store.
vi.mock("bun:sqlite", () => ({ Database: class {} }));

const NEEDLE = Buffer.from("LORE_ACTOR");
const REPO_ROOT = resolve(import.meta.dirname, "../../../../..");

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else out.push(full);
  }
  return out;
}

function filesNamingNeedle(files: readonly string[]): string[] {
  return files.filter((f) => readFileSync(f).includes(NEEDLE)).map((f) => relative(REPO_ROOT, f));
}

type Resolvable<T> = T | Promise<T> | (() => T | Promise<T>);

async function resolveValue<T>(value: Resolvable<T> | undefined): Promise<T | undefined> {
  if (value === undefined) return undefined;
  return typeof value === "function" ? await (value as () => T | Promise<T>)() : await value;
}

/** Every help string of the real registry: group/command descriptions and every arg description. */
async function collectHelpStrings(): Promise<string[]> {
  const main = (await import("../../../src/adapters/cli/index.js")).default as CommandDef;
  const out: string[] = [];
  async function visit(def: CommandDef): Promise<void> {
    const meta = await resolveValue(def.meta as Resolvable<{ description?: string } | undefined>);
    if (meta?.description !== undefined) out.push(meta.description);
    const args = (await resolveValue(def.args as Resolvable<Record<string, { description?: string }>>)) ?? {};
    for (const arg of Object.values(args)) if (arg.description !== undefined) out.push(arg.description);
    const subs = (await resolveValue(def.subCommands as Resolvable<Record<string, Resolvable<CommandDef>>>)) ?? {};
    for (const sub of Object.values(subs)) {
      const child = await resolveValue(sub);
      if (child !== undefined) await visit(child);
    }
  }
  await visit(main);
  return out;
}

describe("AC-ROI-8 no LORE_ACTOR in shipped text", () => {
  it("AC-ROI-8: no CLI help string names LORE_ACTOR", async () => {
    const strings = await collectHelpStrings();
    expect(strings.length).toBeGreaterThan(500);
    expect(strings.filter((s) => s.includes("LORE_ACTOR"))).toEqual([]);
  });

  it("AC-ROI-8: no non-test source under packages/lore/src names LORE_ACTOR (comments included)", () => {
    const files = listFiles(join(REPO_ROOT, "packages/lore/src"));
    expect(files.length).toBeGreaterThan(300);
    expect(filesNamingNeedle(files)).toEqual([]);
  });

  it("AC-ROI-8: no source under packages/core/src names LORE_ACTOR (comments included)", () => {
    const files = listFiles(join(REPO_ROOT, "packages/core/src"));
    expect(files.length).toBeGreaterThan(30);
    expect(filesNamingNeedle(files)).toEqual([]);
  });

  it("AC-ROI-8: no shipped asset names LORE_ACTOR", () => {
    const files = listFiles(join(REPO_ROOT, "assets"));
    expect(files.length).toBeGreaterThan(100);
    expect(filesNamingNeedle(files)).toEqual([]);
  });

  it("AC-ROI-8: the repo CLAUDE.md does not name LORE_ACTOR", () => {
    expect(filesNamingNeedle([join(REPO_ROOT, "CLAUDE.md")])).toEqual([]);
  });

  it("AC-ROI-8: the scanner itself sees the needle in a binary-looking buffer (read is byte-based)", () => {
    const withNul = Buffer.concat([Buffer.from([0, 1, 2, 0]), NEEDLE, Buffer.from([0, 255])]);
    expect(withNul.includes(NEEDLE)).toBe(true);
  });
});

describe("AC-ROI-8 positive counterpart: recovery texts name the agent-integration path", () => {
  const taskClaim = checkpointRegistry["task-claim"]!;

  function feedFor(ctx: GateContext): string {
    return taskClaim.feed(ctx, selectFailures(taskClaim.check(ctx)));
  }

  const sibling = { slug: "task-one", title: "Task One", by: "agent:t1", at: "2026-07-11T09:00:00.000Z", stale: false, anchors: ["src/a/"] };

  it("AC-ROI-8: the foreign-actor anchor-overlap hint stays free of any removed flag", () => {
    const text = feedFor({ candidateBy: "agent:t2", candidateAnchors: ["src/a"], siblingClaims: [sibling], hasSpecParent: false });
    expect(text).toContain("task-one");
    expect(text).not.toContain("--by");
    expect(text).not.toContain("LORE_ACTOR");
  });

  it("AC-ROI-8: the session-not-measured anchor-overlap hint names the agent integration (`lore setup`)", () => {
    const text = feedFor({ candidateBy: "agent:t1", candidateAnchors: ["src/a"], siblingClaims: [sibling], hasSpecParent: false });
    expect(text).toContain("NOT MEASURED");
    expect(text).toContain("lore setup");
    expect(text).toContain("agent integration");
    expect(text).not.toContain("--by");
  });

  it("AC-ROI-8: the foreign-session anchor-overlap hint names the agent integration (`lore setup`)", () => {
    const text = feedFor({
      candidateBy: "agent:t1",
      candidateAnchors: ["src/a"],
      candidateSessionId: "aaaa1111",
      siblingClaims: [{ ...sibling, session_id: "bbbb2222" }],
      hasSpecParent: false,
    });
    expect(text).toContain("DIFFERENT session");
    expect(text).toContain("lore setup");
    expect(text).not.toContain("--by");
    expect(text).not.toContain("LORE_ACTOR");
  });

  it("AC-ROI-8: the actor-identity collision hint names the agent integration (`lore setup`)", () => {
    const text = feedFor({
      candidateBy: "zheng",
      candidateIdentitySource: "os-fallback",
      candidateWorktree: "/wt/a",
      candidateMachine: "m1",
      candidateAnchors: [],
      siblingClaims: [{ ...sibling, by: "zheng", worktree: "/wt/b", machine: "m1", anchors: [] }],
      hasSpecParent: false,
    });
    expect(text).toContain("Conflicting task: task-one");
    expect(text).toContain("lore setup");
    expect(text).toContain("agent integration");
    expect(text).not.toContain("--by");
    expect(text).not.toContain("LORE_ACTOR");
  });

  describe("OS-fallback warning", () => {
    const scratch: string[] = [];
    afterEach(() => {
      vi.restoreAllMocks();
      for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    it("AC-ROI-8: the OS-username warning names `lore setup` and the attested run", async () => {
      const cwd = mkdtempSync(join(tmpdir(), "no-lore-actor-"));
      scratch.push(cwd);
      const written: string[] = [];
      vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
        written.push(String(chunk));
        return true;
      });
      const { resolveActorWithIdentitySource } = await import("../../../src/adapters/cli/utils.js");
      const resolved = resolveActorWithIdentitySource(undefined, {}, cwd);
      expect(resolved.source).toBe("os-fallback");
      const warning = written.join("");
      expect(warning).toContain("lore setup");
      expect(warning).toContain("attested run");
      expect(warning).not.toContain("LORE_ACTOR");
    });
  });
});
