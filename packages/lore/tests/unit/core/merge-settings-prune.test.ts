/**
 * RED test scenarios for `mergeSettings` orphan pruning (SPEC-076 §C5, task
 * T7 "mergeSettings orphan pruning + backup prune keep-5"). Written BEFORE
 * the implementation exists — see the "Expected interface" section below for
 * the contract the paired implementation task (T7,
 * task-skill-implement-t7-mergesettings-orphan-pruning-backup) must satisfy.
 *
 * Problem this closes: `mergeSettings` (packages/core/src/merge-settings.ts)
 * currently identifies a "lore-managed" hook entry SOLELY by an exact
 * `command` string match against the CALLER-SUPPLIED `loreEntries` (the NEW
 * desired set). A hook that lore registered in a PAST run but that is no
 * longer part of `loreEntries` at all (e.g. the hook file was renamed or
 * removed upstream) is invisible to that match — it is neither in the
 * "strip" set (stage 1) nor re-added (stage 2), so it survives forever as an
 * orphaned registration pointing at a file that no longer exists. SPEC-076
 * §C5 fixes this with a SEPARATE ownership signal: any hooks-directory path
 * PREFIX recognizable independent of the current `loreEntries` payload.
 *
 * Expected interface (not yet implemented — this is what T7 must build):
 *   - `MergeSettingsInput` gains an OPTIONAL `hooksPathPrefix?: string`.
 *     When absent, behavior is 100% unchanged from today (backward
 *     compatible with every pre-existing `mergeSettings` test — see the
 *     REGRESSION scenario below). When present, stage 1 ALSO strips any
 *     existing hook entry recognized as lore-owned by path — a
 *     whitespace-delimited TOKEN of `command` starts with `hooksPathPrefix`,
 *     NOT a raw substring test (assess follow-up, 2026-07-25 — a raw
 *     substring would also match a foreign command that merely references
 *     the hooks path as an argument value, see SCENARIO 5 below) — AND is
 *     NOT a member of the current `loreEntries`' command set (an "orphan")
 *     — on top of the existing exact-match strip.
 *   - `MergeSettingsResult` gains a `prunedCount: number` field — the count
 *     of entries removed BY THE ORPHAN RULE specifically (never by the
 *     pre-existing "same entry, being re-added" strip/re-add cycle in
 *     stages 1+2, which is a replace, not a prune — see scenario 3).
 *
 * @spec_ref SPEC-076 §C5 (task-skill-test-t7r-orphan-backup-pruning-red-test-scenarios)
 */

import { describe, it, expect } from "vitest";
import { mergeSettings } from "@lore/core";

const HOOKS_PREFIX = "/Users/agent/.claude/hooks/";

describe("mergeSettings — orphan pruning (SPEC-076 §C5)", () => {
  it("SCENARIO 1: a lore-owned hook (command under hooksPathPrefix) absent from the new payload is removed, prunedCount = 1", () => {
    const existingRaw = JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [{ type: "command", command: `${HOOKS_PREFIX}old-hook.mjs` }],
          },
        ],
      },
    });

    const result = mergeSettings({
      existingRaw,
      loreEntries: [], // old-hook.mjs is no longer part of the desired set
      hooksPathPrefix: HOOKS_PREFIX,
    } as Parameters<typeof mergeSettings>[0]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const merged = result.value.merged as { hooks?: Record<string, unknown> };
    const serialized = JSON.stringify(merged.hooks ?? {});
    expect(serialized).not.toContain("old-hook.mjs");
    expect((result.value as unknown as { prunedCount: number }).prunedCount).toBe(1);
  });

  it("SCENARIO 2: a foreign (non-lore) entry is byte-identical in the output regardless of the payload", () => {
    const foreignGroup = {
      matcher: "Bash",
      hooks: [{ type: "command", command: "/usr/local/bin/some-foreign-tool.sh" }],
    };
    const existingRaw = JSON.stringify({
      hooks: {
        PreToolUse: [foreignGroup],
      },
    });

    const result = mergeSettings({
      existingRaw,
      loreEntries: [{ event: "Stop", command: `${HOOKS_PREFIX}new-hook.mjs` }],
      hooksPathPrefix: HOOKS_PREFIX,
    } as Parameters<typeof mergeSettings>[0]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const merged = result.value.merged as { hooks?: { PreToolUse?: unknown[] } };
    expect(merged.hooks?.PreToolUse).toEqual([foreignGroup]);
    expect((result.value as unknown as { prunedCount: number }).prunedCount).toBe(0);
  });

  it("SCENARIO 3: a lore-owned entry whose file IS in the payload is preserved — no false prune", () => {
    const existingRaw = JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [{ type: "command", command: `${HOOKS_PREFIX}keep-hook.mjs` }],
          },
        ],
      },
    });

    const result = mergeSettings({
      existingRaw,
      loreEntries: [{ event: "Stop", command: `${HOOKS_PREFIX}keep-hook.mjs` }],
      hooksPathPrefix: HOOKS_PREFIX,
    } as Parameters<typeof mergeSettings>[0]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const merged = result.value.merged as { hooks?: Record<string, unknown> };
    const serialized = JSON.stringify(merged.hooks ?? {});
    expect(serialized).toContain("keep-hook.mjs");
    expect((result.value as unknown as { prunedCount: number }).prunedCount).toBe(0);
  });

  it("SCENARIO 4: payload renames hook A→B — output contains B's registration and not A's (rename = prune old + insert new)", () => {
    const existingRaw = JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [{ type: "command", command: `${HOOKS_PREFIX}hook-a.mjs` }],
          },
        ],
      },
    });

    const result = mergeSettings({
      existingRaw,
      loreEntries: [{ event: "Stop", command: `${HOOKS_PREFIX}hook-b.mjs` }],
      hooksPathPrefix: HOOKS_PREFIX,
    } as Parameters<typeof mergeSettings>[0]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const merged = result.value.merged as { hooks?: Record<string, unknown> };
    const serialized = JSON.stringify(merged.hooks ?? {});
    expect(serialized).toContain("hook-b.mjs");
    expect(serialized).not.toContain("hook-a.mjs");
    expect((result.value as unknown as { prunedCount: number }).prunedCount).toBe(1);
  });

  it("SCENARIO 5: a foreign command that merely CONTAINS hooksPathPrefix as a substring inside a longer, unrelated path/argument survives untouched (path-boundary match, never a raw substring test)", () => {
    // Deliberately NOT a lore hook registration — a foreign backup/restore
    // tool invoked with the hooks directory as an ARGUMENT VALUE. The
    // substring `${HOOKS_PREFIX}` is present in the command string, but it
    // does not anchor any whitespace-delimited TOKEN (the token is
    // "--source=/Users/agent/.claude/hooks/old.mjs.bak", which starts with
    // "--source=", not with HOOKS_PREFIX) — a naive `command.includes(...)`
    // test would wrongly prune this, violating AC-076-5's "leaves non-lore
    // entries byte-identical" half.
    const foreignCommand = `backup-restore --source=${HOOKS_PREFIX}old.mjs.bak --dry-run`;
    const foreignGroup = {
      hooks: [{ type: "command", command: foreignCommand }],
    };
    const existingRaw = JSON.stringify({
      hooks: {
        Stop: [foreignGroup],
      },
    });

    const result = mergeSettings({
      existingRaw,
      loreEntries: [], // foreignCommand is not lore's — never part of any desired set
      hooksPathPrefix: HOOKS_PREFIX,
    } as Parameters<typeof mergeSettings>[0]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const merged = result.value.merged as { hooks?: { Stop?: unknown[] } };
    expect(merged.hooks?.Stop).toEqual([foreignGroup]);
    expect((result.value as unknown as { prunedCount: number }).prunedCount).toBe(0);
  });

  it("REGRESSION: omitting hooksPathPrefix disables orphan pruning entirely (legacy call sites stay byte-identical)", () => {
    const existingRaw = JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [{ type: "command", command: `${HOOKS_PREFIX}old-hook.mjs` }],
          },
        ],
      },
    });

    // No hooksPathPrefix at all — mirrors every pre-SPEC-076 mergeSettings call site.
    const result = mergeSettings({ existingRaw, loreEntries: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const merged = result.value.merged as { hooks?: Record<string, unknown> };
    const serialized = JSON.stringify(merged.hooks ?? {});
    // Without an ownership signal, mergeSettings cannot know old-hook.mjs is lore's —
    // legacy (pre-orphan-pruning) behavior leaves it untouched.
    expect(serialized).toContain("old-hook.mjs");
    expect((result.value as unknown as { prunedCount: number }).prunedCount ?? 0).toBe(0);
  });
});
