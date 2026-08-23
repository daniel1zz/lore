/**
 * RED scenario for `GhRunner`'s env-scrub contract (AC-GI-8,
 * spec-the-defect-channel-reaches-no-machine-but-its-own-github, risk R2:
 * "`gh` infers its target from GH_REPO / GH_HOST / GH_CONFIG_DIR / git
 * remote, all attacker-influencable"). `packages/lore/src/service/gh-runner.ts`
 * does NOT exist yet, by design — see the sibling gh-runner-auth.test.ts
 * header for the full dependency-injection contract this suite shares. Until
 * the paired task-skill-implement-ghrunner-as-the-single-gh-subprocess-seam
 * lands, this fails with "Cannot find module '.../gh-runner.js'" — a
 * missing-module failure, never a wrong-contract assertion.
 *
 * This is the one place AC-GI-8 is exercised (its own oracle command runs
 * only this file) — kept separate from gh-runner-auth.test.ts per this
 * spec's round-4 revision: "one AC covering [several things] can pass while
 * testing only [one]", the reason AC-GI-14 got its own file instead of
 * widening AC-GI-10.
 *
 * The assertion is deliberately ABSENCE of the four names as OWN PROPERTY
 * KEYS on the env object the injected `execFile` actually received — not
 * "the values look scrubbed" (e.g. overwritten with `""` or `undefined`
 * would still leave the key present and still leak intent/shape to `gh`,
 * and `in` on a plain object also probes the prototype chain, which is
 * irrelevant here since `NodeJS.ProcessEnv`-shaped objects are plain).
 */

import { describe, expect, it } from "vitest";

import { GhRunner } from "../../../src/service/gh-runner.js";

interface GhExecFileOptions {
  env: NodeJS.ProcessEnv;
  maxBuffer: number;
}

interface GhExecFileResult {
  stdout: string;
  stderr: string;
}

type GhExecFile = (args: readonly string[], options: GhExecFileOptions) => Promise<GhExecFileResult>;

/** The four names risk R2 names explicitly — AC-GI-8's own closed set. */
const SCRUBBED_ENV_VAR_NAMES = ["GH_REPO", "GH_HOST", "GH_CONFIG_DIR", "GH_ENTERPRISE_TOKEN"] as const;

describe("GhRunner env scrub (AC-GI-8, spec-the-defect-channel-reaches-no-machine-but-its-own-github)", () => {
  it("never forwards GH_REPO / GH_HOST / GH_CONFIG_DIR / GH_ENTERPRISE_TOKEN to the child, even when the parent env carries all four", async () => {
    const seededEnv: NodeJS.ProcessEnv = {
      PATH: "/usr/bin:/bin",
      GH_REPO: "attacker/repo",
      GH_HOST: "evil.example.com",
      GH_CONFIG_DIR: "/tmp/attacker-config",
      GH_ENTERPRISE_TOKEN: "leaked-token-should-never-reach-child",
      UNRELATED_VAR: "must-survive-scrub",
    };

    let capturedOptions: GhExecFileOptions | undefined;
    const execFile: GhExecFile = async (_args, options) => {
      capturedOptions = options;
      return { stdout: "{}", stderr: "" };
    };

    const runner = new GhRunner({ execFile, env: seededEnv });
    const result = await runner.run(["api", "user"]);

    expect(result.ok).toBe(true);
    expect(capturedOptions).toBeDefined();
    const childEnv = (capturedOptions as GhExecFileOptions).env;

    for (const name of SCRUBBED_ENV_VAR_NAMES) {
      expect(name in childEnv).toBe(false);
    }

    // Scrubbing must be surgical, not a wholesale env wipe: an unrelated
    // variable, and the seeded PATH itself, both survive.
    expect(childEnv.UNRELATED_VAR).toBe("must-survive-scrub");
    expect(childEnv.PATH).toBe("/usr/bin:/bin");

    // The Scope entry's "explicit maxBuffer" half of the same invocation.
    expect(typeof (capturedOptions as GhExecFileOptions).maxBuffer).toBe("number");
    expect((capturedOptions as GhExecFileOptions).maxBuffer).toBeGreaterThan(0);
  });
});
