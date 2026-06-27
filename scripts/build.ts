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

import { join } from "path";
import { existsSync } from "fs";
import type { BunPlugin, PluginBuilder, OnLoadArgs } from "bun";

const root = join(import.meta.dir, "..");
const entrypoint = join(root, "packages", "lore", "src", "index.ts");
const outfile = join(root, "dist", "lore");

/** Maps process.platform + process.arch (+ libc on linux) to the libsql target name. */
function resolveLibsqlTarget(): string {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "linux" && arch === "x64") return "linux-x64-gnu";
  if (platform === "linux" && arch === "arm64") return "linux-arm64-gnu";
  if (platform === "win32" && arch === "x64") return "win32-x64-msvc";

  throw new Error(
    `[build] Unsupported platform/arch combination: ${platform}/${arch}. ` +
      `Add it to the platform map in scripts/build.ts.`
  );
}

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

// ─── Main ────────────────────────────────────────────────────────────────────

console.log(`Building lore binary...`);
console.log(`  Entry:  ${entrypoint}`);
console.log(`  Output: ${outfile}`);

const nativePkg = `@libsql/${resolveLibsqlTarget()}`;
const nativeNodePath = resolveNativeNodePath(nativePkg);

console.log(`  Native: ${nativeNodePath}`);

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
