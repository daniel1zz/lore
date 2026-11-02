// @spawns packages/lore/src/index.ts
/**
 * E2E for the module-file architecture-card link (task task-module-claude-md-files-do-not-link-their-architecture-2):
 * on a throwaway `mkdtemp` + `lore init` corpus holding one architecture module card, `lore context refresh` writes
 * `Architecture card: \`<slug>\`` into the module's CLAUDE.md, `refresh --check` exits 0, and deleting the card makes
 * `refresh --check` exit 1 (dangling link). A corpus with no module card gets no link line and no error.
 *
 * Runs the SOURCE entry of THIS checkout; this repo's own `.lore/` is never touched.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { templatedFieldsArgs } from "../helpers/templated-create.js";

const TIMEOUT_MS = 180_000;

const LORE_ENTRY = new URL("../../src/index.ts", import.meta.url).pathname;
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const MODULE_FILE = "packages/svc/CLAUDE.md";
const MODULE_BODY = "# Module: svc\n\n## Purpose\n\nServes things.\n";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", LORE_ENTRY, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "context-card-link-e2e-session" },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[], cwd: string): RunResult {
  const result = runLore(args, cwd);
  if (result.exitCode !== 0) throw new Error(`lore ${args.join(" ")} exited ${result.exitCode}: ${result.stderr}${result.stdout}`);
  return result;
}

function parseSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from: ${stdout}`);
  return slug;
}

function parseBaselineSlug(stdout: string): string {
  const slug = stdout.match(/Created baseline \S+ (\S+) \(/)?.[1];
  if (slug === undefined) throw new Error(`could not parse baseline slug from: ${stdout}`);
  return slug;
}

function newCorpus(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-card-link-e2e-")));
  expect(dir.startsWith(REPO_ROOT)).toBe(false);
  mustRun(["init"], dir);
  mkdirSync(join(dir, "packages/svc"), { recursive: true });
  writeFileSync(join(dir, MODULE_FILE), MODULE_BODY);
  writeFileSync(
    join(dir, "CLAUDE.md"),
    "# Fixture\n\n## What This Is\n\nA fixture.\n\n## Commands\n\n- none\n\n## Architecture\n\nLayers.\n",
  );
  mustRun(["context", "init", "--no-ai", "--force"], dir);
  return dir;
}

let withCard = "";
let withoutCard = "";
let cardSlug = "";

describe("lore context refresh links module files to their architecture card", () => {
  beforeAll(() => {
    withCard = newCorpus();
    const prd = parseSlug(mustRun(["create", "prd", "--title", "Card Link Root", ...templatedFieldsArgs("prd", { refTarget: "problem" }), "--no-ai"], withCard).stdout);
    const root = parseBaselineSlug(
      mustRun(["baseline", "add", prd, "--tree", "architecture", "--node", "root", "--label", "ARCH", "--title", "Card Arch Root", ...templatedFieldsArgs("baseline", { kind: "root" })], withCard).stdout,
    );
    const section = parseBaselineSlug(
      mustRun(["baseline", "add", root, "--tree", "architecture", "--node", "section", "--label", "SECT", "--title", "Card Section", ...templatedFieldsArgs("baseline", { kind: "section" })], withCard).stdout,
    );
    // The card names the module file it describes in its `paths` field (the structured twin of the old free body's "Source:" line).
    const cardFields = templatedFieldsArgs("baseline", { kind: "module-card", fields: { purpose: "Module card: svc", paths: [MODULE_FILE] } });
    cardSlug = parseBaselineSlug(
      mustRun(
        ["baseline", "add", section, "--tree", "architecture", "--node", "module-card", "--label", "MSVC", "--title", "Module card: svc", ...cardFields],
        withCard,
      ).stdout,
    );
    withoutCard = newCorpus();
  }, TIMEOUT_MS);

  afterAll(() => {
    for (const dir of [withCard, withoutCard]) if (dir !== "") rmSync(dir, { recursive: true, force: true });
  });

  it("HAPPY: refresh writes the link, then --check exits 0", () => {
    const missing = runLore(["context", "refresh", "--check"], withCard);
    expect(missing.exitCode).toBe(1);
    expect(missing.stdout).toContain(MODULE_FILE);

    mustRun(["context", "refresh"], withCard);
    expect(readFileSync(join(withCard, MODULE_FILE), "utf8")).toContain(`Architecture card: \`${cardSlug}\``);

    expect(runLore(["context", "refresh", "--check"], withCard).exitCode).toBe(0);
  }, TIMEOUT_MS);

  it("NEGATIVE: deleting the card makes --check exit 1; refresh then drops the dangling line", () => {
    const cardId = (JSON.parse(mustRun(["get", cardSlug, "--json"], withCard).stdout) as { data: { doc: { id: string } } }).data.doc.id;
    mustRun(["delete", cardId, "--confirm"], withCard);
    const dangling = runLore(["context", "refresh", "--check"], withCard);
    expect(dangling.exitCode).toBe(1);
    expect(dangling.stdout).toContain(MODULE_FILE);

    mustRun(["context", "refresh"], withCard);
    expect(readFileSync(join(withCard, MODULE_FILE), "utf8")).toBe(MODULE_BODY);
    expect(runLore(["context", "refresh", "--check"], withCard).exitCode).toBe(0);
  }, TIMEOUT_MS);

  it("BOUNDARY: a corpus with no module card gets no link line and no error", () => {
    const refreshed = runLore(["context", "refresh"], withoutCard);
    expect(refreshed.exitCode).toBe(0);
    expect(readFileSync(join(withoutCard, MODULE_FILE), "utf8")).toBe(MODULE_BODY);
    expect(runLore(["context", "refresh", "--check"], withoutCard).exitCode).toBe(0);
  }, TIMEOUT_MS);
});
