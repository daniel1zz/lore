/**
 * Test fixture script: `bun run approve-nodes-cli.ts <corpus.db> <node>...` (or `--all` for every baseline node holding a pending
 * revision) approves every pending revision of each baseline node in a throwaway corpus file, through a bare `ReviewService` (no AI judge). The synchronous fixtures (`ensureLiveRuleViaCli`)
 * cannot await an in-process approval, so they spawn this once.
 *
 * Invariants: refuses (non-zero exit, message on stderr) when a node cannot be approved; never touches a corpus it was not
 * handed (the path is its only input). Side-effect class: store write (test-only).
 */

import { SQLiteStore } from "../../src/store/sqlite-store";
import { declareWriteActorForTests } from "../../src/store/write-context-store";
import { pendingCountOf } from "../../src/service/baseline-pending";
import { approvePending } from "./approve-baseline";

const [dbPath, ...nodes] = process.argv.slice(2);
if (dbPath === undefined || nodes.length === 0) {
  process.stderr.write("usage: approve-nodes-cli.ts <corpus.db> <node>...\n");
  process.exit(2);
}
const store = declareWriteActorForTests(new SQLiteStore(dbPath), "agent:fixture");
try {
  if (nodes.length === 1 && nodes[0] === "--all") {
    const baseline = await store.findMany({ type: "baseline" });
    if (!baseline.ok) throw new Error(`listing baseline nodes failed: ${JSON.stringify(baseline.error)}`);
    for (const node of baseline.value) if (pendingCountOf(node.extra) > 0) await approvePending(store, node.id);
  } else {
    for (const node of nodes) await approvePending(store, node);
  }
} catch (cause) {
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exit(1);
} finally {
  store.close();
}
