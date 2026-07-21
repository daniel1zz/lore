/**
 * Config write-safety tables — pure, browser-safe classification of which
 * `.lore/config.yaml` keys are writable over a network surface, which key
 * VALUES must never be echoed back on read, and which keys require a process
 * restart to take effect. This is the ONE shared source of truth `ConfigService`
 * (`packages/lore/src/service/config-service.ts`) enforces server-side and
 * SPEC-063's dashboard UI will import to render honest affordances — but the
 * SERVER enforcement is what actually protects the corpus; this module existing
 * in the browser bundle is a UX convenience, never the security boundary itself.
 *
 * Public surface:
 *   - CONFIG_DENY_KEYS — dotted-path patterns (wildcard segment `*`) naming
 *     config keys that MUST NEVER be writable over any HTTP surface — each is
 *     arbitrary-code-execution or secret-bearing (spawned-process command/args,
 *     a header map that may carry a literal API key, or the boolean that
 *     disables SPEC-039 §M2's env-allowlist hardening wholesale).
 *   - CONFIG_REDACT_KEYS — dotted-path patterns whose VALUES `ConfigService.read()`
 *     must never emit, even though the KEY itself is legitimately readable
 *     (e.g. you can see a header named "x-api-key" exists without seeing what
 *     it's set to).
 *   - classifyConfigEffect(key) — "live" | "restart_required", derived from a
 *     declared table of start-time-read key PREFIXES. `createApp` reads
 *     `sync`/`ai.provider`/`ai.providers.*`/`ai.http.*`/`telemetry` exactly once
 *     at process startup (see `app.ts`) — editing any of those on disk has zero
 *     effect until the next `lore` invocation / dashboard restart. Everything
 *     else (`workflow.*`, `audit.*`, `verify.*`, `defaults.*`, ...) is re-read
 *     on every call and therefore takes effect immediately.
 *   - findDeniedConfigKeys(patch) — walks an untrusted config PATCH object and
 *     returns every leaf dotted-path that EITHER matches a `CONFIG_DENY_KEYS`
 *     pattern exactly OR is a proper ancestor of one (see @invariant re:
 *     subtree-root denial) — a whole-subtree replacement (`{ai: null}`,
 *     `{ai: {providers: {}}}`) is denied exactly like a narrow leaf-targeted
 *     patch would be.
 *   - redactConfigValues(config) — deep-clones a config-shaped object, replacing
 *     every leaf value at a `CONFIG_REDACT_KEYS`-matching path with a fixed
 *     redaction marker string. Never mutates its input.
 *   - flattenConfigLeafPaths(value) — collects every leaf dotted-path in an
 *     arbitrary config-shaped object (arrays and primitives are leaves; plain
 *     objects are descended into). The shared tree-walk primitive the other
 *     three functions above build on.
 *
 * Invariants:
 *   - Zero Node builtins, zero IO, zero `Date.now()`/`Math.random()` — pure
 *     data transforms only. Re-exported from the browser-safe `@lore/core`
 *     barrel (`index.ts`); a Node import here blanks the `@lore/dashboard` SPA
 *     at module-load time (see that file's own header for the full mechanism).
 *   - `CONFIG_DENY_KEYS`/`CONFIG_REDACT_KEYS` EXACT-match wildcard matching is
 *     EXACT-LENGTH: a `*` segment matches exactly one path segment, never
 *     zero or many — a pattern with N dot-separated segments only ever
 *     exact-matches a leaf path with exactly N segments. This assumes
 *     provider names (`ai.providers.<name>`) and header names
 *     (`ai.http.headers.<name>`) never themselves contain a literal `.` —
 *     true of every real-world provider/header name in this codebase's
 *     schemas (`ai.ts`'s provider registry keys, HTTP header tokens), and
 *     documented here rather than silently assumed.
 *   - `findDeniedConfigKeys` ADDITIONALLY denies a leaf path that is a PROPER
 *     ANCESTOR of a `CONFIG_DENY_KEYS` pattern — strictly SHORTER than the
 *     pattern, with every one of its own segments matching the pattern's
 *     corresponding segment (wildcard-aware). This closes the subtree-root
 *     replacement hole: `{ai: {providers: null}}` / `{ai: {providers: {}}}`
 *     / `{ai: {providers: []}}` all flatten to the single leaf
 *     `"ai.providers"` (shorter than `ai.providers.*.command`'s 4 segments)
 *     and would otherwise slip past an exact-length-only check. Deliberate
 *     consequence: `{ai: null}` and `{verify: null}` are now denied too —
 *     wholesale replacement of those subtrees would destroy/override a
 *     protected key, so it is treated identically to a narrow attack. This
 *     ancestor rule applies ONLY to deny-key matching (`findDeniedConfigKeys`)
 *     — `CONFIG_REDACT_KEYS` matching (`redactConfigValues`) stays exact-length
 *     only, since redacting an ancestor node has no well-defined single
 *     replacement value.
 *   - `findDeniedConfigKeys`/`flattenConfigLeafPaths` treat arrays as LEAVES,
 *     never descending into array elements — `ai.providers.<name>.args` is a
 *     `string[]`, and the deny check must catch the WHOLE array being set in
 *     one patch, not merely a single element of it.
 *   - Both tree-walks cap recursion depth at `MAX_WALK_DEPTH` (32) as a
 *     defensive backstop against a maliciously/accidentally deep patch object
 *     (this module receives untrusted HTTP request bodies) — a node at the cap
 *     is treated as an opaque leaf rather than throwing or infinite-looping.
 *     No legitimate `LoreConfig` shape nests anywhere close to this depth.
 *   - `redactConfigValues` never mutates its input and never throws on
 *     malformed input (a non-object top level degrades to "no leaves to walk",
 *     returning the input structurally unchanged as far as this function's own
 *     contract goes).
 *
 * Side-effect class: pure
 *
 * Source: SPEC-062 (config write layer) §Scope D2, §Design
 */

// ─── Deny / Redact Key Tables ────────────────────────────────────────────────

/**
 * Dotted-path patterns (wildcard segment `*`) for config keys that are
 * structurally READ-ONLY over any HTTP surface — a patch touching any of
 * these is rejected outright by `ConfigService.update`, regardless of the
 * value supplied. Each entry is arbitrary-code-execution or secret-bearing:
 *
 *   - `ai.providers.*.command` / `ai.providers.*.args` — spawned as an
 *     external process (`ai/*-provider.ts`), the same RCE class as a
 *     `settings.json` hook `command` string.
 *   - `ai.http.headers.*` — may carry a literal API key in plaintext.
 *   - `verify.env.passthrough_all` — a single boolean that disables SPEC-039
 *     §M2's entire env-allowlist trust-hardening, handing the full
 *     `process.env` (including `LORE_SYNC_TOKEN`) to every `lore verify`
 *     spawned command.
 */
export const CONFIG_DENY_KEYS: readonly string[] = [
  "ai.providers.*.command",
  "ai.providers.*.args",
  "ai.http.headers.*",
  "verify.env.passthrough_all",
];

/**
 * Dotted-path patterns whose VALUES `ConfigService.read()` must never emit.
 * Unlike {@link CONFIG_DENY_KEYS}, the key itself is legitimately readable
 * (an operator can see a header named "x-api-key" is configured) — only the
 * literal value is replaced with {@link CONFIG_REDACTION_MARKER}.
 */
export const CONFIG_REDACT_KEYS: readonly string[] = ["ai.http.headers.*"];

/** The fixed marker `redactConfigValues` substitutes for a redacted leaf value. */
export const CONFIG_REDACTION_MARKER = "***REDACTED***";

/** `classifyConfigEffect`'s two possible outcomes. */
export type ConfigEffect = "live" | "restart_required";

/**
 * Dotted-path PREFIXES (not exact-length wildcard patterns, unlike the deny/
 * redact tables above) whose config keys are read exactly once at
 * `createApp` construction time (`packages/lore/src/app.ts`) — editing them
 * on disk has zero runtime effect until the next process start.
 *
 * `"ai.provider"` (no trailing dot) deliberately also matches
 * `"ai.providers.*"` via plain `startsWith` (both are declared explicitly
 * here anyway, mirroring the design doc's own listing, even though the
 * second is a strict superset match of the first) — `ai.provider` is the
 * scalar "which provider is active" field, `ai.providers.<name>.*` are the
 * per-provider config blocks; BOTH are read once by `buildProviderRegistry`
 * at startup.
 */
const RESTART_REQUIRED_KEY_PREFIXES: readonly string[] = [
  "sync.",
  "ai.provider",
  "ai.providers.",
  "ai.http.",
  "telemetry.",
];

/**
 * Classifies whether editing `key` (a dotted leaf path, e.g. `"sync.enabled"`)
 * takes effect immediately or requires a process restart. Derived from
 * {@link RESTART_REQUIRED_KEY_PREFIXES} — a key matching ANY declared prefix
 * is `"restart_required"`; every other key (the vast majority — `workflow.*`,
 * `audit.*`, `verify.*` minus the denied boolean, `defaults.*`, `project.*`)
 * is `"live"` because the corresponding service re-reads config on every call.
 *
 * @param key - Dotted leaf path (e.g. `"workflow.claim_ttl_minutes"`)
 * @returns `"restart_required"` iff `key` starts with a declared prefix, else `"live"`
 * @example
 *   classifyConfigEffect("sync.enabled") // => "restart_required"
 *   classifyConfigEffect("workflow.claim_ttl_minutes") // => "live"
 */
export function classifyConfigEffect(key: string): ConfigEffect {
  return RESTART_REQUIRED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
    ? "restart_required"
    : "live";
}

// ─── Shared Tree-Walk Primitives ─────────────────────────────────────────────

/** Defensive recursion-depth backstop for untrusted patch/config objects (see module @invariant). */
const MAX_WALK_DEPTH = 32;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `true` iff every segment of `pattern` (split on `.`) matches the
 * corresponding segment of `pathSegments` — a pattern segment `*` matches any
 * single path segment, every other pattern segment must match exactly.
 * Lengths must match exactly (see module @invariant re: exact-length wildcards).
 */
function segmentsMatchPattern(pathSegments: readonly string[], pattern: string): boolean {
  const patternSegments = pattern.split(".");
  if (patternSegments.length !== pathSegments.length) return false;
  return patternSegments.every((seg, i) => seg === "*" || seg === pathSegments[i]);
}

function matchesAnyPattern(pathSegments: readonly string[], patterns: readonly string[]): boolean {
  return patterns.some((pattern) => segmentsMatchPattern(pathSegments, pattern));
}

/**
 * `true` iff `pathSegments` is a PROPER ancestor of `pattern` — strictly
 * fewer segments than `pattern`, with every one of `pathSegments`'
 * own segments matching the pattern's corresponding segment (wildcard `*`
 * matches any single segment). Used only by {@link findDeniedConfigKeys}'s
 * subtree-root widening (see module @invariant) — deliberately NOT reused by
 * {@link redactConfigValues}, which has no ancestor-redaction semantics.
 */
function isProperAncestorOfPattern(pathSegments: readonly string[], pattern: string): boolean {
  const patternSegments = pattern.split(".");
  if (pathSegments.length >= patternSegments.length) return false;
  return pathSegments.every((seg, i) => patternSegments[i] === "*" || patternSegments[i] === seg);
}

function matchesOrAncestorOfAnyPattern(pathSegments: readonly string[], patterns: readonly string[]): boolean {
  return patterns.some(
    (pattern) => segmentsMatchPattern(pathSegments, pattern) || isProperAncestorOfPattern(pathSegments, pattern),
  );
}

/**
 * Collects every leaf dotted-path reachable from `value` — plain objects are
 * descended into key-by-key, arrays and primitives are leaves (see module
 * @invariant re: arrays-as-leaves), `null`/`undefined` are leaves. Recursion
 * is capped at {@link MAX_WALK_DEPTH}; a node at the cap is treated as an
 * opaque leaf rather than descended further.
 *
 * @param value - Any config-shaped (or untrusted patch-shaped) object
 * @returns Deduplicated, `.sort()`-ordered array of dotted leaf paths (empty
 *   array for a non-object/empty-object input — never throws)
 * @example
 *   flattenConfigLeafPaths({ sync: { enabled: true }, workflow: { claim_ttl_minutes: 30 } })
 *   // => ["sync.enabled", "workflow.claim_ttl_minutes"]
 */
export function flattenConfigLeafPaths(value: unknown): string[] {
  const leaves = new Set<string>();

  function walk(node: unknown, path: readonly string[], depth: number): void {
    if (isPlainObject(node) && depth < MAX_WALK_DEPTH) {
      const keys = Object.keys(node);
      if (keys.length === 0 && path.length > 0) {
        // An empty object still counts as a leaf (there is nothing further
        // to name under it) — e.g. `{ ai: { providers: {} } }` should still
        // report "ai.providers" was touched, not silently vanish.
        leaves.add(path.join("."));
        return;
      }
      for (const key of keys) {
        walk(node[key], [...path, key], depth + 1);
      }
      return;
    }
    if (path.length > 0) {
      leaves.add(path.join("."));
    }
  }

  walk(value, [], 0);
  return [...leaves].sort();
}

// ─── Deny-Key Detection ──────────────────────────────────────────────────────

/**
 * Walks an untrusted config PATCH object and returns every leaf dotted-path
 * that EITHER matches a {@link CONFIG_DENY_KEYS} pattern exactly OR is a
 * proper ancestor of one (see module @invariant) — the check
 * `ConfigService.update` runs BEFORE touching disk (D2). A patch that
 * replaces a whole ancestor object with FURTHER nested content (e.g.
 * `{ ai: { providers: { foo: { command: "evil" } } } }`) is caught because
 * {@link flattenConfigLeafPaths} descends fully into nested plain objects,
 * reaching the same `ai.providers.foo.command` leaf a narrower,
 * path-targeted patch would; a patch that replaces the ancestor with a
 * LEAF-LESS value (`null` / `{}` / `[]`) is caught by the proper-ancestor
 * check instead, since it never reaches that deep leaf.
 *
 * @param patch - Untrusted candidate patch (typically an HTTP request body)
 * @returns Sorted, deduplicated array of denied dotted-paths — empty when the
 *   patch touches nothing denied. Never throws.
 * @example
 *   findDeniedConfigKeys({ verify: { env: { passthrough_all: true } } })
 *   // => ["verify.env.passthrough_all"]
 *   findDeniedConfigKeys({ ai: { providers: null } })
 *   // => ["ai.providers"] (proper ancestor of "ai.providers.*.command"/".args")
 *   findDeniedConfigKeys({ workflow: { claim_ttl_minutes: 30 } })
 *   // => []
 */
export function findDeniedConfigKeys(patch: unknown): string[] {
  return flattenConfigLeafPaths(patch).filter((path) =>
    matchesOrAncestorOfAnyPattern(path.split("."), CONFIG_DENY_KEYS),
  );
}

// ─── Value Redaction ─────────────────────────────────────────────────────────

/**
 * Deep-clones a config-shaped object, replacing every leaf value at a
 * {@link CONFIG_REDACT_KEYS}-matching dotted-path with
 * {@link CONFIG_REDACTION_MARKER}. Never mutates `config`. Recursion is
 * capped at {@link MAX_WALK_DEPTH} (see module @invariant) — a node at the
 * cap is returned verbatim (uncloned) rather than descended further.
 *
 * @param config - A config-shaped object (typically a parsed `LoreConfig`)
 * @returns A structurally-cloned copy with every matched leaf value replaced.
 *   A non-object `config` is returned unchanged (there is nothing to redact).
 * @example
 *   redactConfigValues({ ai: { http: { headers: { "x-api-key": "sk-live-123" } } } })
 *   // => { ai: { http: { headers: { "x-api-key": "***REDACTED***" } } } }
 */
export function redactConfigValues(config: unknown): unknown {
  function walk(node: unknown, path: readonly string[], depth: number): unknown {
    if (path.length > 0 && matchesAnyPattern(path, CONFIG_REDACT_KEYS)) {
      return CONFIG_REDACTION_MARKER;
    }
    if (isPlainObject(node) && depth < MAX_WALK_DEPTH) {
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node)) {
        result[key] = walk(child, [...path, key], depth + 1);
      }
      return result;
    }
    return node;
  }

  return walk(config, [], 0);
}
