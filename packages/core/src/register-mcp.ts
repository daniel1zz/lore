/**
 * MCP registration argv builders — pure, browser-safe argv construction for
 * shelling out to the `claude` CLI to register/unregister the `lore` MCP
 * server at user scope (SPEC-046 §Design, §Scope). No IO, no
 * `child_process`/`Bun.spawn` calls here — this module only decides WHAT argv
 * to pass; the actual process spawn is the service layer's `McpRegistrar`
 * port responsibility.
 *
 * Public surface:
 *   - buildMcpAddArgs(binPath) — argv for `claude mcp add -s user lore -- <binPath> --mcp-server`
 *   - buildMcpRemoveArgs() — argv for `claude mcp remove -s user lore`
 *
 * Invariants:
 *   - Both functions are pure and total — no validation of `binPath` beyond
 *     passing it through verbatim as the argv's positional element (an empty
 *     or relative `binPath` is a caller concern, e.g. the CLI adapter that
 *     resolves the running binary's path — this module has no opinion on
 *     path resolution).
 *   - Each call returns a FRESH array — never a shared/cached reference — so
 *     mutating one call's result can never affect another's.
 *
 * Source: SPEC-046 §Scope ("Global MCP registration via
 *   `claude mcp add -s user lore -- lore --mcp-server`"; uninstall via
 *   `claude mcp remove -s user lore`).
 */

/**
 * Builds the argv for registering the `lore` MCP server at user scope via the
 * `claude` CLI.
 *
 * @param binPath - Absolute (or PATH-resolvable) path to the `lore` binary to register.
 * @returns `["mcp", "add", "-s", "user", "lore", "--", binPath, "--mcp-server"]`
 * @throws Never.
 *
 * @example
 * buildMcpAddArgs("/usr/local/bin/lore");
 * // => ["mcp", "add", "-s", "user", "lore", "--", "/usr/local/bin/lore", "--mcp-server"]
 */
export function buildMcpAddArgs(binPath: string): string[] {
  return ["mcp", "add", "-s", "user", "lore", "--", binPath, "--mcp-server"];
}

/**
 * Builds the argv for de-registering the `lore` MCP server at user scope via
 * the `claude` CLI.
 *
 * @returns `["mcp", "remove", "-s", "user", "lore"]`
 * @throws Never.
 *
 * @example
 * buildMcpRemoveArgs();
 * // => ["mcp", "remove", "-s", "user", "lore"]
 */
export function buildMcpRemoveArgs(): string[] {
  return ["mcp", "remove", "-s", "user", "lore"];
}
