/**
 * Context variables — the `{{lore:<name>}}` template expander.
 *
 * Purpose: replace registered `{{lore:<name>}}` placeholders in lore-owned agent
 * context text (fragments, shipped assets, hook commands) with values lore holds.
 * Public surface: types ContextVariable / VariableSource / VariableOutlet /
 *   VarContext; `expandTemplate`, `findPlaceholders`, `validateRegistry`;
 *   constants CAPTURE_TAIL_CHARS, LORE_AGENT_NAMES.
 * Invariants: only the exact `{{lore:[a-z][a-z0-9_]*}}` spelling is a placeholder
 *   (every other double-brace text is left byte-identical); the registry is an
 *   injected argument (this module owns the mechanism, never the entries); a
 *   refused expansion returns no partially-expanded text.
 * Side effects: pure. No Node builtins (barrel invariant of @lore/core).
 *
 * @spec_ref spec-lore-owned-agent-context-is-generated-from-templates-and (D1, D2, D3, D5)
 */

import { err, ok, type Result } from "./errors.js";
import type { OutletId } from "./context-fragments.js";

/** Persisted `output_tail` ceiling for captured evidence — mirrors `evidenceEntrySchema`'s own max. */
export const CAPTURE_TAIL_CHARS = 4000;

/** Installed lore agent names; MUST match `name:` in assets/agents/*.md. */
export const LORE_AGENT_NAMES = {
  implementer: "lore-implementer",
  reader: "lore-reader",
} as const;

/**
 * Where a variable's value comes from: lore's own code, the caller of this render (`invocation`, one outlet),
 * or the project/global config the caller already resolved for the outlet (`config`, any outlets).
 * Both caller-supplied sources are read from `VarContext.invocation`.
 */
export type VariableSource = "code" | "invocation" | "config";

/** A place a variable may be written: a fragment outlet, an installed asset, or the settings hook. */
export type VariableOutlet = OutletId | "asset:install" | "setup:settings-hook";

/** One registered variable. `code` entries MUST carry `value`; `invocation` entries allow exactly one outlet. */
export interface ContextVariable {
  readonly name: string;
  readonly source: VariableSource;
  readonly outlets: readonly VariableOutlet[];
  readonly describe: string;
  /** Required when `source === "code"`. */
  readonly value?: () => string;
  /** Patterns of hand-typed spellings of this value (consumed by the literal lint, not by the expander). */
  readonly literalPatterns?: readonly RegExp[];
}

/** Per-render context for one template body. */
export interface VarContext {
  readonly outlet: VariableOutlet;
  /** File path used in error messages. */
  readonly path: string;
  /** Lines before the body (e.g. front-matter) so reported lines are file lines. */
  readonly lineOffset: number;
  /** Values for `invocation` and `config` variables, keyed by name. */
  readonly invocation: Readonly<Record<string, string>>;
}

const NAME_SOURCE = "[a-z][a-z0-9_]*";
const NAME_PATTERN = new RegExp(`^${NAME_SOURCE}$`);

function placeholderRegex(): RegExp {
  return new RegExp(`\\{\\{lore:(${NAME_SOURCE})\\}\\}`, "g");
}

/** Number of newlines before `index` plus one = 1-based body line. */
function bodyLineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * List every well-formed placeholder with its 1-based body line, in order.
 * @param text - template body
 */
export function findPlaceholders(text: string): { name: string; line: number }[] {
  const found: { name: string; line: number }[] = [];
  for (const m of text.matchAll(placeholderRegex())) {
    found.push({ name: m[1] as string, line: bodyLineAt(text, m.index ?? 0) });
  }
  return found;
}

function refuse(field: string, message: string) {
  return err({ code: "VALIDATION_ERROR" as const, field, message, rule: "BR-1095" });
}

/**
 * Replace each `{{lore:<name>}}` with its value.
 * Refuses (VALIDATION_ERROR, message holds `${path}:${lineOffset + bodyLine}` and the name)
 * on an unregistered name, a name not allowed at `ctx.outlet`, or an invocation variable
 * with no supplied value. The first offending token in text order is reported.
 * @param text - template body
 * @param ctx - outlet, path, line offset, invocation values
 * @param registry - injected variable registry
 */
export function expandTemplate(
  text: string,
  ctx: VarContext,
  registry: readonly ContextVariable[],
): Result<string> {
  const byName = new Map(registry.map((v) => [v.name, v]));
  let out = "";
  let cursor = 0;
  for (const m of text.matchAll(placeholderRegex())) {
    const index = m.index ?? 0;
    const name = m[1] as string;
    const where = `${ctx.path}:${ctx.lineOffset + bodyLineAt(text, index)}`;
    const variable = byName.get(name);
    if (!variable) return refuse(name, `${where}: unknown context variable '${name}'`);
    if (!variable.outlets.includes(ctx.outlet)) {
      return refuse(name, `${where}: context variable '${name}' is not allowed at outlet '${ctx.outlet}'`);
    }
    let value: string;
    if (variable.source === "invocation" || variable.source === "config") {
      const supplied = Object.hasOwn(ctx.invocation, name) ? ctx.invocation[name] : undefined;
      if (supplied === undefined) {
        return refuse(name, `${where}: ${variable.source} variable '${name}' has no value supplied for outlet '${ctx.outlet}'`);
      }
      value = supplied;
    } else {
      if (!variable.value) return refuse(name, `${where}: code variable '${name}' has no value`);
      value = variable.value();
    }
    out += text.slice(cursor, index) + value;
    cursor = index + m[0].length;
  }
  return ok(out + text.slice(cursor));
}

/**
 * Check a registry is well-formed. Pure; never throws.
 * Refuses a malformed or duplicate name, a `code` entry without `value`,
 * and an `invocation` entry allowed at other than exactly one outlet.
 * @param registry - candidate registry
 */
export function validateRegistry(registry: readonly ContextVariable[]): Result<void> {
  const seen = new Set<string>();
  for (const v of registry) {
    if (typeof v.name !== "string" || !NAME_PATTERN.test(v.name)) {
      return refuse(String(v.name), `context variable name '${String(v.name)}' must match ${NAME_PATTERN.source}`);
    }
    if (seen.has(v.name)) return refuse(v.name, `context variable '${v.name}' is registered twice`);
    seen.add(v.name);
    if (v.source === "code" && typeof v.value !== "function") {
      return refuse(v.name, `code variable '${v.name}' must define value()`);
    }
    if (v.source === "invocation" && v.outlets.length !== 1) {
      return refuse(v.name, `invocation variable '${v.name}' must be allowed at exactly one outlet, got ${v.outlets.length}`);
    }
  }
  return ok(undefined);
}
