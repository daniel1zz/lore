/**
 * The shared `renderDocMarkdown` seam's loss notice REACHES `lore feed` and — the sharp
 * end — a `lore gate` DENIAL pack
 * (task-the-shared-renderdocmarkdown-seam-still-drops-structured).
 *
 * bun test (not vitest): every scenario spawns the real CLI (`bun run src/index.ts`,
 * source-fresh by construction) against a THROWAWAY corpus (`mkdtemp` + `lore init`).
 * ⛔ Never touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule).
 *
 * Why this file exists next to the pure suite
 * (`tests/unit/flows/render-seam-loss-notice.test.ts`): that suite calls the seam
 * directly, so it would pass unchanged against a seam no surface actually routes through
 * — the silently-inert false-oracle vector (root CLAUDE.md). Only a real spawn proves the
 * notice reaches a MACHINE reader's stdout on the two surfaces that were silent.
 *
 * ⛔ WHY THE GATE IS THE SHARP END: a gate denial's feeding pack exists to tell an agent
 * how to fix its REJECTED write. That is the moment structured `extra` is most
 * load-bearing and least substitutable — the agent is mid-write, acting on the pack
 * alone, with no habit of running a second command. The denial below is driven by a
 * SCHEMA-VALID payload (well-formed `type`/`title`/`parent_id`/`content`/`extra`) whose
 * only defect is a gate PREDICATE violation (no `## ` heading → `MISSING_SKELETON`). An
 * invalid payload would be stopped by input parsing BEFORE the gate is reached, which
 * reads as a pass while proving nothing — so every denial assertion below is paired with
 * (a) a `MISSING_SKELETON` token proving the GATE, not the parser, refused it, and (b) a
 * HAPPY control on the SAME payload shape that exits 0.
 *
 * ⛔ SLICE-SCOPED ASSERTIONS: the pack renders `## Rule` (the discovered skill doc) and
 * `## Parent` (the `--parent`/`parent_id` doc) through the SAME seam, and the seeded
 * skill doc carries its own structured `extra.skill`. A whole-stdout `toContain` would
 * therefore pass on the RULE slice alone and prove nothing about the parent — the
 * over-matching face of the substring-matcher lesson (root CLAUDE.md). Every
 * parent-scoped assertion runs against `parentSlice()`. This also makes the negative
 * control strictly stronger: in the very same run, the rule slice DOES announce while the
 * plain parent's slice stays silent, so "no notice" can never be explained by "the
 * mechanism is dead".
 *
 * Coverage:
 *   HAPPY:      `lore feed spec-create --parent <doc with extra.requirements>` announces
 *               on the parent slice; the gate DENIAL pack announces there too
 *   NEGATIVE:   a parent with NO structured `extra` produces NO notice on either surface,
 *               in a run whose rule slice proves the mechanism is live
 *   BOUNDARY:   `lore feed spec-create` with NO `--parent` renders no parent slice at all
 *               and still announces on the rule slice
 *   ERROR:      an UNRESOLVABLE `--parent` degrades to no parent slice (never a crash,
 *               never a fabricated notice) — `buildFeed`'s advisory-only contract
 *   STATE:      an INVALIDATED parent keeps its SPEC-043 banner in the pack AND its notice
 *               omits `validity` (the banner already surfaced it)
 *   REGRESSION: `lore get`'s human render announces EXACTLY ONCE (the seam fix must not
 *               double-announce), `--json` gains no byte, and the gate HAPPY control
 *               still exits 0 with `gate: pass` and no pack
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");
const SEED_SCRIPT = join(PROJECT_ROOT, "..", "..", "scripts", "seed-write-spec-rule.ts");

/** The notice's two stable LONE tokens — asserted independently, never as one phrase. */
const NOTICE_MARKER = "structured";
const NOTICE_COMMAND_TOKEN = "show values";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1", LORE_ACTOR: "agent:render-seam-loss-notice" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

/** Runs a fixture step and fails LOUD — a silently-failed write makes every assertion vacuous. */
function mustRun(args: string[], cwd: string): RunResult {
  const result = runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`fixture step failed (exit ${result.exitCode}): lore ${args.join(" ")}\n${result.stderr}`);
  }
  return result;
}

function parseSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from output: ${stdout}`);
  return slug;
}

/** The pack's `## Parent` slice, or `""` when the pack rendered no parent at all. */
function parentSlice(stdout: string): string {
  const index = stdout.indexOf("## Parent");
  return index === -1 ? "" : stdout.slice(index);
}

/** The pack's `## Rule` slice, bounded by `## Parent` when one follows. */
function ruleSlice(stdout: string): string {
  const start = stdout.indexOf("## Rule");
  if (start === -1) return "";
  const end = stdout.indexOf("## Parent");
  return end === -1 ? stdout.slice(start) : stdout.slice(start, end);
}

/** Number of loss notices in `text` — >1 on `lore get` would be the double-announce trap. */
function noticeCount(text: string): number {
  return text.split(NOTICE_COMMAND_TOKEN).length - 1;
}

/** A SCHEMA-VALID spec candidate whose only defect is the gate's skeleton predicate. */
function denyPayload(parentIdOrSlug: string): string {
  return JSON.stringify({
    type: "spec",
    title: "Seam gate probe spec",
    // reason: BR-2 - a spec takes no parent, so a payload that names one is refused by the gate too;
    // the denial pack still quotes that parent's slice, which is what this suite probes.
    parent_id: parentIdOrSlug,
    content: "just prose with no level-two heading at all",
    extra: { spec_kind: "tech" },
  });
}

/** The SAME payload shape, compliant and parentless (BR-1) - the HAPPY control that must exit 0. */
function passPayload(_parentIdOrSlug: string): string {
  return JSON.stringify({
    type: "spec",
    title: "Seam gate probe spec",
    content: "## Overview\n\nSome text.\n\n## Scope\n\nIn scope.\n\n## Acceptance Criteria\n\n- AC1\n",
    extra: { spec_kind: "tech" },
  });
}

let tmpDir: string;
let prdWithExtra: string;
let prdPlain: string;
let prdWithExtraId: string;
let prdPlainId: string;
let retractedSlug: string;
let prdLong: string;
let prdLongPlain: string;

/** A body comfortably past `service/gate-feeding.ts::DEFAULT_FEEDING_MAX_CHARS` (800). */
const LONG_BODY = "## Overview\n\n" + "Filler prose standing in for a real multi-KB spec body.\n".repeat(40);

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-render-seam-"));
  mustRun(["init"], tmpDir);

  const seed = Bun.spawnSync(["bun", "run", SEED_SCRIPT], { cwd: tmpDir, env: { ...process.env, HOME: tmpDir } });
  if (seed.exitCode !== 0) throw new Error(`seed-write-spec-rule failed: ${seed.stderr.toString()}`);

  prdWithExtra = parseSlug(
    mustRun(["create", "prd", "--title", "Seam Root With Extra", "--no-ai", "--content", "## Overview\n\nRoot body."], tmpDir).stdout,
  );
  prdPlain = parseSlug(
    mustRun(["create", "prd", "--title", "Seam Root Plain", "--no-ai", "--content", "## Overview\n\nPlain body."], tmpDir).stdout,
  );

  // REAL dedicated writer → authentic `extra.requirements` on a LEGAL prd parent.
  mustRun(["requirement", "add", prdWithExtra, "R-1", "--statement", "The seam announces withheld structured extra.", "--priority", "P0"], tmpDir);
  mustRun(["requirement", "add", prdWithExtra, "R-2", "--statement", "A plain doc announces nothing.", "--priority", "P1"], tmpDir);

  prdLong = parseSlug(mustRun(["create", "prd", "--title", "Seam Root Long", "--no-ai", "--content", LONG_BODY], tmpDir).stdout);
  prdLongPlain = parseSlug(mustRun(["create", "prd", "--title", "Seam Root Long Plain", "--no-ai", "--content", LONG_BODY], tmpDir).stdout);
  mustRun(["requirement", "add", prdLong, "R-1", "--statement", "A long doc still announces.", "--priority", "P0"], tmpDir);

  const plan = parseSlug(mustRun(["create", "plan", "--title", "Seam Plan", "--no-ai", "--parent", prdWithExtra, "--content", "Plan body."], tmpDir).stdout);
  retractedSlug = parseSlug(
    mustRun(["handoff", "--decision", "seam probe decision@0.9", "--next", "seam probe next", "--plan", plan], tmpDir).stdout,
  );
  mustRun(["invalidate", retractedSlug, "--reason", "seam probe retraction"], tmpDir);

  // ── Fixture verification — read through `--json`, the surface this feature must not touch.
  const withExtra = JSON.parse(mustRun(["get", prdWithExtra, "--json"], tmpDir).stdout).data.doc;
  const plain = JSON.parse(mustRun(["get", prdPlain, "--json"], tmpDir).stdout).data.doc;
  prdWithExtraId = withExtra.id;
  prdPlainId = plain.id;
  if (!Array.isArray(withExtra.extra.requirements) || withExtra.extra.requirements.length !== 2) {
    throw new Error(`fixture prd lacks the expected extra.requirements: ${JSON.stringify(withExtra.extra)}`);
  }
  const plainStructuredKeys = Object.keys(plain.extra).filter((k) => plain.extra[k] !== null && typeof plain.extra[k] === "object");
  if (plainStructuredKeys.length > 0) {
    throw new Error(`negative-control prd unexpectedly carries structured extra: ${plainStructuredKeys.join(", ")}`);
  }
});

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

// ─── Fixture identity guard (⛔ FULL id vs PARSED id, never a rendered column) ───

describe("fixture identity", () => {
  it("the two probe PRDs are DISTINCT docs whose ULIDs share a long prefix", () => {
    expect(prdWithExtraId).not.toBe(prdPlainId);
    // Burst-created ULIDs are time-ordered, so a TRUNCATED column would collide — which
    // is why every identity assertion in this file compares the FULL parsed `id`, never a
    // rendered column. Bound is 6 chars, not a measured value: ULID timestamp char 6
    // advances roughly every 17 minutes, so it cannot flake inside one fixture build,
    // while chars 7+ turn over in seconds and MUST NOT be asserted equal.
    let shared = 0;
    while (shared < prdWithExtraId.length && prdWithExtraId[shared] === prdPlainId[shared]) shared += 1;
    expect(shared).toBeGreaterThanOrEqual(6);
  });
});

// ─── HAPPY: `lore feed` ─────────────────────────────────────────────────────

describe("lore feed spec-create — HAPPY (the pack announces withheld structured extra)", () => {
  it("names the withheld key, its shape and the --json command on the PARENT slice", () => {
    const result = runLore(["feed", "spec-create", "--parent", prdWithExtra], tmpDir);
    expect(result.exitCode).toBe(0);

    const slice = parentSlice(result.stdout);
    expect(slice).not.toBe("");
    expect(slice).toContain("requirements");
    expect(slice).toContain(NOTICE_MARKER);
    expect(slice).toContain(NOTICE_COMMAND_TOKEN);
    expect(slice).toContain("--json");
    expect(slice).toContain(prdWithExtra);
    expect(slice).toContain("2 item(s)");
    // Shape and key NAMES only — never the values.
    expect(slice).not.toContain("The seam announces withheld structured extra.");
  });

  it("the RULE slice announces the skill doc's own structured extra too", () => {
    const result = runLore(["feed", "spec-create", "--parent", prdWithExtra], tmpDir);
    const slice = ruleSlice(result.stdout);
    expect(slice).toContain(NOTICE_COMMAND_TOKEN);
    expect(slice).toContain("skill");
  });

  it("--json carries the same announced pack in its feed field", () => {
    const result = runLore(["feed", "spec-create", "--parent", prdWithExtra, "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    // `lore feed --json` emits the FeedOutcome at the top level (no ok/data envelope).
    const payload = JSON.parse(result.stdout);
    expect(payload.checkpoint).toBe("spec-create");
    expect(payload.feed).toContain(NOTICE_COMMAND_TOKEN);
    expect(parentSlice(payload.feed)).toContain("requirements");
  });
});

// ─── NEGATIVE control: `lore feed` ──────────────────────────────────────────

describe("lore feed spec-create — NEGATIVE control (a plain parent announces nothing)", () => {
  it("the parent slice is silent while the SAME run's rule slice announces", () => {
    const result = runLore(["feed", "spec-create", "--parent", prdPlain], tmpDir);
    expect(result.exitCode).toBe(0);

    const parent = parentSlice(result.stdout);
    expect(parent).not.toBe(""); // the parent WAS rendered — silence is about `extra`, not absence
    expect(parent).toContain("Plain body.");
    expect(parent).not.toContain(NOTICE_COMMAND_TOKEN);
    expect(parent).not.toContain(NOTICE_MARKER);
    // Live-mechanism control: an always-appending fix and a dead one are distinguishable here.
    expect(ruleSlice(result.stdout)).toContain(NOTICE_COMMAND_TOKEN);
  });
});

// ─── GATE — the sharp end: a REAL refused write with a VALID payload ─────────

describe("lore gate spec-create — HAPPY (the DENIAL pack announces)", () => {
  it("a schema-VALID payload refused by the gate predicate feeds back an announcing parent slice", () => {
    const result = runLore(["gate", "spec-create", "--input-json", denyPayload(prdWithExtra)], tmpDir);

    // Proof the GATE refused it, not the input parser: exit 4 + a predicate reason + a pack.
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain("MISSING_SKELETON");
    expect(result.stdout).toContain("[source:");
    expect(result.stdout).toContain("## Rule");

    const slice = parentSlice(result.stdout);
    expect(slice).toContain("requirements");
    expect(slice).toContain(NOTICE_MARKER);
    expect(slice).toContain(NOTICE_COMMAND_TOKEN);
    expect(slice).toContain(prdWithExtra);
  });

  it("REGRESSION: the HAPPY control on the SAME payload shape still passes with no pack", () => {
    const result = runLore(["gate", "spec-create", "--input-json", passPayload(prdWithExtra)], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("gate: pass");
    expect(result.stdout).not.toContain("## Rule");
    expect(result.stdout).not.toContain(NOTICE_COMMAND_TOKEN);
  });

  it("NEGATIVE control: the same denial against a plain parent announces nothing on that slice", () => {
    const result = runLore(["gate", "spec-create", "--input-json", denyPayload(prdPlain)], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain("MISSING_SKELETON");
    const parent = parentSlice(result.stdout);
    expect(parent).toContain("Plain body.");
    expect(parent).not.toContain(NOTICE_COMMAND_TOKEN);
    expect(ruleSlice(result.stdout)).toContain(NOTICE_COMMAND_TOKEN);
  });
});

// ─── BOUNDARY: the production-sized doc (the case a short fixture hides) ────

describe("lore feed / gate — BOUNDARY (a doc longer than the pack's leading-slice budget)", () => {
  it("the notice survives the 800-char truncation on BOTH surfaces", () => {
    // A short-fixture-only suite would pass with the notice welded BELOW the body and
    // stay silent for every real (multi-KB) spec/PRD — the false-oracle shape this task
    // exists to close. This case is the one that fails if the placement regresses.
    const feed = runLore(["feed", "spec-create", "--parent", prdLong], tmpDir);
    expect(feed.exitCode).toBe(0);
    const feedParent = parentSlice(feed.stdout);
    expect(feedParent).toContain("…[truncated]"); // the slice really was cut
    expect(feedParent).toContain(NOTICE_COMMAND_TOKEN);
    expect(feedParent).toContain("requirements");
    expect(feedParent).toContain(prdLong);

    const gate = runLore(["gate", "spec-create", "--input-json", denyPayload(prdLong)], tmpDir);
    expect(gate.exitCode).toBe(4);
    expect(gate.stdout).toContain("MISSING_SKELETON");
    const gateParent = parentSlice(gate.stdout);
    expect(gateParent).toContain("…[truncated]");
    expect(gateParent).toContain(NOTICE_COMMAND_TOKEN);
    expect(gateParent).toContain("requirements");
  });

  it("NEGATIVE control: an equally long doc with NO structured extra still announces nothing", () => {
    const feed = runLore(["feed", "spec-create", "--parent", prdLongPlain], tmpDir);
    expect(feed.exitCode).toBe(0);
    const slice = parentSlice(feed.stdout);
    expect(slice).toContain("…[truncated]");
    expect(slice).not.toContain(NOTICE_COMMAND_TOKEN);
    expect(slice).not.toContain(NOTICE_MARKER);
  });
});

// ─── BOUNDARY / ERROR ───────────────────────────────────────────────────────

describe("lore feed spec-create — BOUNDARY / ERROR (no parent slice to announce on)", () => {
  it("BOUNDARY: no --parent renders no parent slice and still announces on the rule slice", () => {
    const result = runLore(["feed", "spec-create"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(parentSlice(result.stdout)).toBe("");
    expect(ruleSlice(result.stdout)).toContain(NOTICE_COMMAND_TOKEN);
  });

  it("ERROR: an unresolvable --parent degrades to no parent slice, never a fabricated notice", () => {
    const result = runLore(["feed", "spec-create", "--parent", "no-such-doc-at-all"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(parentSlice(result.stdout)).toBe("");
    expect(result.stdout).not.toContain("no-such-doc-at-all");
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("lore feed spec-create — STATE (an invalidated parent keeps its banner)", () => {
  it("the banner renders in the pack and the notice omits the banner-backed validity", () => {
    const result = runLore(["feed", "spec-create", "--parent", retractedSlug], tmpDir);
    expect(result.exitCode).toBe(0);

    const slice = parentSlice(result.stdout);
    const bannerIndex = slice.indexOf("INVALIDATED");
    const noticeIndex = slice.indexOf(NOTICE_COMMAND_TOKEN);
    expect(bannerIndex).toBeGreaterThan(-1);
    // The retraction banner keeps SPEC-043's lead; the notice follows it, still ahead of
    // the body so the pack's 800-char leading slice cannot cut either annotation.
    expect(noticeIndex).toBeGreaterThan(bannerIndex);

    const inventory = slice.slice(slice.indexOf(NOTICE_MARKER), noticeIndex);
    expect(inventory).toContain("handoff");
    expect(inventory).not.toContain("validity");
  });
});

// ─── REGRESSION: `lore get` must not double-announce ────────────────────────

describe("lore get — REGRESSION (the seam fix does not double-announce)", () => {
  it("the human render carries EXACTLY ONE notice", () => {
    const result = runLore(["get", prdWithExtra], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(noticeCount(result.stdout)).toBe(1);
    expect(result.stdout).toContain("requirements");
  });

  it("--raw also carries EXACTLY ONE notice", () => {
    const result = runLore(["get", prdWithExtra, "--raw"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(noticeCount(result.stdout)).toBe(1);
  });

  it("a plain doc still emits NO notice at all", () => {
    const result = runLore(["get", prdPlain], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(noticeCount(result.stdout)).toBe(0);
    expect(result.stdout).not.toContain(NOTICE_MARKER);
  });

  it("--json stdout is exactly a pretty-printed JSON document — nothing appended", () => {
    const { stdout, exitCode } = runLore(["get", prdWithExtra, "--json"], tmpDir);
    expect(exitCode).toBe(0);
    expect(stdout).toBe(`${JSON.stringify(JSON.parse(stdout), null, 2)}\n`);
    expect(stdout).not.toContain(NOTICE_COMMAND_TOKEN);
    expect(JSON.parse(stdout).data.doc.id).toBe(prdWithExtraId);
  });
});
