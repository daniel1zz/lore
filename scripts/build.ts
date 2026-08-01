#!/usr/bin/env bun
/**
 * Build script: compiles src/index.ts into a standalone binary at dist/lore.
 * Uses Bun.build() API with compile + minify options and a plugin to embed the
 * libsql native addon as a static require so the binary works outside node_modules.
 *
 * Problem: node_modules/libsql/index.js uses a dynamic template-literal require:
 *   return require(`@libsql/${target}`);
 * Bun's bundler cannot statically analyze this, so the .node file is NOT embedded
 * in the binary. At runtime, Bun falls back to cwd node_modules — which fails when
 * the binary is run from a directory without node_modules.
 *
 * Fix: an onLoad plugin intercepts libsql/index.js and rewrites the single dynamic
 * require line to a static require of the resolved absolute .node path.
 * Bun embeds any .node file that appears as a static string literal require.
 */

import { join, dirname } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { spawnSync } from "node:child_process";
import type { BunPlugin, PluginBuilder, OnLoadArgs } from "bun";
import { resolvePlatform } from "./platform-map.js";
import {
  buildManifest,
  renderGeneratedFile,
  extractEmbeddedTreeDigest,
  GENERATED_FILE_PATH,
} from "./embed-assets-manifest.mjs";
import {
  runDashboardAssetsStep,
  DASHBOARD_SHORT_CIRCUIT_MARKER,
  DASHBOARD_BUILD_START_MARKER,
} from "./dashboard-assets-freshness.mjs";

const root = join(import.meta.dir, "..");
const entrypoint = join(root, "packages", "lore", "src", "index.ts");
const outfile = join(root, "dist", "lore");

/** Resolves the absolute path to the native .node file for the current platform. */
function resolveNativeNodePath(nativePkg: string): string {
  // Bun workspaces install dependencies under the owning workspace's node_modules
  // rather than hoisting to the root. libsql lives at packages/lore/node_modules/@libsql/<target>.
  // Use packages/lore as the resolver referrer so we find it whether the build runs
  // in a workspace or a flat checkout.
  const referrer = join(root, "packages", "lore");
  let pkgJsonPath: string;
  try {
    pkgJsonPath = Bun.resolveSync(`${nativePkg}/package.json`, referrer);
  } catch (e) {
    throw new Error(
      `[build] Cannot resolve ${nativePkg}/package.json from ${referrer}. ` +
        `Run 'bun install' first.\nCause: ${e}`
    );
  }

  // package.json resides at <pkg-root>/package.json; .node is <pkg-root>/index.node
  const nodeFilePath = pkgJsonPath.replace(/\/package\.json$/, "/index.node");
  if (!existsSync(nodeFilePath)) {
    throw new Error(
      `[build] Expected native addon at ${nodeFilePath} but file not found. ` +
        `The ${nativePkg} package may be incomplete.`
    );
  }
  return nodeFilePath;
}

/**
 * Bun plugin that rewrites the single dynamic-require line in libsql/index.js
 * to a static require of the resolved .node absolute path.
 *
 * Pattern matched (exactly one occurrence expected):
 *   return require(`@libsql/${target}`);
 *
 * Replaced with:
 *   return require("<absolute path to index.node>");
 *
 * If the pattern is NOT found, the build fails loudly (guards against libsql
 * version drift that renames or restructures the function).
 */
function makeLibsqlPlugin(nativeNodePath: string): BunPlugin {
  // Escape for use in the output source — on Windows, backslashes need doubling
  const escapedNodePath = nativeNodePath.replace(/\\/g, "\\\\");

  return {
    name: "libsql-static-native-require",
    setup(build: PluginBuilder) {
      build.onLoad({ filter: /[/\\]libsql[/\\]index\.js$/ }, async (args: OnLoadArgs) => {
        const source = await Bun.file(args.path).text();

        // The exact line produced by @neon-rs/load's requireNative() fallback.
        // This regex matches the template-literal require statement.
        const dynamicRequirePattern =
          /return require\(`@libsql\/\${target}`\);/;

        if (!dynamicRequirePattern.test(source)) {
          throw new Error(
            `[build] libsql-static-native-require plugin: expected to find ` +
              `'return require(\`@libsql/\${target}\`);' in ${args.path} ` +
              `but the pattern was not found. The libsql package may have changed. ` +
              `Update scripts/build.ts to match the new pattern.`
          );
        }

        const rewritten = source.replace(
          dynamicRequirePattern,
          `return require("${escapedNodePath}");`
        );

        return { contents: rewritten, loader: "js" };
      });
    },
  };
}

// ─── Dashboard production build step (spec-dashboard-production-packaging-
// one-command-lore-dashboard, DD-1) ─────────────────────────────────────────
//
// Runs BEFORE the assets-manifest block and BEFORE Bun.build's compile step
// below — same ordering rationale as that block: the generated module's
// on-disk content at compile time is exactly what `bun build --compile`
// embeds. Produces the git-ignored `packages/lore/src/generated/
// dashboard-assets.ts`, consumed exclusively via the committed dynamic-
// import loader at `packages/lore/src/adapters/http/dashboard-assets-loader.ts`
// (never a static import — see that file's doc comment for the bundler-
// embedding rationale that makes a literal specifier mandatory there).
//
// The decision + regeneration logic lives in the importable, independently
// unit-tested `./dashboard-assets-freshness.mjs` (task-a-stale-untracked-
// dashboard-assets-ts-breaks-every) — see that module's doc comment for the
// "stale manifest survives a digest-match short-circuit" defect it closes:
// a digest match on dashboard SOURCE is NOT evidence that the existing
// manifest's file references still resolve against the CURRENT `dist/`,
// because `vite build` unconditionally empties+rewrites `dist/` with fresh
// content-hashed filenames even on a run that later aborts for an unrelated
// reason (observed: a `prebuild` router-codegen step failing after vite's
// own build had already completed). `runDashboardAssetsStep` verifies file
// existence directly (ground truth) instead of trusting the digest proxy,
// so an interrupted/concurrent prior build that left `dist/` and the
// manifest out of sync is detected and self-heals on the very next build —
// no manual `rm` required ("cannot happen", not "fails legibly").

const dashboardRoot = join(root, "packages", "dashboard");
const dashboardSrcDir = join(dashboardRoot, "src");
const dashboardViteConfigPath = join(dashboardRoot, "vite.config.ts");
const dashboardPkgJsonPath = join(dashboardRoot, "package.json");
const dashboardDistDir = join(dashboardRoot, "dist");
const DASHBOARD_GENERATED_PATH = join(root, "packages", "lore", "src", "generated", "dashboard-assets.ts");

console.log(`Checking dashboard build freshness...`);
const dashboardStep = runDashboardAssetsStep({
  dashboardSrcDir,
  dashboardViteConfigPath,
  dashboardPkgJsonPath,
  dashboardDistDir,
  generatedFilePath: DASHBOARD_GENERATED_PATH,
  skipDashboardBuild: process.argv.includes("--skip-dashboard"),
  // Fires BEFORE runVite() so "why we're about to rebuild" prints ahead of
  // the spawned child's own inherited-stdio output, never after it.
  onBeforeRebuild: (decision) => {
    console.log(decision.reason.startsWith("stale-manifest:") ? decision.reason : DASHBOARD_BUILD_START_MARKER);
  },
  // reason: no explicit `maxBuffer` here (unlike `commands/assess.ts`'s `git diff` spawn,
  // task-lore-assess-diff-spawnsync-sets-no-maxbuffer-a-diff-over-1) — `maxBuffer` only
  // governs Node's OWN in-process accumulation of a `pipe`-mode child's stdout/stderr
  // (spawnSync's default `stdio`); `stdio: "inherit"` here passes the dashboard build's
  // fds straight through to THIS process's own stdout/stderr, bypassing that
  // accumulation buffer entirely (confirmed via Node's child_process docs: `maxBuffer`
  // is documented as bounding output captured through `pipe`, and `inherit` never
  // creates a pipe to capture through). ENOBUFS is structurally impossible here
  // regardless of how much the dashboard build logs.
  runVite: () =>
    spawnSync("bun", ["run", "--filter", "@lore/dashboard", "build"], {
      cwd: root,
      stdio: "inherit",
    }),
});

if (dashboardStep.action === "short-circuited") {
  console.log(DASHBOARD_SHORT_CIRCUIT_MARKER);
} else {
  // "rebuilt" already logged its reason from inside onBeforeRebuild, above;
  // "skipped" (--skip-dashboard) has no prior announcement to interleave with.
  if (dashboardStep.action === "skipped") {
    console.log(`dashboard: --skip-dashboard set, skipping vite build (stamp marked skipped)`);
  }
  console.log(
    `  Dashboard assets manifest: ${String(dashboardStep.distFileCount)} files` +
      `${dashboardStep.action === "skipped" ? " (--skip-dashboard: reused existing dist/)" : ""}, ` +
      `digest ${String(dashboardStep.digest)} (verified fresh)`,
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log(`Building lore binary...`);
console.log(`  Entry:  ${entrypoint}`);
console.log(`  Output: ${outfile}`);

const nativePkg = `@libsql/${resolvePlatform().libsqlTarget}`;
const nativeNodePath = resolveNativeNodePath(nativePkg);

console.log(`  Native: ${nativeNodePath}`);

// ─── Embedded assets manifest (SPEC-076 §C2, R1 mitigation) ──────────────────
// MUST run BEFORE Bun.build's compile step below — the manifest generator's
// output (packages/lore/src/generated/assets-manifest.ts) is a normal source
// file, embedded into the binary exactly as it reads on disk at compile time.
// Regenerating it AFTER compiling would silently ship a stale `tree_digest`
// (the very freshness truth `lore setup --check` depends on) inside the
// binary. Do not reorder this block below the `Bun.build()` call.
console.log(`Regenerating embedded assets manifest...`);
const assetsManifest = buildManifest(join(root, "assets"), root);
mkdirSync(dirname(GENERATED_FILE_PATH), { recursive: true });
writeFileSync(GENERATED_FILE_PATH, renderGeneratedFile(assetsManifest), "utf8");

// Post-write self-check: read back what was just written and confirm its
// embedded tree_digest equals the freshly-computed one — this is the ordering
// assertion the compiled binary's embedded digest correctness depends on
// (AC: "compiled binary's embedded tree_digest equals a fresh recomputation").
const verifyDigest = extractEmbeddedTreeDigest(readFileSync(GENERATED_FILE_PATH, "utf8"));
if (verifyDigest !== assetsManifest.tree_digest) {
  throw new Error(
    `[build] Post-write verification failed: ${GENERATED_FILE_PATH} embeds tree_digest ` +
      `"${verifyDigest}" but a fresh recomputation over assets/ is "${assetsManifest.tree_digest}". ` +
      `This must never happen — investigate scripts/embed-assets-manifest.mjs's ` +
      `renderGeneratedFile/extractEmbeddedTreeDigest for a round-trip bug.`,
  );
}
console.log(
  `  Assets manifest: ${assetsManifest.entries.length} files, tree_digest ${assetsManifest.tree_digest} (verified fresh)`,
);

const result = await Bun.build({
  entrypoints: [entrypoint],
  target: "bun",
  minify: true,
  compile: { outfile },
  plugins: [makeLibsqlPlugin(nativeNodePath)],
});

if (!result.success) {
  console.error(`Build failed:`);
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`\nBuild succeeded: ${outfile}`);
