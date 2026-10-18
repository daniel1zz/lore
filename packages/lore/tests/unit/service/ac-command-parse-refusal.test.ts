// @reads packages/lore/src/**
/**
 * TG-45: a script criterion whose command the verify shell (`sh`) cannot parse is refused at the AC write
 * chokepoint (VALIDATION_ERROR, field `command`, rule `ac-command-parses`, the shell's parser message), writing nothing.
 * Parse is not run: a parseable command whose check would fail is still written.
 *
 * Dimensions: NEGATIVE (unbalanced quote via ac add / set / create / restore / import), HAPPY (quoted
 * apostrophe), BOUNDARY (parse != run), STATE (refusal writes nothing; unchanged stored command not re-checked).
 *
 * @spec_ref AC-TG-45
 */

import { describe, it, expect, vi } from "vitest";
import { existsSync } from "node:fs";
import type { CreateDocInput, DocId } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import { applyAcChange } from "../../../src/service/ac-write-chokepoint.js";
import { recordLockGateOff } from "../../helpers/record-lock-gate-off.js";
import { actedStore } from "../../live-invocation.js";

const UNBALANCED = "echo 'X PASS: its class's calibration'";
const DOUBLE_QUOTED = `echo "X PASS: its class's calibration"`;
const PARSES_BUT_FAILS = "false && echo 'AC-T PASS: never'";
const PARSER_WORDS = /unexpected EOF|syntax error|matching/;

const criterion = (id: string, command: string) => ({
  id,
  statement: `Exits 0 on a clean tree (${id})`,
  verify: { mode: "script", oracle: "test", command },
});

const WRITE_METHODS = [
  "update",
  "updateWithProvenance",
  "insert",
  "insertWithProvenance",
  "insertWithAllocatedOrdinalAndProvenance",
  "appendAuditEntry",
] as const;

async function setup() {
  const store = actedStore(new InMemoryStore());
  const cs = new CorpusService(store, recordLockGateOff(store));
  const ac = new AcService(store, recordLockGateOff(store));
  const prd = await cs.create({ type: "prd", title: "P", content: "root" } as CreateDocInput);
  if (!prd.ok) throw new Error("prd");
  const spec = await cs.create({ type: "spec", title: "S", content: "body" } as CreateDocInput);
  if (!spec.ok) throw new Error("spec");
  return { store, ac, specId: spec.value.id as string };
}

async function storedCriteria(store: InMemoryStore, specId: string): Promise<unknown[]> {
  const d = await store.find(specId as DocId);
  if (!d.ok || d.value === null) throw new Error("find");
  return (d.value.extra["acceptance_criteria"] as unknown[] | undefined) ?? [];
}

describe("TG-45 ac add refuses an unparseable command", () => {
  it("AC-TG-45 refuses with VALIDATION_ERROR field command, rule ac-command-parses, the parser message; writes nothing", async () => {
    const { store, ac, specId } = await setup();
    const spies = WRITE_METHODS.map((m) =>
      vi.spyOn(store as unknown as Record<string, (...a: unknown[]) => unknown>, m),
    );
    const res = await ac.addCriterion(specId, criterion("AC-T-1", UNBALANCED));
    expect(res.ok).toBe(false);
    const e = (res as { error?: { code?: string; field?: string; message?: string } }).error;
    expect(e?.code).toBe("VALIDATION_ERROR");
    expect(e?.field).toBe("command");
    expect(e?.message).toContain("ac-command-parses");
    expect(e?.message).toMatch(PARSER_WORDS);
    expect(spies.reduce((n, s) => n + s.mock.calls.length, 0)).toBe(0);
    expect(await storedCriteria(store, specId)).toEqual([]);
  });

  it("CONTROL a quoted apostrophe is accepted", async () => {
    const { store, ac, specId } = await setup();
    const res = await ac.addCriterion(specId, criterion("AC-T-2", DOUBLE_QUOTED));
    expect(res.ok).toBe(true);
    expect(await storedCriteria(store, specId)).toHaveLength(1);
  });

  it("CONTROL a parseable command whose test would fail is still written (parse != run)", async () => {
    const { store, ac, specId } = await setup();
    const res = await ac.addCriterion(specId, criterion("AC-T-3", PARSES_BUT_FAILS));
    expect(res.ok).toBe(true);
    expect(await storedCriteria(store, specId)).toHaveLength(1);
  });

  it("parse only: a parseable command is never executed", async () => {
    const marker = `/tmp/lore-tg45-${process.pid}-${Date.now()}`;
    const { ac, specId } = await setup();
    const res = await ac.addCriterion(specId, criterion("AC-T-6", `touch ${marker}`));
    expect(res.ok).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });
});

describe("TG-45 every sanctioned path reaches the refusal", () => {
  it.each(["ac-verb", "create", "restore", "import"] as const)("path %s refuses an added unparseable command", (path) => {
    const res = applyAcChange(path, undefined, { acceptance_criteria: [criterion("AC-T-4", UNBALANCED)] });
    expect(res.ok).toBe(false);
    expect((res as { error: { field?: string; message?: string } }).error.field).toBe("command");
  });

  it("a changed command that becomes unparseable is refused; a reworded statement over a stored one is not re-checked", () => {
    const unchanged = applyAcChange(
      "ac-verb",
      { acceptance_criteria: [criterion("AC-T-5", UNBALANCED)] },
      { acceptance_criteria: [{ ...criterion("AC-T-5", UNBALANCED), statement: "reworded only" }] },
    );
    expect(unchanged.ok).toBe(true);
    const changed = applyAcChange(
      "ac-verb",
      { acceptance_criteria: [criterion("AC-T-5", "echo ok")] },
      { acceptance_criteria: [criterion("AC-T-5", UNBALANCED)] },
    );
    expect(changed.ok).toBe(false);
  });
});
