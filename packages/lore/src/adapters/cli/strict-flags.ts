/**
 * Strict unknown-flag rejection for the citty CLI adapter (SPEC-051 D1;
 * SPEC-073 extends D1 to single-dash multi-char tokens).
 *
 * Module purpose: citty's own argv parser (`parseRawArgs`, vendored inside
 * citty 0.1.6's `dist/index.mjs`) supports a strict/`unknown` rejection mode,
 * but citty's `parseArgs()` NEVER passes an `unknown` handler when it builds
 * `parseOptions` — so every `--flag` a command doesn't declare is silently
 * accepted into the parsed result instead of erroring. Real incident: `lore
 * link A B --kind blocks` created a link with the DEFAULT type (`relates-to`)
 * instead of failing, because `--kind` was never declared (the real flag is
 * `--type`) and citty just ignored it, silently corrupting `lore ready`
 * blocker semantics (SPEC-051 Overview, dogfood finding F4).
 *
 * SPEC-073 root cause: citty's vendored parser is a `mri`-style implementation
 * (`parseRawArgs`) that, in NON-strict mode (`strict` is always falsy here —
 * citty never passes `opts.unknown`), treats a single-dash MULTI-CHAR token
 * (`-json`) as a short-flag CLUSTER: `-json` silently expands to `-j -s -o -n`
 * (four unrelated single-char booleans), none of which any command declares,
 * so the value is neither applied NOR rejected — it just evaporates. Observed
 * 2026-07-24: `lore list -json` exits 0 and renders the human table (corpus:
 * `knowledge-lore-verify-yes-alias-not-honored-in-non-tty-json`).
 * `findSingleDashViolation` below is the SPEC-073 D1 additive check for
 * exactly this token shape, layered the SAME way `findUnknownFlag` is layered
 * on top of (never replacing) citty's own parsing.
 *
 * This module re-derives citty's own flag-name/alias/negation resolution
 * rules (mirrored from `resolveArgs`/`parseRawArgs` in citty 0.1.6) as a
 * SEPARATE, additive check layered on top of — never replacing — citty's own
 * parsing. It runs against already-scoped `rawArgs`: by the time a LEAF
 * command's `run` executes, citty has already sliced every subcommand-name
 * token off (`runCommand` recurses with `opts.rawArgs.slice(subCommandArgIndex
 * + 1)`), so `context.rawArgs` there is exactly "this command's own tokens" —
 * never a parent group's, never mixed with sibling subcommand names.
 *
 * Public surface:
 *   - `findUnknownFlag` — pure query: scans rawArgs for the first `--flag`
 *     token that isn't declared, returns it (or `null`).
 *   - `findSingleDashViolation` (SPEC-073 D1) — pure query: scans rawArgs for
 *     the first single-dash, 2+-character token that is neither a declared
 *     single-char-alias cluster, a negative number, nor after a `--`
 *     terminator; returns the offending token plus a `--`-form suggestion
 *     when one is unambiguously derivable (or `null`).
 *   - `wrapCommandStrict` — pure(ish) command-tree transform: wraps every
 *     `run` found at any depth of a command's `subCommands` tree so it
 *     rejects an unknown flag BEFORE the command's real logic executes. Does
 *     not mutate its input.
 *
 * Side-effect class: `findUnknownFlag` and `findSingleDashViolation` are pure
 * (no IO). `wrapCommandStrict` is pure with respect to its OWN inputs
 * (returns a new object, never mutates `cmd`), but the `run` function it
 * PRODUCES calls `process.stderr.write` + `process.exit(2)` on a violation —
 * that IO is the composition site's job (there is no other place to put it:
 * citty commands are the only thing that runs before a service call).
 *
 * Composition-site wiring: `index.ts` calls `wrapCommandStrict` once per
 * top-level lazy command import — see that file's `wrapDefault` helper. This
 * is the ONE seam SPEC-051 D1 (and its SPEC-073 extension) requires; no
 * `commands/*.ts` file is edited for D1 (D2's `--by` alias on approve/reject
 * is a separate, intentional edit to those two files' own `args`).
 *
 * Exit-code note: SPEC-051's Design section describes this as "exit 2
 * (usage-error code, same as citty's own missing-required-argument
 * failures)". Empirically, citty's OWN missing-required-argument path exits
 * with code 1 (`runMain`'s catch-all always calls `process.exit(1)`,
 * regardless of `CLIError` — verified by running `lore create` with no
 * `<TYPE>` positional). The ACTUAL existing "usage error" convention this
 * codebase follows for CLI-level input contradictions (`--ai`/`--no-ai`
 * mutex in `assess.ts`, `--diff`/`--diff-file` mutex, etc.) is a manual
 * `process.stderr.write(...)` + `process.exit(2)` — exit 2 is also SPEC-051's
 * own explicit, AC-tested requirement (AC-051-4, D3's `link ... --kind
 * blocks` fixture). This module follows THAT established exit-2 convention,
 * not citty's internal (and differently-coded) CLIError path.
 *
 * Source: SPEC-051 §Design D1; SPEC-073 §Design D1
 */

import type { ArgsDef, CommandContext, CommandDef, Resolvable } from "citty";

// ─── Declared-flag derivation (mirrors citty's own resolveArgs) ────────────

interface DeclaredFlags {
  /** Every non-positional arg's own key + every declared alias, flattened. */
  readonly names: ReadonlySet<string>;
  /** Subset of `names` whose arg is `type: "boolean"` — the only type `--no-X` may negate. */
  readonly booleanNames: ReadonlySet<string>;
  /** Subset of `names` whose arg is `type: "string"` — citty ALWAYS greedily
   *  consumes the very next raw token as this flag's value (empirically
   *  verified against citty 0.1.6, incl. when that next token itself starts
   *  with one or two dashes — SPEC-073 D1's "Beware" scope note), used by
   *  `findSingleDashViolation` to skip a value token instead of scanning it
   *  as a flag position. */
  readonly stringNames: ReadonlySet<string>;
}

function toAliasArray(alias: string | string[] | undefined): string[] {
  if (alias === undefined) return [];
  return Array.isArray(alias) ? alias : [alias];
}

/**
 * Flatten a citty `ArgsDef` into the flag-name lookup strict-flag validation
 * needs. Positional entries are excluded — a positional can never legally be
 * invoked as `--name value` on the CLI, so admitting its name here would let
 * `--<positionalName>` slip past validation as if it were a declared flag.
 *
 * @param argsDef - a command's own resolved `args` definition (empty object
 *   for a command that declares none)
 * @returns the flattened name set + the boolean-typed subset
 */
function collectDeclaredFlags(argsDef: ArgsDef): DeclaredFlags {
  const names = new Set<string>();
  const booleanNames = new Set<string>();
  const stringNames = new Set<string>();

  for (const [name, argDef] of Object.entries(argsDef)) {
    if (argDef.type === "positional") continue;
    // reason: citty types `type` as optional on EVERY ArgDef variant
    // (including PositionalArgDef, which omits `alias` entirely), so a
    // value with `type: undefined` is structurally valid for any of the
    // three branches — TS therefore cannot prove the `continue` above
    // excludes PositionalArgDef from what follows and refuses direct
    // `argDef.alias` access. Every arg this codebase declares always sets
    // `type` explicitly (verified: no bare/typeless `ArgDef` literal exists
    // under `commands/*.ts`), so reading `alias` via this narrow local
    // shape — rather than citty's own non-narrowable `ArgDef` — is safe.
    const aliasable = argDef as { alias?: string | string[] };
    names.add(name);
    for (const alias of toAliasArray(aliasable.alias)) names.add(alias);
    if (argDef.type === "boolean") {
      booleanNames.add(name);
      for (const alias of toAliasArray(aliasable.alias)) booleanNames.add(alias);
    }
    if (argDef.type === "string") {
      stringNames.add(name);
      for (const alias of toAliasArray(aliasable.alias)) stringNames.add(alias);
    }
  }

  return { names, booleanNames, stringNames };
}

// ─── Token scan ──────────────────────────────────────────────────────────

/**
 * Scan already-scoped `rawArgs` for the first `--flag` token that matches
 * neither a declared arg name/alias nor the `--no-<booleanName>` negation
 * form (citty's own boolean-negation convention). Stops scanning at a
 * literal `--` (passthrough marker, per D1: "positionals and `--`
 * passthrough are untouched") and ignores every token that doesn't start
 * with `--` (positionals, and any flag's own value token — a value is never
 * required to start with `--` in this CLI's real usage).
 *
 * @param rawArgs - the LEAF command's own already-scoped raw args
 *   (`context.rawArgs` at the point its `run` executes)
 * @param argsDef - that SAME command's resolved `args` definition
 * @returns the offending flag as typed on the CLI (e.g. `"--kind"`), or
 *   `null` when every `--`-led token is declared
 * @example
 *   findUnknownFlag(["A", "B", "--kind", "blocks"], { type: { type: "string" } })
 *   // "--kind"
 * @example
 *   findUnknownFlag(["--force"], { force: { type: "boolean" } }) // null
 * @example
 *   findUnknownFlag(["--no-force"], { force: { type: "boolean" } }) // null
 */
export function findUnknownFlag(rawArgs: readonly string[], argsDef: ArgsDef): string | null {
  const { names, booleanNames } = collectDeclaredFlags(argsDef);

  for (const token of rawArgs) {
    if (token === "--") break;
    if (!token.startsWith("--")) continue;

    const body = token.slice(2);
    const eqIdx = body.indexOf("=");
    const name = eqIdx === -1 ? body : body.slice(0, eqIdx);
    if (name === "") continue;

    if (names.has(name)) continue;
    if (name.startsWith("no-") && booleanNames.has(name.slice(3))) continue;

    return `--${name}`;
  }

  return null;
}

// ─── Single-dash multi-char token scan (SPEC-073 D1) ───────────────────────

/** Whole-token match for a negative-number argument, e.g. `-5`, `-3.14`. */
const NEGATIVE_NUMBER_RE = /^\d+(?:\.\d+)?$/;

/**
 * The offending single-dash token as typed on the CLI (e.g. `"-yes"`) plus,
 * when derivable, the correct double-dash form to suggest.
 */
export interface SingleDashViolation {
  readonly token: string;
  /** `--<name>` when `token`'s body exactly or unambiguously-prefix-matches
   *  one declared flag/alias name; `null` when no safe suggestion exists
   *  (no match, or the prefix matches 2+ candidates). */
  readonly suggestion: string | null;
}

/**
 * Whether `token` is a declared STRING-typed flag (long `--name`/`--alias`,
 * or a single-dash single-char alias) with no inline `=value` — meaning the
 * token immediately following it is SYNTACTICALLY that flag's value slot
 * and must never be scanned as a flag position of its own.
 *
 * Deliberately does NOT mirror citty's own internal parse mechanics
 * verbatim: empirically (via this codebase's own vitest oracle), when the
 * NEXT raw token itself starts with `-`, citty's vendored mri-style parser
 * does NOT actually consume it as the string flag's value — it short-
 * circuits that flag to `""` and independently re-parses the dash-prefixed
 * token on its own (where, if it's single-dash multi-char, mri's cluster
 * expansion silently mis-parses it — this module's header's root-cause
 * chain). That is a PRE-EXISTING citty quirk, out of SPEC-073's scope to
 * fix at the parser level. This function instead encodes the INTENDED CLI
 * contract — "whatever syntactically follows a string flag is its value,
 * full stop" — which is the conservative, SAFE choice SPEC-073 D1's own
 * "Beware" scope note requires: this NEW scanner must never turn citty's
 * pre-existing silent (if broken) value-swallow into a LOUD rejection of a
 * legitimate `lore create --title "-something"` invocation. A non-dash next
 * token (`--title something`) IS correctly consumed by citty itself either
 * way, so this function's stance is byte-compatible with citty there too.
 *
 * @param token - a raw arg token, dash-prefixed (single or double)
 * @param stringNames - declared string-typed flag names/aliases
 * @param dashCount - 1 for a single-dash single-char token, 2 for `--name`
 */
function consumesNextTokenAsValue(token: string, stringNames: ReadonlySet<string>, dashCount: number): boolean {
  const body = token.slice(dashCount);
  if (body.includes("=")) return false; // inline value already supplied
  return stringNames.has(body);
}

/**
 * Scan already-scoped `rawArgs` (same scoping contract as `findUnknownFlag`)
 * for the first single-dash token whose body is 2+ characters, EXCEPT when
 * it is (i) a legitimate cluster of declared single-char alias/name
 * characters (citty/mri's own short-flag-cluster convention, e.g. `-ab` when
 * both `a` and `b` are declared single-char names), (ii) a negative number
 * (`-5`, `-3.14` — plausibly a flag's value or a numeric positional, never a
 * flag itself), (iii) positioned after a literal `--` terminator, or (iv) the
 * VALUE token immediately following a declared STRING-typed flag (SPEC-073
 * D1's own "Beware" scope note — `lore create --title "-something"` must
 * never reject `-something`; `consumesNextTokenAsValue` above tracks this
 * across the scan exactly the way citty's real parser consumes it, so a
 * value token is skipped entirely rather than scanned as a flag position).
 * Every OTHER single-dash 2+-char token is exactly the shape citty's
 * vendored parser silently mis-parses as an unrelated short-flag cluster
 * (SPEC-073 root cause, this module's header) — SPEC-073 D1 requires it fail
 * loud instead.
 *
 * A single-dash, SINGLE-character token (`-h`) is never scanned here — that
 * is citty's own legitimate short-flag convention, unaffected by this check.
 *
 * @param rawArgs - the LEAF command's own already-scoped raw args
 * @param argsDef - that SAME command's resolved `args` definition
 * @returns the offending token + a `--`-form suggestion (or `null`
 *   suggestion when none is unambiguous), or `null` when no violation exists
 * @example
 *   findSingleDashViolation(["-json"], { json: { type: "boolean" } })
 *   // { token: "-json", suggestion: "--json" }
 * @example
 *   findSingleDashViolation(["-yes"], { "allow-new-commands": { type: "boolean", alias: "yes" } })
 *   // { token: "-yes", suggestion: "--yes" }
 * @example
 *   findSingleDashViolation(["-5"], {}) // null — negative number
 * @example
 *   findSingleDashViolation(["-ab"], { a: { type: "boolean" }, b: { type: "boolean" } })
 *   // null — legitimate cluster of declared single-char names
 * @example
 *   findSingleDashViolation(["--title", "-something"], { title: { type: "string" } })
 *   // null — "-something" is --title's VALUE, not a flag position
 */
export function findSingleDashViolation(
  rawArgs: readonly string[],
  argsDef: ArgsDef,
): SingleDashViolation | null {
  const { names, stringNames } = collectDeclaredFlags(argsDef);
  const singleCharNames = new Set([...names].filter((n) => n.length === 1));

  let skipNextAsValue = false;
  for (const token of rawArgs) {
    if (token === "--") break;

    if (skipNextAsValue) {
      skipNextAsValue = false;
      continue;
    }

    if (token.startsWith("--")) {
      skipNextAsValue = consumesNextTokenAsValue(token, stringNames, 2);
      continue;
    }
    if (!token.startsWith("-")) continue;

    const body = token.slice(1);
    if (body.length < 2) {
      skipNextAsValue = consumesNextTokenAsValue(token, stringNames, 1);
      continue; // single-char short flag — citty's own legitimate form
    }
    if (NEGATIVE_NUMBER_RE.test(body)) continue; // negative number, not a flag

    const isLegitimateCluster = [...body].every((ch) => singleCharNames.has(ch));
    if (isLegitimateCluster) continue;

    return { token, suggestion: resolveDoubleDashSuggestion(body, names) };
  }

  return null;
}

/**
 * Derive the `--`-form suggestion for an offending single-dash token's body:
 * an EXACT match against a declared flag/alias name wins outright; failing
 * that, an UNAMBIGUOUS prefix match (exactly one declared multi-char name
 * starts with `body`) is offered; two or more prefix candidates (or zero) →
 * no suggestion, rather than guessing wrong.
 *
 * @param body - the offending token with its single leading dash stripped
 *   (e.g. `"json"` for `-json`)
 * @param names - every declared flag name + alias, flattened (same set
 *   `findUnknownFlag` reads via `collectDeclaredFlags`)
 * @returns `--<name>` or `null`
 */
function resolveDoubleDashSuggestion(body: string, names: ReadonlySet<string>): string | null {
  if (names.has(body)) return `--${body}`;

  const candidates = [...names].filter((n) => n.length > 1 && n.startsWith(body));
  return candidates.length === 1 ? `--${candidates[0]}` : null;
}

// ─── Command-tree wrapping (composition-site seam) ─────────────────────────

/** Resolve a citty `Resolvable<T>` value (plain | function | promise), same contract citty itself uses. */
async function resolveMaybe<T>(value: Resolvable<T> | undefined): Promise<T | undefined> {
  if (value === undefined) return undefined;
  const resolved = typeof value === "function" ? (value as () => T | Promise<T>)() : value;
  return await resolved;
}

/**
 * Wrap a citty `CommandDef` (and, recursively, every command nested under
 * its `subCommands`) so each leaf `run` rejects an undeclared flag BEFORE
 * the command's real logic executes — printing `Unknown option: --<flag>`
 * plus a `lore <cmd> --help` pointer to stderr and exiting 2. This is the
 * ONE enforcement seam SPEC-051 D1 requires: the composition site
 * (`index.ts`) calls this once per top-level command import instead of
 * editing every `commands/*.ts` file.
 *
 * Every command GROUP in this codebase (`gate`/`phase`/`anchor`/`scope`/`ac`/
 * `agent`/`eval`/`sync`) declares its nested `subCommands` as a plain object
 * literal — resolving synchronously — but this function follows citty's own
 * `Resolvable<T>` contract fully (function/promise/plain) for BOTH a
 * command's `subCommands` map and each entry within it, so a future group
 * using a lazy subcommand does not silently skip strict-flag wrapping.
 *
 * Does not mutate `cmd` — returns a new object with `run` (if present)
 * replaced and `subCommands` (if present) recursively wrapped the same way.
 *
 * @param cmd - a fully-resolved `CommandDef` (already `await import()`ed).
 *   Typed `CommandDef<any>` — the SAME looseness citty's own public
 *   `SubCommandsDef = Record<string, Resolvable<CommandDef<any>>>` type
 *   uses — because each `commands/*.ts` module's `CommandDef<T>` has a
 *   DIFFERENT, mutually-incompatible `T` (its own `args` shape); a precisely
 *   generic `wrapCommandStrict<T>` would still fail to unify across the 42
 *   distinct call sites `index.ts` wires it into, for the exact
 *   contravariant-parameter reason `Resolvable<CommandDef<any>>` sidesteps.
 * @param commandPath - the dotted CLI path for the `--help` pointer, e.g.
 *   `"lore link"` or `"lore gate spec-create"` — grows by one segment per
 *   recursion level so a nested violation still points at the RIGHT
 *   `--help` invocation
 * @returns a new `CommandDef` with strict-flag checking wired into every
 *   leaf `run`
 */
export async function wrapCommandStrict(cmd: CommandDef<any>, commandPath: string): Promise<CommandDef> {
  const wrapped: CommandDef = { ...cmd };

  const subCommandsDef = await resolveMaybe(cmd.subCommands);
  if (subCommandsDef !== undefined) {
    const nested: Record<string, CommandDef> = {};
    for (const [name, subCmd] of Object.entries(subCommandsDef)) {
      const resolvedSubCmd = await resolveMaybe(subCmd);
      if (resolvedSubCmd === undefined) continue;
      nested[name] = await wrapCommandStrict(resolvedSubCmd, `${commandPath} ${name}`);
    }
    wrapped.subCommands = nested;
  }

  if (typeof cmd.run === "function") {
    const originalRun = cmd.run;
    wrapped.run = async (context: CommandContext) => {
      const argsDef = (await resolveMaybe(context.cmd.args)) ?? {};
      const unknownFlag = findUnknownFlag(context.rawArgs, argsDef);
      if (unknownFlag !== null) {
        process.stderr.write(
          `Error: Unknown option: ${unknownFlag}\n` + `  Run \`${commandPath} --help\` to see valid options.\n`,
        );
        process.exit(2);
      }
      // SPEC-073 D1: single-dash multi-char tokens (`-json`, `-yes`) silently
      // mis-parse under citty's vendored non-strict parser (this module's
      // header) rather than tripping the `--flag` check above — checked
      // SECOND, never instead of, the double-dash scan.
      const singleDashViolation = findSingleDashViolation(context.rawArgs, argsDef);
      if (singleDashViolation !== null) {
        const suggestionLine =
          singleDashViolation.suggestion !== null ? `  Did you mean ${singleDashViolation.suggestion}?\n` : "";
        process.stderr.write(
          `Error: Unknown option: ${singleDashViolation.token}\n` +
            suggestionLine +
            `  Run \`${commandPath} --help\` to see valid options.\n`,
        );
        process.exit(2);
      }
      return originalRun(context);
    };
  }

  return wrapped;
}
