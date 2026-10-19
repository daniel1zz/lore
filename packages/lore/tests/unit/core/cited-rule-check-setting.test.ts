/**
 * BL-D3 (baseline-close-a-plan BR-226) — the cited-rule check at plan close is switched by a setting NAMED FOR IT:
 * `workflow.gates."plan-close".cited_rule_check.enabled`. The borrowed name `prd_sync` is retired:
 *
 *   - the loader NEVER writes: `loadConfig` on a config still naming `prd_sync` refuses (VALIDATION_ERROR, field
 *     `workflow.gates."plan-close".prd_sync`) naming both keys and the fix `lore migrate config-keys --apply`,
 *     and leaves the file untouched; both names present is refused too.
 *   - `migrateConfigKeys(dir, apply)` is the explicit rename: a dry run writes nothing, `--apply` changes ONLY the key
 *     text (every other byte identical), the notice names the file, a second apply changes nothing.
 *   - `loadConfigFromString` (pure) never reads the old name.
 *   - the setting is read from ONE source: `resolveCitedRuleCheckGateEnabled`, consumed by
 *     `GateEnforcer.isCitedRuleCheckEnabled`.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION. Every `it()` title carries `D3-n`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as core from "@lore/core";
import { loadConfig, migrateConfigKeys } from "@lore/core/node";
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

const resolve = (c: unknown): boolean =>
  (core as unknown as { resolveCitedRuleCheckGateEnabled: (c: unknown) => boolean }).resolveCitedRuleCheckGateEnabled(c);

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
    expect(resolve(result.value)).toBe(true);
    expect(new GateEnforcer(result.value).isCitedRuleCheckEnabled()).toBe(true);
  });

  it("D3-2 BOUNDARY: absent or explicit false leaves the check off", () => {
    expect(resolve(undefined)).toBe(false);
    writeFileSync(configPath, OLD_YAML.replace("prd_sync", "cited_rule_check").replace("enabled: true", "enabled: false"));
    const { result } = loadCollecting();
    expect(result.ok && resolve(result.value)).toBe(false);
  });

  it("D3-3 ERROR: loading an old-name config refuses naming both keys and the fix, and never writes", () => {
    writeFileSync(configPath, OLD_YAML);
    const { result, lines } = loadCollecting();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(core.isPrdSyncRenameError(result.error)).toBe(true);
    const message = (result.error as { message: string }).message;
    expect(message).toBe(
      'workflow.gates."plan-close".prd_sync was renamed to workflow.gates."plan-close".cited_rule_check ' +
        "(it switches the cited-rule check, not outline sync); run `lore migrate config-keys --apply` to rename it in .lore/config.yaml.",
    );
    expect(lines).toEqual([]);
    expect(readFileSync(configPath, "utf8")).toBe(OLD_YAML);
  });

  it("D3-4 STATE: --apply renames ONLY the key text, names the file, and the config then loads with the value kept", () => {
    writeFileSync(configPath, OLD_YAML);
    const applied = migrateConfigKeys(dir, true);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value).toEqual({
      file: configPath,
      renamed: true,
      written: true,
      notice:
        `${configPath}: workflow.gates."plan-close".prd_sync renamed to workflow.gates."plan-close".cited_rule_check (enabled: true kept)`,
    });
    expect(readFileSync(configPath, "utf8")).toBe(OLD_YAML.replace("prd_sync", "cited_rule_check"));
    const { result } = loadCollecting();
    expect(result.ok && resolve(result.value)).toBe(true);
  });

  it("D3-5 BOUNDARY: an old `enabled: false` migrates as false, not as the default", () => {
    const text = OLD_YAML.replace("enabled: true", "enabled: false");
    writeFileSync(configPath, text);
    const applied = migrateConfigKeys(dir, true);
    expect(applied.ok && applied.value.notice).toContain("(enabled: false kept)");
    expect(readFileSync(configPath, "utf8")).toBe(text.replace("prd_sync", "cited_rule_check"));
  });

  it("D3-6 BOUNDARY: a dry run reports the rename and writes nothing", () => {
    writeFileSync(configPath, OLD_YAML);
    const preview = migrateConfigKeys(dir, false);
    expect(preview.ok && preview.value).toMatchObject({ renamed: true, written: false });
    expect(readFileSync(configPath, "utf8")).toBe(OLD_YAML);
  });

  it("D3-7 REGRESSION: a second apply changes nothing", () => {
    writeFileSync(configPath, OLD_YAML);
    migrateConfigKeys(dir, true);
    const after = readFileSync(configPath, "utf8");
    const again = migrateConfigKeys(dir, true);
    expect(again.ok && again.value).toEqual({ file: configPath, renamed: false, written: false, notice: undefined });
    expect(readFileSync(configPath, "utf8")).toBe(after);
  });

  it("D3-8 STATE: every other byte is kept, flow-sequence spacing and trailing comments included", () => {
    const text = OLD_YAML + "      # tail comment\nextra_top: [ \"x\", \"y\" ]\n";
    writeFileSync(configPath, text);
    migrateConfigKeys(dir, true);
    expect(readFileSync(configPath, "utf8")).toBe(text.replace("prd_sync", "cited_rule_check"));
  });

  it("D3-9 ERROR: both names present is refused by load and by migrate, naming both; the file is untouched", () => {
    const both = OLD_YAML + "      cited_rule_check:\n        enabled: false\n";
    writeFileSync(configPath, both);
    const { result } = loadCollecting();
    expect(result.ok).toBe(false);
    const migrated = migrateConfigKeys(dir, true);
    expect(migrated.ok).toBe(false);
    if (migrated.ok) return;
    expect(core.isPrdSyncRenameError(migrated.error)).toBe(true);
    expect(JSON.stringify(migrated.error)).toContain("prd_sync");
    expect(JSON.stringify(migrated.error)).toContain("cited_rule_check");
    expect(readFileSync(configPath, "utf8")).toBe(both);
  });

  it("D3-10 NEGATIVE: the pure parser never reads the old name", () => {
    const result = core.loadConfigFromString(OLD_YAML);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(result.error)).toContain("cited_rule_check");
  });

  it("D3-11 REGRESSION: a config with neither name loads silently and migrate writes nothing", () => {
    const plain = 'project:\n  name: "t"\n  author: "a"\n';
    writeFileSync(configPath, plain);
    const { result, lines } = loadCollecting();
    expect(result.ok).toBe(true);
    expect(lines).toEqual([]);
    const applied = migrateConfigKeys(dir, true);
    expect(applied.ok && applied.value.renamed).toBe(false);
    expect(readFileSync(configPath, "utf8")).toBe(plain);
  });
});
