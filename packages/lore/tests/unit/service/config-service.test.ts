/**
 * Tests for SPEC-062 T1 — `ConfigService.read`/`update`, the FIRST runtime write
 * path for `.lore/config.yaml`. Covers AC-062-1 (deny-key rejection, zero-write),
 * AC-062-2 (redaction on read), AC-062-4 (honest restart_required reporting),
 * AC-062-6 (validate-then-write, zero partial application), AC-062-7 (audit row
 * accounting).
 *
 * Uses a real `mkdtemp` corpus directory (never the repo's own `.lore/`, per this
 * repo's own testing rule) so `loadConfig`/`saveConfig`'s real file IO is exercised
 * end-to-end, plus an `InMemoryStore` for the injected `appendAuditEntry` port.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * Source: SPEC-062 §Acceptance Criteria AC-062-1, AC-062-2, AC-062-4, AC-062-6, AC-062-7.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import yaml from "yaml";
import { ConfigService } from "../../../src/service/config-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import type { LoreConfig } from "@lore/core";

// ─── Harness ──────────────────────────────────────────────────────────────────

let corpusDir: string;

/** Minimal valid LoreConfig — `project` is the only required top-level section. */
function baseConfig(extra: Partial<LoreConfig> = {}): LoreConfig {
  return {
    project: { name: "test-project", author: "tester" },
    ...extra,
  } as LoreConfig;
}

function seedConfig(config: LoreConfig): void {
  const loreDir = join(corpusDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  writeFileSync(join(loreDir, "config.yaml"), yaml.stringify(config), "utf8");
}

function rawConfigBytes(): string {
  return readFileSync(join(corpusDir, ".lore", "config.yaml"), "utf8");
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function harness() {
  const store = new InMemoryStore();
  const configService = new ConfigService(corpusDir, store.appendAuditEntry.bind(store));
  return { store, configService };
}

beforeEach(() => {
  corpusDir = mkdtempSync(join(tmpdir(), "lore-config-service-test-"));
});

afterEach(() => {
  rmSync(corpusDir, { recursive: true, force: true });
});

// ─── HAPPY ────────────────────────────────────────────────────────────────────

describe("SPEC-062 T1 — ConfigService", () => {
  it("HAPPY: read() returns the config plus a per-key effect map", async () => {
    seedConfig(baseConfig({ workflow: { claim_ttl_minutes: 200 } as never }));
    const { configService } = harness();

    const result = await configService.read();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.config.project.name).toBe("test-project");
    expect(result.value.effects["workflow.claim_ttl_minutes"]).toBe("live");
  });

  it("HAPPY: update() with a legal patch writes through and reports it in `updated`", async () => {
    seedConfig(baseConfig());
    const { configService } = harness();

    const result = await configService.update(
      { workflow: { claim_ttl_minutes: 45 } },
      { actor: "tester" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.updated).toEqual(["workflow.claim_ttl_minutes"]);

    const reread = await configService.read();
    expect(reread.ok && (reread.value.config.workflow as never as { claim_ttl_minutes: number })?.claim_ttl_minutes).toBe(45);
  });

  // ─── NEGATIVE: deny keys (AC-062-1) ────────────────────────────────────────

  it("NEGATIVE: deny keys — ai.providers.<name>.command is rejected, zero bytes written", async () => {
    seedConfig(baseConfig());
    const { configService } = harness();
    const before = sha256(rawConfigBytes());

    const result = await configService.update(
      { ai: { providers: { claude: { command: "rm -rf /" } } } },
      { actor: "tester" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");

    const after = sha256(rawConfigBytes());
    expect(after).toBe(before);
  });

  it("NEGATIVE: deny keys — ai.providers.<name>.args is rejected, zero bytes written", async () => {
    // reason: seed a pre-existing valid `command` so the deep-merged candidate would
    // OTHERWISE schema-validate cleanly — isolating this test's failure mode to the
    // deny-key check itself, not an incidental "command is required" schema failure
    // (verified via failure-injection: this test only goes red when the deny check
    // is disabled, once `command` is pre-seeded like this).
    seedConfig(baseConfig({ ai: { providers: { claude: { command: "claude", args: [] } } } as never }));
    const { configService } = harness();
    const before = sha256(rawConfigBytes());

    const result = await configService.update(
      { ai: { providers: { claude: { args: ["--evil"] } } } },
      { actor: "tester" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");

    const after = sha256(rawConfigBytes());
    expect(after).toBe(before);
  });

  it("NEGATIVE: deny keys — ai.http.headers.<name> is rejected, zero bytes written", async () => {
    // reason: seed a pre-existing valid `ai.http.url` so the deep-merged candidate
    // would OTHERWISE schema-validate cleanly — isolating this test's failure mode
    // to the deny-key check itself, not an incidental "url is required" schema
    // failure (verified via failure-injection, same rationale as the args test above).
    seedConfig(baseConfig({ ai: { http: { url: "https://api.anthropic.com/v1/messages" } } as never }));
    const { configService } = harness();
    const before = sha256(rawConfigBytes());

    const result = await configService.update(
      { ai: { http: { headers: { "x-api-key": "sk-live-secret" } } } },
      { actor: "tester" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");

    const after = sha256(rawConfigBytes());
    expect(after).toBe(before);
  });

  it("NEGATIVE: deny keys — verify.env.passthrough_all is rejected, zero bytes written", async () => {
    seedConfig(baseConfig());
    const { configService } = harness();
    const before = sha256(rawConfigBytes());

    const result = await configService.update(
      { verify: { env: { passthrough_all: true } } },
      { actor: "tester" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(result.error.code === "VALIDATION_ERROR" && result.error.field).toBe("verify.env.passthrough_all");

    const after = sha256(rawConfigBytes());
    expect(after).toBe(before);
  });

  // ─── BOUNDARY: mixed legal + deny key patch ────────────────────────────────

  it("BOUNDARY: a patch mixing a legal key and a deny key is rejected wholesale (no partial apply)", async () => {
    seedConfig(baseConfig());
    const { configService } = harness();
    const before = sha256(rawConfigBytes());

    const result = await configService.update(
      {
        workflow: { claim_ttl_minutes: 999 },
        verify: { env: { passthrough_all: true } },
      },
      { actor: "tester" },
    );
    expect(result.ok).toBe(false);

    const after = sha256(rawConfigBytes());
    expect(after).toBe(before);

    // the "legal" half must NOT have been applied either — zero partial application
    const reread = await configService.read();
    expect(reread.ok && (reread.value.config.workflow as never as { claim_ttl_minutes?: number })?.claim_ttl_minutes).not.toBe(999);
  });

  // ─── ERROR: schema rejection (AC-062-6) ────────────────────────────────────

  it("ERROR: schema rejection — a patch that fails LoreConfigSchema is rejected, zero bytes written", async () => {
    seedConfig(baseConfig());
    const { configService } = harness();
    const before = sha256(rawConfigBytes());

    // workflow.claim_ttl_minutes must be a positive integer — a string fails the schema.
    const result = await configService.update(
      { workflow: { claim_ttl_minutes: "not-a-number" } },
      { actor: "tester" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");

    const after = sha256(rawConfigBytes());
    expect(after).toBe(before);
  });

  it("ERROR: schema rejection — an unrecognized top-level key is rejected, zero bytes written", async () => {
    seedConfig(baseConfig());
    const { configService } = harness();
    const before = sha256(rawConfigBytes());

    const result = await configService.update(
      { totally_unknown_section: { x: 1 } },
      { actor: "tester" },
    );
    expect(result.ok).toBe(false);

    const after = sha256(rawConfigBytes());
    expect(after).toBe(before);
  });

  // ─── STATE: audit row accounting (AC-062-7) ────────────────────────────────

  it("STATE: audit — an accepted PATCH writes exactly 1 audit row; a rejected PATCH writes 0", async () => {
    seedConfig(baseConfig());
    const { configService, store } = harness();

    const rejected = await configService.update(
      { verify: { env: { passthrough_all: true } } },
      { actor: "tester" },
    );
    expect(rejected.ok).toBe(false);
    const afterRejected = await store.queryAudit({});
    expect(afterRejected.ok && afterRejected.value.length).toBe(0);

    const accepted1 = await configService.update(
      { workflow: { claim_ttl_minutes: 30 } },
      { actor: "tester" },
    );
    expect(accepted1.ok).toBe(true);
    const afterFirst = await store.queryAudit({});
    expect(afterFirst.ok && afterFirst.value.length).toBe(1);

    // second consecutive accepted update accumulates — never resets, never overwrites
    const accepted2 = await configService.update(
      { workflow: { claim_ttl_minutes: 60 } },
      { actor: "tester" },
    );
    expect(accepted2.ok).toBe(true);
    const afterSecond = await store.queryAudit({});
    expect(afterSecond.ok && afterSecond.value.length).toBe(2);

    if (afterSecond.ok) {
      expect(afterSecond.value.every((e) => e.action === "config_update")).toBe(true);
      expect(
        afterSecond.value.every(
          (e) =>
            typeof e.details?.["before_sha256"] === "string" &&
            typeof e.details?.["after_sha256"] === "string" &&
            Array.isArray(e.details?.["changed_keys"]),
        ),
      ).toBe(true);
    }
  });

  // ─── REGRESSION: redaction (AC-062-2) ──────────────────────────────────────

  it("HAPPY/REGRESSION: redaction — read() never emits a raw ai.http.headers value", async () => {
    seedConfig(
      baseConfig({
        ai: {
          http: {
            url: "https://example.invalid/v1/messages",
            headers: { "x-api-key": "sk-live-super-secret-value" },
          },
        } as never,
      }),
    );
    const { configService } = harness();

    const result = await configService.read();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toContain("sk-live-super-secret-value");
    // the key itself is still visible — only the VALUE is redacted
    expect(serialized).toContain("x-api-key");
  });

  // ─── REGRESSION: honest restart_required reporting (AC-062-4) ─────────────

  it("REGRESSION: restart_required — sync.enabled change reports exactly [\"sync.enabled\"]", async () => {
    seedConfig(baseConfig());
    const { configService } = harness();

    const result = await configService.update(
      { sync: { enabled: false } },
      { actor: "tester" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.restart_required).toEqual(["sync.enabled"]);
  });

  it("REGRESSION: restart_required — workflow.claim_ttl_minutes change reports an empty array", async () => {
    seedConfig(baseConfig());
    const { configService } = harness();

    const result = await configService.update(
      { workflow: { claim_ttl_minutes: 77 } },
      { actor: "tester" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.restart_required).toEqual([]);
    expect(result.value.updated).toEqual(["workflow.claim_ttl_minutes"]);
  });
});
