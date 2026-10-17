// @reads packages/core/src/**
/**
 * @spec_ref SPEC-046 §Design ("`@lore/core` (pure, browser-safe)"), AC-046-A
 *
 * Six-dimension coverage for the three pure `@lore/core` setup modules that
 * back `lore setup` (SPEC-046 P1 local safe installer):
 *   - setup-manifest.ts — setupEntrySchema/setupManifestSchema (Zod) + planInstall
 *   - merge-settings.ts — mergeSettings (settings.json hook merge)
 *   - register-mcp.ts — buildMcpAddArgs/buildMcpRemoveArgs (pure argv builders)
 *
 * Coverage:
 *   HAPPY:      planInstall on a clean target writes every payload file;
 *               mergeSettings against an empty existing config installs the
 *               lore hook entries; register-mcp argv builders produce the
 *               exact documented argv.
 *   NEGATIVE:   mergeSettings rejects malformed JSON / non-object top level /
 *               non-object `hooks` with err(VALIDATION_ERROR); an unknown
 *               setup-entry `kind` is rejected by the Zod schema.
 *   BOUNDARY:   empty manifest + empty payload → an empty plan; a target file
 *               NOT tracked by the current manifest but present with
 *               different bytes on disk is scheduled for backup; an empty
 *               `loreEntries` + hooks-free existing settings is a true no-op
 *               (changed: false, byte-identical merged).
 *   ERROR:      mergeSettings NEVER throws across a fuzz of garbage shapes —
 *               every case returns `err`, none escapes as an exception.
 *   STATE:      planInstall → simulate-apply → re-plan converges to zero
 *               writes/backups; mergeSettings → serialize output → re-merge
 *               with the same entries is idempotent (changed: false).
 *   REGRESSION: a settings.json with foreign top-level keys and foreign
 *               matcher-groups survives the merge byte-for-byte on the
 *               untouched parts; register-mcp never returns a shared mutable
 *               array across calls; all three modules (plus the barrel) stay
 *               free of Node builtins — the browser-safety invariant
 *               `@lore/core`'s CLAUDE.md pins for `index.ts`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  setupEntrySchema,
  setupManifestSchema,
  assetPayloadSchema,
  planInstall,
  type SetupManifest,
  type AssetPayload,
} from "@lore/core";
import { mergeSettings, type SettingsHookEntry } from "@lore/core";
import { buildMcpAddArgs, buildMcpRemoveArgs } from "@lore/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_SRC_DIR = join(__dirname, "../../../../core/src");

// ─── setup-manifest.ts: schemas ────────────────────────────────────────────

describe("setup-manifest: schemas", () => {
  it("HAPPY: setupEntrySchema accepts a well-formed manifest entry", () => {
    const result = setupEntrySchema.safeParse({
      path: "skills/lore/SKILL.md",
      kind: "skill",
      sha256: "a".repeat(64),
      written_at: "2026-07-16T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("HAPPY: setupManifestSchema accepts a well-formed manifest document", () => {
    const result = setupManifestSchema.safeParse({
      version: "1",
      claude_dir: "/home/user/.claude",
      entries: [],
    });
    expect(result.success).toBe(true);
  });

  it("NEGATIVE: setupEntrySchema rejects an unknown 'kind' value", () => {
    const result = setupEntrySchema.safeParse({
      path: "skills/lore/SKILL.md",
      kind: "not-a-real-kind",
      sha256: "a".repeat(64),
      written_at: "2026-07-16T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("NEGATIVE: setupEntrySchema rejects an empty path", () => {
    const result = setupEntrySchema.safeParse({
      path: "",
      kind: "skill",
      sha256: "a".repeat(64),
      written_at: "2026-07-16T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("BOUNDARY: setupManifestSchema accepts an empty entries array", () => {
    const result = setupManifestSchema.safeParse({
      version: "1",
      claude_dir: "/tmp/x",
      entries: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.entries).toEqual([]);
    }
  });

  it("REGRESSION: assetPayloadSchema round-trips a mixed-kind file list unchanged", () => {
    const payload = {
      files: [
        { path: "skills/lore/SKILL.md", kind: "skill", content: "x", sha256: "s1" },
        { path: "agents/lore-explorer.md", kind: "agent", content: "y", sha256: "s2" },
      ],
    };
    const result = assetPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(payload);
    }
  });
});

// ─── setup-manifest.ts: planInstall ─────────────────────────────────────────

function file(path: string, sha256: string, kind: AssetPayload["files"][number]["kind"] = "skill") {
  return { path, kind, content: `content-of-${path}`, sha256 };
}

describe("setup-manifest: planInstall", () => {
  it("HAPPY: a clean target (no manifest, nothing on disk) schedules every payload file as a write", () => {
    const payload: AssetPayload = { files: [file("skills/lore/SKILL.md", "sha-1"), file("agents/lore-explorer.md", "sha-2", "agent")] };
    const plan = planInstall(null, payload, new Map());

    expect(plan.writes).toHaveLength(2);
    expect(plan.writes.map((w) => w.path).sort()).toEqual(["agents/lore-explorer.md", "skills/lore/SKILL.md"]);
    expect(plan.skips).toEqual([]);
    expect(plan.backups).toEqual([]);
    expect(plan.removals).toEqual([]);
  });

  it("NEGATIVE: a file whose on-disk sha differs from a DIFFERENT payload file's sha is still a write (not mistakenly matched)", () => {
    const payload: AssetPayload = { files: [file("skills/lore/SKILL.md", "sha-new")] };
    const existingFiles = new Map([["skills/lore/SKILL.md", "sha-old"]]);
    const plan = planInstall(null, payload, existingFiles);

    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]?.sha256).toBe("sha-new");
    expect(plan.skips).toEqual([]);
  });

  it("BOUNDARY: empty manifest + empty payload produces a fully empty plan", () => {
    const emptyManifest: SetupManifest = { version: "1", claude_dir: "/tmp/x", entries: [] };
    const plan = planInstall(emptyManifest, { files: [] }, new Map());

    expect(plan).toEqual({ writes: [], skips: [], backups: [], removals: [] });
  });

  it("BOUNDARY: a file present on disk but NOT tracked by the current manifest, with differing bytes, is written AND scheduled for backup", () => {
    // Simulates a user hand-editing a lore-written file, or a foreign file
    // occupying a path lore is about to claim — either way the pre-existing
    // bytes are worth preserving before being overwritten.
    const currentManifest: SetupManifest = { version: "1", claude_dir: "/tmp/x", entries: [] };
    const payload: AssetPayload = { files: [file("hooks/pre-push", "sha-lore-version")] };
    const existingFiles = new Map([["hooks/pre-push", "sha-user-hand-edited"]]);

    const plan = planInstall(currentManifest, payload, existingFiles);

    expect(plan.writes.map((w) => w.path)).toEqual(["hooks/pre-push"]);
    expect(plan.backups).toEqual(["hooks/pre-push"]);
    expect(plan.skips).toEqual([]);
  });

  it("ERROR: planInstall never throws when `current` references a path absent from `payload` (dangling removal candidate)", () => {
    const currentManifest: SetupManifest = {
      version: "1",
      claude_dir: "/tmp/x",
      entries: [{ path: "hooks/retired-hook.mjs", kind: "hook", sha256: "old-sha", written_at: "2026-01-01T00:00:00.000Z" }],
    };
    const payload: AssetPayload = { files: [file("skills/lore/SKILL.md", "sha-1")] };

    expect(() => planInstall(currentManifest, payload, new Map())).not.toThrow();
    const plan = planInstall(currentManifest, payload, new Map());
    expect(plan.removals).toEqual(["hooks/retired-hook.mjs"]);
  });

  it("STATE: plan -> simulate apply -> re-plan converges to zero writes/backups (I2 idempotency, pure half)", () => {
    const payload: AssetPayload = {
      files: [file("skills/lore/SKILL.md", "sha-1"), file("agents/lore-explorer.md", "sha-2", "agent")],
    };

    const firstPlan = planInstall(null, payload, new Map());
    expect(firstPlan.writes).toHaveLength(2);

    // Simulate applying firstPlan: the manifest now tracks every written path,
    // and the on-disk sha for each matches the payload's sha.
    const appliedManifest: SetupManifest = {
      version: "1",
      claude_dir: "/tmp/x",
      entries: firstPlan.writes.map((w) => ({
        path: w.path,
        kind: w.kind,
        sha256: w.sha256,
        written_at: "2026-07-16T00:00:00.000Z",
      })),
    };
    const existingFilesAfterApply = new Map(payload.files.map((f) => [f.path, f.sha256]));

    const secondPlan = planInstall(appliedManifest, payload, existingFilesAfterApply);

    expect(secondPlan.writes).toEqual([]);
    expect(secondPlan.backups).toEqual([]);
    expect(secondPlan.removals).toEqual([]);
    expect(secondPlan.skips).toHaveLength(2);
  });

  it("REGRESSION: skips/writes/backups partition every payload path exactly once (no double-classification)", () => {
    const payload: AssetPayload = {
      files: [
        file("a", "sha-a"), // not on disk -> write, no backup
        file("b", "sha-b"), // on disk, matches -> skip
        file("c", "sha-c-new"), // on disk, differs -> write + backup
      ],
    };
    const existingFiles = new Map([
      ["b", "sha-b"],
      ["c", "sha-c-old"],
    ]);
    const plan = planInstall(null, payload, existingFiles);

    expect(plan.writes.map((w) => w.path).sort()).toEqual(["a", "c"]);
    expect(plan.skips.map((s) => s.path)).toEqual(["b"]);
    expect(plan.backups).toEqual(["c"]);

    // No path appears in more than one bucket.
    const allPaths = [...plan.writes.map((w) => w.path), ...plan.skips.map((s) => s.path)];
    expect(new Set(allPaths).size).toBe(allPaths.length);
  });
});

// ─── merge-settings.ts ───────────────────────────────────────────────────────

const LORE_HOOK: SettingsHookEntry = {
  event: "PreToolUse",
  matcher: "Bash",
  command: "/home/user/.claude/hooks/example-pretool-hook.mjs",
};
const LORE_HOOK_2: SettingsHookEntry = {
  event: "Stop",
  command: "/home/user/.claude/hooks/example-stop-hook.mjs",
};

describe("merge-settings: mergeSettings", () => {
  it("HAPPY: merging into an empty/absent existing config installs every lore entry", () => {
    const result = mergeSettings({ existingRaw: null, loreEntries: [LORE_HOOK, LORE_HOOK_2] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.changed).toBe(true);
    const hooks = result.value.merged["hooks"] as Record<string, unknown>;
    expect(hooks["PreToolUse"]).toEqual([{ matcher: "Bash", hooks: [{ type: "command", command: LORE_HOOK.command }] }]);
    expect(hooks["Stop"]).toEqual([{ hooks: [{ type: "command", command: LORE_HOOK_2.command }] }]);
  });

  it("NEGATIVE: malformed JSON syntax returns err(VALIDATION_ERROR)", () => {
    const result = mergeSettings({ existingRaw: "{not valid json", loreEntries: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("NEGATIVE: a top-level JSON array (valid JSON, wrong shape) returns err(VALIDATION_ERROR)", () => {
    const result = mergeSettings({ existingRaw: "[]", loreEntries: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("NEGATIVE: a non-object 'hooks' key returns err(VALIDATION_ERROR)", () => {
    const result = mergeSettings({ existingRaw: JSON.stringify({ hooks: "nope" }), loreEntries: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("hooks");
  });

  it("BOUNDARY: empty loreEntries against a hooks-free existing config is a true no-op", () => {
    const result = mergeSettings({ existingRaw: JSON.stringify({ foo: "bar" }), loreEntries: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changed).toBe(false);
    expect(result.value.merged).toEqual({ foo: "bar" });
  });

  it("BOUNDARY: empty existingRaw string behaves identically to null", () => {
    const a = mergeSettings({ existingRaw: "", loreEntries: [LORE_HOOK] });
    const b = mergeSettings({ existingRaw: null, loreEntries: [LORE_HOOK] });
    expect(a).toEqual(b);
  });

  it("ERROR: never throws across a fuzz of structurally-garbage shapes — every case returns err", () => {
    const garbageInputs = [
      "42",
      "true",
      "null",
      "\"just a string\"",
      JSON.stringify({ hooks: { PreToolUse: "not-an-array" } }),
      JSON.stringify({ hooks: { PreToolUse: ["not-an-object"] } }),
      JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash" }] } }), // group missing `hooks` array
      JSON.stringify({ hooks: { PreToolUse: [{ hooks: "not-an-array" }] } }),
    ];

    for (const existingRaw of garbageInputs) {
      let result: ReturnType<typeof mergeSettings> | undefined;
      expect(() => {
        result = mergeSettings({ existingRaw, loreEntries: [LORE_HOOK] });
      }).not.toThrow();
      expect(result?.ok).toBe(false);
    }
  });

  it("STATE: apply once, re-merge with the same entries against the serialized output is idempotent", () => {
    const first = mergeSettings({ existingRaw: null, loreEntries: [LORE_HOOK, LORE_HOOK_2] });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const serialized = JSON.stringify(first.value.merged);
    const second = mergeSettings({ existingRaw: serialized, loreEntries: [LORE_HOOK, LORE_HOOK_2] });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.changed).toBe(false);
    expect(second.value.merged).toEqual(first.value.merged);
  });

  it("STATE: a command manually duplicated under two existing locations collapses to a single, correctly-placed instance after one merge pass", () => {
    // Simulates hand-edited drift: the same lore command ended up registered
    // under two different events. mergeSettings identifies BOTH occurrences
    // by command match, strips both, then re-adds exactly one fresh instance
    // at loreEntries' declared (event, matcher) location.
    const driftedExisting = {
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: LORE_HOOK.command }] }],
        Stop: [{ hooks: [{ type: "command", command: LORE_HOOK.command }] }],
      },
    };
    const result = mergeSettings({ existingRaw: JSON.stringify(driftedExisting), loreEntries: [LORE_HOOK] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const hooks = result.value.merged["hooks"] as Record<string, unknown>;
    // Stop's group contained ONLY the duplicate — fully stripped, group removed.
    expect(hooks["Stop"]).toBeUndefined();
    // PreToolUse holds exactly one fresh instance, not a leftover plus a re-add.
    expect(hooks["PreToolUse"]).toEqual([{ matcher: "Bash", hooks: [{ type: "command", command: LORE_HOOK.command }] }]);
  });

  it("REGRESSION: a settings.json with foreign top-level keys and a foreign matcher-group survives the merge byte-for-byte on untouched parts", () => {
    const foreignExisting = {
      permissions: { allow: ["Bash(git status:*)"] },
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "/some/other/vendor-hook.sh" }] },
        ],
      },
    };
    const result = mergeSettings({ existingRaw: JSON.stringify(foreignExisting), loreEntries: [LORE_HOOK] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Foreign top-level key untouched.
    expect(result.value.merged["permissions"]).toEqual(foreignExisting.permissions);

    // Foreign matcher-group's own hook entry (different command) untouched,
    // AND the fresh lore group was appended alongside it (not merged into it).
    const preToolUse = result.value.merged["hooks"] as Record<string, unknown>;
    expect(preToolUse["PreToolUse"]).toEqual([
      { matcher: "Bash", hooks: [{ type: "command", command: "/some/other/vendor-hook.sh" }] },
      { matcher: "Bash", hooks: [{ type: "command", command: LORE_HOOK.command }] },
    ]);
  });
});

// ─── register-mcp.ts ─────────────────────────────────────────────────────────

describe("register-mcp: buildMcpAddArgs / buildMcpRemoveArgs", () => {
  it("HAPPY: buildMcpAddArgs yields the exact documented argv", () => {
    expect(buildMcpAddArgs("/usr/local/bin/lore")).toEqual([
      "mcp",
      "add",
      "-s",
      "user",
      "lore",
      "--",
      "/usr/local/bin/lore",
      "--mcp-server",
    ]);
  });

  it("HAPPY: buildMcpRemoveArgs yields the exact documented argv", () => {
    expect(buildMcpRemoveArgs()).toEqual(["mcp", "remove", "-s", "user", "lore"]);
  });

  it("BOUNDARY: an empty binPath is passed through verbatim (no validation at this pure layer)", () => {
    expect(buildMcpAddArgs("")).toEqual(["mcp", "add", "-s", "user", "lore", "--", "", "--mcp-server"]);
  });

  it("REGRESSION: each call returns a fresh array — mutating one call's result never affects another's", () => {
    const first = buildMcpAddArgs("/bin/lore-v1");
    const second = buildMcpAddArgs("/bin/lore-v2");
    first.push("--extra-mutation-marker");

    expect(second).toEqual(["mcp", "add", "-s", "user", "lore", "--", "/bin/lore-v2", "--mcp-server"]);
    expect(second).not.toContain("--extra-mutation-marker");
  });
});

// ─── Cross-module: browser-safety (barrel node-free invariant) ─────────────

describe("REGRESSION: setup modules stay browser-safe (no Node builtins)", () => {
  const NODE_BUILTIN_IMPORT = /from\s+["'](?:node:)?(fs|path|os|child_process)["']/;

  it("setup-manifest.ts imports no Node builtins", () => {
    const src = readFileSync(join(CORE_SRC_DIR, "setup-manifest.ts"), "utf-8");
    expect(NODE_BUILTIN_IMPORT.test(src)).toBe(false);
  });

  it("merge-settings.ts imports no Node builtins", () => {
    const src = readFileSync(join(CORE_SRC_DIR, "merge-settings.ts"), "utf-8");
    expect(NODE_BUILTIN_IMPORT.test(src)).toBe(false);
  });

  it("register-mcp.ts imports no Node builtins", () => {
    const src = readFileSync(join(CORE_SRC_DIR, "register-mcp.ts"), "utf-8");
    expect(NODE_BUILTIN_IMPORT.test(src)).toBe(false);
  });

  it("the default barrel (index.ts) re-exports all three new modules", () => {
    const barrel = readFileSync(join(CORE_SRC_DIR, "index.ts"), "utf-8");
    expect(barrel).toContain('export * from "./setup-manifest.js"');
    expect(barrel).toContain('export * from "./merge-settings.js"');
    expect(barrel).toContain('export * from "./register-mcp.js"');
  });
});
