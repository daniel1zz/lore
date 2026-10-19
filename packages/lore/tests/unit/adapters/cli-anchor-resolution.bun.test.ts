// @reads assets/project/lore-config-template.yaml
// @reads assets/governance/write-spec-rule.md
/**
 * `lore create task --anchor` / `lore anchor add` / `lore ready --json` — the
 * author→trip end-to-end oracle for
 * task-a-mistyped-task-file-anchor-is-stored-and-consulted.
 *
 * Proves the non-resolving-anchor ADVISORY actually reaches the COMPILED binary
 * (the service/pure layers are covered by
 * `tests/unit/service/anchor-resolution.test.ts` +
 * `tests/unit/service/ready-anchor-resolution.test.ts` +
 * `packages/core/tests/file-anchor-resolution.test.ts`), and — the load-bearing
 * half — that it is an ADVISORY and not a refusal: exit stays 0 and the anchor
 * IS stored. Asserting the advisory alone would pass against an implementation
 * that rejected the write, which would make the mutex unusable for the highest-
 * risk case (two agents both about to CREATE the same new file).
 *
 * Spawns the COMPILED `dist/lore` binary (Bun.spawnSync) against a THROWAWAY
 * corpus (mkdtemp + `lore init`) — never the repo's own `.lore/` corpus (project
 * CLAUDE.md hard rule). `assertFreshBinary` fails loud if `dist/lore` is missing
 * or older than the newest `.ts` source, so `bun run build` must run first.
 *
 * The probe root is the spawned process's cwd (the throwaway corpus dir), the
 * SAME `process.cwd()` assumption `lore status --check-drift` already makes — so
 * a fixture file created inside `tmpDir` is a genuinely resolving anchor and a
 * repo-shaped path like `packages/lore/src/does-not-exist.ts` is genuinely absent.
 *
 * Six-dimension coverage:
 *   HAPPY:      `create task --anchor <missing>` → exit 0, advisory naming that
 *               EXACT path on stderr, `--json` stdout still parses, anchor stored
 *   NEGATIVE:   the advisory is not a refusal — no non-zero exit anywhere in this
 *               file; `anchor add` of a missing path also stores + advises
 *   BOUNDARY:   directory-scope anchors — an existing dir (trailing "/") is
 *               SILENT, a missing dir advises `dir_missing`
 *   ERROR:      n/a at this surface — a probe failure is a service-layer concern
 *               (covered by the fake-probe suites); the CLI has no usage error to
 *               provoke here, since every anchor spelling that reaches the probe
 *               already passed `normalizeFileAnchors`
 *   STATE:      `lore ready <plan> --json` reports the non-resolving anchor for a
 *               CLAIMED task, keyed by task_slug, with `probed: true`
 *   REGRESSION: CONTROL — a task whose every anchor RESOLVES emits no advisory at
 *               all (a blanket-advisory implementation fails here); and a corpus
 *               with no declared anchors stays silent
 *
 * @spec_ref task-a-mistyped-task-file-anchor-is-stored-and-consulted
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { join } from "path";
import { tmpdir } from "os";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";

setDefaultTimeout(60_000);

// tests/unit/adapters/ → tests/unit/ → tests/ → packages/lore/ → packages/ → repo root (5 levels up).
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");

/** The literal marker every advisory header carries — one grep-able token. */
const ADVISORY_MARKER = "file_anchors advisory";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true" },
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

async function mustRun(args: string[], cwd: string): Promise<RunResult> {
  const result = await runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`fixture command \`lore ${args.join(" ")}\` failed (${result.exitCode}): ${result.stderr}`);
  }
  return result;
}

/** Mirrors `cli-drift.bun.test.ts`'s helper — appends, never rewrites (`project:` is required). */
function disableAllGates(dir: string): void {
  patchLoreConfig(
    dir,
    [
      "workflow:",
      "  gates:",
      "    spec-create:",
      "      enabled: false",
      "    spec-promote:",
      "      enabled: false",
      "    plan-promote:",
      "      enabled: false",
      "    task-claim:",
      "      enabled: false",
      "",
    ].join("\n"),
  );
}

function parseSlug(stdout: string): string {
  return (JSON.parse(stdout) as { data: { slug: string } }).data.slug;
}

async function createTask(cwd: string, title: string, planSlug: string, anchors: string[]): Promise<RunResult> {
  return await runLore(
    [
      "create",
      "task",
      "--title",
      title,
      "--plan-id",
      planSlug,
      "--content",
      "body",
      "--no-ai",
      "--json",
      ...anchors.flatMap((a) => ["--anchor", a]),
    ],
    cwd,
  );
}

async function listAnchors(cwd: string, slug: string): Promise<string[]> {
  const result = await mustRun(["anchor", "list", slug, "--json"], cwd);
  return (JSON.parse(result.stdout) as { data: { anchors: string[] } }).data.anchors;
}

interface ReadyJson {
  readonly ready: {
    readonly anchor_resolution:
      | { readonly probed: false; readonly reason: string }
      | {
          readonly probed: true;
          readonly root: string;
          readonly unresolved: ReadonlyArray<{ task_slug: string; anchor: string; kind: string }>;
        };
  };
}

let tmpDir: string;
let planSlug: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-anchor-resolve-"));
  await mustRun(["init"], tmpDir);
  disableAllGates(tmpDir);
  // Fixture working tree: one real file and one real directory inside the probe
  // root, so a RESOLVING anchor is available as the CONTROL.
  mkdirSync(join(tmpDir, "src", "existing-dir"), { recursive: true });
  writeFileSync(join(tmpDir, "src", "real.ts"), "export const real = 1;\n");
  planSlug = parseSlug(
    (await mustRun(["create", "plan", "--title", "Anchor Probe Plan", "--content", "# Plan", "--no-ai", "--json"], tmpDir))
      .stdout,
  );
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("HAPPY — a mistyped anchor is advised, stored, and exits 0", () => {
  it("names the exact non-resolving path on stderr, exits 0, and keeps --json stdout parseable", async () => {
    const result = await createTask(tmpDir, "Typo Task", planSlug, ["packages/lore/src/does-not-exist.ts"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(ADVISORY_MARKER);
    expect(result.stderr).toContain("packages/lore/src/does-not-exist.ts");
    expect(result.stderr).toContain("file_missing");
    // The advisory goes to stderr precisely so machine consumers of --json are unharmed.
    const parsed = JSON.parse(result.stdout) as { ok: boolean; data: { slug: string } };
    expect(parsed.ok).toBe(true);
  });

  it("STORES the anchor anyway — the advisory is not a refusal", async () => {
    const slug = parseSlug((await createTask(tmpDir, "Typo Task", planSlug, ["packages/lore/src/does-not-exist.ts"])).stdout);
    expect(await listAnchors(tmpDir, slug)).toEqual(["packages/lore/src/does-not-exist.ts"]);
  });

  it("`lore anchor add` of a missing path also advises, exits 0, and stores it", async () => {
    const slug = parseSlug((await createTask(tmpDir, "Grow Task", planSlug, ["src/real.ts"])).stdout);
    const added = await runLore(["anchor", "add", slug, "src/added-but-missing.ts"], tmpDir);

    expect(added.exitCode).toBe(0);
    expect(added.stderr).toContain(ADVISORY_MARKER);
    expect(added.stderr).toContain("src/added-but-missing.ts");
    expect(await listAnchors(tmpDir, slug)).toEqual(["src/real.ts", "src/added-but-missing.ts"]);
  });
});

describe("REGRESSION CONTROL — a resolving anchor emits NO advisory", () => {
  it("a task whose only anchor resolves prints no advisory at all", async () => {
    const result = await createTask(tmpDir, "Clean Task", planSlug, ["src/real.ts"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain(ADVISORY_MARKER);
    expect(result.stderr).not.toContain("file_missing");
  });

  it("`lore anchor add` of a resolving path prints no advisory", async () => {
    const slug = parseSlug((await createTask(tmpDir, "Clean Task", planSlug, ["src/real.ts"])).stdout);
    const added = await runLore(["anchor", "add", slug, "src/existing-dir/"], tmpDir);

    expect(added.exitCode).toBe(0);
    expect(added.stderr).not.toContain(ADVISORY_MARKER);
  });

  it("a task with NO anchors at all prints no advisory", async () => {
    const result = await createTask(tmpDir, "Anchorless Task", planSlug, []);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain(ADVISORY_MARKER);
  });
});

describe("BOUNDARY — directory-scope anchors resolve against a directory", () => {
  it("an EXISTING directory declared with a trailing slash is silent", async () => {
    const result = await createTask(tmpDir, "Dir Task", planSlug, ["src/existing-dir/"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain(ADVISORY_MARKER);
    expect(await listAnchors(tmpDir, parseSlug(result.stdout))).toEqual(["src/existing-dir/"]);
  });

  it("a MISSING directory declared with a trailing slash advises dir_missing (never file_missing)", async () => {
    const result = await createTask(tmpDir, "Missing Dir Task", planSlug, ["src/no-such-dir/"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(ADVISORY_MARKER);
    expect(result.stderr).toContain("src/no-such-dir/");
    expect(result.stderr).toContain("dir_missing");
    expect(result.stderr).not.toContain("file_missing");
  });
});

describe("STATE — lore ready <plan> --json surfaces it for the dispatcher", () => {
  it("reports the non-resolving anchor of a CLAIMED task, keyed by task_slug, with probed:true", async () => {
    const slug = parseSlug((await createTask(tmpDir, "Claimed Typo", planSlug, ["src/gone.ts"])).stdout);
    await mustRun(["claim", slug, "--worktree", tmpDir], tmpDir);

    const ready = await mustRun(["ready", planSlug, "--json"], tmpDir);
    const payload = (JSON.parse(ready.stdout) as { data: ReadyJson }).data;
    const resolution = payload.ready.anchor_resolution;

    expect(resolution.probed).toBe(true);
    if (!resolution.probed) throw new Error("expected a probed report");
    // The reported root is the spawned process's REAL cwd — on macOS `mkdtemp`'s
    // `/var/folders/...` is a symlink to `/private/var/folders/...`, and the
    // binary reports the resolved location (which is the honest answer for a
    // reader checking whether they ran from the right directory).
    expect(resolution.root).toBe(realpathSync(tmpDir));
    expect(resolution.unresolved).toEqual([
      { task_slug: slug, anchor: "src/gone.ts", kind: "file_missing" },
    ]);
  });

  it("reports probed:true with an EMPTY unresolved list when every declared anchor resolves", async () => {
    await createTask(tmpDir, "Clean Task", planSlug, ["src/real.ts", "src/existing-dir/"]);

    const ready = await mustRun(["ready", planSlug, "--json"], tmpDir);
    const resolution = (JSON.parse(ready.stdout) as { data: ReadyJson }).data.ready.anchor_resolution;

    expect(resolution.probed).toBe(true);
    if (!resolution.probed) throw new Error("expected a probed report");
    expect(resolution.unresolved).toEqual([]);
  });

  it("human-mode `lore ready` prints the advisory too, still exiting 0", async () => {
    await createTask(tmpDir, "Typo Task", planSlug, ["src/gone.ts"]);
    const ready = await runLore(["ready", planSlug], tmpDir);

    expect(ready.exitCode).toBe(0);
    expect(`${ready.stdout}${ready.stderr}`).toContain("src/gone.ts");
  });
});
