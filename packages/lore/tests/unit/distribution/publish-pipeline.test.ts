/**
 * `scripts/publish-npm.ts` unit suite (SPEC-048 Scope IN #2, AC-048-A).
 *
 * Exercises the orchestrator's PURE surface — `parseArgs` and `runPipeline`
 * — with an in-memory fake `PipelineDeps` bundle (fake build/assemble/verify
 * functions + a fake `Publisher`). No filesystem write, no subprocess spawn,
 * no network activity: every stage is a plain async function pushing a
 * marker into a shared call-order array and resolving `ok(...)`/`err(...)`.
 *
 * The single most important assertion class here is D9 (SPEC-048 Design):
 * `fakePublisher.npmPublish` must NEVER be invoked unless `flags.publish`
 * is `true` — verified across a bare run, a `--pack-only` run, and a
 * `--tag beta` run (the task's literal D-FUNC INV-1 AC wording).
 *
 * Coverage:
 *   HAPPY:      parseArgs resolves every flag combination correctly
 *               (defaults, --publish, --tag, --registry, --pack-only,
 *               combinations); runPipeline's full stage sequence succeeds
 *               and returns the composed PipelineReport
 *   NEGATIVE:   an unknown flag, and --tag/--registry each missing their
 *               required value, are rejected with VALIDATION_ERROR naming
 *               the offending token/field
 *   BOUNDARY:   bare run, --pack-only run, and --tag beta run (none passing
 *               --publish) all leave fakePublisher.npmPublish uncalled;
 *               --pack-only calls fakePublisher.npmPack exactly once while
 *               a bare run calls neither Publisher method
 *   ERROR:      a failing build/assemble/verify stage short-circuits the
 *               pipeline — every later stage (including both Publisher
 *               methods) is never invoked, and the original error surfaces
 *               verbatim (not re-wrapped)
 *   STATE:      stage call order is exactly build → assemble → verify →
 *               (pack-only?) → (publish?), asserted via a shared marker array
 *   REGRESSION: a bare run's PipelineReport has `published: false` and NO
 *               `packed` key at all (never `packed: undefined`) —
 *               `exactOptionalPropertyTypes` discipline; --publish is
 *               called with exactly the resolved tag/registry, never more
 *
 * Import note: `scripts/publish-npm.ts` lives OUTSIDE
 * `packages/lore/tsconfig.tests.json`'s `rootDir` ("."). A static `import` of
 * a repo-root `scripts/` file from here would pull it into that tsconfig's
 * program and fail with TS6059 ("File is not under rootDir"). Loading it via
 * `import()` with a runtime-COMPUTED (non-literal) specifier sidesteps that
 * — mirrors `platform-map.test.ts`'s established workaround exactly.
 *
 * @spec_ref AC-048-A, SPEC-048 Design D9
 */

import { describe, it, expect, beforeAll } from "vitest";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

import { ok, err } from "@lore/core";
import type { Result, LoreError } from "@lore/core";

// ─── Structural mirrors of scripts/publish-npm.ts's exported shapes ────────
// Not imported (see note above) — kept in lockstep by exercising the real
// module's runtime behavior below, same convention as platform-map.test.ts.

interface PublishNpmFlags {
  publish: boolean;
  packOnly: boolean;
  tag: string;
  registry?: string;
  skipBuild?: true;
}

/** Minimal structural stand-in for `PublishPlan` — the pipeline never inspects its shape, only threads it through. */
interface FakePublishPlan {
  target: string;
  packageName: string;
  stagingRoot: string;
  stagingFiles: Record<string, string>;
  packageJson: Record<string, unknown>;
}

interface FakeVerifyReport {
  version: string;
  packFiles: string[];
  tarballSizeBytes: number;
}

interface FakePackResult {
  tarballPath: string;
  sizeBytes: number;
}

interface PipelineDeps {
  build: () => Promise<Result<void, LoreError>>;
  assemble: () => Promise<Result<FakePublishPlan, LoreError>>;
  verify: (plan: FakePublishPlan) => Promise<Result<FakeVerifyReport, LoreError>>;
  publisher: {
    npmPack: (plan: FakePublishPlan) => Promise<Result<FakePackResult, LoreError>>;
    npmPublish: (plan: FakePublishPlan, opts: { tag: string; registry?: string }) => Promise<Result<void, LoreError>>;
  };
}

interface PipelineReport {
  plan: FakePublishPlan;
  verify: FakeVerifyReport;
  packed?: FakePackResult;
  published: boolean;
}

type ParseArgsFn = (argv: string[]) => Result<PublishNpmFlags, LoreError>;
type RunPipelineFn = (flags: PublishNpmFlags, deps: PipelineDeps) => Promise<Result<PipelineReport, LoreError>>;

// packages/lore/tests/unit/distribution/publish-pipeline.test.ts -> repo root is 5 levels up.
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const PUBLISH_NPM_SPECIFIER = pathToFileURL(join(REPO_ROOT, "scripts", "publish-npm.ts")).href;

let parseArgs: ParseArgsFn;
let runPipeline: RunPipelineFn;

beforeAll(async () => {
  const publishNpmModule = await import(/* @vite-ignore */ PUBLISH_NPM_SPECIFIER);
  parseArgs = publishNpmModule.parseArgs;
  runPipeline = publishNpmModule.runPipeline;
});

// ─── Fixtures ───────────────────────────────────────────────────────────────

const FAKE_PLAN: FakePublishPlan = {
  target: "darwin-arm64",
  packageName: "@lore-npm-scope-placeholder/cli-darwin-arm64",
  stagingRoot: "dist-npm/cli-darwin-arm64/",
  stagingFiles: { "dist-npm/cli-darwin-arm64/dist/lore": "dist/lore" },
  packageJson: { name: "@lore-npm-scope-placeholder/cli-darwin-arm64", version: "0.1.0" },
};

const FAKE_VERIFY_REPORT: FakeVerifyReport = {
  version: "0.1.0",
  packFiles: ["dist/lore", "postinstall.mjs", "package.json"],
  tarballSizeBytes: 1024,
};

const FAKE_PACK_RESULT: FakePackResult = {
  tarballPath: "/tmp/fake/cli-darwin-arm64-0.1.0.tgz",
  sizeBytes: 2048,
};

/** Tracks the order every stage function is invoked in — the STATE-dimension oracle. */
interface CallTracker {
  order: string[];
  npmPackCalls: FakePublishPlan[];
  npmPublishCalls: Array<{ plan: FakePublishPlan; opts: { tag: string; registry?: string } }>;
}

interface FakeStageOutcomes {
  build?: Result<void, LoreError>;
  assemble?: Result<FakePublishPlan, LoreError>;
  verify?: Result<FakeVerifyReport, LoreError>;
  npmPack?: Result<FakePackResult, LoreError>;
  npmPublish?: Result<void, LoreError>;
}

/** Builds a fake `PipelineDeps` bundle + a shared `CallTracker`, defaulting every stage to success unless overridden. */
function makeFakeDeps(outcomes: FakeStageOutcomes = {}): { deps: PipelineDeps; tracker: CallTracker } {
  const tracker: CallTracker = { order: [], npmPackCalls: [], npmPublishCalls: [] };

  const deps: PipelineDeps = {
    build: async () => {
      tracker.order.push("build");
      return outcomes.build ?? ok(undefined);
    },
    assemble: async () => {
      tracker.order.push("assemble");
      return outcomes.assemble ?? ok(FAKE_PLAN);
    },
    verify: async (_plan) => {
      tracker.order.push("verify");
      return outcomes.verify ?? ok(FAKE_VERIFY_REPORT);
    },
    publisher: {
      npmPack: async (plan) => {
        tracker.order.push("npmPack");
        tracker.npmPackCalls.push(plan);
        return outcomes.npmPack ?? ok(FAKE_PACK_RESULT);
      },
      npmPublish: async (plan, opts) => {
        tracker.order.push("npmPublish");
        tracker.npmPublishCalls.push({ plan, opts });
        return outcomes.npmPublish ?? ok(undefined);
      },
    },
  };

  return { deps, tracker };
}

const BASE_FLAGS: PublishNpmFlags = { publish: false, packOnly: false, tag: "beta" };

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("scripts/publish-npm — parseArgs", () => {
  describe("HAPPY — flag combinations", () => {
    it("defaults to a bare dry-run (no --publish, no --pack-only, tag 'beta')", () => {
      const result = parseArgs([]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ publish: false, packOnly: false, tag: "beta" });
    });

    it("parses --publish", () => {
      const result = parseArgs(["--publish"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.publish).toBe(true);
    });

    it("parses --pack-only", () => {
      const result = parseArgs(["--pack-only"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.packOnly).toBe(true);
    });

    it("parses --tag <value>, overriding the 'beta' default", () => {
      const result = parseArgs(["--tag", "latest"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.tag).toBe("latest");
    });

    it("parses --registry <value>", () => {
      const result = parseArgs(["--registry", "https://registry.example.com"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.registry).toBe("https://registry.example.com");
    });

    it("parses a full combination: --publish --tag latest --registry <url> --pack-only", () => {
      const result = parseArgs(["--publish", "--tag", "latest", "--registry", "https://registry.example.com", "--pack-only"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({
        publish: true,
        packOnly: true,
        tag: "latest",
        registry: "https://registry.example.com",
      });
    });
  });

  describe("NEGATIVE — malformed argv", () => {
    it("rejects an unknown flag", () => {
      const result = parseArgs(["--bogus"]);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect((result.error as { message: string }).message).toContain("--bogus");
    });

    it("rejects --tag with no following value", () => {
      const result = parseArgs(["--tag"]);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect((result.error as { field: string }).field).toBe("tag");
    });

    it("rejects --registry with no following value", () => {
      const result = parseArgs(["--registry"]);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect((result.error as { field: string }).field).toBe("registry");
    });
  });

  describe("REGRESSION — omitted optional fields are truly absent", () => {
    it("a bare parse never carries a 'registry' key at all", () => {
      const result = parseArgs([]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect("registry" in result.value).toBe(false);
    });

    it("a bare parse never carries a 'skipBuild' key at all", () => {
      const result = parseArgs([]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect("skipBuild" in result.value).toBe(false);
    });
  });

  describe("TG-24 — --skip-build", () => {
    it("HAPPY: --skip-build --pack-only resolves skipBuild: true", () => {
      const result = parseArgs(["--pack-only", "--skip-build"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toMatchObject({ packOnly: true, skipBuild: true, publish: false });
    });

    it("NEGATIVE: --skip-build with --publish is refused (a publish must ship a binary it built)", () => {
      const result = parseArgs(["--publish", "--skip-build"]);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect((result.error as { message: string }).message).toContain("--skip-build");
    });
  });
});

describe("scripts/publish-npm — runPipeline", () => {
  describe("HAPPY — full successful sequence", () => {
    it("bare run: succeeds, returns plan+verify, published=false, no pack", async () => {
      const { deps, tracker } = makeFakeDeps();
      const result = await runPipeline(BASE_FLAGS, deps);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.plan).toEqual(FAKE_PLAN);
      expect(result.value.verify).toEqual(FAKE_VERIFY_REPORT);
      expect(result.value.published).toBe(false);
      expect(tracker.order).toEqual(["build", "assemble", "verify"]);
    });

    it("TG-24 skipBuild run: build() is never called; assemble and verify still run", async () => {
      const { deps, tracker } = makeFakeDeps();
      const result = await runPipeline({ ...BASE_FLAGS, skipBuild: true }, deps);
      expect(result.ok).toBe(true);
      expect(tracker.order).toEqual(["assemble", "verify"]);
    });

    it("--pack-only run: calls npmPack exactly once with the plan, still published=false", async () => {
      const { deps, tracker } = makeFakeDeps();
      const result = await runPipeline({ ...BASE_FLAGS, packOnly: true }, deps);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.packed).toEqual(FAKE_PACK_RESULT);
      expect(result.value.published).toBe(false);
      expect(tracker.npmPackCalls).toEqual([FAKE_PLAN]);
      expect(tracker.npmPublishCalls).toEqual([]);
      expect(tracker.order).toEqual(["build", "assemble", "verify", "npmPack"]);
    });

    it("--publish run: calls npmPublish exactly once with the resolved tag/registry", async () => {
      const { deps, tracker } = makeFakeDeps();
      const flags: PublishNpmFlags = { publish: true, packOnly: false, tag: "latest", registry: "https://registry.example.com" };
      const result = await runPipeline(flags, deps);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.published).toBe(true);
      expect(tracker.npmPublishCalls).toEqual([
        { plan: FAKE_PLAN, opts: { tag: "latest", registry: "https://registry.example.com" } },
      ]);
      expect(tracker.npmPackCalls).toEqual([]);
      expect(tracker.order).toEqual(["build", "assemble", "verify", "npmPublish"]);
    });

    it("--publish --pack-only together: both Publisher methods called, in pack-then-publish order", async () => {
      const { deps, tracker } = makeFakeDeps();
      const result = await runPipeline({ publish: true, packOnly: true, tag: "beta" }, deps);
      expect(result.ok).toBe(true);
      expect(tracker.npmPackCalls).toHaveLength(1);
      expect(tracker.npmPublishCalls).toHaveLength(1);
      expect(tracker.order).toEqual(["build", "assemble", "verify", "npmPack", "npmPublish"]);
    });
  });

  describe("BOUNDARY — D-FUNC INV-1: npmPublish NEVER called without --publish", () => {
    it.each([
      { label: "bare run", flags: BASE_FLAGS },
      { label: "--pack-only run", flags: { ...BASE_FLAGS, packOnly: true } },
      { label: "--tag beta run", flags: { ...BASE_FLAGS, tag: "beta" } },
    ])("$label: fakePublisher.npmPublish is never invoked; only stages a-c (+npmPack under --pack-only) run", async ({ flags }) => {
      const { deps, tracker } = makeFakeDeps();
      const result = await runPipeline(flags, deps);
      expect(result.ok).toBe(true);
      expect(tracker.npmPublishCalls).toEqual([]);
      if (flags.packOnly) {
        expect(tracker.order).toEqual(["build", "assemble", "verify", "npmPack"]);
      } else {
        expect(tracker.order).toEqual(["build", "assemble", "verify"]);
      }
    });

    it("a bare run calls NEITHER Publisher method", async () => {
      const { deps, tracker } = makeFakeDeps();
      await runPipeline(BASE_FLAGS, deps);
      expect(tracker.npmPackCalls).toEqual([]);
      expect(tracker.npmPublishCalls).toEqual([]);
    });
  });

  describe("ERROR — stage failure short-circuits every later stage", () => {
    const BUILD_ERROR: LoreError = { code: "VALIDATION_ERROR", field: "build", message: "build failed", value: 1 };
    const BUILD_FAILURE: Result<void, LoreError> = err(BUILD_ERROR);
    const ASSEMBLE_FAILURE: Result<FakePublishPlan, LoreError> = err({ code: "VALIDATION_ERROR", field: "assemble", message: "assemble failed" });
    const VERIFY_FAILURE: Result<FakeVerifyReport, LoreError> = err({ code: "VALIDATION_ERROR", field: "verify", message: "verify failed" });

    it("build failure: assemble/verify/publisher never run; original error surfaces verbatim", async () => {
      const { deps, tracker } = makeFakeDeps({ build: BUILD_FAILURE });
      const result = await runPipeline({ ...BASE_FLAGS, publish: true, packOnly: true }, deps);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual(BUILD_ERROR);
      expect(tracker.order).toEqual(["build"]);
      expect(tracker.npmPackCalls).toEqual([]);
      expect(tracker.npmPublishCalls).toEqual([]);
    });

    it("assemble failure: verify/publisher never run", async () => {
      const { deps, tracker } = makeFakeDeps({ assemble: ASSEMBLE_FAILURE });
      const result = await runPipeline({ ...BASE_FLAGS, publish: true, packOnly: true }, deps);
      expect(result.ok).toBe(false);
      expect(tracker.order).toEqual(["build", "assemble"]);
      expect(tracker.npmPackCalls).toEqual([]);
      expect(tracker.npmPublishCalls).toEqual([]);
    });

    it("verify failure: publisher never runs even with --publish --pack-only", async () => {
      const { deps, tracker } = makeFakeDeps({ verify: VERIFY_FAILURE });
      const result = await runPipeline({ publish: true, packOnly: true, tag: "beta" }, deps);
      expect(result.ok).toBe(false);
      expect(tracker.order).toEqual(["build", "assemble", "verify"]);
      expect(tracker.npmPackCalls).toEqual([]);
      expect(tracker.npmPublishCalls).toEqual([]);
    });

    it("npmPack failure (under --pack-only): npmPublish never runs even with --publish", async () => {
      const packFailure: Result<FakePackResult, LoreError> = err({ code: "VALIDATION_ERROR", field: "npm pack", message: "pack failed" });
      const { deps, tracker } = makeFakeDeps({ npmPack: packFailure });
      const result = await runPipeline({ publish: true, packOnly: true, tag: "beta" }, deps);
      expect(result.ok).toBe(false);
      expect(tracker.order).toEqual(["build", "assemble", "verify", "npmPack"]);
      expect(tracker.npmPublishCalls).toEqual([]);
    });
  });

  describe("STATE — call order is exactly sequential, never interleaved/reordered", () => {
    it("every stage runs in build -> assemble -> verify -> npmPack -> npmPublish order when all flags are set", async () => {
      const { deps, tracker } = makeFakeDeps();
      await runPipeline({ publish: true, packOnly: true, tag: "beta" }, deps);
      expect(tracker.order).toEqual(["build", "assemble", "verify", "npmPack", "npmPublish"]);
    });
  });

  describe("REGRESSION — PipelineReport shape discipline", () => {
    it("a bare run's report has NO 'packed' key at all (never packed: undefined)", async () => {
      const { deps } = makeFakeDeps();
      const result = await runPipeline(BASE_FLAGS, deps);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect("packed" in result.value).toBe(false);
    });

    it("a --pack-only run's report DOES carry the packed result", async () => {
      const { deps } = makeFakeDeps();
      const result = await runPipeline({ ...BASE_FLAGS, packOnly: true }, deps);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect("packed" in result.value).toBe(true);
      expect(result.value.packed).toEqual(FAKE_PACK_RESULT);
    });
  });
});
