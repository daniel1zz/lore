// @spawns packages/lore/src/index.ts
/**
 * AC-BIND-3 (spec-prose-about-code-is-bound-to-what-it-describes-one, D2):
 * `lore refs <path> --json` returns exactly the spec code anchor, the CLAUDE.md line and the
 * fragment line bound to the path in a throwaway corpus, and nothing for an unbound path.
 *
 * Spawns the CLI in SOURCE mode against a mkdtemp corpus (`lore init`, cwd inside it); never
 * the repo's own `.lore/`.
 *
 * Coverage: HAPPY (spec anchor + memory-file line + fragment line, exact set) / NEGATIVE
 * (an unbound path returns an empty list, exit 0) / BOUNDARY (a folder anchor binds files
 * beneath it; a symbol anchor reports its symbol; a script reference binds package.json
 * with `script`; `./`-prefixed and trailing-slash arguments normalize) / ERROR (an argument
 * that escapes the repo is refused, exit 4) / STATE (removing the prose line removes its
 * binding on the next run; read-only: the corpus gains no version) / REGRESSION (the human
 * output names document and line).
 *
 * @spec_ref spec-prose-about-code-is-bound-to-what-it-describes-one
 * @ac_ref AC-BIND-3
 */

import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

function runOrThrow(args: string[], dir: string, label: string): RunResult {
  const result = runLore(args, dir);
  if (result.exitCode !== 0) throw new Error(`${label} failed (exit ${result.exitCode}): ${result.stderr}${result.stdout}`);
  return result;
}

function slugOf(stdout: string): string {
  return (JSON.parse(stdout) as { data: { slug: string } }).data.slug;
}

interface BindingJson {
  document: string;
  document_kind: string;
  reference: string;
  path: string;
  line?: number;
  symbol?: string;
  script?: string;
  folder?: true;
}

function refs(dir: string, path: string): { exitCode: number; bindings: BindingJson[] } {
  const result = runLore(["refs", path, "--json"], dir);
  const parsed = JSON.parse(result.stdout) as { data: { bindings: BindingJson[] } };
  return { exitCode: result.exitCode, bindings: parsed.data.bindings };
}

const dir = mkdtempSync(join(tmpdir(), "lore-refs-"));
runOrThrow(["init"], dir, "lore init");
patchLoreConfig(dir, ["workflow:", "  gates:", "    spec-create:", "      enabled: false", ""].join("\n"));

mkdirSync(join(dir, "src", "widgets"), { recursive: true });
mkdirSync(join(dir, ".lore", "context"), { recursive: true });
writeFileSync(join(dir, "src", "widget.ts"), "export function renderWidget() {}\n");
writeFileSync(join(dir, "src", "widgets", "inner.ts"), "export const Inner = 1;\n");
writeFileSync(join(dir, "src", "unbound.ts"), "export const Alone = 1;\n");
writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", scripts: { build: "tsc" } }));
writeFileSync(
  join(dir, "CLAUDE.md"),
  ["# Fixture", "", "The widget lives in `src/widget.ts`.", "", "Build it with `bun run build`.", ""].join("\n"),
);
writeFileSync(
  join(dir, ".lore", "context", "widget-rules.md"),
  ["---", "id: project-widget-rules", "title: Widget rules", 'audience: ["subagent:*"]', "mode: static", "---", "Never edit `src/widget.ts#renderWidget` by hand.", ""].join("\n"),
);

const specSlug = slugOf(
  runOrThrow(
    ["create", "spec", "--title", "Widget Contract", "--no-ai", "--content", "## Goal\n\nBody.", "--json"],
    dir,
    "create spec",
  ).stdout,
);
runOrThrow(["anchor", "add", specSlug, "src/widget.ts#renderWidget"], dir, "anchor add file#symbol");
runOrThrow(["anchor", "add", specSlug, "src/widgets/"], dir, "anchor add folder");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("AC-BIND-3: lore refs <path>", () => {
  it("HAPPY: returns exactly the spec anchor, the CLAUDE.md line and the fragment line bound to the path", () => {
    const { exitCode, bindings } = refs(dir, "src/widget.ts");

    expect(exitCode).toBe(0);
    expect(bindings).toEqual([
      { document: specSlug, document_kind: "spec", reference: "src/widget.ts#renderWidget", path: "src/widget.ts", symbol: "renderWidget" },
      { document: "CLAUDE.md", document_kind: "memory_file", reference: "src/widget.ts", path: "src/widget.ts", line: 3 },
      {
        document: ".lore/context/widget-rules.md",
        document_kind: "fragment",
        reference: "src/widget.ts#renderWidget",
        path: "src/widget.ts",
        line: 7,
        symbol: "renderWidget",
      },
    ]);
  });

  it("NEGATIVE: a path nothing binds returns an empty list and exit 0", () => {
    const { exitCode, bindings } = refs(dir, "src/unbound.ts");

    expect(exitCode).toBe(0);
    expect(bindings).toEqual([]);
  });

  it("BOUNDARY: a folder anchor binds the files beneath it, and the binding says it is a folder", () => {
    const { bindings } = refs(dir, "src/widgets/inner.ts");

    expect(bindings).toEqual([
      { document: specSlug, document_kind: "spec", reference: "src/widgets/", path: "src/widgets", folder: true },
    ]);
  });

  it("BOUNDARY: a script reference binds package.json and names the script", () => {
    const { bindings } = refs(dir, "package.json");

    expect(bindings).toEqual([
      { document: "CLAUDE.md", document_kind: "memory_file", reference: "bun run build", path: "package.json", line: 5, script: "build" },
    ]);
  });

  it("BOUNDARY: `./` prefix and doubled slashes normalize to the same answer", () => {
    expect(refs(dir, "./src//widget.ts").bindings).toHaveLength(3);
  });

  it("ERROR: an argument that escapes the repository is refused with exit 4 and no output on stdout", () => {
    const result = runLore(["refs", "../outside.ts", "--json"], dir);

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toBe("");
  });

  it("REGRESSION: the human output names each document and line", () => {
    const result = runLore(["refs", "src/widget.ts"], dir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CLAUDE.md:3");
    expect(result.stdout).toContain(".lore/context/widget-rules.md:7");
    expect(result.stdout).toContain(specSlug);
  });

  it("STATE: it is read-only (the spec gains no version) and dropping the prose line drops its binding", () => {
    const before = runOrThrow(["log", specSlug], dir, "log before").stdout;
    refs(dir, "src/widget.ts");
    expect(runOrThrow(["log", specSlug], dir, "log after").stdout).toBe(before);

    writeFileSync(join(dir, "CLAUDE.md"), "# Fixture\n\nNothing about code here.\n");

    const kinds = refs(dir, "src/widget.ts").bindings.map((b) => b.document_kind);
    expect(kinds).toEqual(["spec", "fragment"]);
  });
});
