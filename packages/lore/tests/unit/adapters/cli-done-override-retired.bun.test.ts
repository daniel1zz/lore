/**
 * `lore done --override-attestation` / `--override-attestation-cite` are RETIRED (decision D45, spec
 * spec-done-contract-compiled-at-approve-task-kinds-write-sets AC-DCS1-*): under the done contract the contract's oracles are the
 * only proof of done, so a flag that waived only the attested-pass floor goes. A caller meets the contract's oracles, or amends
 * the contract.
 *
 * Both flags stay DECLARED as "Retired" stubs: deleting them would give the generic strict-flags "Unknown option" with no
 * replacement path. Each use exits exactly 2 with a retirement message on stderr, BEFORE the corpus is touched.
 *
 * Coverage:
 *   NEGATIVE:   each flag alone and both together exit 2, name the flag as retired and the replacement path; stdout stays empty
 *   BOUNDARY:   a blank value and a non-numeric cite value are the same retirement exit, not the old usage errors
 *   STATE:      the task's version, status and audit rows are unchanged after every retired use
 *   REGRESSION: a plain `lore done` still refuses an unattested task at the attested floor and never names the retired flag
 *
 * @spec_ref spec-done-contract-compiled-at-approve-task-kinds-write-sets
 *
 * TG-25: the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through dist/lore.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";
import { makeCleanTreeRepo } from "../../helpers/clean-tree-repo";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, { cwd, home: cwd, env: { ...process.env, HOME: cwd, EDITOR: "true" } });
  return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.exitCode };
}

async function mustRun(args: string[], cwd: string): Promise<RunResult> {
  const result = await runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`fixture command \`lore ${args.join(" ")}\` failed (${result.exitCode}): ${result.stderr}`);
  }
  return result;
}

interface DocJson {
  readonly status: string;
  readonly version: number;
}

async function getDoc(slug: string, cwd: string): Promise<DocJson> {
  const result = await mustRun(["get", slug, "--json"], cwd);
  return (JSON.parse(result.stdout) as { data: { doc: DocJson } }).data.doc;
}

async function auditCount(slug: string, cwd: string): Promise<number> {
  const audit = await mustRun(["audit", slug, "--json"], cwd);
  return (JSON.parse(audit.stdout) as { data: { entries: unknown[] } }).data.entries.length;
}

async function createAdhocTask(cwd: string, title: string): Promise<string> {
  const created = await mustRun(
    ["create", "task", "--title", title, "--kind", "code", "--adhoc", "--ac-scope", "", "--content", "body", "--no-ai", "--json"],
    cwd,
  );
  return (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-done-override-retired-"));
  makeCleanTreeRepo(tmpDir);
  await mustRun(["init"], tmpDir);
  await mustRun(["create", "prd", "--title", "Retired Override Root", "--content", "## Overview\nroot", "--no-ai"], tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

const RETIRED_USES: ReadonlyArray<{ readonly label: string; readonly args: readonly string[]; readonly flags: readonly string[] }> = [
  { label: "--override-attestation alone", args: ["--override-attestation", "manual browser check"], flags: ["--override-attestation"] },
  { label: "--override-attestation-cite alone", args: ["--override-attestation-cite", "1"], flags: ["--override-attestation-cite"] },
  {
    label: "both flags together",
    args: ["--override-attestation", "x", "--override-attestation-cite", "1"],
    flags: ["--override-attestation", "--override-attestation-cite"],
  },
  { label: "a blank reason", args: ["--override-attestation", "   "], flags: ["--override-attestation"] },
  { label: "a non-numeric cite", args: ["--override-attestation-cite", "abc"], flags: ["--override-attestation-cite"] },
];

describe("NEGATIVE/BOUNDARY/STATE — every use of a retired flag exits 2 with the retirement text and writes nothing", () => {
  for (const use of RETIRED_USES) {
    it(`${use.label}: exit 2, retired + replacement path on stderr, version and audit unchanged`, async () => {
      const slug = await createAdhocTask(tmpDir, `Retired ${use.label}`);
      const before = await getDoc(slug, tmpDir);
      const auditBefore = await auditCount(slug, tmpDir);

      const result = await runLore(["done", slug, ...use.args], tmpDir);

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("retired");
      for (const flag of use.flags) expect(result.stderr).toContain(flag);
      expect(result.stderr).not.toContain("Unknown option");
      // the replacement path: meet the contract's oracles, or amend the contract
      expect(result.stderr).toContain("oracles");
      expect(result.stderr).toContain("amend");

      const after = await getDoc(slug, tmpDir);
      expect(after.status).toBe(before.status);
      expect(after.version).toBe(before.version);
      expect(await auditCount(slug, tmpDir)).toBe(auditBefore);
    });
  }
});

describe("REGRESSION — the attested floor still refuses with no escape", () => {
  it("a plain `lore done` on an unattested task exits 4 and names neither retired flag", async () => {
    const slug = await createAdhocTask(tmpDir, "Plain Done Task");
    await mustRun(["claim", slug, "--worktree", "plain-branch"], tmpDir);
    await mustRun(["evidence", slug, "--oracle", "manual", "--command", "bun run typecheck", "--result", "pass", "--output-tail", "ok"], tmpDir);
    await mustRun(["release", slug], tmpDir);

    const result = await runLore(["done", slug], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).not.toContain("--override-attestation");
  });
});
