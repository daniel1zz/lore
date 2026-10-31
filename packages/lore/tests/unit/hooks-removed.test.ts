// @spawns assets/hooks/subagent-context.mjs
// @spawns assets/hooks/session-start-resume.mjs
// @spawns packages/lore/src/index.ts
// @reads assets/hooks/stop-turn-review.mjs
// @reads hooks/pre-push
// @reads assets/hooks/stop-handoff-coverage.mjs
// @reads assets/hooks/post-edit-bindings.mjs
// @reads assets/project/reference-transaction
/**
 * AC-LG-7 — removed hooks stay removed (spec-lean-governance-batch-verbs-judgment-only-at-milestones, Part B, BR-1368).
 *
 * Throwaway repo + corpus only (helpers/own-diff-fixture.ts); never the repo's own `.lore/`.
 *
 * Coverage: HAPPY subagent-context spawns exactly one lore process; the integrate own-diff output lists bound prose.
 * NEGATIVE the two hook files, their registrations and manifest entries are gone; session-start-resume spawns no
 * `lore setup`; stop-turn-review and pre-push carry no removed check. REGRESSION the surviving Stop hook is still
 * registered.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HOOK_REGISTRATIONS } from "@lore/core";
import { EMBEDDED_ASSETS_MANIFEST } from "../../src/generated/assets-manifest.js";
import { OwnDiffFixture } from "../helpers/own-diff-fixture.js";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const REMOVED_HOOKS = ["stop-handoff-coverage.mjs", "post-edit-bindings.mjs"] as const;

const scratch: string[] = [];
let fx: OwnDiffFixture | undefined;
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  fx?.dispose();
  fx = undefined;
});

interface LoreStub {
  readonly dir: string;
  readonly bin: string;
  readonly invocations: () => string[][];
}

/** A `lore` stub on PATH that appends one line of argv per invocation to a log and prints `stdout`. */
function makeLoreStub(stdout: string): LoreStub {
  const dir = mkdtempSync(join(tmpdir(), "hooks-removed-"));
  scratch.push(dir);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  const stub = join(bin, "lore");
  writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nprintf '%s' '${stdout}'\nexit 0\n`);
  chmodSync(stub, 0o755);
  return {
    dir,
    bin,
    invocations: () => readFileSync(log, "utf8").split("\n").filter((l) => l !== "").map((l) => l.split(" ")),
  };
}

function runHook(file: string, stub: LoreStub, payload: unknown): { status: number | null; stdout: string } {
  const home = join(stub.dir, "home");
  mkdirSync(home, { recursive: true });
  const result = spawnSync("node", [join(REPO_ROOT, "assets", "hooks", file)], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd: stub.dir,
    env: {
      ...process.env,
      PATH: `${stub.bin}:${process.env.PATH ?? ""}`,
      HOME: home,
      CLAUDE_AGENTS_DIR_OVERRIDE: join(home, ".claude", "agents"),
      CLAUDE_STATE_BASE_OVERRIDE: join(home, "state"),
    },
  });
  return { status: result.status, stdout: result.stdout ?? "" };
}

describe("removed hooks — files, registrations, manifest", () => {
  it("NEGATIVE: removed hooks have no asset file, no registration and no embedded-manifest entry", () => {
    for (const hook of REMOVED_HOOKS) {
      expect(existsSync(join(REPO_ROOT, "assets", "hooks", hook)), `${hook} file`).toBe(false);
      expect(HOOK_REGISTRATIONS.some((r) => r.file === hook), `${hook} registered`).toBe(false);
      expect(EMBEDDED_ASSETS_MANIFEST.entries.some((e) => e.path === `hooks/${hook}`), `${hook} in manifest`).toBe(false);
    }
  });

  it("REGRESSION control: the surviving Stop hook is still on disk, registered and in the manifest", () => {
    expect(existsSync(join(REPO_ROOT, "assets", "hooks", "stop-turn-review.mjs"))).toBe(true);
    expect(HOOK_REGISTRATIONS.filter((r) => r.event === "Stop").map((r) => r.file)).toEqual(["stop-turn-review.mjs"]);
    expect(EMBEDDED_ASSETS_MANIFEST.entries.some((e) => e.path === "hooks/stop-turn-review.mjs")).toBe(true);
  });
});

describe("removed hooks — surviving hooks and pre-push drop the removed checks", () => {
  it("NEGATIVE: stop-turn-review runs no anchor-drift or CLAUDE.md-budget check", () => {
    const source = readFileSync(join(REPO_ROOT, "assets", "hooks", "stop-turn-review.mjs"), "utf8");
    expect(source).not.toContain("--check-drift");
    expect(source).not.toContain("--check-claude-md");
    expect(source).toContain("findSharedCheckoutChanges");
    expect(source).toContain("findSourceEdits");
  });

  it("NEGATIVE: hooks/pre-push runs no --check-claude-md and no prose-pins step", () => {
    const source = readFileSync(join(REPO_ROOT, "hooks", "pre-push"), "utf8");
    expect(source).not.toContain("--check-claude-md");
    expect(source).not.toContain("check-prose-pins");
    expect(source).toContain("--check-prd-budget");
  });

  it("NEGATIVE: session-start-resume spawns no `lore setup` (empty cache, nothing to refresh)", () => {
    const stub = makeLoreStub("{}");
    const result = runHook("session-start-resume.mjs", stub, { cwd: stub.dir, session_id: "s1", source: "startup" });
    expect(result.status).toBe(0);
    // a detached spawn is not awaited: give a would-be child the time to write its log line
    spawnSync("sleep", ["0.5"]);
    expect(stub.invocations().filter((argv) => argv[0] === "setup")).toEqual([]);
  });

  it("HAPPY: subagent-context spawns exactly one lore process and relays its context", () => {
    const stub = makeLoreStub('{"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":"FRAGMENT-BLOCK"}}');
    const result = runHook("subagent-context.mjs", stub, { agent_type: "implementer", cwd: stub.dir });
    expect(result.status).toBe(0);
    const calls = stub.invocations();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(0, 2)).toEqual(["fragments", "render"]);
    expect(calls[0]).toContain("--with-pointers");
    expect(JSON.parse(result.stdout).hookSpecificOutput.additionalContext).toBe("FRAGMENT-BLOCK");
  });
});

describe("removed hooks — integrate own-diff output lists bound prose", () => {
  it("HAPPY: a landing whose changed file is named in a CLAUDE.md prints the bound-prose line; an unbound file prints none", () => {
    const f = new OwnDiffFixture();
    fx = f;
    f.commitOnMain(
      { "src/bound.ts": "export const a = 1;\n", "src/free.ts": "export const b = 1;\n", "CLAUDE.md": "# Notes\n\nThe constant lives in `src/bound.ts`.\n" },
      "base",
    );
    const task = f.createTask("Bound", ["src/bound.ts", "src/free.ts"], "code");
    f.makeBranch("bound-b", { "src/bound.ts": "export const a = 2;\n", "src/free.ts": "export const b = 2;\n" });
    f.claim(task, "bound-b");

    const landed = f.integrate("bound-b");

    expect(landed.exitCode, landed.text).toBe(0);
    expect(landed.text).toContain("prose bound to src/bound.ts: CLAUDE.md");
    expect(landed.text).not.toContain("prose bound to src/free.ts");
  }, 300_000);
});
