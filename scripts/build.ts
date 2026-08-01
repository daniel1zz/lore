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

import { join, dirname, relative, sep } from "path";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { BunPlugin, PluginBuilder, OnLoadArgs } from "bun";
import { resolvePlatform } from "./platform-map.js";
import {
  buildManifest,
  renderGeneratedFile,
  extractEmbeddedTreeDigest,
  GENERATED_FILE_PATH,
} from "./embed-assets-manifest.mjs";

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

const dashboardRoot = join(root, "packages", "dashboard");
const dashboardSrcDir = join(dashboardRoot, "src");
const dashboardViteConfigPath = join(dashboardRoot, "vite.config.ts");
const dashboardPkgJsonPath = join(dashboardRoot, "package.json");
const dashboardDistDir = join(dashboardRoot, "dist");
const DASHBOARD_GENERATED_PATH = join(root, "packages", "lore", "src", "generated", "dashboard-assets.ts");

/** Literal, grep-assertable per the task AC — do not reword without updating the paired oracle. */
const DASHBOARD_SHORT_CIRCUIT_MARKER = "dashboard: unchanged (digest match), skipping vite build";
const DASHBOARD_BUILD_START_MARKER =
  "dashboard: build starting (digest changed or no prior build), running vite build via package lifecycle";

function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Recursively collects every regular file under `dir`, as POSIX-relative paths (sorted). Empty array if `dir` is absent. */
function walkFilesRelative(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string, prefix: string) => {
    const dirents = readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of dirents) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(join(current, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(dir, "");
  return out;
}

/** `true` iff `dashboardDistDir` exists and contains at least one file. */
function dashboardDistIsPresent(): boolean {
  return walkFilesRelative(dashboardDistDir).length > 0;
}

/**
 * Content digest over `packages/dashboard/src/**` + `vite.config.ts` +
 * `package.json` — the dashboard build's freshness identity (task
 * Approach). sha256 per file over raw bytes, sorted-pair whole-tree digest
 * (mirrors `embed-assets-manifest.mjs`'s `computeTreeDigest` — same
 * rationale: filesystem walk order must never leak into the digest).
 */
function computeDashboardSourceDigest(): string {
  const entries: { path: string; sha256: string }[] = [];
  for (const rel of walkFilesRelative(dashboardSrcDir)) {
    entries.push({ path: `src/${rel}`, sha256: sha256Hex(readFileSync(join(dashboardSrcDir, rel))) });
  }
  entries.push({ path: "vite.config.ts", sha256: sha256Hex(readFileSync(dashboardViteConfigPath)) });
  entries.push({ path: "package.json", sha256: sha256Hex(readFileSync(dashboardPkgJsonPath)) });
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const joined = entries.map((e) => `${e.path} ${e.sha256}`).join("\n");
  return sha256Hex(Buffer.from(joined, "utf8"));
}

/** Extracts a previously-generated dashboard-assets.ts source's embedded `stamp.digest`, or `undefined` if absent/corrupt. */
function extractEmbeddedDashboardDigest(source: string): string | undefined {
  const match = source.match(/digest:\s*"([0-9a-f]{64})"/);
  return match ? match[1] : undefined;
}

const DASHBOARD_CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain",
  ".wasm": "application/wasm",
};

function contentTypeForDistPath(relPath: string): string {
  const dot = relPath.lastIndexOf(".");
  const ext = dot === -1 ? "" : relPath.slice(dot).toLowerCase();
  return DASHBOARD_CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * Renders the generated dashboard-assets.ts module source: one `with {
 * type: "file" }` import per `packages/dashboard/dist/**` file, using a
 * LITERAL relative specifier per entry (required for `bun build --compile`
 * to embed each one — see dashboard-assets-loader.ts's doc comment), plus
 * the `DASHBOARD_ASSETS_MANIFEST` export the loader's contract requires.
 * `distFiles` are POSIX-relative paths under `dashboardDistDir`.
 */
function renderDashboardAssetsModule(
  distFiles: string[],
  stamp: { digest: string; builtAt: string; skipped?: boolean },
): string {
  const generatedDir = dirname(DASHBOARD_GENERATED_PATH);
  const importLines: string[] = [];
  const entryLines: string[] = [];
  distFiles.forEach((rel, i) => {
    const abs = join(dashboardDistDir, rel);
    const relSpecifier = relative(generatedDir, abs).split(sep).join("/");
    const specifier = relSpecifier.startsWith(".") ? relSpecifier : `./${relSpecifier}`;
    const varName = `asset_${i}`;
    // bun-types only ships ambient `with { type: "file" }` module
    // declarations for a handful of extensions (.txt/.toml/.yaml/.json*/
    // .html — see node_modules/bun-types/extensions.d.ts); an arbitrary
    // vite dist file (.css, .js, nested asset extensions the dashboard
    // build might emit later) has no such declaration, so a bare import
    // fails tsc with TS2307/TS7016 whenever this generated file exists on
    // disk — and packages/lore/tsconfig.json's broad `include: ["src/**/*"]`
    // DOES type-check it even though nothing statically imports it
    // elsewhere. `@ts-ignore` (never `@ts-expect-error`) suppresses that
    // per-line without ever erroring "unused" for extensions bun-types DOES
    // cover (e.g. .html) — the same asymmetric-safety rationale as the
    // committed loader's default-path import.
    importLines.push(
      `// @ts-ignore -- see scripts/build.ts's renderDashboardAssetsModule doc comment`,
    );
    importLines.push(`import ${varName} from ${JSON.stringify(specifier)} with { type: "file" };`);
    const urlPath = `/${rel}`;
    const contentType = contentTypeForDistPath(rel);
    const immutable = rel.startsWith("assets/");
    entryLines.push(
      `  ${JSON.stringify(urlPath)}: { embedded: ${varName}, contentType: ${JSON.stringify(contentType)}, immutable: ${immutable} },`,
    );
  });

  const stampSrc =
    stamp.skipped === true
      ? `{ digest: ${JSON.stringify(stamp.digest)}, builtAt: ${JSON.stringify(stamp.builtAt)}, skipped: true }`
      : `{ digest: ${JSON.stringify(stamp.digest)}, builtAt: ${JSON.stringify(stamp.builtAt)} }`;

  return `/**
 * AUTO-GENERATED by scripts/build.ts — DO NOT HAND-EDIT, DO NOT COMMIT.
 * Git-ignored (spec-dashboard-production-packaging-one-command-lore-dashboard,
 * DD-1 git contract): content churns with every hashed vite build filename.
 * Regenerate: \`bun run build\` (or \`bun run build --skip-dashboard\` to reuse
 * an existing packages/dashboard/dist without re-running vite — marks the
 * stamp \`skipped: true\`, loud in \`/api/health\`).
 *
 * Consumed EXCLUSIVELY via the guarded dynamic import in the COMMITTED
 * loader packages/lore/src/adapters/http/dashboard-assets-loader.ts — never
 * import this module directly (breaks fresh-clone \`bun run typecheck\`).
 */
${importLines.join("\n")}

export const DASHBOARD_ASSETS_MANIFEST = {
  stamp: ${stampSrc},
  entries: {
${entryLines.join("\n")}
  },
};
`;
}

/** Regenerates + writes `DASHBOARD_GENERATED_PATH` from the current `dashboardDistDir`, with a post-write digest self-check. */
function writeDashboardAssetsModule(stamp: { digest: string; builtAt: string; skipped?: boolean }): void {
  const distFiles = walkFilesRelative(dashboardDistDir);
  const moduleSrc = renderDashboardAssetsModule(distFiles, stamp);
  mkdirSync(dirname(DASHBOARD_GENERATED_PATH), { recursive: true });
  writeFileSync(DASHBOARD_GENERATED_PATH, moduleSrc, "utf8");

  const verifyDigest = extractEmbeddedDashboardDigest(readFileSync(DASHBOARD_GENERATED_PATH, "utf8"));
  if (verifyDigest !== stamp.digest) {
    throw new Error(
      `[build] Post-write verification failed: ${DASHBOARD_GENERATED_PATH} embeds digest "${String(verifyDigest)}" ` +
        `but the intended stamp digest is "${stamp.digest}". This must never happen — investigate ` +
        `renderDashboardAssetsModule/extractEmbeddedDashboardDigest for a round-trip bug.`,
    );
  }
  console.log(
    `  Dashboard assets manifest: ${distFiles.length} files${stamp.skipped === true ? " (--skip-dashboard: reused existing dist/)" : ""}, digest ${stamp.digest} (verified fresh)`,
  );
}

console.log(`Checking dashboard build freshness...`);
const skipDashboardBuild = process.argv.includes("--skip-dashboard");
const freshDashboardDigest = computeDashboardSourceDigest();
const existingDashboardDigest = existsSync(DASHBOARD_GENERATED_PATH)
  ? extractEmbeddedDashboardDigest(readFileSync(DASHBOARD_GENERATED_PATH, "utf8"))
  : undefined;

if (skipDashboardBuild) {
  console.log(`dashboard: --skip-dashboard set, skipping vite build (stamp marked skipped)`);
  if (!dashboardDistIsPresent()) {
    throw new Error(
      `[build] --skip-dashboard requires an existing packages/dashboard/dist build (none found at ${dashboardDistDir}). ` +
        `Run 'bun run build' once without --skip-dashboard first.`,
    );
  }
  writeDashboardAssetsModule({ digest: freshDashboardDigest, builtAt: new Date().toISOString(), skipped: true });
} else if (existingDashboardDigest === freshDashboardDigest && dashboardDistIsPresent()) {
  console.log(DASHBOARD_SHORT_CIRCUIT_MARKER);
} else {
  console.log(DASHBOARD_BUILD_START_MARKER);
  // reason: no explicit `maxBuffer` here (unlike `commands/assess.ts`'s `git diff` spawn,
  // task-lore-assess-diff-spawnsync-sets-no-maxbuffer-a-diff-over-1) — `maxBuffer` only
  // governs Node's OWN in-process accumulation of a `pipe`-mode child's stdout/stderr
  // (spawnSync's default `stdio`); `stdio: "inherit"` here passes the dashboard build's
  // fds straight through to THIS process's own stdout/stderr, bypassing that
  // accumulation buffer entirely (confirmed via Node's child_process docs: `maxBuffer`
  // is documented as bounding output captured through `pipe`, and `inherit` never
  // creates a pipe to capture through). ENOBUFS is structurally impossible here
  // regardless of how much the dashboard build logs.
  const dashboardBuildResult = spawnSync("bun", ["run", "--filter", "@lore/dashboard", "build"], {
    cwd: root,
    stdio: "inherit",
  });
  if (dashboardBuildResult.status !== 0) {
    throw new Error(
      `[build] dashboard build failed (bun run --filter '@lore/dashboard' build exited ` +
        `${String(dashboardBuildResult.status)}). See output above.`,
    );
  }
  if (!dashboardDistIsPresent()) {
    throw new Error(
      `[build] dashboard build reported success but ${dashboardDistDir} is missing or empty. ` +
        `Check packages/dashboard/vite.config.ts's build.outDir.`,
    );
  }
  // Recompute AFTER the build, not before: `prebuild` regenerates the
  // git-ignored packages/dashboard/src/routeTree.gen.ts on every invocation
  // (TanStack Router codegen), so the pre-build snapshot in
  // `freshDashboardDigest` never matches what's actually on disk once this
  // build's own prebuild step has run. Storing that stale pre-build digest
  // as the stamp would make the VERY NEXT run recompute a different digest
  // (now including this run's routeTree.gen.ts) and rebuild again —
  // defeating the two-consecutive-runs short-circuit contract even though
  // nothing hand-written changed. The post-build digest is what the NEXT
  // run's pre-build snapshot will actually reproduce (routeTree.gen.ts
  // codegen is deterministic for unchanged routes), so it's the correct
  // freshness identity to persist.
  const postBuildDashboardDigest = computeDashboardSourceDigest();
  writeDashboardAssetsModule({ digest: postBuildDashboardDigest, builtAt: new Date().toISOString() });
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
