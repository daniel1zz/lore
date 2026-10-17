// @spawns packages/lore/src/index.ts
/**
 * `lore approve <plan>` — `prd_sync_advisories` CHANNEL render (task
 * task-t7-lore-approve-renders-the-prd-sync-advisory-to-stderr,
 * spec-plan-close-predicates-measure-invariants-an-applicability §D2 "an
 * inapplicable verdict is loud on two channels" — the audit row is the
 * auditor's channel, this task is the operator's).
 *
 * `commands/approve.ts` transitively imports `loader.ts` (`bun:sqlite`),
 * unresolvable by vitest as a direct import (confirmed empirically — importing
 * it directly throws `Cannot find package 'bun:sqlite'` under this vitest
 * config, which marks it an SSR external rather than a resolvable module).
 * Like `tests/unit/adapters/cli-strict-flags-incidents.test.ts`, this suite
 * spawns the REAL CLI (`bun run src/index.ts`) as a subprocess against a
 * THROWAWAY temp corpus (`mkdtemp` + `lore init` — never the repo's own
 * `.lore/`, per project CLAUDE.md) with stdout/stderr captured on SEPARATE
 * real pipes — the only way to prove the advisory reaches the correct CHANNEL
 * rather than merely appearing "somewhere" in a merged buffer. A test that
 * only asserted the text appeared in combined output would still pass if the
 * advisory leaked to stdout, which the surrounding code comment in
 * `approve.ts` explicitly forbids (D1: advisory never changes the outcome —
 * exit code stays 0 whether or not it prints).
 *
 * UPDATED for slice 3a (BR-984): the `prd_sync_advisories` channel (the plan-promote early warning that
 * plan-close's domain-document-edit predicate would find no domain doc) is RETIRED together with that
 * predicate, so `lore approve` no longer renders it. The same scenarios (unlinked spec, both-advisory,
 * linked spec, knob off) now pin the new behaviour through the real CLI process: no prd-sync line ever
 * reaches either channel, and the sibling `reachability_advisories` channel still renders on stderr alone.
 *
 * Coverage:
 *   HAPPY:      an unlinked ancestor spec with the knob ON prints NO prd-sync advisory (stderr empty,
 *               stdout free of ADVISORY), exit 0 — the case that used to print it.
 *   REGRESSION: a human-mode-only spec prints exactly ONE advisory line, the reachability one, on stderr.
 *   BOUNDARY:   a resolvable domain doc (an `implements` edge wired) prints nothing extra.
 *   NEGATIVE:   the prd_sync knob OFF (the default) prints nothing extra.
 *
 * @spec_ref spec-plan-close-predicates-measure-invariants-an-applicability §D2
 *   Acceptance Criteria AC-PCI-16
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { saveConfig } from "@lore/core/node";
import type { LoreConfig } from "@lore/core";
import { citeSpecViaCli } from "../../helpers/cli-live-rule.js";

// tests/unit/cli/ → tests/unit/ → tests/ → packages/lore/
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir and a
 *  fixed actor identity (mirrors `cli-plan-promote-advisory.bun.test.ts` — a
 *  stable identity keeps stderr free of an unrelated actor-traceability
 *  warning that would otherwise pollute the exact stderr assertions below). */
function runLore(args: string[], cwd: string): RunResult {
  // reason: a stable identity WITHOUT `$LORE_ACTOR` — that variable now draws a one-line deprecation warning on
  // stderr (spec-run-identity-slice-1 D8), which would pollute the exact stderr assertions below. The session
  // tier names the writer and prints nothing.
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: cwd, EDITOR: "true", CLAUDE_CODE_SESSION_ID: "stable-probe-session" };
  delete env["LORE_ACTOR"];
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env,
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

function parseSlug(stdout: string): string {
  const match = stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from output: ${stdout}`);
  return slug;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-approve-prd-sync-advisory-"));
  const init = runLore(["init"], tmpDir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

/**
 * Writes `.lore/config.yaml` with `workflow.gates."plan-close".prd_sync.enabled`
 * set to `prdSyncEnabled`, and `workflow.review.judgment_required_types: []` —
 * every scenario below approves >= 1 `spec`-type doc during setup, which
 * SPEC-103 M2 would otherwise block without a fresh review judgment (mirrors
 * `cli-plan-promote-advisory.bun.test.ts`'s / `gate-hooks.bun.test.ts`'s own
 * precedent for neutralizing that UNRELATED gate in a fixture that isn't
 * testing it).
 */
function writeConfig(dir: string, prdSyncEnabled: boolean): void {
  const config: LoreConfig = {
    project: { name: "t7-prd-sync-advisory-test", author: "tester" },
    workflow: {
      gates: { "plan-close": { prd_sync: { enabled: prdSyncEnabled } } },
      review: { judgment_required_types: [] },
    },
  } as unknown as LoreConfig;
  const result = saveConfig(dir, config);
  if (!result.ok) throw new Error(`saveConfig failed: ${JSON.stringify(result.error)}`);
}

function createPrd(dir: string, title: string): string {
  const r = runLore(["create", "prd", "--title", title, "--content", "PRD body.", "--no-ai"], dir);
  if (r.exitCode !== 0) throw new Error(`create prd failed: ${r.stderr}`);
  return parseSlug(r.stdout);
}

function createSpec(dir: string, parentSlug: string, title: string): string {
  const r = runLore(
    ["create", "spec", "--title", title,"--content", "## Overview\n\nBody.", "--no-ai"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create spec failed: ${r.stderr}`);
  return parseSlug(r.stdout);
}

/** Script-mode AC — keeps the ancestor spec `lore verify`-reachable, so
 *  `reachability_advisories` stays OUT of scope for scenarios only testing
 *  `prd_sync_advisories` in isolation. */
function addScriptAc(dir: string, specSlug: string): void {
  const r = runLore(
    [
      "ac",
      "add",
      specSlug,
      "AC-1",
      "--statement",
      "the parser round-trips every fixture file",
      "--mode",
      "script",
      "--oracle",
      "test",
      // reason: token-less on purpose (task-wire-allow-missing-path-and-the-
      // unredeemed-declaration) — `commands/ac.ts` now runs the D8
      // declaration-time path-existence check on every real `ac add`
      // invocation. A `.test.ts`-suffixed path here would need to actually
      // exist on disk (or an --allow-missing-path reason); this fixture only
      // needs SOME script-mode AC to exist, so it uses the same token-less
      // "bun test" form every other fixture in this repo already uses for
      // the identical reason (see e.g. cli-plan-promote-advisory.bun.test.ts).
      "--command",
      "bun test",
    ],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`ac add (script) failed: ${r.stderr}`);
}

/** Human-mode-only AC — zero script-mode ACs makes `lore verify` structurally
 *  unreachable, deliberately firing `reachability_advisories` ALONGSIDE
 *  `prd_sync_advisories` for the REGRESSION (both-present) scenario. */
function addHumanAc(dir: string, specSlug: string): void {
  const r = runLore(
    ["ac", "add", specSlug, "AC-1", "--statement", "the onboarding flow reads clearly", "--mode", "human"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`ac add (human) failed: ${r.stderr}`);
}

function approveDoc(dir: string, slug: string): RunResult {
  // BR-1007: the spec's criterion AC-1 cites the corpus's live fixture rule, so the approval is accepted.
  citeSpecViaCli(
    (args) => {
      const c = runLore(args, dir);
      if (c.exitCode !== 0) throw new Error(`${args.join(" ")}: ${c.stderr}`);
      return c.stdout;
    },
    dir,
    undefined,
    slug,
    "AC-1",
  );
  const r = runLore(["approve", slug], dir);
  if (r.exitCode !== 0) throw new Error(`approve ${slug} failed (setup): ${r.stderr}`);
  return r;
}

function createPlan(dir: string, parentSlug: string, title: string): string {
  const r = runLore(
    ["create", "plan", "--title", title, "--parent", parentSlug, "--content", "## Plan\n\nbody", "--no-ai"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  return parseSlug(r.stdout);
}

describe("lore approve — the prd_sync advisory channel is retired (AC-PCI-16, BR-984)", () => {
  it("HAPPY: an unlinked ancestor spec with the knob ON prints no prd-sync advisory on either channel, exit 0", () => {
    writeConfig(tmpDir, true);
    const prdSlug = createPrd(tmpDir, "T7 Unlinked PRD");
    const specSlug = createSpec(tmpDir, prdSlug, "T7 Unlinked Spec");
    addScriptAc(tmpDir, specSlug);
    approveDoc(tmpDir, specSlug);
    const planSlug = createPlan(tmpDir, specSlug, "T7 Plan Under Unlinked Spec");

    const result = runLore(["approve", planSlug], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("approved");
    expect(result.stderr).not.toContain("prd-sync predicate");
    expect(result.stderr).not.toContain("--type implements");
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("ADVISORY");
  });

  it("REGRESSION: a human-mode-only spec prints exactly one advisory (reachability) on stderr, never stdout", () => {
    writeConfig(tmpDir, true);
    const prdSlug = createPrd(tmpDir, "T7 Both-Advisory PRD");
    const specSlug = createSpec(tmpDir, prdSlug, "T7 Both-Advisory Spec");
    addHumanAc(tmpDir, specSlug);
    approveDoc(tmpDir, specSlug);
    const planSlug = createPlan(tmpDir, specSlug, "T7 Plan Under Human-AC Spec");

    const result = runLore(["approve", planSlug], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr.indexOf("lore verify` will be structurally")).toBeGreaterThanOrEqual(0);
    expect(result.stderr).not.toContain("prd-sync predicate");
    const advisoryLines = result.stderr.split("\n").filter((l) => l.includes("ADVISORY"));
    expect(advisoryLines.length).toBe(1);
    expect(result.stdout).not.toContain("ADVISORY");
  });

  it("BOUNDARY: a resolvable domain doc (implements edge) means the field stays absent — approve prints nothing extra", () => {
    writeConfig(tmpDir, true);
    const prdSlug = createPrd(tmpDir, "T7 Linked PRD");
    const domainSlug = createSpec(tmpDir, prdSlug, "T7 Domain Doc");
    const specSlug = createSpec(tmpDir, prdSlug, "T7 Linked Feature Spec");
    addScriptAc(tmpDir, specSlug);
    const linkResult = runLore(["link", specSlug, domainSlug, "--type", "implements"], tmpDir);
    expect(linkResult.exitCode).toBe(0);
    approveDoc(tmpDir, specSlug);
    const planSlug = createPlan(tmpDir, specSlug, "T7 Plan Under Linked Spec");

    const result = runLore(["approve", planSlug], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("NEGATIVE: the prd_sync gate knob OFF (default) suppresses the advisory even with no domain doc at all", () => {
    writeConfig(tmpDir, false);
    const prdSlug = createPrd(tmpDir, "T7 Knob-Off PRD");
    const specSlug = createSpec(tmpDir, prdSlug, "T7 Knob-Off Spec");
    addScriptAc(tmpDir, specSlug);
    approveDoc(tmpDir, specSlug);
    const planSlug = createPlan(tmpDir, specSlug, "T7 Plan Under Knob-Off Spec");

    const result = runLore(["approve", planSlug], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("ADVISORY");
  });
});
