/**
 * Tests for SPEC-064 (machine-config write backend) — `GlobalConfigService.read`/
 * `update`, the FIRST runtime write path for the machine-scope global config
 * (`~/.config/lore/config.yaml` / XDG). Mirrors `config-service.test.ts`'s harness
 * shape (SPEC-062 T1/T3) one scope over: same deny-key table (`CONFIG_DENY_KEYS`),
 * same validate-then-write/CAS/audit invariants, applied to `GlobalLoreConfigSchema`
 * instead of `LoreConfigSchema`.
 *
 * Uses a real `mkdtemp` directory (never the repo's own `.lore/` or the real XDG
 * path, per this repo's own testing rule) so `loadGlobalConfig`/`saveGlobalConfig`'s
 * real file IO is exercised end-to-end, plus an `InMemoryStore` for the injected
 * `appendAuditEntry` port.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * Source: SPEC-064 §Acceptance Criteria AC-064-4.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import yaml from "yaml";
import { GlobalConfigService } from "../../../src/service/global-config-service.js";
import { computeConfigHash } from "../../../src/service/config-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import type { GlobalLoreConfig } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

// ─── Harness ──────────────────────────────────────────────────────────────────

let workDir: string;
let configPath: string;

function seedConfig(config: GlobalLoreConfig): void {
  mkdirSync(workDir, { recursive: true });
  writeFileSync(configPath, yaml.stringify(config), "utf8");
}

function rawConfigBytesOrNull(): string | null {
  return existsSync(configPath) ? readFileSync(configPath, "utf8") : null;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function harness() {
  const store = actedStore(new InMemoryStore());
  const globalConfigService = new GlobalConfigService(configPath, store.appendAuditEntry.bind(store));
  return { store, globalConfigService };
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "lore-global-config-service-test-"));
  configPath = join(workDir, "config.yaml");
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("SPEC-064 — GlobalConfigService", () => {
  // ─── HAPPY ────────────────────────────────────────────────────────────────

  it("HAPPY: read() on a missing file returns ok({}) with an empty effect map (D7)", async () => {
    expect(existsSync(configPath)).toBe(false);
    const { globalConfigService } = harness();

    const result = await globalConfigService.read();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.config).toEqual({});
    expect(result.value.effects).toEqual({});
  });

  it("HAPPY: read() on a seeded file returns the config plus a per-key effect map", async () => {
    seedConfig({ defaults: { format: "json", color: true } });
    const { globalConfigService } = harness();

    const result = await globalConfigService.read();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.config.defaults?.format).toBe("json");
    expect(result.value.effects["defaults.format"]).toBe("live");
    expect(result.value.effects["defaults.color"]).toBe("live");
  });

  it("HAPPY: update() with a legal patch writes through and reports it in `updated`", async () => {
    seedConfig({});
    const { globalConfigService } = harness();

    const result = await globalConfigService.update(
      { defaults: { format: "json" } },
      { actor: "tester" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.updated).toEqual(["defaults.format"]);
    expect(result.value.restart_required).toEqual([]);

    const reread = await globalConfigService.read();
    expect(reread.ok && reread.value.config.defaults?.format).toBe("json");
  });

  // ─── NEGATIVE — defaults.editor is denied (the AC-064-4 core assertion) ────

  it("NEGATIVE: defaults.editor is rejected — exactly 1 denied key, VALIDATION_ERROR naming it, 0 bytes written (no pre-existing file)", async () => {
    expect(existsSync(configPath)).toBe(false);
    const { globalConfigService, store } = harness();

    const result = await globalConfigService.update(
      { defaults: { editor: "/tmp/evil.sh" } },
      { actor: "tester" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(result.error.code === "VALIDATION_ERROR" && result.error.field).toBe("defaults.editor");

    // A denied patch never even opens the file — a rejected write on a
    // not-yet-existing config must not CREATE one either.
    expect(existsSync(configPath)).toBe(false);

    const audit = await store.queryAudit({});
    expect(audit.ok && audit.value.length).toBe(0);
  });

  it("NEGATIVE+STATE: defaults.editor rejected against a PRE-EXISTING file — byte-identical before/after (sha256-asserted, not just \"still exists\")", async () => {
    seedConfig({ defaults: { format: "text" } });
    const before = sha256(rawConfigBytesOrNull() ?? "");
    const { globalConfigService } = harness();

    const result = await globalConfigService.update(
      { defaults: { editor: "vim" } },
      { actor: "tester" },
    );
    expect(result.ok).toBe(false);

    const after = sha256(rawConfigBytesOrNull() ?? "");
    expect(after).toBe(before);
  });

  it("NEGATIVE: defaults.format and defaults.color (siblings of defaults.editor) remain WRITABLE", async () => {
    seedConfig({});
    const { globalConfigService } = harness();

    const formatResult = await globalConfigService.update(
      { defaults: { format: "json" } },
      { actor: "tester" },
    );
    expect(formatResult.ok).toBe(true);

    const colorResult = await globalConfigService.update(
      { defaults: { color: false } },
      { actor: "tester" },
    );
    expect(colorResult.ok).toBe(true);

    const reread = await globalConfigService.read();
    expect(reread.ok).toBe(true);
    if (!reread.ok) return;
    expect(reread.value.config.defaults?.format).toBe("json");
    expect(reread.value.config.defaults?.color).toBe(false);
  });

  it("NEGATIVE: a patch mixing a legal key and defaults.editor is rejected wholesale (no partial apply)", async () => {
    seedConfig({});
    const { globalConfigService } = harness();

    const result = await globalConfigService.update(
      { defaults: { format: "json", editor: "vim" } },
      { actor: "tester" },
    );
    expect(result.ok).toBe(false);

    const reread = await globalConfigService.read();
    expect(reread.ok && reread.value.config.defaults?.format).not.toBe("json");
  });

  // ─── BOUNDARY ───────────────────────────────────────────────────────────

  it("BOUNDARY: first write on a missing file creates it (D7) and subsequent read() sees it", async () => {
    expect(existsSync(configPath)).toBe(false);
    const { globalConfigService } = harness();

    const result = await globalConfigService.update(
      { defaults: { color: true } },
      { actor: "tester" },
    );
    expect(result.ok).toBe(true);
    expect(existsSync(configPath)).toBe(true);

    const reread = await globalConfigService.read();
    expect(reread.ok && reread.value.config.defaults?.color).toBe(true);
  });

  it("BOUNDARY: first write creates missing nested parent directories", async () => {
    const nestedPath = join(workDir, "a", "b", "c", "config.yaml");
    const store = actedStore(new InMemoryStore());
    const nestedService = new GlobalConfigService(nestedPath, store.appendAuditEntry.bind(store));

    const result = await nestedService.update({ defaults: { format: "json" } }, { actor: "tester" });
    expect(result.ok).toBe(true);
    expect(existsSync(nestedPath)).toBe(true);
  });

  // ─── ERROR ──────────────────────────────────────────────────────────────

  it("ERROR: a non-object patch is rejected, never throws", async () => {
    seedConfig({});
    const { globalConfigService } = harness();

    await expect(globalConfigService.update(null, { actor: "tester" })).resolves.toMatchObject({ ok: false });
    await expect(globalConfigService.update("not-an-object", { actor: "tester" })).resolves.toMatchObject({
      ok: false,
    });
    await expect(globalConfigService.update([1, 2, 3], { actor: "tester" })).resolves.toMatchObject({ ok: false });
  });

  it("ERROR: schema rejection — an invalid defaults.format enum value is rejected, zero bytes written", async () => {
    seedConfig({ defaults: { format: "text" } });
    const before = sha256(rawConfigBytesOrNull() ?? "");
    const { globalConfigService } = harness();

    const result = await globalConfigService.update(
      { defaults: { format: "yaml" } },
      { actor: "tester" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");

    const after = sha256(rawConfigBytesOrNull() ?? "");
    expect(after).toBe(before);
  });

  it("ERROR: schema rejection — an unrecognized top-level key is rejected (GlobalLoreConfigSchema is .strict())", async () => {
    seedConfig({});
    const { globalConfigService } = harness();

    const result = await globalConfigService.update(
      { totally_unknown_section: { x: 1 } },
      { actor: "tester" },
    );
    expect(result.ok).toBe(false);
  });

  // ─── STATE: audit row accounting ────────────────────────────────────────

  it("STATE: audit — an accepted PATCH writes exactly 1 audit row; a rejected PATCH writes 0", async () => {
    seedConfig({});
    const { globalConfigService, store } = harness();

    const rejected = await globalConfigService.update(
      { defaults: { editor: "vim" } },
      { actor: "tester" },
    );
    expect(rejected.ok).toBe(false);
    const afterRejected = await store.queryAudit({});
    expect(afterRejected.ok && afterRejected.value.length).toBe(0);

    const accepted1 = await globalConfigService.update(
      { defaults: { format: "json" } },
      { actor: "tester" },
    );
    expect(accepted1.ok).toBe(true);
    const afterFirst = await store.queryAudit({});
    expect(afterFirst.ok && afterFirst.value.length).toBe(1);

    const accepted2 = await globalConfigService.update(
      { defaults: { color: false } },
      { actor: "tester" },
    );
    expect(accepted2.ok).toBe(true);
    const afterSecond = await store.queryAudit({});
    expect(afterSecond.ok && afterSecond.value.length).toBe(2);

    if (afterSecond.ok) {
      expect(afterSecond.value.every((e) => e.action === "global_config_update")).toBe(true);
      expect(
        afterSecond.value.every((e) => Array.isArray(e.details?.["changed_keys"])),
      ).toBe(true);
    }
  });

  // ─── expectedHash CAS ───────────────────────────────────────────────────

  it("HAPPY expectedHash: a matching expectedHash is accepted and the patch is applied", async () => {
    seedConfig({});
    const { globalConfigService } = harness();

    const readResult = await globalConfigService.read();
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;
    const currentHash = computeConfigHash(readResult.value.config as never);

    const result = await globalConfigService.update(
      { defaults: { format: "json" } },
      { actor: "tester", expectedHash: currentHash },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.updated).toEqual(["defaults.format"]);
  });

  it("ERROR expectedHash: a stale/mismatched expectedHash is rejected, zero bytes written, zero audit rows", async () => {
    seedConfig({ defaults: { format: "text" } });
    const before = sha256(rawConfigBytesOrNull() ?? "");
    const { globalConfigService, store } = harness();

    const result = await globalConfigService.update(
      { defaults: { format: "json" } },
      {
        actor: "tester",
        expectedHash: "0000000000000000000000000000000000000000000000000000000000000000",
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(result.error.code === "VALIDATION_ERROR" && result.error.field).toBe("expectedHash");

    const after = sha256(rawConfigBytesOrNull() ?? "");
    expect(after).toBe(before);

    const audit = await store.queryAudit({});
    expect(audit.ok && audit.value.length).toBe(0);
  });

  it("BOUNDARY expectedHash: omitted expectedHash skips the CAS entirely — matches ConfigService's opts.expectedHash precedent", async () => {
    seedConfig({ defaults: { format: "text" } });
    const { globalConfigService } = harness();

    // No expectedHash at all — must succeed regardless of the current on-disk hash.
    const result = await globalConfigService.update(
      { defaults: { format: "json" } },
      { actor: "tester" },
    );
    expect(result.ok).toBe(true);
  });

  it("STATE expectedHash (TOCTOU): a concurrent writer landing between a read and update() is caught", async () => {
    seedConfig({ defaults: { format: "text" } });
    const { globalConfigService } = harness();

    const readResult = await globalConfigService.read();
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;
    const sharedHash = computeConfigHash(readResult.value.config as never);

    // Writer A lands first, using the hash both writers observed.
    const writerA = await globalConfigService.update(
      { defaults: { format: "json" } },
      { actor: "writer-a", expectedHash: sharedHash },
    );
    expect(writerA.ok).toBe(true);

    // Writer B still holds the STALE hash from before writer A's commit.
    const writerB = await globalConfigService.update(
      { defaults: { color: true } },
      { actor: "writer-b", expectedHash: sharedHash },
    );
    expect(writerB.ok).toBe(false);
    if (writerB.ok) return;
    expect(writerB.error.code === "VALIDATION_ERROR" && writerB.error.field).toBe("expectedHash");

    // Writer A's commit survives untouched.
    const reread = await globalConfigService.read();
    expect(reread.ok && reread.value.config.defaults?.format).toBe("json");
    expect(reread.ok && reread.value.config.defaults?.color).toBeUndefined();
  });

  // ─── REGRESSION ─────────────────────────────────────────────────────────

  it("REGRESSION: restart_required is always [] for defaults.* keys (no RESTART_REQUIRED_KEY_PREFIXES entry matches)", async () => {
    seedConfig({});
    const { globalConfigService } = harness();

    const result = await globalConfigService.update(
      { defaults: { format: "json", color: true } },
      { actor: "tester" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.restart_required).toEqual([]);
    expect(result.value.updated.sort()).toEqual(["defaults.color", "defaults.format"]);
  });
});
