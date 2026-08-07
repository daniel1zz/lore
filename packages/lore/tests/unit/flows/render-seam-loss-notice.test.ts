/**
 * The SHARED `renderDocMarkdown` seam announces withheld structured `extra`
 * (task-the-shared-renderdocmarkdown-seam-still-drops-structured).
 *
 * The defect under test: the structured-`extra` loss notice shipped on ONE consumer
 * (`commands/get.ts`), while the seam those consumers share —
 * `flows/feed-flow.ts::renderDocMarkdown` — kept returning an unannotated projection.
 * Every OTHER consumer (`lore feed`'s advisory pack, and — the sharp end — the feeding
 * pack pushed back with a GATE DENIAL) therefore handed a MACHINE reader a body with
 * structured `extra` silently dropped, at the exact moment that reader is mid-write and
 * acting on the pack alone. Measured on the pre-fix binary: `lore feed spec-create
 * --parent <doc carrying extra.requirements>` and `lore gate spec-create` (exit 4)
 * both emitted ZERO occurrences of the notice while `lore get` on the SAME doc emitted one.
 *
 * Unit under test is the seam itself, exercised against a stub `App` whose
 * `outlineService` returns controlled resolve/banner outcomes — so this file proves the
 * seam APPENDS, and the sibling `tests/integration/render-seam-structured-extra.bun.test.ts`
 * proves it actually REACHES `feed`/`gate` stdout (a pure suite alone would pass against a
 * seam nobody calls — the silently-inert false-oracle vector, root CLAUDE.md).
 *
 * ⛔ Assertions key on INDEPENDENT LONE TOKENS (`requirements`, `show values`, `--json`,
 * the slug), never one remembered sentence — a contiguous-substring matcher degrades
 * silently to no-match when wording is reflowed (root CLAUDE.md standing lesson).
 *
 * Coverage:
 *   HAPPY:      `renderDocMarkdown` appends the notice below the body it just rendered
 *   NEGATIVE:   a doc whose `extra` holds no STRUCTURED value gets NO appended byte — the
 *               vacuity guard; an always-appending seam would satisfy HAPPY for free
 *   BOUNDARY:   an EMPTY rendered body yields the notice with no leading blank run;
 *               `appendStructuredExtraNotice` is a no-op on an absent notice
 *   ERROR:      an MDX resolution FAILURE still announces (the seam degrades the body to
 *               `doc.content` but the `extra` loss is unrelated to that degradation)
 *   STATE:      an invalidated doc keeps its SPEC-043 banner FIRST and does NOT list
 *               `validity` (the banner already surfaced it); a spec's projected
 *               `acceptance_criteria` / `code_anchors` are likewise excluded
 *   REGRESSION: `renderDocBodyWithoutLossNotice` — the ONE deliberately non-announcing
 *               entry point, which `commands/get.ts` uses so it can interpose its
 *               `(no content)` placeholder — appends NOTHING, and the two entry points
 *               agree byte-for-byte whenever no notice is due
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  renderDocMarkdown,
  renderDocBodyWithoutLossNotice,
} from "../../../src/flows/feed-flow.js";
import { composeWithStructuredExtraNotice, type RenderedBodyFacts } from "../../../src/adapters/cli/get-render.js";
import { DEFAULT_FEEDING_MAX_CHARS } from "../../../src/service/gate-feeding.js";
import type { App } from "../../../src/app.js";
import type { DocRecord, Slug } from "@lore/core";

const FEED_FLOW_PATH = new URL("../../../src/flows/feed-flow.ts", import.meta.url).pathname;
const GET_COMMAND_PATH = new URL("../../../src/adapters/cli/commands/get.ts", import.meta.url).pathname;

const NOW_ISO = "2026-08-07T00:00:00.000Z";
const PAST_ISO = "2026-07-01T00:00:00.000Z";

/** The notice's two stable LONE tokens — asserted independently, never as one phrase. */
const NOTICE_MARKER = "structured";
const NOTICE_COMMAND_TOKEN = "show values";

function makeDoc(slug: string, content: string, extra: Record<string, unknown>): DocRecord {
  return {
    id: "01K000000000000000000DOC",
    slug: slug as Slug,
    type: "task",
    title: "Seam subject",
    content,
    status: "draft",
    priority: "medium",
    version: 1,
    tags: [],
    extra,
    parent_id: null,
    created_at: PAST_ISO,
    updated_at: PAST_ISO,
    created_by: "tester",
    deleted_at: null,
  } as unknown as DocRecord;
}

interface StubOpts {
  /** `false` makes `outlineService.resolve` fail, exercising the seam's degrade path. */
  readonly resolveOk?: boolean;
  /** Banner string the SPEC-043 D4 renderer returns; `undefined` = doc is live. */
  readonly banner?: string;
  readonly acceptanceCriteriaProjected?: boolean;
  readonly codeAnchorsProjected?: boolean;
}

/**
 * Minimal `App` carrying only what {@link renderDocMarkdown} reads. Cast at the boundary
 * because the seam's own signature is the contract under test — widening `App` for a test
 * double would weaken the very type this proves.
 */
function stubApp(opts: StubOpts = {}): App {
  const resolveOk = opts.resolveOk ?? true;
  return {
    outlineService: {
      resolve: async (doc: DocRecord) =>
        resolveOk
          ? {
              ok: true as const,
              value: {
                content: doc.content,
                resolvedComponents: [],
                warnings: [],
                ...(opts.acceptanceCriteriaProjected === true
                  ? { acceptanceCriteria: { criteria: [], coverage: [] } }
                  : {}),
                ...(opts.codeAnchorsProjected === true ? { codeAnchors: ["src/x.ts"] } : {}),
              },
            }
          : { ok: false as const, error: { code: "STORE_ERROR", message: "resolve blew up" } },
      resolveValidityBanner: async () => opts.banner,
    },
  } as unknown as App;
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("renderDocMarkdown — HAPPY (the shared seam announces)", () => {
  it("appends a notice naming the withheld key, its shape and the exact --json command", async () => {
    const doc = makeDoc("task-seam-happy", "Body sentinel.", {
      plan_id: "01K000000000000000000PLN",
      requirements: [{ id: "R-1", statement: "s" }],
    });
    const out = await renderDocMarkdown(stubApp(), doc, () => NOW_ISO);

    expect(out).toContain("Body sentinel.");
    expect(out).toContain("requirements");
    expect(out).toContain(NOTICE_MARKER);
    expect(out).toContain(NOTICE_COMMAND_TOKEN);
    expect(out).toContain("--json");
    expect(out).toContain("task-seam-happy");
    // Shape summary only — never the values.
    expect(out).toContain("1 item(s)");
    expect(out).not.toContain("R-1");
  });

  it("places the notice ABOVE the body so an 800-char leading slice cannot cut it", async () => {
    const longBody = "Body sentinel.\n\n" + "filler line to blow past the feeding-pack budget.\n".repeat(40);
    const doc = makeDoc("task-seam-order", longBody, { file_anchors: ["a.ts"] });
    const out = await renderDocMarkdown(stubApp(), doc, () => NOW_ISO);

    expect(out.indexOf(NOTICE_COMMAND_TOKEN)).toBeLessThan(out.indexOf("Body sentinel."));
    // The real constraint, asserted against the real budget rather than a remembered one:
    // the notice must survive `gate-feeding.ts`'s DEFAULT_FEEDING_MAX_CHARS leading slice.
    expect(longBody.length).toBeGreaterThan(DEFAULT_FEEDING_MAX_CHARS);
    expect(out.slice(0, DEFAULT_FEEDING_MAX_CHARS)).toContain(NOTICE_COMMAND_TOKEN);
    expect(out.slice(0, DEFAULT_FEEDING_MAX_CHARS)).toContain("file_anchors");
  });

  it("says NOT shown BELOW when it leads the body — the preposition tracks the placement", async () => {
    const doc = makeDoc("task-seam-preposition", "Body sentinel.", { file_anchors: ["a.ts"] });
    const out = await renderDocMarkdown(stubApp(), doc, () => NOW_ISO);
    expect(out).toContain("NOT shown below");
    expect(out).not.toContain("NOT shown above");
  });

  it("announces a key nobody has written yet — the seam is key-AGNOSTIC", async () => {
    const doc = makeDoc("task-seam-future", "Body.", { a_key_invented_after_this_test: { alpha: 1 } });
    const out = await renderDocMarkdown(stubApp(), doc, () => NOW_ISO);
    expect(out).toContain("a_key_invented_after_this_test");
    expect(out).toContain("alpha");
    expect(out).not.toContain("1,");
  });
});

// ─── NEGATIVE (the vacuity guard) ───────────────────────────────────────────

describe("renderDocMarkdown — NEGATIVE control (no structured extra ⇒ no appended byte)", () => {
  it("a scalars-only extra bag leaves the body byte-identical", async () => {
    const doc = makeDoc("task-seam-scalars", "Body sentinel.", {
      plan_id: "01K000000000000000000PLN",
      phase: "P1",
      red_first: true,
    });
    const out = await renderDocMarkdown(stubApp(), doc, () => NOW_ISO);
    expect(out).toBe("Body sentinel.");
    expect(out).not.toContain(NOTICE_MARKER);
    expect(out).not.toContain(NOTICE_COMMAND_TOKEN);
  });

  it("an empty extra bag leaves the body byte-identical", async () => {
    const doc = makeDoc("task-seam-empty-bag", "Body sentinel.", {});
    expect(await renderDocMarkdown(stubApp(), doc, () => NOW_ISO)).toBe("Body sentinel.");
  });

  it("EMPTY containers announce nothing — nothing is being withheld", async () => {
    const doc = makeDoc("task-seam-empty-containers", "Body sentinel.", { file_anchors: [], handoff: {} });
    expect(await renderDocMarkdown(stubApp(), doc, () => NOW_ISO)).toBe("Body sentinel.");
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("composeWithStructuredExtraNotice — BOUNDARY", () => {
  const RESOLVED: RenderedBodyFacts = {
    mdxResolved: true,
    acceptanceCriteriaProjected: false,
    codeAnchorsProjected: false,
    nowIso: NOW_ISO,
  };

  it("an EMPTY body yields the notice alone — no stray blank run on either side", () => {
    const doc = makeDoc("task-seam-empty-body", "", { file_anchors: ["a.ts"] });
    for (const placement of ["below-body", "above-body"] as const) {
      const out = composeWithStructuredExtraNotice("", doc, RESOLVED, placement);
      expect(out.startsWith("\n")).toBe(false);
      expect(out.endsWith("\n")).toBe(false);
      expect(out).toContain(NOTICE_COMMAND_TOKEN);
    }
  });

  it("returns the body UNCHANGED when no notice is due, on BOTH placements", () => {
    const doc = makeDoc("task-seam-none", "Body sentinel.", { plan_id: "x" });
    for (const placement of ["below-body", "above-body"] as const) {
      expect(composeWithStructuredExtraNotice("Body sentinel.", doc, RESOLVED, placement)).toBe("Body sentinel.");
      expect(composeWithStructuredExtraNotice("", doc, RESOLVED, placement)).toBe("");
    }
  });

  it("welds on the named side, separated by exactly one blank line", () => {
    const doc = makeDoc("task-seam-sep", "Body sentinel.", { file_anchors: ["a.ts"] });
    expect(composeWithStructuredExtraNotice("Body sentinel.", doc, RESOLVED, "below-body").startsWith("Body sentinel.\n\n⚠")).toBe(true);
    expect(composeWithStructuredExtraNotice("Body sentinel.", doc, RESOLVED, "above-body").endsWith("\n\nBody sentinel.")).toBe(true);
  });

  it("the two placements differ ONLY in the preposition and the weld side", () => {
    const doc = makeDoc("task-seam-parity", "Body sentinel.", { handoff: { decisions: ["d"] } });
    const below = composeWithStructuredExtraNotice("Body sentinel.", doc, RESOLVED, "below-body");
    const above = composeWithStructuredExtraNotice("Body sentinel.", doc, RESOLVED, "above-body");
    expect(below.replace("Body sentinel.\n\n", "").replace("NOT shown above", "NOT shown X")).toBe(
      above.replace("\n\nBody sentinel.", "").replace("NOT shown below", "NOT shown X"),
    );
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("renderDocMarkdown — ERROR (resolution failure still announces)", () => {
  it("a failed MDX resolve degrades the body but never silences the loss notice", async () => {
    const doc = makeDoc("task-seam-resolve-fail", "Raw stored body.", { file_anchors: ["a.ts"] });
    const out = await renderDocMarkdown(stubApp({ resolveOk: false }), doc, () => NOW_ISO);
    expect(out).toContain("Raw stored body.");
    expect(out).toContain("file_anchors");
    expect(out).toContain(NOTICE_COMMAND_TOKEN);
  });

  it("a failed resolve announces acceptance_criteria / code_anchors — no block was projected", async () => {
    const doc = makeDoc("spec-seam-resolve-fail", "Raw stored body.", {
      acceptance_criteria: [{ id: "AC-1" }],
      code_anchors: ["src/a.ts"],
    });
    const out = await renderDocMarkdown(stubApp({ resolveOk: false }), doc, () => NOW_ISO);
    expect(out).toContain("acceptance_criteria");
    expect(out).toContain("code_anchors");
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("renderDocMarkdown — STATE (exclusions derive from what THIS render surfaced)", () => {
  const INVALIDATED_EXTRA = {
    validity: { invalid_at: PAST_ISO, reason: "obsolete" },
    handoff: { decisions: ["d"], next_steps: ["n"] },
  };

  it("order is banner → notice → body, and validity is NOT listed as withheld", async () => {
    const doc = makeDoc("knowledge-seam-invalid", "Body sentinel.", INVALIDATED_EXTRA);
    const out = await renderDocMarkdown(stubApp({ banner: "⚠ INVALIDATED probe banner" }), doc, () => NOW_ISO);

    // The retraction banner keeps SPEC-043's lead — the notice never displaces it.
    expect(out.startsWith("⚠ INVALIDATED probe banner")).toBe(true);
    expect(out.indexOf(NOTICE_COMMAND_TOKEN)).toBeGreaterThan(out.indexOf("INVALIDATED"));
    expect(out.indexOf(NOTICE_COMMAND_TOKEN)).toBeLessThan(out.indexOf("Body sentinel."));

    const inventory = out.slice(out.indexOf(NOTICE_MARKER), out.indexOf(NOTICE_COMMAND_TOKEN));
    expect(inventory).toContain("handoff");
    expect(inventory).not.toContain("validity");
  });

  it("a spec whose AC / code-anchor blocks projected announces neither", async () => {
    const doc = makeDoc("spec-seam-projected", "Body sentinel.", {
      acceptance_criteria: [{ id: "AC-1" }],
      code_anchors: ["src/a.ts"],
      requirements: [{ id: "R-1" }],
    });
    const out = await renderDocMarkdown(
      stubApp({ acceptanceCriteriaProjected: true, codeAnchorsProjected: true }),
      doc,
      () => NOW_ISO,
    );
    const inventory = out.slice(out.indexOf(NOTICE_MARKER), out.indexOf(NOTICE_COMMAND_TOKEN));
    expect(inventory).toContain("requirements");
    expect(inventory).not.toContain("acceptance_criteria");
    expect(inventory).not.toContain("code_anchors");
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("renderDocBodyWithoutLossNotice — REGRESSION (the one non-announcing entry point)", () => {
  it("appends NOTHING even when structured extra is withheld", async () => {
    const doc = makeDoc("task-seam-bodyonly", "Body sentinel.", { file_anchors: ["a.ts"] });
    const out = await renderDocBodyWithoutLossNotice(stubApp(), doc, () => NOW_ISO);
    expect(out).toBe("Body sentinel.");
    expect(out).not.toContain(NOTICE_COMMAND_TOKEN);
  });

  it("agrees byte-for-byte with the seam whenever no notice is due", async () => {
    const doc = makeDoc("task-seam-agree", "Body sentinel.", { plan_id: "x" });
    const app = stubApp({ banner: "⚠ INVALIDATED probe banner" });
    expect(await renderDocBodyWithoutLossNotice(app, doc, () => NOW_ISO)).toBe(
      await renderDocMarkdown(app, doc, () => NOW_ISO),
    );
  });
});

/**
 * Drops comment-only lines so a source-text wiring assertion keys on CODE.
 *
 * reason: these modules document their own invariants by quoting the identifiers under
 * test (`… contains no renderDocMarkdown( call …`), so a raw whole-file match would trip
 * on the very prose asserting the rule — a self-inflicted false RED.
 */
function codeLinesOf(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

describe("wiring — REGRESSION (no consumer double-announces)", () => {
  const feedFlowSource = readFileSync(FEED_FLOW_PATH, "utf8");
  const getSource = codeLinesOf(readFileSync(GET_COMMAND_PATH, "utf8"));

  it("the seam produces the notice from the ONE shipped formatter, never a second copy", () => {
    expect(codeLinesOf(feedFlowSource)).toContain("composeWithStructuredExtraNotice");
    expect(feedFlowSource).toContain("get-render.js");
    // A second implementation of the invariant is the SSOT violation this task exists to close.
    expect(feedFlowSource).not.toContain("field(s) present, values NOT shown");
  });

  it("commands/get.ts does NOT call the announcing seam — that is the double-announce trap", () => {
    expect(getSource).not.toMatch(/\brenderDocMarkdown\s*\(/);
    expect(getSource).toContain("renderDocBodyWithoutLossNotice");
  });

  it("get.ts still welds via the SHARED joiner, after the --json early return and before Navigation", () => {
    const jsonBranchIndex = getSource.indexOf("if (args.json)");
    const weldIndex = getSource.indexOf("composeWithStructuredExtraNotice(displayBody");
    const navigationIndex = getSource.indexOf("formatNavigation(navigation)");
    expect(jsonBranchIndex).toBeGreaterThan(-1);
    expect(weldIndex).toBeGreaterThan(jsonBranchIndex);
    expect(weldIndex).toBeLessThan(navigationIndex);
  });

  it("get.ts's weld sits inside no args.raw conditional — a raw read is equally blind", () => {
    const humanRenderSection = getSource.slice(
      getSource.indexOf("if (args.json)"),
      getSource.indexOf("formatNavigation(navigation)"),
    );
    expect(humanRenderSection).toContain("composeWithStructuredExtraNotice");
    expect(humanRenderSection).not.toMatch(/if\s*\(\s*!?\s*args\.raw\s*\)/);
  });

  it("⛔ renderDocBodyWithoutLossNotice has exactly ONE production caller", () => {
    // A second caller silently reintroduces the defect this task closed. Measured over
    // production sources only (tests legitimately import it to prove it stays silent).
    const hits = Bun_grepProductionCallers();
    expect(hits).toEqual(["packages/lore/src/adapters/cli/commands/get.ts"]);
  });
});

/**
 * Lists production (non-test) source files that CALL `renderDocBodyWithoutLossNotice`,
 * excluding its own definition site. Walks the source tree rather than shelling out, so
 * the assertion holds under any runner.
 */
function Bun_grepProductionCallers(): string[] {
  const SRC_ROOT = new URL("../../../src/", import.meta.url).pathname;
  const REPO_PREFIX = new URL("../../../../../", import.meta.url).pathname;
  const DEFINITION_FILE = "flows/feed-flow.ts";
  const { readdirSync, readFileSync } = require("node:fs") as typeof import("node:fs");
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}${entry.name}`;
      if (entry.isDirectory()) walk(`${full}/`);
      else if (entry.name.endsWith(".ts") && !full.endsWith(DEFINITION_FILE)) {
        if (/renderDocBodyWithoutLossNotice\s*\(/.test(readFileSync(full, "utf8"))) {
          hits.push(full.slice(REPO_PREFIX.length));
        }
      }
    }
  };
  walk(SRC_ROOT);
  return hits.sort();
}
