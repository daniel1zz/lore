/**
 * `assets/hooks/lib/shell-writes.mjs` — the files a Bash command line writes, read from its text alone
 * (spec-a-helper-s-shell-write-whose-target-cannot-be-read-is, BR-1493).
 *
 * Table-driven. Coverage:
 *   AC-USW-1 HAPPY       every row of the closed interpreter write-call table yields its literal DESTINATION
 *   AC-USW-1 NEGATIVE    the same row with a variable target yields one `non-literal-target` entry and no path;
 *                        reads, script files and `python3 -c "print(1)"` yield nothing
 *   AC-USW-1 STATE       program sources (-c/-e, heredoc on the interpreter, `cat <<EOF |` into it) and shell expansion
 *   AC-USW-5 HAPPY       cp/mv/install/ln destination only, directory destination, `-t dir`, touch/rm every operand
 *   AC-USW-5 NEGATIVE    non-literal operand is unmeasured; cat/ls/grep write nothing
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface UnmeasuredEntry {
  readonly kind: "unsegmentable" | "non-literal-target" | "non-literal-program";
  readonly text: string;
}
interface Extracted {
  readonly paths: string[];
  readonly unmeasured: UnmeasuredEntry[];
}
interface ShellWritesModule {
  extractShellWriteTargets(command: string, options: { cwd: string; env: Record<string, string | undefined> }): Extracted;
  mayWriteFiles(command: string): boolean;
}

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
let mod: ShellWritesModule;
let root = "";

beforeAll(async () => {
  mod = (await import(pathToFileURL(join(REPO_ROOT, "assets", "hooks", "lib", "shell-writes.mjs")).href)) as ShellWritesModule;
  root = realpathSync(mkdtempSync(join(tmpdir(), "usw-unit-")));
  mkdirSync(join(root, "dir"));
});

afterAll(() => {
  if (root !== "") rmSync(root, { recursive: true, force: true });
});

function extract(command: string): Extracted {
  return mod.extractShellWriteTargets(command, { cwd: root, env: {} });
}

/** Paths relative to the test root, for readable expectations. */
function rel(result: Extracted): string[] {
  return result.paths.map((p) => (p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p));
}

/** A program given to python/node/bun on stdin through a QUOTED heredoc (no shell expansion, program read verbatim). */
const pythonHeredoc = (program: string): string => `python3 - <<'EOF'\n${program}\nEOF`;
const nodeHeredoc = (program: string): string => `node - <<'EOF'\n${program}\nEOF`;

interface Row {
  readonly name: string;
  readonly literal: string;
  readonly variable: string;
  readonly expected: string[];
}

const PYTHON_ROWS: readonly Row[] = [
  { name: "open w", literal: "open('out.txt', 'w')", variable: "open(p, 'w')", expected: ["out.txt"] },
  { name: "open a", literal: "open('out.txt', 'a')", variable: "open(p, 'a')", expected: ["out.txt"] },
  { name: "open x", literal: "open('out.txt', 'x')", variable: "open(p, 'x')", expected: ["out.txt"] },
  { name: "open r+", literal: "open('out.txt', 'r+')", variable: "open(p, 'r+')", expected: ["out.txt"] },
  { name: "open wb", literal: 'open("out.txt", "wb")', variable: 'open(p, "wb")', expected: ["out.txt"] },
  { name: "open non-literal mode", literal: "open('out.txt', mode)", variable: "open(p, mode)", expected: ["out.txt"] },
  { name: "Path.write_text", literal: "Path('out.txt').write_text('x')", variable: "Path(p).write_text('x')", expected: ["out.txt"] },
  { name: "Path.write_bytes", literal: "Path('out.txt').write_bytes(b'x')", variable: "Path(p).write_bytes(b'x')", expected: ["out.txt"] },
  { name: "Path.touch", literal: "Path('out.txt').touch()", variable: "Path(p).touch()", expected: ["out.txt"] },
  { name: "Path.unlink", literal: "Path('out.txt').unlink()", variable: "Path(p).unlink()", expected: ["out.txt"] },
  { name: "shutil.copy", literal: "shutil.copy('src.txt', 'out.txt')", variable: "shutil.copy('src.txt', dst)", expected: ["out.txt"] },
  { name: "shutil.copy2", literal: "shutil.copy2('src.txt', 'out.txt')", variable: "shutil.copy2('src.txt', dst)", expected: ["out.txt"] },
  { name: "shutil.copyfile", literal: "shutil.copyfile('src.txt', 'out.txt')", variable: "shutil.copyfile('src.txt', dst)", expected: ["out.txt"] },
  { name: "shutil.copytree", literal: "shutil.copytree('src.txt', 'out.txt')", variable: "shutil.copytree('src.txt', dst)", expected: ["out.txt"] },
  { name: "shutil.move", literal: "shutil.move('src.txt', 'out.txt')", variable: "shutil.move('src.txt', dst)", expected: ["out.txt"] },
  { name: "os.rename", literal: "os.rename('src.txt', 'out.txt')", variable: "os.rename('src.txt', dst)", expected: ["out.txt"] },
  { name: "os.replace", literal: "os.replace('src.txt', 'out.txt')", variable: "os.replace('src.txt', dst)", expected: ["out.txt"] },
  { name: "os.remove", literal: "os.remove('out.txt')", variable: "os.remove(p)", expected: ["out.txt"] },
  { name: "os.unlink", literal: "os.unlink('out.txt')", variable: "os.unlink(p)", expected: ["out.txt"] },
  { name: "concatenation is not a literal", literal: "open('out.txt', 'w')", variable: "open('a' + name, 'w')", expected: ["out.txt"] },
  { name: "f-string is not a literal", literal: "open('out.txt', 'w')", variable: "open(f'a{name}', 'w')", expected: ["out.txt"] },
];

const NODE_PREFIXES = ["", "fs.", "fs.promises.", "fsp."] as const;
const NODE_CALLS: readonly { readonly name: string; readonly literalArgs: string; readonly variableArgs: string }[] = [
  { name: "writeFileSync", literalArgs: "'out.txt', 'x'", variableArgs: "p, 'x'" },
  { name: "appendFileSync", literalArgs: "'out.txt', 'x'", variableArgs: "p, 'x'" },
  { name: "writeFile", literalArgs: "'out.txt', 'x'", variableArgs: "p, 'x'" },
  { name: "appendFile", literalArgs: "'out.txt', 'x'", variableArgs: "p, 'x'" },
  { name: "rmSync", literalArgs: "'out.txt'", variableArgs: "p" },
  { name: "unlinkSync", literalArgs: "'out.txt'", variableArgs: "p" },
  { name: "createWriteStream", literalArgs: "'out.txt'", variableArgs: "p" },
  { name: "renameSync", literalArgs: "'src.txt', 'out.txt'", variableArgs: "'src.txt', dst" },
  { name: "copyFileSync", literalArgs: "'src.txt', 'out.txt'", variableArgs: "'src.txt', dst" },
];

describe("AC-USW-1: python programs through a quoted heredoc", () => {
  for (const row of PYTHON_ROWS) {
    it(`AC-USW-1: ${row.name} with a literal target yields the destination only`, () => {
      const result = extract(pythonHeredoc(row.literal));
      expect(rel(result)).toEqual(row.expected);
      expect(result.paths.some((p) => p.endsWith("src.txt"))).toBe(false);
      expect(result.unmeasured).toEqual([]);
    });
  }
  for (const row of PYTHON_ROWS.filter((r) => r.variable !== r.literal && !r.name.startsWith("open non-literal mode") && !/^open r\+|open wb/.test(r.name))) {
    it(`AC-USW-1: ${row.name} with a variable target yields one non-literal-target entry naming the call and no path`, () => {
      const result = extract(pythonHeredoc(row.variable));
      expect(result.paths).toEqual([]);
      expect(result.unmeasured).toHaveLength(1);
      expect(result.unmeasured[0]?.kind).toBe("non-literal-target");
      expect(result.unmeasured[0]?.text).toContain(row.variable.split("(")[0] ?? "");
    });
  }
});

describe("AC-USW-1: node and bun programs", () => {
  for (const prefix of NODE_PREFIXES) {
    for (const call of NODE_CALLS) {
      it(`AC-USW-1: ${prefix}${call.name}(literal) yields the destination; a variable yields one entry`, () => {
        const literal = extract(nodeHeredoc(`${prefix}${call.name}(${call.literalArgs})`));
        expect(rel(literal)).toEqual(["out.txt"]);
        expect(literal.paths.some((p) => p.endsWith("src.txt"))).toBe(false);
        expect(literal.unmeasured).toEqual([]);
        const variable = extract(nodeHeredoc(`${prefix}${call.name}(${call.variableArgs})`));
        expect(variable.paths).toEqual([]);
        expect(variable.unmeasured).toHaveLength(1);
        expect(variable.unmeasured[0]?.kind).toBe("non-literal-target");
        expect(variable.unmeasured[0]?.text).toContain(call.name);
      });
    }
  }

  it("AC-USW-1: Bun.write(literal) yields the path; Bun.write(variable) yields one entry", () => {
    expect(rel(extract(`bun -e "Bun.write('out.txt', 'x')"`))).toEqual(["out.txt"]);
    const variable = extract(`bun -e "Bun.write(p, 'x')"`);
    expect(variable.paths).toEqual([]);
    expect(variable.unmeasured).toHaveLength(1);
    expect(variable.unmeasured[0]?.text).toContain("Bun.write");
  });

  it("AC-USW-1: a template literal with ${} is not a literal; one without is", () => {
    expect(extract(nodeHeredoc("fs.writeFileSync(`a${name}`, 'x')")).unmeasured).toHaveLength(1);
    expect(rel(extract(nodeHeredoc("fs.writeFileSync(`out.txt`, 'x')")))).toEqual(["out.txt"]);
  });
});

describe("AC-USW-1: where the program comes from", () => {
  it("AC-USW-1: python -c, python3 heredoc on the interpreter and cat <<'EOF' | python3 - all read the program", () => {
    expect(rel(extract(`python3 -c "open('out.txt','w').write('x')"`))).toEqual(["out.txt"]);
    expect(rel(extract(`python3 -c 'open("out.txt","w").write("x")'`))).toEqual(["out.txt"]);
    expect(rel(extract(`python3 - <<'EOF'\nopen('out.txt','a').write('x')\nEOF`))).toEqual(["out.txt"]);
    expect(rel(extract(`cat <<'EOF' | python3 -\nopen('out.txt','a').write('x')\nEOF`))).toEqual(["out.txt"]);
  });

  it("AC-USW-1: node -e, node heredoc, cat <<EOF | node, bun -e, cat <<EOF | bun - all read the program", () => {
    expect(rel(extract(`node -e "require('fs').writeFileSync('out.txt','x')"`))).toEqual(["out.txt"]);
    expect(rel(extract(`node - <<'EOF'\nfs.writeFileSync('out.txt','x')\nEOF`))).toEqual(["out.txt"]);
    expect(rel(extract(`cat <<'EOF' | node\nfs.writeFileSync('out.txt','x')\nEOF`))).toEqual(["out.txt"]);
    expect(rel(extract(`bun -e "await Bun.write('out.txt','x')"`))).toEqual(["out.txt"]);
    expect(rel(extract(`cat <<'EOF' | bun -\nawait Bun.write('out.txt','x')\nEOF`))).toEqual(["out.txt"]);
  });

  it("AC-USW-1: a heredoc into a chain: the write after `&&` is still read, and the cwd of a cd applies", () => {
    expect(rel(extract(`cd dir && python3 - <<'EOF'\nopen('out.txt','w')\nEOF`))).toEqual(["dir/out.txt"]);
  });

  it("AC-USW-1: two heredoc programs in one command are each read once", () => {
    const result = extract(`python3 - <<'A'\nopen('one.txt','w')\nA\npython3 - <<'B'\nopen('two.txt','w')\nB`);
    expect(rel(result)).toEqual(["one.txt", "two.txt"]);
  });
});

describe("AC-USW-1: shell expansion is never read as a path", () => {
  it('AC-USW-1: python3 -c "open(\'$F\',\'w\')" yields one non-literal-target entry and no path', () => {
    const result = extract(`python3 -c "open('$F','w')"`);
    expect(result.paths).toEqual([]);
    expect(result.unmeasured).toHaveLength(1);
    expect(result.unmeasured[0]?.kind).toBe("non-literal-target");
  });

  it("AC-USW-1: an unquoted heredoc into python with open('$TARGET','a') is one entry; the quoted heredoc yields the literal path", () => {
    const unquoted = extract(`cat <<EOF | python3 -\nopen('$TARGET','a').write('x')\nEOF`);
    expect(unquoted.paths).toEqual([]);
    expect(unquoted.unmeasured).toHaveLength(1);
    const quoted = extract(`cat <<'EOF' | python3 -\nopen('$TARGET','a').write('x')\nEOF`);
    expect(rel(quoted)).toEqual(["$TARGET"]);
    expect(quoted.unmeasured).toEqual([]);
    const doubleQuotedDelimiter = extract(`cat <<"EOF" | python3 -\nopen('$TARGET','a').write('x')\nEOF`);
    expect(rel(doubleQuotedDelimiter)).toEqual(["$TARGET"]);
  });

  it('AC-USW-1: python3 -c "$CODE" yields one non-literal-program entry', () => {
    const result = extract(`python3 -c "$CODE"`);
    expect(result.paths).toEqual([]);
    expect(result.unmeasured).toHaveLength(1);
    expect(result.unmeasured[0]?.kind).toBe("non-literal-program");
  });

  it("AC-USW-1: a command the parser cannot segment is one unsegmentable entry (typed so the gate can exempt it)", () => {
    const result = extract(`python3 -c "open('x','w')`);
    expect(result.paths).toEqual([]);
    expect(result.unmeasured).toHaveLength(1);
    expect(result.unmeasured[0]?.kind).toBe("unsegmentable");
  });
});

describe("AC-USW-1: reads and script files yield nothing", () => {
  const NOTHING = [
    `python3 -c "print(open('a.txt').read())"`,
    `python3 - <<'EOF'\nprint(open('a.txt').read())\nEOF`,
    `python3 - <<'EOF'\nopen(p)\nopen('a.txt', 'r')\nEOF`,
    `python3 -c "print(1)"`,
    `python3 tool.py`,
    `python3 -m pytest tests`,
    `node x.js`,
    `node -e "fs.readFileSync(p)"`,
    `node - <<'EOF'\nfs.readFileSync(p)\nEOF`,
    `bun run build`,
    `bun test packages/lore`,
  ];
  for (const command of NOTHING) {
    it(`AC-USW-1: ${JSON.stringify(command)} yields no path and no entry`, () => {
      const result = extract(command);
      expect(result.paths).toEqual([]);
      expect(result.unmeasured).toEqual([]);
    });
  }

  it("AC-USW-1: a write call inside a SCRIPT FILE's name or an unrelated command's text is not read", () => {
    expect(extract(`echo "open('out.txt','w')"`).paths).toEqual([]);
    expect(extract(`grep "writeFileSync('out.txt')" src`).paths).toEqual([]);
  });
});

describe("AC-USW-1: the existing redirect / tee / sed readings keep their entry shape", () => {
  it("AC-USW-1: a non-literal redirect and sed -i operand are non-literal-target entries", () => {
    expect(extract(`echo hi > "$OUT"`).unmeasured[0]?.kind).toBe("non-literal-target");
    expect(extract(`sed -i "s/x/y/" "$(pick_file)"`).unmeasured[0]?.kind).toBe("non-literal-target");
    expect(rel(extract("echo hi > out.txt"))).toEqual(["out.txt"]);
  });
});

describe("AC-USW-5: file commands write their destination only", () => {
  it("AC-USW-5: cp, mv, install and ln yield the destination, never the source", () => {
    for (const command of ["cp a b", "mv a b", "install -m 644 a b", "ln -s a b", "cp -r a b", "cp -- a b"]) {
      const result = extract(command);
      expect(rel(result), command).toEqual(["b"]);
      expect(result.unmeasured, command).toEqual([]);
    }
  });

  it("AC-USW-5: a destination that is an existing directory yields dir/<basename> for each source", () => {
    expect(rel(extract("cp a b dir/")).sort()).toEqual(["dir/a", "dir/b"]);
    expect(rel(extract("cp a b dir")).sort()).toEqual(["dir/a", "dir/b"]);
    expect(rel(extract("mv x/y.txt dir")).sort()).toEqual(["dir/y.txt"]);
  });

  it("AC-USW-5: -t dir and --target-directory=dir give dir/<basename> for every operand", () => {
    expect(rel(extract("cp -t dir a b")).sort()).toEqual(["dir/a", "dir/b"]);
    expect(rel(extract("cp --target-directory=dir a b")).sort()).toEqual(["dir/a", "dir/b"]);
  });

  it("AC-USW-5: touch and rm write every operand; options are skipped", () => {
    expect(rel(extract("touch f g")).sort()).toEqual(["f", "g"]);
    expect(rel(extract("rm f g")).sort()).toEqual(["f", "g"]);
    expect(rel(extract("rm -rf dir")).sort()).toEqual(["dir"]);
  });

  it("AC-USW-5: a non-literal operand yields one non-literal-target entry", () => {
    const viaVariable = extract(`cp a "$D"`);
    expect(viaVariable.paths).toEqual([]);
    expect(viaVariable.unmeasured).toHaveLength(1);
    expect(viaVariable.unmeasured[0]?.kind).toBe("non-literal-target");
    expect(extract("rm -rf build/*").unmeasured).toHaveLength(1);
    expect(extract(`touch "$(mk)"`).unmeasured).toHaveLength(1);
  });

  it("AC-USW-5: cat, ls and grep read; git rm is the git-safety gate's, not read here", () => {
    for (const command of ["cat a", "ls a", "grep x a", "git rm a", "head -n 3 a"]) {
      const result = extract(command);
      expect(result.paths, command).toEqual([]);
      expect(result.unmeasured, command).toEqual([]);
    }
  });

  it("AC-USW-5: mayWriteFiles recognises every file command and interpreter, and not a plain read", () => {
    for (const command of ["cp a b", "mv a b", "install a b", "ln -s a b", "touch f", "rm f", "node -e 1", "bun -e 1", "python3 -c 1"]) {
      expect(mod.mayWriteFiles(command), command).toBe(true);
    }
    expect(mod.mayWriteFiles("cat a | grep x")).toBe(false);
  });
});
