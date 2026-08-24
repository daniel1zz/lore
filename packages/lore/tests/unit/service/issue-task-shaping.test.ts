/**
 * RED-first scenarios for `issue-task-shaping.ts` — the WRITE-time half of
 * GitHub issue ingest (D3): `githubIssueTaskSlug` (D1's rename-proof
 * identity key) and `toIssueTaskInput` (spec-a-github-filed-defect-must-be-
 * claimable-one-ingest-seam, AC-GR-6).
 *
 * `packages/lore/src/service/issue-task-shaping.ts` DOES NOT EXIST YET at
 * authoring time — this file's imports below ARE the contract the paired
 * implementation must satisfy (mirrors `resolution-projector.test.ts`'s own
 * RED-first convention in this same directory: the whole file is expected
 * to fail at MODULE RESOLUTION, not at an assertion, until the
 * implementation lands).
 *
 * ## AC-GR-6's pinned search space
 *
 * A property test generates AT LEAST 1000 cases with `repo_id` drawn from
 * `[1, 2^53-1]` (`Number.MAX_SAFE_INTEGER`) and issue number from
 * `[1, 10^6]`, asserting every `githubIssueTaskSlug` output satisfies
 * `slugSchema` and that no two distinct `(repo_id, number)` pairs collide.
 * PLUS the named adversarial case: `owner_a/repo` and `owner-a/repo` —
 * distinct GitHub repositories any underscore-to-hyphen slug sanitizer
 * would collide on — now yield distinct slugs because they carry distinct
 * repo ids, and the strings themselves never reach this function.
 *
 * No `fast-check`/property-testing library is added for this (none is a
 * dependency anywhere in this repo today, and `package.json` is outside
 * this task's file anchors) — a seeded `mulberry32` PRNG generates the
 * >=1000 cases deterministically, so the run is reproducible and never
 * flaky, without a new dependency.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * @spec_ref AC-GR-6 — spec-a-github-filed-defect-must-be-claimable-one-ingest-seam
 */

import { describe, expect, it } from "vitest";
import { assembleIssueBody, slugSchema, type IssueFrontMatterFields } from "@lore/core";

// ─── The module under test — DOES NOT EXIST YET; this import is the RED signal ──

import { githubIssueTaskSlug, toIssueTaskInput } from "../../../src/service/issue-task-shaping.js";
import type { GithubListedIssue } from "../../../src/service/github-intake-port.js";
import type { GithubIssueRef } from "../../../src/service/resolution-projector.js";

// ─── Deterministic seeded PRNG (public-domain mulberry32) — no new dependency ──

/**
 * A tiny, well-known seeded PRNG. Deterministic per `seed`: this test suite
 * never flakes and is fully reproducible from the seed alone, without
 * pulling in a property-testing library (`package.json` is outside this
 * task's file anchors, so adding a dependency is out of scope regardless).
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function nextRandom(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_REPO_ID = Number.MAX_SAFE_INTEGER; // 2^53 - 1
const MAX_ISSUE_NUMBER = 1_000_000;

function randomRepoId(rng: () => number): number {
  return Math.floor(rng() * MAX_REPO_ID) + 1; // [1, 2^53-1]
}

function randomIssueNumber(rng: () => number): number {
  return Math.floor(rng() * MAX_ISSUE_NUMBER) + 1; // [1, 10^6]
}

// ─── Fixtures for toIssueTaskInput ──────────────────────────────────────────

const FIELDS: IssueFrontMatterFields = {
  severity: "high",
  category: "regression",
  tags: ["cli", "github"],
  reporter_corpus: "~/lore",
  reporter_root_prd: "prd-lore",
  idempotency_key: "01HFIXTUREKEY00000000000A1",
};

function listedIssue(overrides: Partial<GithubListedIssue> = {}): GithubListedIssue {
  return {
    number: 7,
    title: "lore issues exits 4 against a GitHub-configured corpus",
    state: "open",
    body: assembleIssueBody(FIELDS, "Steps to reproduce...\n\nExpected 0, got 4."),
    ...overrides,
  };
}

function githubRef(overrides: Partial<GithubIssueRef> = {}): GithubIssueRef {
  return { repo: "acme/widget", issueNumber: 7, repo_id: 555, ...overrides };
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-GR-6 — githubIssueTaskSlug is total against slugSchema and injective
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-GR-6: githubIssueTaskSlug is total and injective over GitHub's namespace", () => {
  it("HAPPY: a representative (repo_id, number) pair produces the documented deterministic shape", () => {
    expect(githubIssueTaskSlug(12345, 7)).toBe("task-gh-12345-7");
  });

  it("BOUNDARY: the exact pinned range endpoints (repo_id=1/2^53-1, number=1/10^6) all satisfy slugSchema", () => {
    const boundaryPairs: Array<[number, number]> = [
      [1, 1],
      [1, MAX_ISSUE_NUMBER],
      [MAX_REPO_ID, 1],
      [MAX_REPO_ID, MAX_ISSUE_NUMBER],
    ];
    for (const [repoId, issueNumber] of boundaryPairs) {
      const slug = githubIssueTaskSlug(repoId, issueNumber);
      expect(slugSchema.safeParse(slug).success).toBe(true);
    }
  });

  it("HAPPY: >=1000 generated cases (seeded, reproducible) all satisfy slugSchema and never collide across distinct pairs", () => {
    const rng = mulberry32(0xa5a5a5a5);
    const CASE_COUNT = 2000; // comfortably clears the AC's ">= 1000" floor
    const seenSlugs = new Map<string, [number, number]>();
    let checked = 0;

    for (let i = 0; i < CASE_COUNT; i += 1) {
      const repoId = randomRepoId(rng);
      const issueNumber = randomIssueNumber(rng);
      const slug = githubIssueTaskSlug(repoId, issueNumber);

      // Every generated slug must satisfy the store's own format gate.
      expect(slugSchema.safeParse(slug).success).toBe(true);

      // Injectivity: a slug seen before must map back to the SAME pair —
      // a different pair producing the same string is the collision this
      // AC exists to catch. Falsifier: key the slug on a sanitized
      // owner/repo instead of (repo_id, number) and two distinct repos
      // (or two distinct issues sharing a mangled repo string) collide.
      const priorPair = seenSlugs.get(slug);
      if (priorPair !== undefined) {
        expect(priorPair).toEqual([repoId, issueNumber]);
      } else {
        seenSlugs.set(slug, [repoId, issueNumber]);
      }
      checked += 1;
    }

    expect(checked).toBeGreaterThanOrEqual(1000);
  });

  it("HAPPY (named adversarial case): owner_a/repo and owner-a/repo carry distinct repo ids and yield distinct slugs", () => {
    // owner_a/repo and owner-a/repo are two DISTINCT real GitHub repositories
    // that ANY underscore-to-hyphen slug sanitizer would collide on (D1's
    // rejected design) — but this function never sees either string, only
    // each repo's own numeric id, so the collision cannot occur here.
    // Falsifier: implement githubIssueTaskSlug by sanitizing an owner/repo
    // string instead of consuming repo_id directly, and these two collide.
    const ownerUnderscoreARepoId = 111_111; // "owner_a/repo"
    const ownerHyphenARepoId = 222_222; // "owner-a/repo"
    const slugA = githubIssueTaskSlug(ownerUnderscoreARepoId, 42);
    const slugB = githubIssueTaskSlug(ownerHyphenARepoId, 42);

    expect(slugA).not.toBe(slugB);
    expect(slugSchema.safeParse(slugA).success).toBe(true);
    expect(slugSchema.safeParse(slugB).success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// toIssueTaskInput — exercised here so a vitest run actually CALLS every
// exported symbol (a run never proves a symbol is exported unless a test
// calls it — root CLAUDE.md).
// ═══════════════════════════════════════════════════════════════════════════

describe("toIssueTaskInput: builds the CreateDocInput for one listed GitHub issue", () => {
  it("HAPPY: a well-formed listed issue becomes a claimable CreateDocInput carrying the six decoded fields plus the GitHub pointer", () => {
    const result = toIssueTaskInput(listedIssue(), githubRef(), "plan-x", "plan-x");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(result.value.type).toBe("task");
    expect(result.value.slug).toBe("task-gh-555-7");
    expect(result.value.parent_id).toBe("plan-x");

    const extra = result.value.extra as Record<string, unknown>;
    expect(extra["plan_id"]).toBe("plan-x");

    const issueReport = extra["issue_report"] as Record<string, unknown>;
    expect(issueReport["severity"]).toBe("high");
    expect(issueReport["category"]).toBe("regression");
    expect(issueReport["tags"]).toEqual(["cli", "github"]);
    expect(issueReport["reporter_corpus"]).toBe("~/lore");
    expect(issueReport["reporter_root_prd"]).toBe("prd-lore");
    expect(issueReport["idempotency_key"]).toBe("01HFIXTUREKEY00000000000A1");

    const github = issueReport["github"] as Record<string, unknown>;
    expect(github).toEqual({ repo: "acme/widget", number: 7, repo_id: 555 });
  });

  it("NEGATIVE: an issue body with no lore front matter at all is refused, never silently defaulted", () => {
    const result = toIssueTaskInput(
      listedIssue({ body: "Just a plain GitHub issue, no front matter." }),
      githubRef(),
      "plan-x",
      "plan-x",
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("ERROR: a corrupted front-matter block (delimiters present, invalid JSON) is reported, never thrown", () => {
    const corruptBody = "---\n{not valid json\n---\n\nSteps to reproduce.";

    expect(() => toIssueTaskInput(listedIssue({ body: corruptBody }), githubRef(), "plan-x", "plan-x")).not.toThrow();

    const result = toIssueTaskInput(listedIssue({ body: corruptBody }), githubRef(), "plan-x", "plan-x");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("BOUNDARY/STATE: a ref with no repo_id yet is refused rather than falling back to a rename-unsafe key (D1)", () => {
    const refWithNoRepoId: GithubIssueRef = { repo: "acme/widget", issueNumber: 7 };
    const result = toIssueTaskInput(listedIssue(), refWithNoRepoId, "plan-x", "plan-x");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") throw new Error("expected VALIDATION_ERROR");
    expect(result.error.field).toBe("ref.repo_id");
  });

  it("REGRESSION: toIssueTaskInput is deterministic — identical inputs yield an identical CreateDocInput", () => {
    const first = toIssueTaskInput(listedIssue(), githubRef(), "plan-x", "plan-x");
    const second = toIssueTaskInput(listedIssue(), githubRef(), "plan-x", "plan-x");
    expect(first).toEqual(second);
  });
});
