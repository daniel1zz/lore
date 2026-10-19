/**
 * shell-writes.mjs — the files a Bash command line writes, when that can be read from its text alone.
 *
 * Purpose: lets the pre-edit anchor gate apply the same anchor decision to a helper's shell write (`sed -i`, `> file`,
 * `tee file`, python `open(file, 'w')`) as to an Edit/Write call, instead of leaving it to the turn-end review.
 * Public surface: {@link mayWriteFiles}, {@link extractShellWriteTargets}.
 * Side-effect class: pure (reads nothing; the caller passes the starting directory and an explicit env map).
 *
 * ## Invariants
 *
 * - Never guess. A target is reported only when its text names it outright: a word that still carries `$`, a backtick or a
 *   glob character, a segment whose working directory the parser could not measure, and a script file's own writes are all
 *   NOT reported (the turn-end helper-scope review stays their backstop). A missed target costs a later report; an invented
 *   one would refuse a legitimate command.
 * - Directories come from the ONE shell parser (`./shell-cwd.mjs`, generated from `packages/core/src/shell-cwd.ts`), so a
 *   `cd` earlier in the chain moves the target exactly as it does in the git-safety hook.
 * - Heredoc bodies are removed before parsing: their lines are data, not commands.
 */

import { parseShellCommand, resolvePathInSegment } from './shell-cwd.mjs';

/** Cheap pre-filter: a command with none of these tokens cannot write a file this module can read. */
const WRITE_HINT = />|\btee\b|\bsed\b|\bpython[\d.]*\b|\bopen\s*\(|write_text|write_bytes/;

/** Targets that are not repository files. */
const IGNORED_TARGET = /^(?:\/dev\/|&)/;

/**
 * @param {string} command - the Bash command text.
 * @returns {boolean} whether the command could write a file at all (false = skip parsing).
 */
export function mayWriteFiles(command) {
  return WRITE_HINT.test(command);
}

/** Removes heredoc bodies (`<<EOF ... EOF`, `<<-'EOF'`) so their lines are not read as commands. */
function stripHeredocBodies(command) {
  const lines = command.split('\n');
  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    kept.push(lines[i]);
    const match = /<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/.exec(lines[i]);
    if (match === null) continue;
    const terminator = match[3];
    const strip = match[1] === '-';
    let j = i + 1;
    while (j < lines.length && (strip ? lines[j].trim() : lines[j]) !== terminator) j += 1;
    i = j;
  }
  return kept.join('\n');
}

/** Words that name a redirection target in `argv`: `> f`, `>> f`, `>f`, `2>f`, `&>f`, `>| f`. */
function redirectTargets(argv) {
  const targets = [];
  for (let i = 0; i < argv.length; i += 1) {
    const match = /^(?:\d*|&)(?:>>|>\||>)(.*)$/.exec(argv[i]);
    if (match === null) continue;
    const rest = match[1];
    if (rest !== '') targets.push(rest);
    else if (i + 1 < argv.length) targets.push(argv[i + 1]);
  }
  return targets;
}

/** The file operands of `sed -i` / `perl -i`-style in-place editors. */
function inPlaceEditorTargets(argv) {
  const rest = argv.slice(1);
  const inPlace = rest.some((word) => word === '--in-place' || word.startsWith('--in-place=') || /^-[A-Za-z]*i/.test(word));
  if (!inPlace) return [];
  let scriptGiven = false;
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const word = rest[i];
    if (word === '-e' || word === '-f' || word === '--expression' || word === '--file') {
      scriptGiven = true;
      i += 1;
    } else if (word.startsWith('--expression=') || word.startsWith('--file=') || /^-[A-Za-z]*e./.test(word)) {
      scriptGiven = true;
    } else if (word.startsWith('-') && word !== '-') {
      continue;
    } else {
      positional.push(word);
    }
  }
  return scriptGiven ? positional : positional.slice(1);
}

/** The file operands of `tee`. */
function teeTargets(argv) {
  return argv.slice(1).filter((word) => !word.startsWith('-') || word === '-').filter((word) => word !== '-');
}

/** `open('f', 'w')` / `Path('f').write_text(` file names written by an inline python program. */
function pythonTargets(argv) {
  const source = argv.slice(1).join('\n');
  const targets = [];
  for (const match of source.matchAll(/\bopen\s*\(\s*(['"])([^'"\n]+)\1\s*,\s*(['"])([^'"\n]*)\3/g)) {
    if (/[wax+]/.test(match[4])) targets.push(match[2]);
  }
  for (const match of source.matchAll(/\bPath\s*\(\s*(['"])([^'"\n]+)\1\s*\)\s*\.\s*write_(?:text|bytes)\s*\(/g)) targets.push(match[2]);
  return targets;
}

/** Whether `raw` has a `>` outside quotes (quote-removed argv alone cannot tell `grep ">" f` from `echo > f`). */
function hasUnquotedRedirect(raw) {
  let quote = null;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (quote !== null) {
      if (char === '\\' && quote === '"') i += 1;
      else if (char === quote) quote = null;
    } else if (char === '\\') i += 1;
    else if (char === "'" || char === '"') quote = char;
    else if (char === '>') return true;
  }
  return false;
}

/** Target words one segment writes. */
function segmentTargets(segment) {
  const argv = segment.argv;
  const head = argv[0] === undefined ? '' : argv[0].split('/').pop();
  const targets = hasUnquotedRedirect(segment.raw) ? redirectTargets(argv) : [];
  if (head === 'sed' || head === 'gsed' || head === 'perl') targets.push(...inPlaceEditorTargets(argv));
  else if (head === 'tee') targets.push(...teeTargets(argv));
  else if (/^python[\d.]*$/.test(head)) targets.push(...pythonTargets(argv));
  return targets;
}

/**
 * The absolute paths `command` writes, as far as its text names them.
 *
 * @param {string} command - the Bash command text.
 * @param {{cwd: string, env: Record<string, string | undefined>}} options - the directory the command starts in (absolute)
 *   and the variables `$NAME` may expand from.
 * @returns {{paths: string[], unmeasured: string[]}} `paths`: absolute, deduplicated, in source order. `unmeasured`: one line per
 *   write whose target could not be read from the text (named so a caller can report it, never silently dropped).
 */
export function extractShellWriteTargets(command, options) {
  const parse = parseShellCommand(stripHeredocBodies(command), { root: options.cwd, env: options.env });
  if (parse.kind !== 'parsed') return { paths: [], unmeasured: [`command could not be segmented (${parse.cause})`] };
  const paths = [];
  const unmeasured = [];
  for (const segment of parse.segments) {
    for (const word of segmentTargets(segment)) {
      if (IGNORED_TARGET.test(word)) continue;
      if (/[$`*?[\]{}]/.test(word)) {
        unmeasured.push(`${word}: not a literal path`);
        continue;
      }
      const placed = resolvePathInSegment(parse, segment, word);
      if (placed.kind === 'not-measured') {
        unmeasured.push(`${word}: ${placed.cause}`);
        continue;
      }
      if (!paths.includes(placed.absolute)) paths.push(placed.absolute);
    }
  }
  return { paths, unmeasured };
}
