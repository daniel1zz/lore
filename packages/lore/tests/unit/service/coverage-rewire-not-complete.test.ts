// @reads packages/lore/src/adapters/cli/**
/**
 * AC-BCR-3: a change only to file X that makes an existing site in the UNCHANGED file Y reachable from more commands
 * leaves root coverage incomplete: `lore baseline coverage <root>` exits exactly 1 and lists each newly affected leaf
 * (with the fix for its pair). A per-changed-file check would miss it: Y did not change.
 *
 * Fixture: tests/helpers/coverage-mini-corpus.ts. X = commands/beta.ts (rewired to call `checkShared`), Y =
 * lib/shared.ts (holds the site, byte-identical before and after). Before the rewire only leaf A (`alpha`) reaches
 * the site and has it accounted for; after it leaf B (`beta`) reaches it too and does not.
 * Not vacuous: before the rewire the same corpus exits 0.
 *
 * @spec_ref spec-baseline-coverage-cannot-silently-regress-one-program#AC-BCR-3
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MINI_CLI, buildMiniCorpus, type MiniCorpus } from "../../helpers/coverage-mini-corpus";

const corpora: MiniCorpus[] = [];
afterEach(() => {
  for (const c of corpora.splice(0)) c.dispose();
});

const SHARED = `${MINI_CLI}/lib/shared.ts`;
const BETA = `${MINI_CLI}/commands/beta.ts`;
const SHARED_SITE = `${SHARED}#checkShared#ALPHA_BAD`;

describe("AC-BCR-3 rewiring an unchanged site to more commands is not complete", () => {
  it("editing only the caller makes the unchanged site reachable from leaf B: exit 1 naming leaf B", async () => {
    const c = await buildMiniCorpus();
    corpora.push(c);
    await c.mapAllSites(c.leafA, "alpha");
    await c.mapAllSites(c.leafB, "beta");

    const before = await c.run(["baseline", "coverage", c.root]);
    expect(before.exitCode, before.stdout + before.stderr).toBe(0);
    const sharedBefore = readFileSync(join(c.dir, SHARED), "utf8");

    // only X changes: beta now also calls checkShared
    c.writeSource(
      BETA,
      `import { checkOther } from "../lib/other.js";\nimport { checkShared } from "../lib/shared.js";\nexport default { run() { checkShared(); return checkOther(); } };\n`,
    );
    expect(readFileSync(join(c.dir, SHARED), "utf8")).toBe(sharedBefore);

    const after = await c.run(["baseline", "coverage", c.root]);
    expect(after.exitCode, after.stdout + after.stderr).toBe(1);
    expect(after.stdout).toContain(`${c.leafB}: INCOMPLETE`);
    expect(after.stdout).toContain(`gap          ${SHARED_SITE}`);
    expect(after.stdout).toContain(`lore baseline map ${c.leafB} --site ${SHARED_SITE}`);
    expect(after.stdout).toContain(`incomplete leaves (1): ${c.leafB}`);
    expect(after.stdout).toContain(`${c.leafA}: complete`);
  }, 180_000);
});
