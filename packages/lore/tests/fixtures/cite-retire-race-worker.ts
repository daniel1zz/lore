/**
 * @spec_ref AC-BLS2-3
 *
 * Child-process worker for tests/unit/store/cite-retire-race.bun.test.ts.
 * Lives under tests/fixtures (inside the repo tree) so the bare `@lore/core`
 * specifier used by production source resolves via the repo's node_modules.
 *
 * argv: dbPath role target readyFile barrierFile resultPath mode armedBranch actor
 *   role   = "cite"   -> target is a spec id; cites BR-1 on criterion AC-R-1
 *   role   = "retire" -> target is a rule id; retires it
 *   mode   = off | report | enforce  (the `workflow.gates."ac-cite"` mode)
 *   armedBranch = baseline branch slug armed for the gate, or "-" for none
 *
 * Each worker opens its OWN SQLiteStore connection on the shared file, signals
 * readiness, spins on the barrier file, performs ONE write, and writes
 * `{ ok: true } | { ok: false, code, message }` to resultPath.
 */
import { existsSync, writeFileSync } from "node:fs";
import { AcService } from "../../src/service/ac-service.js";
import { RuleService } from "../../src/service/rule-service.js";
import { SQLiteStore } from "../../src/store/sqlite-store.js";

const [dbPath, role, target, readyFile, barrierFile, resultPath, mode, armedBranch, actor] = process.argv.slice(2);
if (!dbPath || !role || !target || !readyFile || !barrierFile || !resultPath || !mode || !armedBranch || !actor) {
  throw new Error("cite-retire-race-worker: missing argv");
}

const store = new SQLiteStore(dbPath);
// PINNED CONTRACT (C4/D6): the gate config is handed to AcService as the 2nd constructor
// argument. Today's AcService ignores it (report-only citing) — that is the RED state.
const AcServiceCtor = AcService as unknown as new (s: SQLiteStore, opts: Record<string, unknown>) => AcService;
const ac = new AcServiceCtor(store, {
  citeGate: { mode, armed_branches: armedBranch === "-" ? [] : [armedBranch] },
});
const rules = new RuleService(store);

writeFileSync(readyFile, "ready");
while (!existsSync(barrierFile)) Bun.sleepSync(1);

let outcome: { ok: true } | { ok: false; code: string; message: string };
try {
  if (role === "cite") {
    const r = await ac.citeCriterion(target, "AC-R-1", ["BR-1"], {}, { by: actor });
    outcome = r.ok ? { ok: true } : { ok: false, code: String(r.error.code), message: JSON.stringify(r.error) };
  } else {
    const r = await rules.setRule(target, { lifecycle: "retired", note: "retired by the race test" }, { by: actor });
    outcome = r.ok ? { ok: true } : { ok: false, code: String(r.error.code), message: JSON.stringify(r.error) };
  }
} catch (cause) {
  outcome = { ok: false, code: "THROWN", message: String(cause) };
}
writeFileSync(resultPath, JSON.stringify(outcome));
store.close();
