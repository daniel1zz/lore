/**
 * co-change-review — judges `workflow.turn_end.co_change` rules against what each run changed
 * (spec session-trail, Design > Consumers "Co-change" and "Config failure"; AC-ST-7).
 *
 * Public surface: {@link loadCoChangeRules} (project root -> rules or a not-measured reason),
 * {@link reviewCoChange} (rules + change groups -> findings), types {@link CoChangeRulesLoad},
 * {@link CoChangeGroup}, {@link CoChangeFinding}, {@link GlobMatchFn}.
 *
 * @invariant Side-effect class: {@link loadCoChangeRules} reads one file through the injected `readFile` port;
 *   {@link reviewCoChange} is pure (the glob matcher is injected, so no second glob grammar lives here — the CLI
 *   adapter passes `Bun.Glob`).
 * @invariant The rule list is validated through `CoChangeRulesSchema` from `@lore/core`, NOT through the CLI
 *   loader (`adapters/cli/loader.ts` falls back to "no config" silently on a bad `workflow` section). An invalid
 *   list is a `{measured:false, reason}` naming the exact key path (`workflow.turn_end.co_change[0].require`);
 *   it is never read as "no rules".
 * @invariant A file absent from `.lore/config.yaml`, or an absent `workflow`/`turn_end`/`co_change` key, means no
 *   rules (the schema default `[]`): that is a measured empty list, not a failure.
 */
import { join } from "node:path";
import { CoChangeRulesSchema, type CoChangeRule } from "@lore/core";
import { parse as parseYaml } from "yaml";

/** Dotted path of the setting, the prefix of every reason this module writes. */
export const CO_CHANGE_KEY_PATH = "workflow.turn_end.co_change";

/** Reads a UTF-8 file; returns null when it does not exist, throws on any other fault. */
export type ReadFileOrNullFn = (path: string) => string | null;

/** True when `path` (repo-relative, `/`-separated) matches the glob `pattern`. */
export type GlobMatchFn = (pattern: string, path: string) => boolean;

export type CoChangeRulesLoad =
  | { readonly measured: true; readonly rules: readonly CoChangeRule[] }
  | { readonly measured: false; readonly reason: string };

/** `[0].require` style suffix for a Zod issue path below the rule list. */
function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.map((part) => (typeof part === "number" ? `[${part}]` : `.${String(part)}`)).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Loads and validates the co-change rules of the project at `projectRoot`.
 *
 * @param projectRoot - directory holding `.lore/`.
 * @param readFile - file port (null = file absent).
 * @returns measured rules (empty when unset), or a not-measured reason naming the offending key path.
 */
export function loadCoChangeRules(projectRoot: string, readFile: ReadFileOrNullFn): CoChangeRulesLoad {
  const configPath = join(projectRoot, ".lore", "config.yaml");
  let text: string | null;
  try {
    text = readFile(configPath);
  } catch (err) {
    return { measured: false, reason: `${CO_CHANGE_KEY_PATH}: ${configPath} unreadable (${err instanceof Error ? err.message : String(err)})` };
  }
  if (text === null) return { measured: true, rules: [] };
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (err) {
    return { measured: false, reason: `${CO_CHANGE_KEY_PATH}: ${configPath} is not valid YAML (${err instanceof Error ? err.message.split("\n")[0] : String(err)})` };
  }
  const workflow = isRecord(parsed) ? parsed["workflow"] : undefined;
  if (workflow !== undefined && !isRecord(workflow)) return { measured: false, reason: "workflow: must be a mapping" };
  const turnEnd = workflow === undefined ? undefined : workflow["turn_end"];
  if (turnEnd !== undefined && !isRecord(turnEnd)) return { measured: false, reason: "workflow.turn_end: must be a mapping" };
  const raw = turnEnd === undefined ? undefined : turnEnd["co_change"];
  if (raw === undefined) return { measured: true, rules: [] };
  const result = CoChangeRulesSchema.safeParse(raw);
  if (result.success) return { measured: true, rules: result.data };
  const reasons = result.error.issues.map((issue) => `${CO_CHANGE_KEY_PATH}${formatIssuePath(issue.path)}: ${issue.message}`);
  return { measured: false, reason: reasons.join("; ") };
}

/** Who a set of changed paths belongs to: one run, or the turn's unknown-source changes taken as one group. */
export type CoChangeSubject = { readonly kind: "run"; readonly run: string } | { readonly kind: "unknown" };

export interface CoChangeGroup {
  readonly subject: CoChangeSubject;
  /** Repo-relative paths. */
  readonly files: readonly string[];
}

export interface CoChangeFinding {
  readonly kind: "co-change";
  readonly rule: string;
  /** The run, for a run subject. */
  readonly run?: string;
  /** `"unknown"` for the unknown-source group. */
  readonly group?: "unknown";
  /** The group's files that matched the rule's `when`, sorted. */
  readonly files: readonly string[];
  readonly require: readonly string[];
  readonly message: string;
}

/**
 * One finding per (rule, group) where some changed path matches `when` and none matches `require`.
 *
 * @param rules - validated rules.
 * @param groups - the runs judged by this review plus the unknown-source group.
 * @param matches - glob matcher.
 * @returns findings in rule order, then group order.
 */
export function reviewCoChange(rules: readonly CoChangeRule[], groups: readonly CoChangeGroup[], matches: GlobMatchFn): CoChangeFinding[] {
  const findings: CoChangeFinding[] = [];
  const any = (patterns: readonly string[], file: string): boolean => patterns.some((pattern) => matches(pattern, file));
  for (const rule of rules) {
    for (const group of groups) {
      const triggered = group.files.filter((file) => any(rule.when, file)).sort();
      if (triggered.length === 0 || group.files.some((file) => any(rule.require, file))) continue;
      const who = group.subject.kind === "run" ? `run ${group.subject.run}` : "the unknown-source changes (author could not be told)";
      findings.push({
        kind: "co-change",
        rule: rule.name,
        ...(group.subject.kind === "run" ? { run: group.subject.run } : { group: "unknown" as const }),
        files: triggered,
        require: rule.require,
        message: `Co-change rule "${rule.name}": ${who} changed ${triggered.join(", ")} but nothing matching ${rule.require.join(" | ")}. Change the required file too, or say why it is not needed.`,
      });
    }
  }
  return findings;
}
