/**
 * Review fixes on the record-edit gate (follow-up to AC-DR-2).
 *
 * Spec: spec-documents-are-living-or-records-a-locked-record-is-never (D13, D14, D15, D17).
 * Rules: BR-1048 (refusal), BR-1049/BR-1050 (correction is a text fix), BR-1051 (difference trigger).
 *
 * Dimensions:
 *   HAPPY       correction on a locked retro that leaves extra.sub_type alone still writes ONE version
 *   NEGATIVE    correction + extra.sub_type change on a locked retro is refused (gate:record-edit), no version written
 *   BOUNDARY    resend of the canonical body + tag change on a locked doc with a non-canonical stored body
 *               writes no content (stored bytes kept), tag updated
 *   REGRESSION  a correction that restates the SAME sub_type is not a kind change
 */

import { describe, it, expect } from "vitest";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { actedStore } from "../../live-invocation.js";

function makeFixture(): { store: InMemoryStore; service: CorpusService } {
  const store = actedStore(new InMemoryStore());
  const lock = new RecordLockService(store, new GateEnforcer(undefined));
  const service = new CorpusService(store, lock, undefined, undefined, undefined, undefined, true);
  return { store, service };
}

async function mustCreate(service: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const created = await service.create(input);
  if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created.error)}`);
  return created.value;
}

async function approvedRetro(service: CorpusService): Promise<DocRecord> {
  const retro = await mustCreate(service, {
    type: "knowledge",
    title: "A retro",
    content: "what happened",
    extra: { sub_type: "retro" },
  });
  if (retro.status !== "approved") throw new Error(`fixture expected the ledger fast-track, got ${retro.status}`);
  return retro;
}

async function versionCount(store: InMemoryStore, docId: DocRecord["id"]): Promise<number> {
  const versions = await store.findVersions(docId, { limit: 1000 });
  if (!versions.ok) throw new Error("findVersions failed");
  return versions.value.length;
}

describe("review fix 1 — a correction may not change extra.sub_type of a locked record", () => {
  it("NEGATIVE: correction + sub_type retro->reference is refused with gate:record-edit and writes no version", async () => {
    const { store, service } = makeFixture();
    const retro = await approvedRetro(service);
    const before = await versionCount(store, retro.id);

    const result = await service.set(
      retro.slug,
      { extra: { sub_type: "reference" } },
      { correction: { reason: "typo" } },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("gate:record-edit");
    expect(await versionCount(store, retro.id)).toBe(before);
    const stored = await store.find(retro.id);
    expect(stored.ok && stored.value?.extra["sub_type"]).toBe("retro");
    expect(stored.ok && stored.value?.status).toBe("approved");
  });

  it("HAPPY: correction without a sub_type change still succeeds, ONE version, status kept", async () => {
    const { store, service } = makeFixture();
    const retro = await approvedRetro(service);
    const before = await versionCount(store, retro.id);

    const result = await service.set(retro.slug, { content: "what happened, fixed" }, { correction: { reason: "typo" } });

    expect(result.ok).toBe(true);
    expect(await versionCount(store, retro.id)).toBe(before + 1);
    if (result.ok) expect(result.value.status).toBe("approved");
  });

  it("REGRESSION: a correction restating the same sub_type is not a kind change", async () => {
    const { service } = makeFixture();
    const retro = await approvedRetro(service);
    const result = await service.set(
      retro.slug,
      { content: "what happened, fixed", extra: { sub_type: "retro" } },
      { correction: { reason: "typo" } },
    );
    expect(result.ok).toBe(true);
  });
});

describe("review fix 3 — an unchanged body is never rewritten on a locked record", () => {
  it("BOUNDARY: canonical resend + tag change keeps the stored non-canonical bytes and writes the tag", async () => {
    const { store, service } = makeFixture();
    const retro = await approvedRetro(service);
    // Plant a non-canonical stored body (trailing whitespace) the way an import or an older writer could have.
    const nonCanonical = "what happened   \n\n\n";
    const planted = await store.update(
      retro.id,
      { content: nonCanonical, version: retro.version + 1 },
      { expected_version: retro.version },
    );
    if (!planted.ok) throw new Error("plant failed");

    const result = await service.set(retro.slug, { content: "what happened", tags: ["t1"] });

    expect(result.ok).toBe(true);
    const stored = await store.find(retro.id);
    if (!stored.ok || stored.value === null) throw new Error("vanished");
    expect(stored.value.content).toBe(nonCanonical);
    expect(stored.value.tags).toEqual(["t1"]);
    expect(stored.value.status).toBe("approved");
  });
});
