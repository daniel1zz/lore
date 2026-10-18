/**
 * AC-IV-3 / AS-27: the user-level state guard fails a run that changed a lore-owned path of the
 * STARTING HOME. Drives the pure core against a mkdtemp fixture home, never the real one.
 * @layer unit
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  UserStateWrittenDuringRunError,
  assertUserStateUnchanged,
  diffUserState,
  resolveUserStateRoots,
  snapshotUserState,
} from "../test-user-state-guard";

let home: string;
let roots: ReturnType<typeof resolveUserStateRoots>;

function put(rel: string, body: string): string {
  const abs = join(home, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body);
  return abs;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "iv-user-state-"));
  put(".claude/rules/lore-a.md", "rule a");
  put(".claude/rules/mine.md", "not lore owned");
  put(".claude/skills/lore-x/SKILL.md", "skill");
  put(".claude/CLAUDE.md", "memory");
  put(".claude/settings.json", "{}");
  put(".claude/hooks/h.mjs", "hook");
  put(".claude/agents/lore-impl.md", "agent");
  put(".config/lore/config.json", "{}");
  put(".claude/projects/p/session.jsonl", "live");
  roots = resolveUserStateRoots(home, {});
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function expectFailure(mutate: () => void, changedPath: string): void {
  const before = snapshotUserState(roots);
  mutate();
  expect(() => assertUserStateUnchanged(before, roots)).toThrow(UserStateWrittenDuringRunError);
  let message = "";
  try {
    assertUserStateUnchanged(before, roots);
  } catch (caught) {
    message = (caught as Error).message;
  }
  expect(message).toContain(changedPath);
  expect(message).toContain("AS-27");
}

describe("AC-IV-3 user-state guard", () => {
  it("AC-IV-3 an unchanged run passes", () => {
    const before = snapshotUserState(roots);
    expect(() => assertUserStateUnchanged(before, roots)).not.toThrow();
  });

  it("AC-IV-3 a run that changes only .claude/projects/ or a non-lore rule passes", () => {
    const before = snapshotUserState(roots);
    put(".claude/projects/p/session.jsonl", "more live data");
    put(".claude/projects/q/new.jsonl", "new");
    put(".claude/rules/mine.md", "edited, not lore owned");
    expect(() => assertUserStateUnchanged(before, roots)).not.toThrow();
  });

  it.each([
    ["rule", ".claude/rules/lore-a.md"],
    ["skill", ".claude/skills/lore-x/SKILL.md"],
    ["claude memory", ".claude/CLAUDE.md"],
    ["settings", ".claude/settings.json"],
    ["hook", ".claude/hooks/h.mjs"],
    ["agent", ".claude/agents/lore-impl.md"],
    ["lore settings", ".config/lore/config.json"],
  ])("AC-IV-3 a content change to a %s fails naming the path and AS-27", (_name, rel) => {
    expectFailure(() => put(rel, "CHANGED BODY"), join(home, rel));
  });

  it("AC-IV-3 a same-size content change is caught (hash, not size)", () => {
    expectFailure(() => put(".claude/rules/lore-a.md", "rule b"), join(home, ".claude/rules/lore-a.md"));
  });

  it("AC-IV-3 an added lore-owned file fails", () => {
    expectFailure(() => put(".claude/rules/lore-new.md", "x"), join(home, ".claude/rules/lore-new.md"));
  });

  it("AC-IV-3 a deleted lore-owned file fails", () => {
    expectFailure(() => unlinkSync(join(home, ".claude/rules/lore-a.md")), join(home, ".claude/rules/lore-a.md"));
  });

  it("AC-IV-3 one line per changed path", () => {
    const before = snapshotUserState(roots);
    put(".claude/CLAUDE.md", "z");
    put(".claude/settings.json", "[]");
    expect(diffUserState(before, snapshotUserState(roots))).toEqual([
      `changed: ${join(home, ".claude/CLAUDE.md")}`,
      `changed: ${join(home, ".claude/settings.json")}`,
    ]);
  });

  it("AC-IV-3 settings folder resolution: LORE_CONFIG_HOME, then XDG_CONFIG_HOME/lore, then ~/.config/lore", () => {
    expect(resolveUserStateRoots(home, { LORE_CONFIG_HOME: "/a", XDG_CONFIG_HOME: "/b" }).settingsDir).toBe("/a");
    expect(resolveUserStateRoots(home, { XDG_CONFIG_HOME: "/b" }).settingsDir).toBe("/b/lore");
    expect(resolveUserStateRoots(home, {}).settingsDir).toBe(join(home, ".config", "lore"));
  });

  it("AC-IV-3 a missing home subtree snapshots as empty and does not throw", () => {
    const empty = mkdtempSync(join(tmpdir(), "iv-user-state-empty-"));
    try {
      expect(snapshotUserState(resolveUserStateRoots(empty, {})).size).toBe(0);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
