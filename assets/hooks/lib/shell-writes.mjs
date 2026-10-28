/**
 * shell-writes.mjs — the files a Bash command line writes, when that can be read from its text alone.
 *
 * Purpose: lets the pre-edit anchor gate apply the same anchor decision to a helper's shell write (`sed -i`, `> file`,
 * `tee file`, `cp`/`mv`/`install`/`ln`/`touch`/`rm`, an inline python/node/bun program) as to an Edit/Write call, and
 * tells it which writes it could see coming but could not place (BR-1493).
 * Public surface: {@link mayWriteFiles}, {@link extractShellWriteTargets}.
 * Side-effect class: IO read only (one `stat` per `cp`/`mv`/`install`/`ln` destination, to tell a directory from a
 * file); writes nothing. The caller passes the starting directory and an explicit env map.
 *
 * ## Invariants
 *
 * - Never guess. A target is reported as a path only when its text names it outright. A word that still carries `$`, a
 *   backtick or a glob character, a segment whose working directory the parser could not measure, and a write call whose
 *   path argument is not ONE string literal are reported as `unmeasured` entries instead (named, never silently dropped),
 *   so the gate can refuse them while another run holds a path (BR-1493). Variable assignments are never resolved.
 * - Out of scope, so never read: a program in a script file (`python3 tool.py`, `node x.js`, `bun run …`), other
 *   interpreters (`perl -e`, `ruby -e`; `perl -i` is read), and a command the shell parser cannot segment (reported as
 *   `unsegmentable`). Their writes are judged only by integrate's own-diff judgment (BR-1346).
 * - Directories come from the ONE shell parser (`./shell-cwd.mjs`, generated from `packages/core/src/shell-cwd.ts`), so a
 *   `cd` earlier in the chain moves the target exactly as it does in the git-safety hook.
 * - Heredoc bodies are removed before parsing (their lines are data, not commands) and re-attached to the segment that
 *   carries the `<<` marker, with whether the delimiter was quoted: an unquoted heredoc and a double-quoted `-c`/`-e`
 *   argument are expanded by the shell, so a `$` in a write target there is never a literal path.
 * - The interpreter write calls read are ONE closed table ({@link WRITE_CALLS}); adding a call is adding a row.
 */

import { lstatSync, statSync } from 'node:fs';
import { parseShellCommand, resolvePathInSegment } from './shell-cwd.mjs';

/** Cheap pre-filter: a command with none of these tokens cannot write a file this module can read. */
const WRITE_HINT =
  />|\btee\b|\bsed\b|\bperl\b|\bpython[\d.]*\b|\bnode(?:js)?\b|\bbun\b|\bopen\s*\(|write_text|write_bytes|\b(?:cp|mv|install|ln|touch|rm)\b/;

/** Targets that are not repository files. */
const IGNORED_TARGET = /^(?:\/dev\/|&)/;

/** A word that is not a plain literal path: expansion, command substitution, glob or brace. */
const NON_LITERAL_WORD = /[$`*?[\]{}]/;

/**
 * @typedef {{kind: 'unsegmentable' | 'non-literal-target' | 'non-literal-program', text: string, within?: string}} UnmeasuredEntry
 *   `within`: the absolute directory the entry's literal prefix names (`rm -f /tmp/*.log` -> `/tmp`), absent when the word
 *   starts with an expansion and could be anywhere.
 *   `unsegmentable`: the parser could not split the command (writes unknown in kind AND target; the gate never refuses
 *   it). `non-literal-target`: a write whose destination is not a literal. `non-literal-program`: an inline interpreter
 *   program that is itself an expansion (`python3 -c "$CODE"`).
 */

/**
 * The interpreter write calls read, one row each (BR-1493's closed list).
 *
 * `pattern` matches the callee up to and including its `(` (global); `target` is the zero-based index of the argument that
 * names the written file (the DESTINATION for rename/copy/move); `targetName` is its keyword spelling in python;
 * `mode` marks python `open(`, a write only when its mode says so; `chained` marks `Path(<p>).<method>(`, where the target
 * is `Path`'s argument and the call is the method that follows.
 */
const WRITE_CALLS = [
  { lang: 'python', pattern: /(?<![\w$.])(?:(?:io|codecs)\s*\.\s*)?open\s*\(/g, target: 0, targetName: 'file', mode: true },
  {
    lang: 'python',
    pattern: /(?<![\w$])(?:pathlib\s*\.\s*)?Path\s*\(/g,
    target: 0,
    chained: /^\s*\.\s*(write_text|write_bytes|touch|unlink|open)\s*\(/,
  },
  { lang: 'python', pattern: /(?<![\w$.])shutil\s*\.\s*(?:copy(?:2|file|tree)?|move)\s*\(/g, target: 1, targetName: 'dst' },
  { lang: 'python', pattern: /(?<![\w$.])os\s*\.\s*(?:rename|replace)\s*\(/g, target: 1, targetName: 'dst' },
  { lang: 'python', pattern: /(?<![\w$.])os\s*\.\s*(?:remove|unlink)\s*\(/g, target: 0, targetName: 'path' },
  {
    lang: 'js',
    pattern:
      /(?<![\w$.])(?:(?:require\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\)|fs\.promises|fsp|fs)\s*\.\s*)?(?:writeFileSync|appendFileSync|writeFile|appendFile|rmSync|unlinkSync|createWriteStream)\s*\(/g,
    target: 0,
  },
  {
    lang: 'js',
    pattern:
      /(?<![\w$.])(?:(?:require\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\)|fs\.promises|fsp|fs)\s*\.\s*)?(?:renameSync|copyFileSync)\s*\(/g,
    target: 1,
  },
  { lang: 'js', pattern: /(?<![\w$.])Bun\s*\.\s*write\s*\(/g, target: 0 },
];

/**
 * @param {string} command - the Bash command text.
 * @returns {boolean} whether the command could write a file at all (false = skip parsing).
 */
export function mayWriteFiles(command) {
  return WRITE_HINT.test(command);
}

const HEREDOC_MARKER = /(?<!<)<<(?!<)(-?)\s*(?:(['"])([A-Za-z_][A-Za-z0-9_]*)\2|\\?([A-Za-z_][A-Za-z0-9_]*))/g;

/**
 * Removes heredoc bodies (`<<EOF ... EOF`, `<<-'EOF'`) so their lines are not parsed as commands, and returns them in
 * source order with whether the delimiter was quoted (a quoted delimiter means the shell does no expansion in the body).
 *
 * @returns {{stripped: string, heredocs: {delimiter: string, quoted: boolean, body: string}[]}}
 */
function splitHeredocs(command) {
  const lines = command.split('\n');
  const kept = [];
  const heredocs = [];
  for (let i = 0; i < lines.length; i += 1) {
    kept.push(lines[i]);
    const markers = [...lines[i].matchAll(HEREDOC_MARKER)];
    for (const marker of markers) {
      const strip = marker[1] === '-';
      const quoted = marker[2] !== undefined || marker[0].includes('\\');
      const delimiter = marker[3] ?? marker[4];
      let j = i + 1;
      const body = [];
      while (j < lines.length && (strip ? lines[j].replace(/^\t+/, '') : lines[j]) !== delimiter) {
        body.push(strip ? lines[j].replace(/^\t+/, '') : lines[j]);
        j += 1;
      }
      heredocs.push({ delimiter, quoted, body: body.join('\n') });
      i = j;
    }
  }
  return { stripped: kept.join('\n'), heredocs };
}

/** Maps each segment to the heredocs its `<<` markers introduced, in source order. */
function attachHeredocs(segments, heredocs) {
  const queue = [...heredocs];
  const bySegment = new Map();
  for (const segment of segments) {
    const markers = [...segment.raw.matchAll(HEREDOC_MARKER)];
    if (markers.length === 0) continue;
    bySegment.set(segment, queue.splice(0, markers.length));
  }
  return bySegment;
}

/** For each segment directly piped from a `cat <<EOF` segment, that heredoc. */
function pipedHeredocs(stripped, segments, ownHeredocs) {
  const piped = new Map();
  let cursor = 0;
  const spans = segments.map((segment) => {
    const start = stripped.indexOf(segment.raw, cursor);
    if (start >= 0) cursor = start + segment.raw.length;
    return start;
  });
  for (let i = 0; i + 1 < segments.length; i += 1) {
    const feeder = segments[i];
    const heredoc = ownHeredocs.get(feeder)?.[0];
    if (heredoc === undefined || spans[i] < 0 || spans[i + 1] < 0) continue;
    if (feeder.argv[0]?.split('/').pop() !== 'cat') continue;
    const between = stripped.slice(spans[i] + feeder.raw.length, spans[i + 1]).replace(/[()\s]/g, '');
    if (between === '|') piped.set(segments[i + 1], heredoc);
  }
  return piped;
}

/** `argv` without redirections (`> f`, `2>f`, `<<EOF`, `< f`) and the word each standalone operator consumes. */
function operandsOf(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const match = /^(?:\d*|&)(>>|>\||>|<<<|<<-?|<)(.*)$/.exec(argv[i]);
    if (match === null || i === 0) {
      out.push(argv[i]);
      continue;
    }
    if (match[2] === '') i += 1;
  }
  return out;
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
    } else if (/^-[A-Za-z]*i$/.test(word) && (rest[i + 1] === '' || /^\.[\w.-]*$/.test(rest[i + 1] ?? ''))) {
      // reason: BSD/macOS `sed -i '' …` / `sed -i .bak …` give the backup suffix as a SEPARATE word; GNU spells it
      // `-i.bak`. An empty word or a dotted suffix is never a sed script, so it is consumed, not read as a file.
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

// ── file commands: cp mv install ln (destination), touch rm (every operand) ─────────────────────

/** Short options that consume a value (attached `-Ssuf` or the next word), per command. */
const VALUE_SHORT = { cp: 'S', mv: 'S', ln: 'S', install: 'mogS', touch: 'dtrA', rm: '' };
/** Long options that consume the next word when not written `--name=value`, per command. */
const VALUE_LONG = {
  cp: new Set(['--suffix', '--backup-dir', '--context', '--reflink', '--preserve', '--sparse']),
  mv: new Set(['--suffix', '--context']),
  ln: new Set(['--suffix']),
  install: new Set(['--mode', '--owner', '--group', '--suffix', '--context']),
  touch: new Set(['--date', '--reference', '--time']),
  rm: new Set(),
};

const FILE_COMMANDS = new Set(['cp', 'mv', 'install', 'ln', 'touch', 'rm']);

/**
 * Operands of a file command with its destination-shaping options read: `-t dir` / `-tdir` / `--target-directory[=]dir`
 * (`targetDirectory`), `-T` / `--no-target-directory` (`noTargetDirectory`), `ln -n` / `--no-dereference` (`noDereference`),
 * `install -d` (`installDirectories`). Value-taking options consume their value so it is never read as an operand; `--`
 * ends the options.
 */
function parseFileCommand(head, words) {
  const operands = [];
  let targetDirectory;
  let installDirectories = false;
  let noTargetDirectory = false;
  let noDereference = false;
  let optionsDone = false;
  const takesTargetDirectory = head !== 'touch' && head !== 'rm';
  for (let i = 1; i < words.length; i += 1) {
    const word = words[i];
    if (optionsDone || word === '-' || !word.startsWith('-')) {
      operands.push(word);
    } else if (word === '--') {
      optionsDone = true;
    } else if (word.startsWith('--')) {
      const [name] = word.split('=', 1);
      if (takesTargetDirectory && name === '--target-directory') {
        targetDirectory = word.includes('=') ? word.slice(name.length + 1) : words[i + 1];
        if (!word.includes('=')) i += 1;
      } else if (name === '--no-target-directory') noTargetDirectory = true;
      else if (name === '--no-dereference') noDereference = true;
      else if (!word.includes('=') && VALUE_LONG[head].has(name)) i += 1;
    } else {
      for (let k = 1; k < word.length; k += 1) {
        const flag = word[k];
        if (flag === 't' && takesTargetDirectory) {
          targetDirectory = word.slice(k + 1) !== '' ? word.slice(k + 1) : words[i + 1];
          if (word.slice(k + 1) === '') i += 1;
          break;
        }
        if (VALUE_SHORT[head].includes(flag)) {
          if (word.slice(k + 1) === '') i += 1;
          break;
        }
        if (flag === 'T') noTargetDirectory = true;
        else if (flag === 'n' && head === 'ln') noDereference = true;
        else if (flag === 'd' && head === 'install') installDirectories = true;
      }
    }
  }
  return { operands, targetDirectory, installDirectories, noTargetDirectory, noDereference };
}

const baseName = (word) => word.replace(/\/+$/, '').split('/').pop() ?? word;

/**
 * Whether `word`, placed in the segment's directory, is an existing directory (a trailing `/` says so outright).
 * `followLinks: false` (ln -n) answers false for a symlink to a directory, which `ln -n` treats as a plain file.
 */
function namesDirectory(parse, segment, word, followLinks) {
  if (word.endsWith('/')) return true;
  const placed = resolvePathInSegment(parse, segment, word);
  if (placed.kind === 'not-measured') return false;
  try {
    return (followLinks ? statSync(placed.absolute) : lstatSync(placed.absolute)).isDirectory();
  } catch {
    return false;
  }
}

/** Items a file-command segment writes: see {@link segmentItems}. */
function fileCommandItems(parse, segment, head, words) {
  const { operands, targetDirectory, installDirectories, noTargetDirectory, noDereference } = parseFileCommand(head, words);
  const word = (text) => ({ type: 'word', word: text });
  if (head === 'touch' || head === 'rm' || installDirectories) return operands.map(word);
  const intoDirectory = (directory, sources) => {
    if (NON_LITERAL_WORD.test(directory)) return [word(directory)];
    const items = [];
    for (const source of sources) {
      if (NON_LITERAL_WORD.test(source)) items.push(word(source));
      else items.push(word(`${directory.replace(/\/+$/, '')}/${baseName(source)}`));
    }
    return items;
  };
  if (targetDirectory !== undefined) return intoDirectory(targetDirectory, operands);
  if (head === 'ln' && operands.length === 1) return [word(baseName(operands[0]))];
  if (operands.length < 2) return [];
  const destination = operands[operands.length - 1];
  const sources = operands.slice(0, -1);
  // reason: `-T` says the destination is never a directory to copy into; `ln -n` says so for a symlink to one.
  if (!noTargetDirectory && !NON_LITERAL_WORD.test(destination) && namesDirectory(parse, segment, destination, !noDereference)) {
    return intoDirectory(destination, sources);
  }
  return [word(destination)];
}

// ── inline interpreter programs ─────────────────────────────────────────────────────────────────

/** Where an interpreter segment gets its program: `{from: 'argument'|'stdin', ...}` or null (a script file / nothing). */
function interpreterProgram(kind, words) {
  const argumentFlags = { python: /^-[A-Za-z]*c$/, node: /^(?:-e|-p|-pe|--eval|--print)$/, bun: /^(?:-e|-p|--eval|--print)$/ }[kind];
  const skipsValue = { python: new Set(['-W', '-X', '-Q']), node: new Set(['-r', '--require', '--import', '--loader', '--experimental-loader']), bun: new Set() }[kind];
  let i = 1;
  if (kind === 'bun' && words[1] === 'run' && words[2] === '-') return { from: 'stdin' };
  for (; i < words.length; i += 1) {
    const word = words[i];
    if (argumentFlags.test(word)) return words[i + 1] === undefined ? null : { from: 'argument', text: words[i + 1] };
    if (kind === 'node' && word.startsWith('--eval=')) return { from: 'argument', text: word.slice('--eval='.length) };
    if (word === '-') return { from: 'stdin' };
    if (kind === 'python' && word === '-m') return null;
    if (skipsValue.has(word)) {
      i += 1;
    } else if (!word.startsWith('-')) {
      return null; // a script file (or a subcommand such as `bun run x`, `bun test`): out of scope
    }
  }
  return { from: 'stdin' };
}

/** The longest stretch of program text read for ONE call's arguments; a longer or unclosed call is reported unmeasured. */
const CALL_SCAN_LIMIT = 4096;
/** Total characters read for call arguments across one program (bounds a program of many unclosed calls). */
const PROGRAM_SCAN_BUDGET = 262144;

/**
 * Reads the first `needed` arguments of a call whose argument text starts at `from`, scanning at most
 * {@link CALL_SCAN_LIMIT} characters (a long string literal AFTER the arguments that matter is never scanned).
 *
 * @returns {{args: string[], end: number, closed: boolean, scanned: number}} `closed`: whether the call's `)` was reached;
 *   false when the scan stopped at `needed` arguments, at the limit, or at the end of the text.
 */
function readCallArgs(source, from, needed) {
  const args = [];
  const stop = Math.min(source.length, from + CALL_SCAN_LIMIT);
  let depth = 0;
  let start = from;
  let i = from;
  const result = (end, closed) => ({ args, end, closed, scanned: end - from });
  while (i < stop) {
    const char = source[i];
    if (char === "'" || char === '"' || char === '`') {
      const quote = source.startsWith(char.repeat(3), i) ? char.repeat(3) : char;
      i += quote.length;
      while (i < stop && !source.startsWith(quote, i)) i += source[i] === '\\' ? 2 : 1;
      i += quote.length;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      if (depth === 0) {
        const text = source.slice(start, i).trim();
        if (text !== '') args.push(text);
        return result(i + 1, true);
      }
      depth -= 1;
    } else if (char === ',' && depth === 0) {
      args.push(source.slice(start, i).trim());
      start = i + 1;
      if (args.length >= needed) return result(i + 1, false);
    }
    i += 1;
  }
  return result(Math.min(i, source.length), false);
}

/**
 * Which characters of `source` are code: false inside a comment (python `#`, js line and block comments) or a string literal. A call name
 * found there (`print("open('y','w')")`, `# open('y','w')`) is text, not a call. A single- or double-quoted string ends at
 * its line end when unterminated, so one stray apostrophe cannot hide the rest of the program.
 */
function codeMask(source, lang) {
  const mask = new Uint8Array(source.length).fill(1);
  const length = source.length;
  let i = 0;
  while (i < length) {
    const char = source[i];
    const lineComment = (lang === 'python' && char === '#') || (lang === 'js' && char === '/' && source[i + 1] === '/');
    if (lineComment) {
      const eol = source.indexOf('\n', i);
      const end = eol < 0 ? length : eol;
      mask.fill(0, i, end);
      i = end;
    } else if (lang === 'js' && char === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      const end = close < 0 ? length : close + 2;
      mask.fill(0, i, end);
      i = end;
    } else if (char === "'" || char === '"' || char === '`') {
      const triple = lang === 'python' && char !== '`' && source.startsWith(char.repeat(3), i);
      const quote = triple ? char.repeat(3) : char;
      let j = i + quote.length;
      while (j < length) {
        if (source[j] === '\\') j += 2;
        else if (source.startsWith(quote, j) || (!triple && char !== '`' && source[j] === '\n')) break;
        else j += 1;
      }
      const end = Math.min(length, j + (source.startsWith(quote, j) ? quote.length : 0));
      mask.fill(0, i, end);
      i = end;
    } else {
      i += 1;
    }
  }
  return mask;
}

/** The string a single string literal spells, or undefined when `text` is anything else (variable, concatenation, f-string, escape). */
function literalOf(text, lang) {
  const trimmed = text.trim();
  const open = (lang === 'python' ? /^([rRbBuU]{0,2})('''|"""|'|")/ : /^()(['"`])/).exec(trimmed);
  if (open === null) return undefined;
  const quote = open[2];
  const bodyStart = open[0].length;
  for (let i = bodyStart; i < trimmed.length; i += 1) {
    // reason: an escape could spell a different path than the text shows; never guess.
    if (trimmed[i] === '\\') return undefined;
    if (!trimmed.startsWith(quote, i)) continue;
    if (trimmed.slice(i + quote.length).trim() !== '') return undefined;
    const body = trimmed.slice(bodyStart, i);
    return quote === '`' && body.includes('${') ? undefined : body;
  }
  return undefined;
}

/** `{positional, keyword}` of python call arguments (`name=value` words are keywords). */
function splitPythonArgs(args) {
  const positional = [];
  const keyword = new Map();
  for (const arg of args) {
    const match = /^([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]*)$/.exec(arg);
    if (match === null) positional.push(arg);
    else keyword.set(match[1], match[2]);
  }
  return { positional, keyword };
}

/**
 * The write calls of an inline program, in text order: `{path}` (a literal target) or `{unmeasured}` (a write call whose
 * path argument is not one string literal).
 *
 * @param {string} source - the program text.
 * @param {'python' | 'js'} lang
 */
function scanProgram(source, lang) {
  const found = [];
  const mask = codeMask(source, lang);
  let budget = PROGRAM_SCAN_BUDGET;
  const handledMethods = new Set();
  const tooLarge = () => found.push({ index: source.length, unmeasured: 'program too large to read in full: its calls cannot all be checked' });
  for (const row of WRITE_CALLS) {
    if (row.lang !== lang) continue;
    for (const match of source.matchAll(row.pattern)) {
      if (mask[match.index] === 0) continue;
      if (budget <= 0) {
        tooLarge();
        return found.sort((a, b) => a.index - b.index);
      }
      const callee = match[0].replace(/\s+/g, '').slice(0, -1);
      const argsFrom = match.index + match[0].length;
      const needed = row.chained !== undefined ? 2 : Math.max(row.target + 1, row.mode ? 2 : 0);
      const read = readCallArgs(source, argsFrom, needed);
      budget -= Math.max(read.scanned, 1);
      const complete = read.closed || read.args.length >= needed;
      if (!complete) {
        found.push({ index: match.index, unmeasured: `${callee}(…): call is unclosed or longer than ${CALL_SCAN_LIMIT} characters, so its target cannot be read` });
        continue;
      }
      const { args } = read;
      let targetText;
      let display = callee;
      let literalAllowed = true;
      if (row.chained !== undefined) {
        const method = read.closed ? row.chained.exec(source.slice(read.end, read.end + 64)) : null;
        targetText = args.join(', ');
        if (method === null) {
          // reason: `Path(<p>)` not directly followed by a write method is no write by itself; the method call, if any,
          // is reported by the receiver check below.
          continue;
        }
        handledMethods.add(read.end + method[0].indexOf('.'));
        display = `Path(${targetText}).${method[1]}`;
        literalAllowed = args.length === 1;
        if (method[1] === 'open') {
          const opened = readCallArgs(source, read.end + method[0].length, 2);
          const { positional, keyword } = splitPythonArgs(opened.args);
          const mode = keyword.get('mode') ?? positional[0];
          const modeLiteral = mode === undefined ? undefined : literalOf(mode, lang);
          if (mode === undefined || (modeLiteral !== undefined && !/[wax+]/.test(modeLiteral))) continue;
        }
      } else if (lang === 'python') {
        const { positional, keyword } = splitPythonArgs(args);
        if (row.mode) {
          const mode = keyword.get('mode') ?? positional[1];
          const modeLiteral = mode === undefined ? undefined : literalOf(mode, lang);
          if (mode === undefined || (modeLiteral !== undefined && !/[wax+]/.test(modeLiteral))) continue;
        }
        targetText = keyword.get(row.targetName) ?? positional[row.target] ?? '';
        display = `${callee}(${targetText})`;
      } else {
        targetText = args[row.target] ?? '';
        display = `${callee}(${targetText})`;
      }
      const literal = literalAllowed ? literalOf(targetText, lang) : undefined;
      if (literal === undefined) found.push({ index: match.index, unmeasured: `${display}: target is not a single string literal` });
      else found.push({ index: match.index, path: literal, call: display });
    }
  }
  if (lang === 'python') {
    // A write method on a receiver that is not `Path('<literal>')` (`p = Path('x'); p.write_text(..)`, `(Path('d')/'x').touch()`):
    // the file it writes is not in the text.
    for (const match of source.matchAll(/\.\s*(write_text|write_bytes|touch|unlink)\s*\(/g)) {
      if (mask[match.index] === 0 || handledMethods.has(match.index)) continue;
      if (/\b(?:os|shutil)\s*$/.test(source.slice(Math.max(0, match.index - 12), match.index))) continue;
      found.push({ index: match.index, unmeasured: `.${match[1]}(): the receiver is not Path('<literal>'), so the target cannot be read` });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/** Items one interpreter segment writes: see {@link segmentItems}. */
function interpreterItems(segment, kind, words, ownHeredocs, piped) {
  const program = interpreterProgram(kind, words);
  if (program === null) return [];
  const head = words[0].split('/').pop();
  let source;
  let expandable;
  if (program.from === 'argument') {
    if (segment.unresolved.some((entry) => entry.detail.trim() === program.text.trim())) {
      return [{ type: 'unmeasured', entry: { kind: 'non-literal-program', text: `${head}: the inline program ${program.text} is not literal text` } }];
    }
    source = program.text;
    // reason: a double-quoted -c/-e argument is expanded by the shell; the parser leaves its trace in `unresolved`, a
    // single-quoted one leaves none and its `$` is literal text.
    expandable = segment.unresolved.length > 0;
  } else {
    // reason: with several heredocs on one command the shell feeds stdin from the LAST one; a heredoc on the
    // interpreter also overrides a pipe into it.
    const heredoc = ownHeredocs.get(segment)?.at(-1) ?? piped.get(segment);
    if (heredoc === undefined) return [];
    source = heredoc.body;
    expandable = !heredoc.quoted;
  }
  const items = [];
  for (const call of scanProgram(source, kind === 'python' ? 'python' : 'js')) {
    if (call.unmeasured !== undefined) items.push({ type: 'unmeasured', entry: { kind: 'non-literal-target', text: call.unmeasured } });
    else if (expandable && /[$`]/.test(call.path)) {
      items.push({ type: 'unmeasured', entry: { kind: 'non-literal-target', text: `${call.call}: shell expansion in the program text` } });
    } else items.push({ type: 'word', word: call.path, trusted: true });
  }
  return items;
}

// ── segments ────────────────────────────────────────────────────────────────────────────────────

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

/**
 * What one segment writes: `{type: 'word', word, trusted?}` (a target word to place; `trusted` skips the non-literal
 * check because the program text, not the shell, spelled it) or `{type: 'unmeasured', entry}`.
 */
function segmentItems(parse, segment, ownHeredocs, piped) {
  const argv = segment.argv;
  const items = (hasUnquotedRedirect(segment.raw) ? redirectTargets(argv) : []).map((word) => ({ type: 'word', word }));
  const words = unwrapCommand(operandsOf(argv));
  const head = words[0] === undefined ? '' : words[0].split('/').pop();
  const word = (text) => ({ type: 'word', word: text });
  if (head === 'sed' || head === 'gsed' || head === 'perl') items.push(...inPlaceEditorTargets(words).map(word));
  else if (head === 'tee') items.push(...teeTargets(words).map(word));
  else if (FILE_COMMANDS.has(head)) items.push(...fileCommandItems(parse, segment, head, words));
  else if (/^python[\d.]*$/.test(head)) items.push(...interpreterItems(segment, 'python', words, ownHeredocs, piped));
  else if (head === 'node' || head === 'nodejs') items.push(...interpreterItems(segment, 'node', words, ownHeredocs, piped));
  else if (head === 'bun') items.push(...interpreterItems(segment, 'bun', words, ownHeredocs, piped));
  else if (head === 'xargs') items.push(...xargsItems(words));
  else if (head === 'find') items.push(...findExecItems(words));
  return items;
}

// ── commands behind a prefix, loop keyword, xargs or find -exec ─────────────────────────────────

/** Words that run the command after them (shell keywords and wrappers that change nothing about what is written). */
const PREFIX_WORDS = new Set(['do', 'then', 'else', '{', '!', 'time', 'nohup', 'command', 'exec', 'builtin']);
/** Prefix words that take their own options before the command. */
const PREFIX_WITH_OPTIONS = new Set(['time', 'nohup', 'command', 'exec', 'builtin']);
const SUDO_VALUE_OPTIONS = new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-T', '-U', '-R']);
const ENV_VALUE_OPTIONS = new Set(['-u', '-C', '-S']);

/**
 * The command words after any leading assignment, loop/conditional keyword (`do`, `then`, `else`, `{`, `!`), `time`,
 * `nohup`, `command`, `exec`, `sudo` (with its options) and `env` (with its options and `NAME=value` words); `[]` when
 * the line only asks about a command (`command -v`).
 */
function unwrapCommand(words) {
  let i = 0;
  for (;;) {
    const word = words[i];
    if (word === undefined) return [];
    const name = word.split('/').pop();
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      i += 1;
    } else if (PREFIX_WORDS.has(name)) {
      i += 1;
      if (name === 'command' && (words[i] === '-v' || words[i] === '-V')) return [];
      while (PREFIX_WITH_OPTIONS.has(name) && words[i] !== undefined && words[i].startsWith('-') && words[i] !== '--') {
        i += name === 'exec' && words[i] === '-a' ? 2 : 1;
      }
    } else if (name === 'sudo' || name === 'env') {
      const valueOptions = name === 'sudo' ? SUDO_VALUE_OPTIONS : ENV_VALUE_OPTIONS;
      i += 1;
      while (words[i] !== undefined && words[i].startsWith('-')) {
        const option = words[i];
        i += 1;
        if (option === '--') break;
        if (valueOptions.has(option)) i += 1;
      }
    } else {
      return words.slice(i);
    }
  }
}

/** Whether a command (already unwrapped) can write files named by its operands or its input. */
function canWriteFiles(words) {
  const head = words[0] === undefined ? '' : words[0].split('/').pop();
  if (head === 'tee' || FILE_COMMANDS.has(head)) return true;
  if (head === 'sed' || head === 'gsed' || head === 'perl') return words.slice(1).some((w) => w === '--in-place' || w.startsWith('--in-place=') || /^-[A-Za-z]*i/.test(w));
  return false;
}

const XARGS_VALUE_OPTIONS = new Set(['-I', '-n', '-P', '-L', '-s', '-d', '-E', '-a', '-J']);

/** `xargs <write command>`: the targets come from the input, so the write is one unmeasured entry. */
function xargsItems(words) {
  let i = 1;
  while (words[i] !== undefined && words[i].startsWith('-')) {
    const option = words[i];
    i += 1;
    if (option === '--') break;
    if (XARGS_VALUE_OPTIONS.has(option)) i += 1;
  }
  const inner = unwrapCommand(words.slice(i));
  if (!canWriteFiles(inner)) return [];
  return [{ type: 'unmeasured', entry: { kind: 'non-literal-target', text: `xargs ${inner[0]}: its targets come from the input, not the command text` } }];
}

/** `find … -exec|-execdir|-ok|-okdir <write command> … ;|+`: the targets are the matched files. */
function findExecItems(words) {
  const items = [];
  for (let i = 1; i < words.length; i += 1) {
    if (!/^-(?:exec|execdir|ok|okdir)$/.test(words[i])) continue;
    let end = i + 1;
    while (end < words.length && words[end] !== ';' && words[end] !== '+') end += 1;
    const inner = unwrapCommand(words.slice(i + 1, end));
    if (canWriteFiles(inner)) {
      items.push({ type: 'unmeasured', entry: { kind: 'non-literal-target', text: `find ${words[i]} ${inner[0]}: its targets are the files found, not the command text` } });
    }
    i = end;
  }
  return items;
}

/**
 * The directory the literal prefix of a non-literal word names (absolute), or undefined when the word could be anywhere
 * (it starts with an expansion). `/tmp/*.log` -> `/tmp`; `dist/*` -> `<cwd>/dist`; `*.log` -> the segment's directory;
 * `$d/x` -> undefined. Lets a caller skip a write that lands outside the working copy or in an ignored directory.
 */
function withinOf(parse, segment, word) {
  const cut = word.search(NON_LITERAL_WORD);
  if (cut < 0) return undefined;
  const prefix = word.slice(0, cut);
  const slash = prefix.lastIndexOf('/');
  let directory;
  if (slash >= 0) directory = prefix.slice(0, slash) === '' ? '/' : prefix.slice(0, slash);
  else if (prefix !== '' || /[*?[]/.test(word[cut])) directory = '.';
  else return undefined;
  const placed = resolvePathInSegment(parse, segment, directory);
  return placed.kind === 'not-measured' ? undefined : placed.absolute;
}

/**
 * The absolute paths `command` writes, as far as its text names them.
 *
 * @param {string} command - the Bash command text.
 * @param {{cwd: string, env: Record<string, string | undefined>}} options - the directory the command starts in (absolute)
 *   and the variables `$NAME` may expand from.
 * @returns {{paths: string[], unmeasured: UnmeasuredEntry[]}} `paths`: absolute, deduplicated, in source order. `unmeasured`:
 *   one typed entry per write whose target could not be read from the text (named so a caller can report it, never silently
 *   dropped); the gate exempts `unsegmentable` and refuses the rest while another run holds a path.
 */
export function extractShellWriteTargets(command, options) {
  const { stripped, heredocs } = splitHeredocs(command);
  const parse = parseShellCommand(stripped, { root: options.cwd, env: options.env });
  if (parse.kind !== 'parsed') {
    return { paths: [], unmeasured: [{ kind: 'unsegmentable', text: `command could not be segmented (${parse.cause})` }] };
  }
  const ownHeredocs = attachHeredocs(parse.segments, heredocs);
  const piped = pipedHeredocs(stripped, parse.segments, ownHeredocs);
  const paths = [];
  const unmeasured = [];
  const noteUnmeasured = (entry) => {
    if (!unmeasured.some((known) => known.kind === entry.kind && known.text === entry.text)) unmeasured.push(entry);
  };
  for (const segment of parse.segments) {
    for (const item of segmentItems(parse, segment, ownHeredocs, piped)) {
      if (item.type === 'unmeasured') {
        noteUnmeasured(item.entry);
        continue;
      }
      const word = item.word;
      // reason: an empty operand (`touch ''`) names nothing, and the working-copy root is never a file target.
      if (word === '' || IGNORED_TARGET.test(word)) continue;
      if (item.trusted !== true && NON_LITERAL_WORD.test(word)) {
        const within = withinOf(parse, segment, word);
        noteUnmeasured({ kind: 'non-literal-target', text: `${word}: not a literal path`, ...(within !== undefined ? { within } : {}) });
        continue;
      }
      const placed = resolvePathInSegment(parse, segment, word);
      if (placed.kind === 'not-measured') {
        noteUnmeasured({ kind: 'non-literal-target', text: `${word}: ${placed.cause}` });
        continue;
      }
      if (placed.absolute === parse.root) continue;
      if (!paths.includes(placed.absolute)) paths.push(placed.absolute);
    }
  }
  return { paths, unmeasured };
}
