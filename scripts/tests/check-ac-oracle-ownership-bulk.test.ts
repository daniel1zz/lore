// @spawns packages/lore/src/index.ts
// @spawns scripts/check-ac-oracle-ownership.ts
// @spawns scripts/check-ac-oracle-ownership-corpus.ts
/**
 * task-check-ac-oracle-ownership-scans-only-what-changed-so-the — the ownership check reads the
 * whole corpus through ONE reader process instead of one `lore ac list` spawn per spec, and
 * stays exact: same findings, same exit as the per-spec reference reader on every input.
 *
 * (a) the real-tree timing and equality are recorded by the task's evidence (a test may not read the repo's own corpus); (b) a seeded unowned-ac-reference is found.
 * Falsifier: a reader that skips the changed file (stays green with the seeded finding) fails (b).
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { collectScriptAcs, scriptAcsFromDump } from "../check-ac-oracle-ownership.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const CHECKER = join(REPO_ROOT, "scripts", "check-ac-oracle-ownership.ts");
const SPEC_BODY = "## Overview/Goal\n\nFixture.\n\n## Scope\n\nFixture.\n\n## Acceptance Criteria\n\nSee ac list.\n";
const ENV = { ...process.env, CLAUDECODE: "1" };

function lore(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("bun", ["run", LORE_ENTRY, ...args], { cwd, encoding: "utf8", env: ENV });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

function addSpec(dir: string, title: string, acId: string, command: string): string {
  const created = lore(["create", "spec", "--title", title, "--content", SPEC_BODY, "--json"], dir);
  if (created.status !== 0) throw new Error(`fixture: create spec: ${created.stderr}${created.stdout}`);
  const slug = (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
  const added = lore(
    ["ac", "add", slug, acId, "--statement", "The fixture command exits with code 0", "--mode", "script", "--oracle", "test", "--command", command, "--allow-missing-path", "fixture: path may be absent", "--json"],
    dir,
  );
  if (added.status !== 0) throw new Error(`fixture: ac add: ${added.stderr}${added.stdout}`);
  return slug;
}

function runMain(dir: string, reader: "bulk" | "per-spec-cli"): { status: number; out: string } {
  const driver = `import { main } from ${JSON.stringify(CHECKER)}; process.exit(main(${JSON.stringify(dir)}, ${JSON.stringify(dir)}, ${JSON.stringify(LORE_ENTRY)}, ${JSON.stringify(reader)}));`;
  const driverPath = join(dir, "driver.mts");
  writeFileSync(driverPath, driver, "utf8");
  const r = spawnSync("bun", [driverPath], { cwd: dir, encoding: "utf8", env: ENV });
  return { status: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

describe("task-check-ac-oracle-ownership-scans-only-what-changed-so-the — bulk reader", () => {
  it("HAPPY: scriptAcsFromDump yields exactly what the per-spec reader collects (live, deprecated, red-first reason, non-script)", () => {
    const dump = {
      specs: [
        {
          slug: "spec-live",
          status: "approved",
          criteria: [
            { id: "AC-A-1", verify: { mode: "script", command: "bunx vitest run a.test.ts" } },
            { id: "AC-A-2", verify: { mode: "manual" } },
            { id: "AC-A-3" },
          ],
          allow_missing_declarations: [{ ac_id: "AC-A-1", reason: "red-first" }],
        },
        { slug: "spec-old", status: "deprecated", criteria: [], allow_missing_declarations: [] },
      ],
    };
    const runner = ((args: readonly string[]) => {
      if (args[0] === "list") return { ok: true, data: { docs: dump.specs.map((s) => ({ slug: s.slug, status: s.status })) } };
      const spec = dump.specs.find((s) => s.slug === args[2]);
      return { ok: true, data: { criteria: spec?.criteria ?? [], allow_missing_declarations: spec?.allow_missing_declarations ?? [] } };
    }) as unknown as Parameters<typeof collectScriptAcs>[2];
    expect(scriptAcsFromDump(dump)).toEqual(collectScriptAcs("/unused", "/unused", runner));
  });

  it("NEGATIVE (b): a seeded unowned-ac-reference in a changed file is found, identically by both readers (a reader that skips the file would stay green)", () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-ac-ownership-bulk-"));
    try {
      expect(lore(["init", "--json"], dir).status).toBe(0);
      mkdirSync(join(dir, "scripts", "tests"), { recursive: true });
      writeFileSync(join(dir, "scripts/tests/a.test.ts"), 'it("AC-BK-1 holds", () => {});\n', "utf8");
      writeFileSync(join(dir, "scripts/tests/b.test.ts"), 'it("AC-BK-2 holds", () => {});\n', "utf8");
      const a = addSpec(dir, "Bulk fixture A", "AC-BK-1", "bunx vitest run scripts/tests/a.test.ts");
      addSpec(dir, "Bulk fixture B", "AC-BK-2", "bunx vitest run scripts/tests/b.test.ts");
      const clean = runMain(dir, "bulk");
      expect(clean.status).toBe(0);
      // seed: b.test.ts now also references AC-BK-1, which a.test.ts owns
      writeFileSync(join(dir, "scripts/tests/b.test.ts"), 'it("AC-BK-2 holds", () => {});\nit("AC-BK-1 leaks in", () => {});\n', "utf8");
      const bulk = runMain(dir, "bulk");
      const reference = runMain(dir, "per-spec-cli");
      expect(bulk.status).toBe(1);
      expect(bulk.out).toContain("rule=unowned-ac-reference");
      expect(bulk.out).toContain(`spec=${a}`);
      expect(bulk.out).toContain("path=scripts/tests/b.test.ts");
      expect(bulk).toEqual(reference);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);

  it("ERROR (AS-17): a cwd that is not a corpus fails loud with exit 1, never a clean 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-ac-ownership-bulk-nocorpus-"));
    try {
      const r = runMain(dir, "bulk");
      expect(r.status).toBe(1);
      expect(r.out).not.toContain("OK");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
