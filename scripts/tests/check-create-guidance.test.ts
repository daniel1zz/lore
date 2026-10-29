// @spawns scripts/check-create-guidance.ts
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(__dirname, "..", "check-create-guidance.ts");
const SPEC_LINE = "An ad-hoc task with criteria: `lore create task --adhoc --title x --spec <spec>`.\n";
const roots: string[] = [];

function run(files: Record<string, string>): { status: number | null; out: string } {
  const root = mkdtempSync(join(tmpdir(), "create-guidance-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const result = spawnSync("bun", [SCRIPT, "--root", root], { encoding: "utf8" });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("check-create-guidance", () => {
  it("exits 1 for an example without --parent and names it", () => {
    const r = run({ "assets/a.md": `${SPEC_LINE}Run \`lore create adr --title x\`.\n` });
    expect(r.status).toBe(1);
    expect(r.out).toContain("assets/a.md:2 lacks --parent");
  });

  it("exits 0 when a continued command has --parent on its second line", () => {
    const r = run({ "assets/a.md": `${SPEC_LINE}lore create knowledge --sub-type retro \\\n  --parent <plan> --title x\n` });
    expect(r.status).toBe(0);
    expect(r.out).toContain("examples=1 withParent=1");
  });

  it("skips a line that describes a refusal", () => {
    const r = run({
      "assets/a.md": `${SPEC_LINE}lore create plan --parent <spec>\nthe guard rejects any \`lore create knowledge\` attempt here\n`,
    });
    expect(r.status).toBe(0);
    expect(r.out).toContain("skippedRefusals=1");
  });

  it("checks string literals under packages/lore/src but not their comments", () => {
    const comment = run({
      "assets/a.md": `${SPEC_LINE}lore create plan --parent <spec>\n`,
      "packages/lore/src/x.ts": "/**\n * `lore create knowledge --sub-type retro`\n */\n",
    });
    expect(comment.status).toBe(0);
    const literal = run({
      "assets/a.md": `${SPEC_LINE}lore create plan --parent <spec>\n`,
      "packages/lore/src/x.ts": "export const hint = 'run lore create adr --title x';\n",
    });
    expect(literal.status).toBe(1);
    expect(literal.out).toContain("packages/lore/src/x.ts:1 lacks --parent");
  });

  it("exits 1 when two examples share a line and only one has --parent", () => {
    const r = run({ "assets/a.md": `${SPEC_LINE}\`lore create adr --parent <spec>\` or \`lore create plan\`\n` });
    expect(r.status).toBe(1);
  });

  it("scans the repo-root CLAUDE.md and exits 1 for an example without --parent", () => {
    const r = run({
      "assets/a.md": `${SPEC_LINE}lore create plan --parent <spec>\n`,
      "CLAUDE.md": "Findings go to the corpus (`lore create knowledge --sub-type retro`).\n",
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain("CLAUDE.md:1 lacks --parent");
  });

  it("exits 0 when the root CLAUDE.md example names --parent", () => {
    const r = run({
      "assets/a.md": `${SPEC_LINE}lore create plan --parent <spec>\n`,
      "CLAUDE.md": "Findings go to the corpus (`lore create knowledge --sub-type retro --parent <plan>`).\n",
    });
    expect(r.status).toBe(0);
    expect(r.out).toContain("examples=2 withParent=2");
  });

  it("exits 1 on an empty scan", () => {
    const r = run({ "assets/a.md": SPEC_LINE });
    expect(r.status).toBe(1);
    expect(r.out).toContain("no `lore create");
  });

  it("exits 1 when the guidance never states --spec for an ad-hoc task", () => {
    const r = run({ "assets/a.md": "lore create plan --parent <spec>\n" });
    expect(r.status).toBe(1);
    expect(r.out).toContain("--spec");
  });

  it("passes on the guidance this repository ships", () => {
    const result = spawnSync("bun", [SCRIPT], { encoding: "utf8" });
    expect(`${result.stdout}${result.stderr}`).toContain("check-create-guidance PASS");
    expect(result.status).toBe(0);
  });
});
