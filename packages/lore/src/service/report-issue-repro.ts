/**
 * Filing-time check of a `--repro-command` value: is it one shell-lexable line whose program can be found?
 *
 * Purpose: keep a repro command a COMMAND — a sentence typed into the field (#364) is refused before filing, since
 * no code ever runs the value afterwards (spec-defect-reports-carry-their-own-context-a-checked-repro D4).
 *
 * Public surface: `checkReproCommand`, `ReproCheck`, `ReproCheckDeps`, `SHELL_BUILTINS`.
 *
 * Invariants:
 *   - The command is lexed, never executed or expanded: backticks and `$( )` are ordinary characters.
 *   - The program is the first word of the first segment (before the first unquoted `;`, `|`, `&&`), after
 *     skipping leading `NAME=value` words.
 *   - `which` is the ONLY source of "is this name on PATH": the caller passes a lookup over `Invocation.env.PATH`,
 *     so this module never reads a process default (an MCP server's PATH may differ from the agent's shell).
 *   - Called from the input adapters only (CLI flag, MCP field); lore's own filers carry generated or
 *     historical values and are not checked.
 *
 * Side-effect class: pure (every lookup is injected).
 *
 * Source: BR-491/BR-1381 via spec-defect-reports-carry-their-own-context-a-checked-repro "Repro command check".
 */

/** Result of checking a --repro-command value; pure except for the injected PATH lookup. */
export type ReproCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "multi_line" | "unlexable" | "no_program" | "program_not_found";
      /** Names the offending word (or the quote / backslash that could not be lexed). */
      readonly detail: string;
    };

/** Lookups {@link checkReproCommand} needs; all injected so the check stays pure. */
export interface ReproCheckDeps {
  /** True when `name` (a program word without a slash) is found on the invocation's PATH. */
  readonly which: (name: string) => boolean;
  /** The one program name that is always accepted: lore itself. */
  readonly selfName: "lore";
  /** True when a program word containing a slash names an existing path relative to the cwd; absent = never. */
  readonly pathExists?: (path: string) => boolean;
}

/** Shell builtins accepted as a repro program without a PATH lookup. */
export const SHELL_BUILTINS: readonly string[] = ["cd", "export", "source", ".", "set", "unset"];

const ASSIGNMENT_WORD = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Lexes the first segment's words; `unlexable` carries the reason for an unbalanced quote / trailing backslash. */
function lexFirstSegment(cmd: string): { words: string[] } | { unlexable: string } {
  const words: string[] = [];
  let current = "";
  let inWord = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < cmd.length; i += 1) {
    const ch = cmd[i] as string;
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === "\\" && i + 1 < cmd.length && '"\\$`'.includes(cmd[i + 1] as string)) {
        current += cmd[i + 1];
        i += 1;
      } else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
    } else if (ch === "\\") {
      if (i + 1 >= cmd.length) return { unlexable: "trailing backslash" };
      current += cmd[i + 1];
      inWord = true;
      i += 1;
    } else if (ch === ";" || ch === "|" || (ch === "&" && cmd[i + 1] === "&")) {
      // Keep scanning only to validate quoting of the rest; later segments contribute no words.
      if (inWord) words.push(current);
      current = "";
      inWord = false;
      if (ch === "&") i += 1;
      return finishQuoteScan(cmd, i + 1, words);
    } else if (ch === " " || ch === "\t") {
      if (inWord) words.push(current);
      current = "";
      inWord = false;
    } else {
      current += ch;
      inWord = true;
    }
  }
  if (quote !== null) return { unlexable: `unbalanced ${quote} quote` };
  if (inWord) words.push(current);
  return { words };
}

/** After the first segment ended, only verify the remainder has balanced quotes and no trailing backslash. */
function finishQuoteScan(
  cmd: string,
  from: number,
  words: string[],
): { words: string[] } | { unlexable: string } {
  let quote: '"' | "'" | null = null;
  for (let i = from; i < cmd.length; i += 1) {
    const ch = cmd[i] as string;
    if (quote === "'") {
      if (ch === "'") quote = null;
    } else if (quote === '"') {
      if (ch === "\\") i += 1;
      else if (ch === '"') quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "\\") {
      if (i + 1 >= cmd.length) return { unlexable: "trailing backslash" };
      i += 1;
    }
  }
  if (quote !== null) return { unlexable: `unbalanced ${quote} quote` };
  return { words };
}

/**
 * Checks one `--repro-command` value.
 *
 * @param cmd - the raw value as given by a person or agent
 * @param deps - injected PATH / path lookups (see {@link ReproCheckDeps})
 * @returns `{ ok: true }`, or the refusal reason plus the offending word in `detail`
 * @example
 *   checkReproCommand("with an old fragment: lore integrate x", deps)
 *   // => { ok: false, reason: "program_not_found", detail: "with" }
 */
export function checkReproCommand(cmd: string, deps: ReproCheckDeps): ReproCheck {
  if (/[\r\n]/.test(cmd)) {
    return { ok: false, reason: "multi_line", detail: "the command spans more than one line" };
  }
  const lexed = lexFirstSegment(cmd);
  if ("unlexable" in lexed) return { ok: false, reason: "unlexable", detail: lexed.unlexable };
  const program = lexed.words.find((word) => !ASSIGNMENT_WORD.test(word));
  if (program === undefined) {
    return { ok: false, reason: "no_program", detail: "no program word (only NAME=value assignments or nothing)" };
  }
  if (program === deps.selfName || SHELL_BUILTINS.includes(program)) return { ok: true };
  const found = program.includes("/") ? (deps.pathExists?.(program) ?? false) : deps.which(program);
  return found ? { ok: true } : { ok: false, reason: "program_not_found", detail: program };
}
