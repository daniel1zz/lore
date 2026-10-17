/**
 * One test for the whole retirement registry (`RETIREMENTS`, src/adapters/retirements.ts).
 * It replaces four tombstone files (setup-retires-session-start-fragments, init-context-skill-
 * retirement, setup-retired-agent-types, and the retirement cases of setup-governance-retirement):
 * each row is checked by its kind, so retiring something new means adding a row, not a test file.
 *
 *   install-asset:  a fresh install never writes it; `--dry-run` lists a planted tracked copy under
 *                   removals; converge removes it (and prunes its emptied skill directory);
 *                   `RealAssetSource.load()` and the setup-check embedded manifest never yield it;
 *                   `still_shipped` matches the file's presence in assets/ and the
 *                   RETIRED_FROM_INSTALL_PATHS membership (derived, no second list)
 *   settings-entry: converge removes the planted `settings.json` hook registrations; the kept
 *                   resume hook and a user-owned entry survive; a second converge changes nothing
 *   cli-command:    exit 4 naming the replacement, nothing written
 *   outlet:         exit 2 naming the outlet as retired
 *   structural:     no lore-gate-g1..g4 hook name is left in shipped or registered places
 *
 * Safety: every setup run uses `PATH: ""` (never reaches a real `claude` CLI) and a fresh mkdtemp
 * `--claude-dir`; CLI probes run in a throwaway `lore init` corpus outside the repo.
 *
 * @spec_ref spec-test-governance-guards-that-refuse-bad-tests-declared AC-TG-9
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { HOOK_REGISTRATIONS } from "@lore/core";
import { RealAssetSource, RETIRED_FROM_INSTALL_PATHS } from "../../src/adapters/real-asset-source.js";
import { buildCheckEmbeddedManifest } from "../../src/adapters/cli/setup-check.js";
import { RETIREMENTS, type Retirement } from "../../src/adapters/retirements.js";

setDefaultTimeout(300_000);

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
const ASSETS_ROOT = join(REPO_ROOT, "assets");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const MANIFEST_FILENAME = ".lore-setup-manifest.json";
const KEPT_HOOK = "session-start-resume.mjs";
const USER_COMMAND = "node /opt/user-owned/my-session-hook.mjs";
const CONTROL = "agents/my-own-agent.md";
const CONTROL_BYTES = "# my own agent: not tracked by lore, must survive converge\n";

const BUN_BIN = (() => {
  const resolved = Bun.which("bun");
  if (resolved === null) throw new Error("retirement-registry.bun.test.ts: could not resolve the `bun` binary via Bun.which");
  return resolved;
})();

const rowsOf = (kind: Retirement["kind"]): readonly Retirement[] => RETIREMENTS.filter((row) => row.kind === kind);

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function run(args: string[], cwd: string, env: Record<string, string>): RunResult {
  const proc = Bun.spawnSync([BUN_BIN, "run", INDEX_TS, ...args], { cwd, env: { ...process.env, ...env } });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

// ─── registry shape ─────────────────────────────────────────────────────────

describe("RETIREMENTS registry shape", () => {
  it("ids are unique and every row has a replacement and a spec_ref", () => {
    const ids = RETIREMENTS.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of RETIREMENTS) {
      expect(row.replacement.length, row.id).toBeGreaterThan(0);
      expect(row.spec_ref.length, row.id).toBeGreaterThan(0);
    }
  });

  it("every kind has at least one row (a kind with no rows would be checked vacuously)", () => {
    for (const kind of ["install-asset", "cli-command", "outlet", "settings-entry"] as const) {
      expect(rowsOf(kind).length, kind).toBeGreaterThan(0);
    }
  });
});

// ─── install-asset ──────────────────────────────────────────────────────────

describe("install-asset rows", () => {
  const rows = rowsOf("install-asset");
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "lore-retirement-registry-")));
  const claudeDir = join(sandbox, ".claude");
  let freshWrote: Map<string, boolean>;
  let dryRunStdout = "";
  let dryRunRemovals: string[] = [];
  let convergeOut: RunResult;
  let afterManifest: string[] = [];
  let againDryRunStdout = "";

  const setup = (args: string[]): RunResult => run(["setup", ...args], sandbox, { PATH: "" });

  beforeAll(() => {
    const seed = setup(["--claude-dir", claudeDir, "--yes"]);
    if (seed.exitCode !== 1) throw new Error(`seed install: expected exit 1 (MCP fails under PATH=""), got ${seed.exitCode}\n${seed.stdout}\n${seed.stderr}`);
    freshWrote = new Map(rows.map((row) => [row.id, existsSync(join(claudeDir, row.target))]));

    // Plant what an OLDER release left: the retired files on disk and tracked in the manifest.
    const manifestPath = join(claudeDir, MANIFEST_FILENAME);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { entries: Array<Record<string, unknown>> };
    const template = manifest.entries.find((entry) => entry.path === "agents/lore-implementer.md");
    if (template === undefined) throw new Error("seed install manifest has no agents/lore-implementer.md entry");
    for (const row of rows) {
      const bytes = `retired ${row.target}\n`;
      mkdirSync(dirname(join(claudeDir, row.target)), { recursive: true });
      writeFileSync(join(claudeDir, row.target), bytes);
      manifest.entries.push({
        ...template,
        path: row.target,
        kind: row.target.split("/")[0]!.replace(/s$/, ""),
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(join(claudeDir, CONTROL), CONTROL_BYTES);

    const dry = setup(["--claude-dir", claudeDir, "--dry-run", "--json"]);
    dryRunStdout = dry.stdout;
    dryRunRemovals = (JSON.parse(dry.stdout) as { data: { plan: { removals: string[] } } }).data.plan.removals;
    convergeOut = setup(["--claude-dir", claudeDir, "--yes"]);
    afterManifest = (JSON.parse(readFileSync(manifestPath, "utf8")) as { entries: Array<{ path: string }> }).entries.map((e) => e.path);
    againDryRunStdout = setup(["--claude-dir", claudeDir, "--dry-run"]).stdout;
  });

  afterAll(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it("fixture sanity: the converge ran and the dry run produced a plan", () => {
    expect(convergeOut.exitCode).toBe(1); // MCP registration fails under PATH=""
    expect(dryRunStdout.length).toBeGreaterThan(0);
  });

  for (const row of rows) {
    describe(row.id, () => {
      it("a fresh install does not write it", () => {
        expect(freshWrote.get(row.id)).toBe(false);
      });

      it("--dry-run lists the planted tracked copy under removals", () => {
        expect(dryRunRemovals).toContain(row.target);
      });

      it("converge removes the tracked copy from disk and from the manifest", () => {
        expect(existsSync(join(claudeDir, row.target))).toBe(false);
        expect(afterManifest).not.toContain(row.target);
      });

      it("RealAssetSource.load() and the setup-check embedded manifest never yield it", async () => {
        const loaded = await new RealAssetSource(ASSETS_ROOT).load();
        expect(loaded.ok).toBe(true);
        if (!loaded.ok) return;
        expect(loaded.value.files.map((f) => f.path)).not.toContain(row.target);
        expect(buildCheckEmbeddedManifest().entries.map((e) => e.path)).not.toContain(row.target);
      });

      it("still_shipped matches assets/ and the derived RETIRED_FROM_INSTALL_PATHS membership", () => {
        expect(existsSync(join(ASSETS_ROOT, row.target)), `${row.target} presence in assets/`).toBe(row.still_shipped === true);
        expect(RETIRED_FROM_INSTALL_PATHS.has(row.target)).toBe(row.still_shipped === true);
      });
    });
  }

  it("an emptied skill directory is pruned with its only file", () => {
    for (const row of rows.filter((r) => r.target.startsWith("skills/"))) {
      expect(existsSync(join(claudeDir, dirname(row.target))), row.id).toBe(false);
    }
  });

  it("converge is not a blanket wipe: the current agents land and an untracked user agent survives", () => {
    expect(existsSync(join(claudeDir, "agents/lore-reader.md"))).toBe(true);
    expect(existsSync(join(claudeDir, "agents/lore-implementer.md"))).toBe(true);
    expect(readFileSync(join(claudeDir, CONTROL), "utf8")).toBe(CONTROL_BYTES);
    expect(afterManifest).toContain("agents/lore-reader.md");
    expect(afterManifest).not.toContain(CONTROL);
  });

  it("a second converge has nothing further to remove", () => {
    expect(againDryRunStdout).not.toContain("Would remove");
  });

  it("deleted hook files are absent from the shipped roster and assets/hooks; the resume hook stays", () => {
    const shipped = HOOK_REGISTRATIONS.map((entry) => entry.file);
    for (const row of rows.filter((r) => r.target.startsWith("hooks/"))) {
      const file = row.target.slice("hooks/".length);
      expect(shipped, row.id).not.toContain(file);
      expect(existsSync(join(ASSETS_ROOT, "hooks", file)), row.id).toBe(false);
    }
    expect(shipped).toContain(KEPT_HOOK);
    expect(existsSync(join(ASSETS_ROOT, "hooks", KEPT_HOOK))).toBe(true);
  });
});

// ─── settings-entry ─────────────────────────────────────────────────────────

interface SettingsGroup {
  matcher?: string;
  hooks: Array<{ type: string; command: string }>;
}
interface Settings {
  hooks: Record<string, SettingsGroup[]>;
}

describe("settings-entry rows", () => {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), "lore-retirement-settings-")));
  const claudeDir = join(sandbox, ".claude");
  const env = { PATH: "", HOME: join(sandbox, "home"), XDG_CONFIG_HOME: join(sandbox, "xdg") };
  const setup = (): RunResult => run(["setup", "--claude-dir", claudeDir, "--yes"], sandbox, env);
  const readSettings = (): Settings => JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8")) as Settings;
  const commandsOf = (event: string): string[] => (readSettings().hooks[event] ?? []).flatMap((g) => g.hooks.map((h) => h.command));
  let freshSettings = "";
  let plantedCount: Map<string, number>;
  let afterSettings = "";
  let settingsBeforeSecond = "";
  let settingsAfterSecond = "";
  let converged: RunResult;

  beforeAll(() => {
    for (const dir of ["home", "xdg"]) mkdirSync(join(sandbox, dir), { recursive: true });
    expect(setup().stdout).toContain("lore setup complete");
    freshSettings = readFileSync(join(claudeDir, "settings.json"), "utf8");

    // Plant each retired registration twice: plain group and a `compact` matcher group (what the older release left).
    const settings = readSettings();
    plantedCount = new Map();
    for (const row of rowsOf("settings-entry")) {
      const [event, file] = row.target.split(":") as [string, string];
      const command = `node ${join(claudeDir, "hooks", file)}`;
      const groups = settings.hooks[event] ?? [];
      const plain = groups.find((g) => g.matcher === undefined);
      if (plain === undefined) throw new Error(`no matcher-less ${event} group in the fresh install`);
      plain.hooks.push({ type: "command", command });
      groups.push({ matcher: "compact", hooks: [{ type: "command", command }] });
      settings.hooks[event] = groups;
      plantedCount.set(row.id, 2);
    }
    // A user-owned entry pointing outside <claudeDir>/hooks/: converge must never touch it.
    (settings.hooks["SessionStart"] ??= []).push({ hooks: [{ type: "command", command: USER_COMMAND }] });
    writeFileSync(join(claudeDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);

    converged = setup();
    afterSettings = readFileSync(join(claudeDir, "settings.json"), "utf8");
    settingsBeforeSecond = afterSettings;
    setup();
    settingsAfterSecond = readFileSync(join(claudeDir, "settings.json"), "utf8");
  });

  afterAll(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it("converge completed (exit 1: MCP registration fails under PATH=\"\")", () => {
    expect(converged.stdout).toContain("lore setup complete");
    expect(converged.exitCode).toBe(1);
  });

  for (const row of rowsOf("settings-entry")) {
    const [event, file] = row.target.split(":") as [string, string];
    const [, replacementFile] = row.replacement.split(":") as [string, string];

    it(`${row.id}: a fresh install never registers ${file}`, () => {
      expect(freshSettings).not.toContain(file);
    });

    it(`${row.id}: the planted fixture really held two registrations (precondition)`, () => {
      expect(plantedCount.get(row.id)).toBe(2);
    });

    it(`${row.id}: converge removes every ${event} registration of ${file}`, () => {
      expect(afterSettings).not.toContain(file);
    });

    it(`${row.id}: the replacement ${replacementFile} stays registered and the user-owned entry is untouched`, () => {
      expect(commandsOf(event).some((c) => c.includes(replacementFile))).toBe(true);
      expect(commandsOf(event)).toContain(USER_COMMAND);
    });
  }

  it("a second converge changes nothing (idempotent)", () => {
    expect(settingsAfterSecond).toBe(settingsBeforeSecond);
  });
});

// ─── cli-command and outlet ─────────────────────────────────────────────────

/** Argv tail (after the registry target) that makes each retired command a complete invocation. */
const CLI_PROBE_ARGS: Readonly<Record<string, readonly string[]>> = {
  "outline set": ["--section", "section-1", "--title", "T", "--tier", "domain", "--direction", "d"],
  "outline rm": ["section-1"],
  "outline exempt": ["--reason", "no outline change needed"],
};

describe("cli-command and outlet rows", () => {
  let dir = "";
  let prdSlug = "";
  const env = (): Record<string, string> => ({ HOME: dir, CLAUDECODE: "1", LORE_ACTOR: "agent:retirement-registry-test" });
  const lore = (args: string[]): RunResult => run(args, dir, env());

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-retirement-cli-")));
    if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@example.invalid"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
    writeFileSync(join(dir, "README.md"), "fixture\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
    const init = lore(["init"]);
    if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}${init.stdout}`);
    const created = lore(["create", "prd", "--title", "Retirement PRD", "--content", "root", "--no-ai"]);
    const slug = created.stdout.match(/Slug:\s+(\S+)/) ?? created.stdout.match(/Created \w+ (\S+) \(/);
    if (!slug?.[1]) throw new Error(`no slug in: ${created.stdout}${created.stderr}`);
    prdSlug = slug[1];
  });

  afterAll(() => {
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
  });

  for (const row of rowsOf("cli-command")) {
    it(`${row.id}: \`lore ${row.target}\` exits 4 naming ${row.replacement}`, () => {
      const tail = CLI_PROBE_ARGS[row.target];
      if (tail === undefined) throw new Error(`no CLI_PROBE_ARGS entry for registry target "${row.target}"`);
      const [verb, sub] = row.target.split(" ") as [string, string];
      const argv = [verb, sub, prdSlug, ...tail];
      // `outline rm` takes the section positionally after the slug; the others take flags only.
      const r = lore(argv);
      expect(r.exitCode).toBe(4);
      expect(r.stderr).toContain(row.replacement);
    });
  }

  for (const row of rowsOf("outlet")) {
    it(`${row.id}: \`render --outlet ${row.target}\` exits 2, names it as retired, prints nothing`, () => {
      const r = lore(["fragments", "render", "--outlet", row.target]);
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toContain(row.target);
      expect(r.stderr).toMatch(/retired/i);
      expect(r.stdout).toBe("");
    });
  }
});

// ─── structural: no lore-gate-g1..g4 hook remains shipped or registered ─────
// Moved from gate-hook-retirement-parity.bun.test.ts (the g1-g4 hooks are a retirement too).

const G_HOOK_NAME = /lore-gate-g[1-4]|(^|[^a-z0-9])g[1-4]-(spec-create|spec-promote|plan-promote|task-claim)/;

function filesUnder(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((entry) => filesUnder(join(path, entry)));
}

/** Files (names and contents) under `relPath` that still name a g1-g4 hook. */
function gHookOffenders(relPath: string): string[] {
  return filesUnder(join(REPO_ROOT, relPath)).filter(
    (file) => G_HOOK_NAME.test(file.slice(REPO_ROOT.length)) || G_HOOK_NAME.test(readFileSync(file, "utf8")),
  );
}

describe("no lore-gate-g1..g4 / g1..g4 hook remains shipped or registered", () => {
  const LOCATIONS = [
    "packages/core/src/distribution-hooks.ts",
    "assets/hooks",
    "assets/project",
    "hooks",
    ".claude/settings.json",
    "packages/lore/src/service/project-setup-service.ts",
    "packages/lore/src/flows/setup-project-flow.ts",
  ];
  for (const loc of LOCATIONS) {
    it(`${loc} names no g1-g4 hook`, () => {
      expect(gHookOffenders(loc)).toEqual([]);
    });
  }
});
