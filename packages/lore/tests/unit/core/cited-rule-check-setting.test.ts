/**
 * BL-D3 (baseline-close-a-plan BR-226) — the cited-rule check at plan close is switched by a setting
 * NAMED FOR IT: `workflow.gates."plan-close".cited_rule_check.enabled`. The borrowed name
 * `prd_sync` (the retired outline-sync predicate's switch) is migrated ONCE, loudly:
 *
 *   - `loadConfig(dir, warn)` rewrites the file in place (key renamed, value and comments kept) and
 *     hands `warn` ONE line naming both keys; the next load is silent (one-time).
 *   - both names present -> VALIDATION_ERROR naming both, file untouched (no silent precedence).
 *   - no `warn` channel to carry the notice -> VALIDATION_ERROR, file untouched (never a silent rewrite).
 *   - `loadConfigFromString` (pure) never reads the old name: VALIDATION_ERROR naming the new one.
 *   - the setting is read from ONE source: `resolveCitedRuleCheckEnabled`, consumed by
 *     `GateEnforcer.isCitedRuleCheckEnabled`.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION. Every `it()` title carries `D3-n`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as core from "@lore/core";
import { loadConfig } from "@lore/core/node";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";

const OLD_YAML = `project:
  name: "t"
  author: "a"
workflow:
  gates:
    plan-close:
      # keep this comment
      prd_sync:
        enabled: true
`;

const NOTICE =
  'lore: workflow.gates."plan-close".prd_sync was renamed to workflow.gates."plan-close".cited_rule_check ' +
  "and this config was rewritten in place (enabled: true kept); the old name is no longer read.";

let dir: string;
let configPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-cited-rule-check-"));
  mkdirSync(join(dir, ".lore"), { recursive: true });
  configPath = join(dir, ".lore", "config.yaml");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function loadCollecting(): { result: ReturnType<typeof loadConfig>; lines: string[] } {
  const lines: string[] = [];
  return { result: loadConfig(dir, (l) => lines.push(l)), lines };
}

describe("the cited-rule check has a setting named for it (D3)", () => {
  it("D3-1 HAPPY: the new name turns the check on, read through the one resolver", () => {
    writeFileSync(configPath, OLD_YAML.replace("prd_sync", "cited_rule_check"));
    const { result, lines } = loadCollecting();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(lines).toEqual([]);
    expect((core as Record<string, unknown>)["resolveCitedRuleCheckEnabled"]).toBeTypeOf("function");
    const resolve = (core as unknown as { resolveCitedRuleCheckEnabled: (c: unknown) => boolean }).resolveCitedRuleCheckEnabled;
    expect(resolve(result.value)).toBe(true);
    expect(new GateEnforcer(result.value).isCitedRuleCheckEnabled()).toBe(true);
  });

  it("D3-2 BOUNDARY: absent or explicit false leaves the check off", () => {
    const resolve = (core as unknown as { resolveCitedRuleCheckEnabled: (c: unknown) => boolean }).resolveCitedRuleCheckEnabled;
    expect(resolve(undefined)).toBe(false);
    writeFileSync(configPath, OLD_YAML.replace("prd_sync", "cited_rule_check").replace("enabled: true", "enabled: false"));
    const { result } = loadCollecting();
    expect(result.ok && resolve(result.value)).toBe(false);
  });

  it("D3-3 STATE: the old name is migrated once, loudly: file rewritten, ONE named notice, value kept, comment kept", () => {
    writeFileSync(configPath, OLD_YAML);
    const first = loadCollecting();
    expect(first.result.ok).toBe(true);
    expect(first.lines).toEqual([NOTICE]);
    const rewritten = readFileSync(configPath, "utf8");
    expect(rewritten).not.toContain("prd_sync");
    expect(rewritten).toContain("cited_rule_check:");
    expect(rewritten).toContain("# keep this comment");
    const resolve = (core as unknown as { resolveCitedRuleCheckEnabled: (c: unknown) => boolean }).resolveCitedRuleCheckEnabled;
    expect(first.result.ok && resolve(first.result.value)).toBe(true);

    const second = loadCollecting();
    expect(second.result.ok).toBe(true);
    expect(second.lines).toEqual([]);
  });

  it("D3-4 BOUNDARY: an old `enabled: false` migrates as false, not as the default", () => {
    writeFileSync(configPath, OLD_YAML.replace("enabled: true", "enabled: false"));
    const { result, lines } = loadCollecting();
    expect(lines).toEqual([NOTICE.replace("enabled: true", "enabled: false")]);
    expect(readFileSync(configPath, "utf8")).toContain("enabled: false");
    expect(result.ok).toBe(true);
  });

  it("D3-5 ERROR: both names present is refused naming both; the file is untouched", () => {
    const both = OLD_YAML + "      cited_rule_check:\n        enabled: false\n";
    writeFileSync(configPath, both);
    const { result, lines } = loadCollecting();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(result.error)).toContain("prd_sync");
    expect(JSON.stringify(result.error)).toContain("cited_rule_check");
    expect(lines).toEqual([]);
    expect(readFileSync(configPath, "utf8")).toBe(both);
  });

  it("D3-6 ERROR: with no warning channel the old name is refused, never silently rewritten", () => {
    writeFileSync(configPath, OLD_YAML);
    const result = loadConfig(dir);
    expect(result.ok).toBe(false);
    expect(readFileSync(configPath, "utf8")).toBe(OLD_YAML);
  });

  it("D3-7 NEGATIVE: the pure parser never reads the old name", () => {
    const result = core.loadConfigFromString(OLD_YAML);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(result.error)).toContain("cited_rule_check");
  });

  it("D3-8 REGRESSION: a config with neither name loads silently and writes nothing", () => {
    const plain = 'project:\n  name: "t"\n  author: "a"\n';
    writeFileSync(configPath, plain);
    const { result, lines } = loadCollecting();
    expect(result.ok).toBe(true);
    expect(lines).toEqual([]);
    expect(readFileSync(configPath, "utf8")).toBe(plain);
  });
});
