/**
 * Shared `lore.tree.yaml` blueprint load+parse flow — pure refactor extraction,
 * NO behavior change. Three adapter call sites (`adapters/cli/commands/status.ts`,
 * `adapters/cli/commands/review.ts`, `adapters/mcp/tools.ts`) each independently
 * re-implemented `existsSync(join(cwd, "lore.tree.yaml")) → readFileSync →
 * parseTreeBlueprint(raw)` with near-identical absent/invalid/ok branching. This
 * module is the single derivation site — mirrors `flows/drift-flow.ts`'s
 * narrow-deps, vitest-safe dependency discipline: pure `node:fs` + `@lore/core`,
 * NO `App`, NO `bun:sqlite` anywhere in its import graph.
 *
 * Public surface:
 *   loadTreeBlueprint(cwd) — reads and parses `<cwd>/lore.tree.yaml`, returning a
 *     discriminated `BlueprintLoadResult` covering the three outcomes every call
 *     site branches on: absent file, invalid YAML/schema, or a successfully
 *     parsed blueprint. Each adapter translates `status` into its own control
 *     flow (the CLI's stderr text + exit code, MCP's `Result` envelope) — this
 *     function itself never writes to stderr/stdout and never calls
 *     `process.exit`.
 *
 * Side-effect class: IO (synchronous fs read against the given `cwd`) — never
 * throws; a missing file is a normal `"missing"` outcome, not an exception.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parseTreeBlueprint } from "@lore/core";
import type { LoreError, TreeBlueprint } from "@lore/core";

/**
 * Discriminated result of loading+parsing `lore.tree.yaml` from a given `cwd`.
 * - `"missing"` — no `lore.tree.yaml` file exists at `path`. Not an error by
 *   itself; callers decide whether absence is fatal (CLI `--check-tree` treats
 *   it as unarmable/exit 4; `lore review`'s `tree_position` check degrades to
 *   `"skipped"`, never fatal).
 * - `"invalid"` — the file exists but failed YAML parse or schema validation;
 *   `error` is the `LoreError` `parseTreeBlueprint` produced, ready to hand to
 *   `formatError` (CLI) or return inside a `Result` (MCP).
 * - `"ok"` — parsed successfully; `blueprint` is the validated `TreeBlueprint`.
 */
export type BlueprintLoadResult =
  | { status: "missing"; path: string }
  | { status: "invalid"; path: string; error: LoreError }
  | { status: "ok"; path: string; blueprint: TreeBlueprint };

/**
 * Loads and parses `<cwd>/lore.tree.yaml` — the single derivation site for the
 * absent/invalid/ok three-way branch every call site (`status.ts`, `review.ts`,
 * `tools.ts`) previously re-implemented independently.
 *
 * @param cwd - Directory to resolve `lore.tree.yaml` against. Production
 *   callers pass `process.cwd()`; tests pass an isolated mkdtemp path — this
 *   function never reads `process.cwd()` itself, keeping it a pure function of
 *   its argument (plus the fs it inspects).
 * @returns A {@link BlueprintLoadResult}. Never throws — a synchronous
 *   `readFileSync`/YAML-parse failure is impossible here because `existsSync`
 *   already gated the read, and `parseTreeBlueprint` itself is Result-returning
 *   (never throws on malformed YAML or a schema mismatch).
 * @example
 * const result = loadTreeBlueprint(process.cwd());
 * if (result.status === "missing") { ...treat as unarmable...; }
 * else if (result.status === "invalid") { ...formatError(result.error)...; }
 * else { ...use result.blueprint...; }
 */
export function loadTreeBlueprint(cwd: string): BlueprintLoadResult {
  const path = join(cwd, "lore.tree.yaml");
  if (!existsSync(path)) return { status: "missing", path };

  const raw = readFileSync(path, "utf8");
  const parsed = parseTreeBlueprint(raw);
  if (!parsed.ok) return { status: "invalid", path, error: parsed.error };
  return { status: "ok", path, blueprint: parsed.value };
}
