/**
 * Settings-merge domain — pure, fail-loud JSON merge of lore-managed hook
 * entries into a Claude Code `settings.json` document. Pure, browser-safe
 * module: no IO, no `Date.now()`/`Math.random()` calls, no filesystem access
 * (the caller reads/writes the actual file; this module only transforms
 * strings/objects already in memory).
 *
 * Public surface:
 *   - SettingsHookEntry — one lore-managed hook registration
 *   - MergeSettingsInput / MergeSettingsResult — mergeSettings' I/O shapes
 *   - mergeSettings(input) — the pure merge function
 *
 * Invariants:
 *   - NEVER throws — every malformed input (invalid JSON syntax, a non-object
 *     top level, a non-object/non-array `hooks` substructure) is translated
 *     into `err(VALIDATION_ERROR)`, never a thrown exception and never a
 *     partially-built result (SPEC-046 I1).
 *   - Structural preservation — every top-level key OTHER than `hooks`, and
 *     every `hooks[event]` matcher-group that contains zero lore-managed
 *     entries, is carried into the output UNCHANGED (deep-equal to the
 *     input). Only entries this function itself owns (identified by exact
 *     `command` string match against `loreEntries`) are ever added or removed.
 *   - Identification, not ownership metadata — a previously-written lore hook
 *     entry is recognized SOLELY by its `command` string exactly matching one
 *     of `loreEntries`' commands, regardless of which event/matcher it
 *     currently sits under. There is no separate "owned by lore" marker field
 *     in `settings.json` itself.
 *   - Idempotent — calling `mergeSettings` again with the SAME `loreEntries`
 *     against its own previous output (serialized back to a string) yields
 *     `changed: false` and a merged object deep-equal to the input (SPEC-046
 *     I2's merge-settings half): stage 1 strips the exact entries stage 2 of
 *     the prior call added, then stage 2 re-adds the identical set.
 *   - `loreEntries: []` is a valid input, but NOT a general-purpose "strip
 *     everything lore ever wrote" operation — identification is solely by
 *     matching a `command` string PRESENT in `loreEntries` (see the bullet
 *     above), so an empty `loreEntries` matches nothing and removes nothing.
 *     Combined with a hooks-free (or already-empty) existing config it is a
 *     true no-op. `settings.json`'s uninstall path is the service layer's
 *     byte-restore-from-backup (SPEC-046 §Scope: "restore-from-backup is THE
 *     uninstall mechanism for merge-target files"), never a `mergeSettings`
 *     call with an empty entry list.
 *   - **Orphan pruning (SPEC-076 §C5, OPTIONAL, additive)** — `loreEntries`'
 *     exact-`command`-match identification above has a gap: a hook lore
 *     registered in a PAST run that is no longer part of `loreEntries` AT ALL
 *     (renamed/removed upstream) is invisible to that match and survives
 *     forever. When the caller supplies `hooksPathPrefix`, stage 1 ALSO
 *     strips any hook entry recognized as lore-owned-by-path (see
 *     `commandReferencesHooksPath` below) AND is NOT a member of the current
 *     `loreEntries`' command set — an "orphan". `hooksPathPrefix` is OPTIONAL
 *     and OFF by default: omitting it (every pre-SPEC-076 call site) leaves
 *     behavior 100% unchanged — orphan pruning never runs, and a stale entry
 *     survives exactly as before (see the REGRESSION scenario in
 *     `merge-settings-prune.test.ts`). `MergeSettingsResult.prunedCount`
 *     counts ONLY entries removed by this orphan rule — never the
 *     pre-existing "same entry, being re-added" strip/re-add cycle (stages
 *     1+2 together), which is a replace, not a prune.
 *   - **Path-boundary match, never a raw substring test (assess follow-up,
 *     2026-07-25)** — `commandReferencesHooksPath` requires `hooksPathPrefix`
 *     to anchor a whitespace-delimited TOKEN of `command`
 *     (`token.startsWith(hooksPathPrefix)` for some token in
 *     `command.split(/\s+/)`), matching production `command` shapes of both
 *     a bare path (`"<path>"`) and `"<runner> <path> [args...]"` (e.g.
 *     `"node /x/.claude/hooks/foo.mjs"`). A bare `command.includes(...)`
 *     substring test was tried first and rejected: it would ALSO match a
 *     genuinely foreign command that merely references the hooks path as an
 *     ARGUMENT VALUE or inside an unrelated longer path (e.g.
 *     `"backup-restore --source=/x/.claude/hooks/old.mjs.bak"`), wrongly
 *     pruning a registration lore never owned — a direct violation of
 *     AC-076-5's "leaves non-lore entries byte-identical" half. See the
 *     foreign-command NEGATIVE scenario in `merge-settings-prune.test.ts`.
 *
 * Source: SPEC-046 §Design ("`merge-settings.ts`"), §Scope ("settings.json merge"), §Design I1.
 *   SPEC-076 §C5 (orphan pruning) — task-skill-implement-t7-mergesettings-orphan-pruning-backup.
 */

import { err, ok } from "./errors.js";
import type { Result, LoreError } from "./errors.js";

/** One lore-managed hook registration to be present in `settings.json` after the merge. */
export interface SettingsHookEntry {
  /** Hook event name, e.g. `"PreToolUse"`, `"Stop"`, `"SubagentStart"`. */
  event: string;
  /** Optional tool/agent matcher (Claude Code's `hooks[event][].matcher`). */
  matcher?: string;
  /** The exact shell command string — this is the identity key for merge/strip. */
  command: string;
  /** Optional per-hook budget in seconds; emitted as `timeout` on the settings hook object. */
  timeout?: number;
}

/** Input to {@link mergeSettings}. Deliberately narrow — never the full setup manifest. */
export interface MergeSettingsInput {
  /**
   * Raw `settings.json` file content, or `null`/empty string when the file
   * does not exist yet (treated identically — both mean "start from `{}`").
   */
  existingRaw: string | null;
  /** The complete desired set of lore-managed hook entries after this merge. */
  loreEntries: SettingsHookEntry[];
  /**
   * OPTIONAL (SPEC-076 §C5) — when present, enables orphan pruning: any
   * existing hook entry whose `command` CONTAINS this string AND is NOT a
   * member of `loreEntries`' command set is stripped as an orphaned past
   * lore registration, on top of the existing exact-match strip. Absent
   * (the default) disables orphan pruning entirely — see this module's
   * "Orphan pruning" invariant.
   */
  hooksPathPrefix?: string;
}

/** Output of a successful {@link mergeSettings} call. */
export interface MergeSettingsResult {
  /** The full new `settings.json` content (JSON-serializable plain object). */
  merged: Record<string, unknown>;
  /** `true` iff `merged` is NOT deep-equal to the parsed `existingRaw` input. */
  changed: boolean;
  /**
   * Count of entries removed by the orphan-pruning rule specifically
   * (SPEC-076 §C5) — always `0` when `hooksPathPrefix` was omitted. Never
   * counts the pre-existing exact-match strip/re-add cycle (a replace, not a
   * prune).
   */
  prunedCount: number;
}

/** One Claude Code `hooks[event][]` matcher-group, in its on-disk shape. */
interface HookGroup {
  matcher?: string;
  hooks: Array<{ type: "command"; command: string; timeout?: number }>;
}

/** Narrow runtime type guard — true for non-null, non-array JSON objects. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Path-boundary test behind SPEC-076 §C5 orphan pruning — TRUE iff
 * `hooksPathPrefix` anchors the START of some whitespace-delimited TOKEN of
 * `command`, never a raw substring anywhere in the string. Production
 * `command` values take one of two shapes: a bare path (`"<path>"`) or
 * `"<runner> <path> [args...]"` (e.g. `"node /x/.claude/hooks/foo.mjs"`) —
 * splitting on whitespace and checking `startsWith` per token matches both
 * without also matching a foreign command that merely references the hooks
 * directory as an argument VALUE or as a substring of an unrelated longer
 * path (e.g. `"backup-restore --source=/x/.claude/hooks/old.mjs.bak"` does
 * NOT match — that flag's value doesn't itself START with the prefix).
 *
 * @param command - The hook entry's full `command` string.
 * @param hooksPathPrefix - The lore-owned hooks-directory path prefix.
 * @returns `true` iff some token of `command` starts with `hooksPathPrefix`.
 */
function commandReferencesHooksPath(command: string, hooksPathPrefix: string): boolean {
  return command.split(/\s+/).some((token) => token.startsWith(hooksPathPrefix));
}

/**
 * Groups `entries` into fresh `hooks[event][]` matcher-groups (SPEC-046 merge
 * stage 2). Entries sharing the same `(event, matcher)` pair are combined
 * into one group's `hooks` array, first-seen order preserved; entries with no
 * `matcher` form their own no-matcher group per event.
 */
function groupLoreEntries(entries: SettingsHookEntry[]): Record<string, HookGroup[]> {
  const byEvent = new Map<string, Map<string, HookGroup>>();

  for (const entry of entries) {
    // `JSON.stringify` distinguishes "no matcher" (null) from matcher === "" —
    // a plain `matcher ?? ""` key would incorrectly collide those two cases.
    const matcherKey = JSON.stringify(entry.matcher ?? null);
    if (!byEvent.has(entry.event)) byEvent.set(entry.event, new Map());
    const groups = byEvent.get(entry.event) as Map<string, HookGroup>;
    if (!groups.has(matcherKey)) {
      groups.set(
        matcherKey,
        entry.matcher !== undefined ? { matcher: entry.matcher, hooks: [] } : { hooks: [] },
      );
    }
    (groups.get(matcherKey) as HookGroup).hooks.push({
      type: "command",
      command: entry.command,
      ...(entry.timeout !== undefined ? { timeout: entry.timeout } : {}),
    });
  }

  const result: Record<string, HookGroup[]> = {};
  for (const [event, groups] of byEvent) {
    result[event] = Array.from(groups.values());
  }
  return result;
}

/**
 * Merges `input.loreEntries` into `input.existingRaw`'s parsed JSON, replacing
 * every previously lore-managed hook entry (matched by exact `command`
 * string) with the fresh set, and leaving everything else byte-for-byte
 * untouched.
 *
 * Algorithm (never mutates its parsed input in place — builds a new object):
 *   1. Parse `existingRaw` (`null`/empty → `{}`). Invalid JSON syntax, or a
 *      non-object top level → `err(VALIDATION_ERROR)`.
 *   2. Read `hooks` (absent → `{}`; present but not a plain object →
 *      `err(VALIDATION_ERROR)`).
 *   3. For every `hooks[event][]` group: drop any hook entry whose `command`
 *      is in `loreEntries`' command set; drop the whole group if it becomes
 *      empty. A structurally malformed group/array anywhere in `hooks` →
 *      `err(VALIDATION_ERROR)` (never a throw, never a partial merge).
 *   4. Append fresh groups built from `loreEntries` (see
 *      {@link groupLoreEntries}) onto each `hooks[event]` array.
 *   5. `hooks` is included in the output iff it ends up non-empty OR the
 *      input already had a `hooks` key — this keeps a no-op call
 *      (`loreEntries: []` against a hooks-free `existingRaw`) reporting
 *      `changed: false` against a byte-identical `merged`, rather than
 *      spuriously introducing an empty `hooks: {}`.
 *
 * @param input - `{existingRaw, loreEntries, hooksPathPrefix?}` — see
 *   {@link MergeSettingsInput}.
 * @returns `ok({merged, changed, prunedCount})` or `err(VALIDATION_ERROR)`
 *   naming the exact malformed field. Never throws.
 *
 * @example
 * mergeSettings({ existingRaw: null, loreEntries: [{event: "Stop", command: "lore-hook.mjs"}] });
 * // => ok({ merged: { hooks: { Stop: [{ hooks: [{ type: "command", command: "lore-hook.mjs" }] }] } }, changed: true, prunedCount: 0 })
 *
 * @example
 * mergeSettings({ existingRaw: "{not json", loreEntries: [] });
 * // => err({ code: "VALIDATION_ERROR", field: "existingRaw", ... })
 */
export function mergeSettings(input: MergeSettingsInput): Result<MergeSettingsResult, LoreError> {
  const { existingRaw, loreEntries, hooksPathPrefix } = input;

  let parsed: Record<string, unknown>;
  if (existingRaw === null || existingRaw.trim() === "") {
    parsed = {};
  } else {
    let candidate: unknown;
    try {
      candidate = JSON.parse(existingRaw);
    } catch (cause) {
      return err({
        code: "VALIDATION_ERROR",
        field: "existingRaw",
        message: `existing settings.json is not valid JSON: ${(cause as Error).message}`,
        value: existingRaw.slice(0, 200),
        rule: "BR-820",
      });
    }
    if (!isPlainObject(candidate)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "existingRaw",
        message: "existing settings.json must parse to a JSON object at the top level",
        value: candidate,
        rule: "BR-820",
      });
    }
    parsed = candidate;
  }

  const before = JSON.stringify(parsed);
  const hadHooksKey = Object.prototype.hasOwnProperty.call(parsed, "hooks");
  const rawHooks = parsed["hooks"];

  let hooksObj: Record<string, unknown>;
  if (rawHooks === undefined) {
    hooksObj = {};
  } else if (isPlainObject(rawHooks)) {
    hooksObj = { ...rawHooks };
  } else {
    return err({
      code: "VALIDATION_ERROR",
      field: "hooks",
      message: "existing settings.json 'hooks' key must be a JSON object",
      value: rawHooks,
      rule: "BR-820",
    });
  }

  const loreCommands = new Set(loreEntries.map((e) => e.command));
  let prunedCount = 0;

  // Stage 1: strip every previously lore-managed hook entry (command match),
  // dropping any matcher-group left with zero hooks. When `hooksPathPrefix`
  // is present, ALSO strip an "orphan" — an entry recognized as lore-owned
  // by path (SPEC-076 §C5, path-boundary match — see
  // `commandReferencesHooksPath`) but no longer present in `loreEntries` at
  // all — counting each into `prunedCount`.
  for (const eventKey of Object.keys(hooksObj)) {
    const groups = hooksObj[eventKey];
    if (!Array.isArray(groups)) {
      return err({
        code: "VALIDATION_ERROR",
        field: `hooks.${eventKey}`,
        message: `existing settings.json 'hooks.${eventKey}' must be an array`,
        value: groups,
        rule: "BR-820",
      });
    }

    const survivors: unknown[] = [];
    for (const group of groups) {
      if (!isPlainObject(group)) {
        return err({
          code: "VALIDATION_ERROR",
          field: `hooks.${eventKey}`,
          message: `existing settings.json 'hooks.${eventKey}' entries must be objects`,
          value: group,
          rule: "BR-820",
        });
      }
      const groupHooks = group["hooks"];
      if (!Array.isArray(groupHooks)) {
        return err({
          code: "VALIDATION_ERROR",
          field: `hooks.${eventKey}`,
          message: `existing settings.json 'hooks.${eventKey}[].hooks' must be an array`,
          value: groupHooks,
          rule: "BR-820",
        });
      }
      const filteredHooks = groupHooks.filter((hook) => {
        if (!isPlainObject(hook)) return true; // foreign shape — leave untouched, don't strip
        const command = hook["command"];
        if (typeof command !== "string") return true;
        if (loreCommands.has(command)) return false; // exact-match strip (replace, not prune)
        if (hooksPathPrefix !== undefined && commandReferencesHooksPath(command, hooksPathPrefix)) {
          prunedCount += 1; // orphan: lore-owned by path, absent from the new payload
          return false;
        }
        return true;
      });
      if (filteredHooks.length > 0) {
        survivors.push({ ...group, hooks: filteredHooks });
      }
    }

    if (survivors.length > 0) {
      hooksObj[eventKey] = survivors;
    } else {
      delete hooksObj[eventKey];
    }
  }

  // Stage 2: append the fresh lore-managed groups.
  const freshGroups = groupLoreEntries(loreEntries);
  for (const [eventKey, groups] of Object.entries(freshGroups)) {
    const existingArr = Array.isArray(hooksObj[eventKey]) ? (hooksObj[eventKey] as unknown[]) : [];
    hooksObj[eventKey] = [...existingArr, ...groups];
  }

  const merged: Record<string, unknown> = { ...parsed };
  const hooksNowNonEmpty = Object.keys(hooksObj).length > 0;
  if (hooksNowNonEmpty || hadHooksKey) {
    merged["hooks"] = hooksObj;
  } else {
    delete merged["hooks"];
  }

  const after = JSON.stringify(merged);
  return ok({ merged, changed: before !== after, prunedCount });
}
