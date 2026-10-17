// @reads assets/project/**
/**
 * Config-template overlay suite (SPEC-058 §Design Decisions D6, task
 * AC-V-4) — proves the NEW `assets/project/lore-config-template.yaml`
 * asset exists, generically parses, carries the three recommended
 * spec_kind profile blocks (design->e2e, feature->test, tech->test), that
 * the pure `flows/config-template.ts` merge helpers behave correctly on
 * their own (NEGATIVE/BOUNDARY/ERROR/STATE), and that the production
 * `lore setup --project` scaffold wiring actually lands the block in a
 * freshly-scaffolded corpus's `.lore/config.yaml` on disk (the
 * `scaffoldProject` integration, mirroring
 * `tests/unit/service/project-setup-service.test.ts`'s real-port-on-a-
 * throwaway-git-repo pattern).
 *
 * Concurrency note (dispatch bundle context digest): `verificationProfileSchema`
 * (`@lore/core` `verification-profile.ts`) is being implemented by a SIBLING
 * task on a DIFFERENT branch and does not exist on this one yet. The
 * schema-parse assertion below loads that module via a dynamic `import()`
 * whose specifier is a COMPUTED (non-literal) string — the SAME RED
 * technique `tests/unit/core/verification-profile.test.ts` uses — so
 * `tsc --noEmit` stays green today (TS only statically resolves `import()`
 * calls with a literal string argument) and the assertion runs for real the
 * moment the sibling module lands. UNLIKE that suite (which is deliberately
 * whole-file RED until the module exists — its entire purpose is to gate
 * that module's authorship), every assertion in THIS file must be GREEN
 * right now: the module-not-found case is caught inside a single `it` and
 * degrades to a console note instead of a `beforeAll` throw (which would
 * fail every other test in the file too). See the "schema-dependent"
 * describe block below for exactly which assertions run vs. are deferred.
 *
 * Coverage:
 *   HAPPY:      template file exists on disk; generically parses via `yaml`
 *               and carries all three recommended spec_kind blocks; a fresh
 *               `scaffoldProject` run over a throwaway git repo lands the
 *               SAME block in the resulting `.lore/config.yaml`
 *   NEGATIVE:   malformed overlay YAML text -> parseConfigTemplateOverlay
 *               returns err (never throws, never silently drops the caller
 *               into an unmerged state without saying why)
 *   BOUNDARY:   merge with an empty overlay leaves base untouched; merge
 *               into an empty base yields the overlay verbatim; a base that
 *               ALREADY carries a sibling `workflow.*` key keeps it
 *               alongside the merged-in `verification_profiles` (deep merge,
 *               not whole-section clobber)
 *   ERROR:      overlay text that parses to a non-object top level (YAML
 *               array / bare scalar) -> parseConfigTemplateOverlay err,
 *               field names "configTemplateYaml"
 *   STATE:      mergeConfigWithOverlay never mutates either input object
 *   REGRESSION: re-scaffolding an ALREADY-`.lore/`-initialized repo (whose
 *               config.yaml predates this template) never retroactively
 *               injects the block — SPEC-058 D1 "existing corpora
 *               untouched", exercised via the real `scaffoldProject` skip
 *               path (`runInitStep` never calls `initCorpus` when `.lore/`
 *               already exists)
 *
 * @spec_ref spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag AC-V-4
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import yaml from "yaml";

import { err, ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";
import { saveConfig } from "@lore/core/node";

import {
  mergeConfigWithOverlay,
  parseConfigTemplateOverlay,
} from "../../../src/flows/config-template.js";
import {
  scaffoldProject,
  type ExecPort,
  type InitCorpus,
  type ProjectAssetSource,
  type ProjectFsPort,
  type ProjectScaffoldFlowDeps,
} from "../../../src/flows/setup-project-flow.js";

// ─── Repo-root resolution (project-setup-service.test.ts precedent — same depth) ──
// packages/lore/tests/unit/setup/ -> repo root is 5 levels up.

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const PROJECT_ASSETS_DIR = join(REPO_ROOT, "assets", "project");
const TEMPLATE_ASSET_NAME = "lore-config-template.yaml";
const TEMPLATE_PATH = join(PROJECT_ASSETS_DIR, TEMPLATE_ASSET_NAME);

// packages/lore/tests/unit/setup/ -> ../../../../ -> packages/ -> core/src/verification-profile.js
const VERIFICATION_PROFILE_MODULE_PATH = [
  "..",
  "..",
  "..",
  "..",
  "core",
  "src",
  "verification-profile.js",
].join("/");

/** The sliver of `verification-profile.ts`'s public shape this suite needs. */
interface VerificationProfileModule {
  verificationProfileSchema: { safeParse: (v: unknown) => { success: boolean } };
}

// ─── HAPPY: the asset file itself ──────────────────────────────────────────────

describe("lore-config-template.yaml — HAPPY (asset content)", () => {
  it("exists on disk under assets/project/", () => {
    expect(existsSync(TEMPLATE_PATH)).toBe(true);
  });

  it("parses as YAML and carries design->e2e, feature->test, tech->test blocks", () => {
    const raw = readFileSync(TEMPLATE_PATH, "utf-8");
    const parsed = yaml.parse(raw) as Record<string, unknown>;

    const profiles = (parsed.workflow as Record<string, unknown> | undefined)?.["verification_profiles"] as
      | Record<string, { required_oracles?: string[]; min_acs?: number }>
      | undefined;
    expect(profiles).toBeDefined();
    if (!profiles) return;

    expect(profiles.design?.required_oracles).toContain("e2e");
    expect(profiles.feature?.required_oracles).toContain("test");
    expect(profiles.tech?.required_oracles).toContain("test");
  });

  // task-spec-promote-base-1-ac-rule-is-spec-kind-agnostic-spec-080 AC3 — the
  // seeded template carries a domain-overview entry waiving the AC-count floor.
  it("carries a domain-overview -> min_acs: 0 block with no required_oracles", () => {
    const raw = readFileSync(TEMPLATE_PATH, "utf-8");
    const parsed = yaml.parse(raw) as Record<string, unknown>;
    const profiles = (parsed.workflow as Record<string, unknown> | undefined)?.["verification_profiles"] as
      | Record<string, { required_oracles?: string[]; min_acs?: number }>
      | undefined;
    expect(profiles).toBeDefined();
    if (!profiles) return;

    expect(profiles["domain-overview"]?.min_acs).toBe(0);
    expect(profiles["domain-overview"]?.required_oracles).toBeUndefined();
  });
});

// ─── HAPPY (deferred): schema-dependent assertion ──────────────────────────────

describe("lore-config-template.yaml — HAPPY (schema-dependent, deferred)", () => {
  it("each recommended profile block parses via verificationProfileSchema, once @lore/core ships it", async () => {
    let mod: VerificationProfileModule | undefined;
    try {
      mod = (await import(VERIFICATION_PROFILE_MODULE_PATH)) as unknown as VerificationProfileModule;
    } catch {
      mod = undefined;
    }

    if (mod === undefined) {
      // reason: packages/core/src/verification-profile.ts is authored by a CONCURRENT
      // sibling task (dispatch bundle context digest) and is not present on this
      // branch yet — deferred, not a failure. This assertion self-activates the
      // moment that module lands, with zero edits to this file.
      console.warn(
        "[deferred] @lore/core verification-profile.ts not yet present on this branch — " +
          "schema-parse assertion skipped (activates once the sibling task lands)",
      );
      return;
    }

    const raw = readFileSync(TEMPLATE_PATH, "utf-8");
    const parsed = yaml.parse(raw) as Record<string, unknown>;
    const profiles = (parsed.workflow as Record<string, unknown>)["verification_profiles"] as Record<
      string,
      unknown
    >;

    for (const kind of ["design", "feature", "tech", "domain-overview"]) {
      const result = mod.verificationProfileSchema.safeParse(profiles[kind]);
      expect(result.success).toBe(true);
    }
  });
});

// ─── NEGATIVE: malformed overlay text ──────────────────────────────────────────

describe("parseConfigTemplateOverlay — NEGATIVE", () => {
  it("malformed YAML text returns err, never throws", () => {
    const malformed = "workflow:\n  verification_profiles:\n  - not: [valid, yaml: structure\n";
    const result = parseConfigTemplateOverlay(malformed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── ERROR: non-object top level ───────────────────────────────────────────────

describe("parseConfigTemplateOverlay — ERROR", () => {
  it("a YAML array at the top level is rejected, naming the configTemplateYaml field", () => {
    const result = parseConfigTemplateOverlay("- one\n- two\n- three\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect((result.error as Extract<LoreError, { code: "VALIDATION_ERROR" }>).field).toBe(
      "configTemplateYaml",
    );
  });

  it("a bare scalar top level is rejected the same way", () => {
    const result = parseConfigTemplateOverlay("just-a-string\n");
    expect(result.ok).toBe(false);
  });
});

// ─── BOUNDARY: merge semantics ──────────────────────────────────────────────────

describe("mergeConfigWithOverlay — BOUNDARY", () => {
  it("merging an empty overlay leaves base untouched", () => {
    const base = { project: { name: "t", author: "t" } };
    const merged = mergeConfigWithOverlay(base, {});
    expect(merged).toEqual(base);
  });

  it("merging into an empty base yields the overlay's shape", () => {
    const overlay = { workflow: { verification_profiles: { tech: { required_oracles: ["test"] } } } };
    const merged = mergeConfigWithOverlay({}, overlay);
    expect(merged).toEqual(overlay);
  });

  it("a base with a pre-existing sibling workflow.* key keeps it alongside the merged-in block (deep merge, not clobber)", () => {
    const base = { project: { name: "t", author: "t" }, workflow: { claim_ttl_minutes: 45 } };
    const overlay = { workflow: { verification_profiles: { tech: { required_oracles: ["test"] } } } };
    const merged = mergeConfigWithOverlay(base, overlay) as Record<string, unknown>;
    const workflow = merged.workflow as Record<string, unknown>;
    expect(workflow.claim_ttl_minutes).toBe(45);
    expect(workflow.verification_profiles).toEqual(overlay.workflow.verification_profiles);
  });
});

// ─── STATE: immutability ────────────────────────────────────────────────────────

describe("mergeConfigWithOverlay — STATE", () => {
  it("never mutates either input", () => {
    const base = { project: { name: "t", author: "t" } };
    const overlay = { workflow: { verification_profiles: { tech: { required_oracles: ["test"] } } } };
    const baseSnapshot = structuredClone(base);
    const overlaySnapshot = structuredClone(overlay);

    mergeConfigWithOverlay(base, overlay);

    expect(base).toEqual(baseSnapshot);
    expect(overlay).toEqual(overlaySnapshot);
  });
});

// ─── Scaffold integration (real ports, throwaway git repo — I6 rule) ───────────

function makeRealFs(): ProjectFsPort {
  return {
    exists(path: string): boolean {
      return existsSync(path);
    },
    readFile(path: string): string | null {
      try {
        return readFileSync(path, "utf-8");
      } catch {
        return null;
      }
    },
    writeFile(path: string, content: string, mode: number): void {
      writeFileSync(path, content, { mode });
    },
    mkdir(path: string): void {
      mkdirSync(path, { recursive: true });
    },
  };
}

function makeRealExec(): ExecPort {
  return {
    async run(argv: string[], cwd: string) {
      const [cmd, ...args] = argv;
      if (!cmd) return { code: -1, stdout: "", stderr: "empty argv" };
      const result = spawnSync(cmd, args, { cwd, encoding: "utf-8" });
      if (result.error) return { code: -1, stdout: "", stderr: result.error.message };
      return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    },
  };
}

function makeRealAssetSource(): ProjectAssetSource {
  return {
    async readAsset(name: string): Promise<Result<string, LoreError>> {
      try {
        return ok(readFileSync(join(PROJECT_ASSETS_DIR, name), "utf-8"));
      } catch {
        return err({
          code: "VALIDATION_ERROR",
          field: "name",
          message: `unknown or unreadable project asset: ${name}`,
          value: name,
        });
      }
    },
  };
}

/**
 * Mirrors production `commands/setup.ts::runProjectScaffold`'s `initCorpus`
 * closure — reads the REAL shipped template asset via the SAME asset source
 * the scaffold's hooks/tree.yaml steps use, merges it with `saveConfig`'s
 * SSOT, and writes `.lore/config.yaml` directly (never touches `bun:sqlite` —
 * this is a vitest suite, and `initCorpusAt`/`createApp` are bun-only,
 * `project-setup-service.test.ts`'s own documented precedent for why this
 * fixture exists rather than importing the real `initCorpusAt`).
 */
function makeConfigTemplateSeededInitCorpus(assets: ProjectAssetSource): InitCorpus {
  return async (repoDir: string) => {
    const baseConfig = { project: { name: "test-project", author: "test" } };
    const templateResult = await assets.readAsset(TEMPLATE_ASSET_NAME);
    if (!templateResult.ok) {
      return saveConfig(repoDir, baseConfig);
    }
    const overlayResult = parseConfigTemplateOverlay(templateResult.value);
    if (!overlayResult.ok) {
      return saveConfig(repoDir, baseConfig);
    }
    const merged = mergeConfigWithOverlay(baseConfig, overlayResult.value);
    return saveConfig(repoDir, merged as Parameters<typeof saveConfig>[1]);
  };
}

function makeRealDeps(): ProjectScaffoldFlowDeps {
  const assets = makeRealAssetSource();
  return {
    fs: makeRealFs(),
    exec: makeRealExec(),
    initCorpus: makeConfigTemplateSeededInitCorpus(assets),
    assets,
  };
}

const tempDirs: string[] = [];

function makeThrowawayGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-config-template-"));
  tempDirs.push(dir);
  execSync("git init -q", { cwd: dir });
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("scaffoldProject — HAPPY (config-template seeding integration)", () => {
  it("a freshly-scaffolded corpus's .lore/config.yaml contains the recommended verification-profile block", async () => {
    const repoDir = makeThrowawayGitRepo();
    const result = await scaffoldProject(makeRealDeps(), { repoDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.init.status).toBe("done");

    const configPath = join(repoDir, ".lore", "config.yaml");
    expect(existsSync(configPath)).toBe(true);
    const parsed = yaml.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    const profiles = (parsed.workflow as Record<string, unknown>)["verification_profiles"] as Record<
      string,
      { required_oracles?: string[]; min_acs?: number }
    >;
    expect(profiles.design?.required_oracles).toContain("e2e");
    expect(profiles.feature?.required_oracles).toContain("test");
    expect(profiles.tech?.required_oracles).toContain("test");
    expect(profiles["domain-overview"]?.min_acs).toBe(0);
  });
});

describe("scaffoldProject — REGRESSION (existing corpora untouched, SPEC-058 D1)", () => {
  it("re-scaffolding an already-.lore/-initialized repo never retroactively injects the block", async () => {
    const repoDir = makeThrowawayGitRepo();
    const loreDir = join(repoDir, ".lore");
    mkdirSync(loreDir, { recursive: true });
    // A pre-existing config.yaml predating this template — no workflow.verification_profiles key.
    const preExistingResult = saveConfig(repoDir, { project: { name: "pre-existing", author: "owner" } });
    expect(preExistingResult.ok).toBe(true);

    const result = await scaffoldProject(makeRealDeps(), { repoDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // init step is skipped entirely (runInitStep never calls initCorpus when .lore/ exists) —
    // the config-template seeding closure above is therefore never invoked either.
    expect(result.value.init.status).toBe("skipped");

    const configPath = join(repoDir, ".lore", "config.yaml");
    const parsed = yaml.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    expect(parsed.workflow).toBeUndefined();
    expect((parsed.project as Record<string, unknown>).name).toBe("pre-existing");
  });
});
