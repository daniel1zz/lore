/**
 * Test driver for the AC-AU-3 positive control: runs the REAL `lore decide` flow (runDecideFlow, real TTY checks,
 * real /dev/tty nonce prompt, real store) with ONE injected port — the process-table reader — so a test process that
 * itself runs under an agent harness can still exercise the success path.
 *
 * Why a driver and not an env switch on the product: a switch in the production path that points the ancestry check
 * at a fixture is exactly the hole an agent would use. The product has no such switch; production wiring is asserted
 * separately by the tests that spawn the real CLI (`src/index.ts`) and a real fake-`claude` ancestor.
 *
 * argv: <dbPath> <pendingId> <--accept|--reject> [reason]
 * env:  FIXTURE_ANCESTRY_COMMAND — when set, the synthetic ancestry carries that command as the driver's parent.
 */
import { deriveHumanRunId, type Invocation } from "@lore/core";
import { actedStore, liveInvocation } from "../../live-invocation.js";
import { RunService } from "../../../src/service/run-service.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { runDecideFlow } from "../../../src/adapters/cli/decide-flow.js";
import { createProductionHumanChannelPorts } from "../../../src/adapters/real-human-channel-port.js";

const [dbPath, id, flag, reason] = process.argv.slice(2);
if (dbPath === undefined || id === undefined || flag === undefined) {
  process.stderr.write("usage: autonomy-decide-driver <dbPath> <id> <--accept|--reject> [reason]\n");
  process.exit(64);
}

// The driver stands for the person at the terminal, so it runs as a HUMAN party (never an agent run: the channel refuses
// an agent identity, BR-1350). The person's run is registered in the corpus the way `lore session start --human` does it.
const HUMAN_TOKEN_HASH = "ab".repeat(32);
const humanStore = actedStore(new SQLiteStore(dbPath));
const registered = await new RunService(humanStore, undefined, undefined, undefined, process.cwd()).registerParty({
  harness: "human",
  name: "driver",
  tokenHash: HUMAN_TOKEN_HASH,
});
humanStore.close();
if (!registered.ok) {
  process.stderr.write(`driver: registering the human run failed: ${JSON.stringify(registered.error)}\n`);
  process.exit(65);
}
const invocation: Invocation = {
  ...liveInvocation(),
  identity: { harnessRun: deriveHumanRunId(HUMAN_TOKEN_HASH), claimed: "driver", claimedSource: "human" },
};

const parentCommand = process.env["FIXTURE_ANCESTRY_COMMAND"];
const ports = createProductionHumanChannelPorts(invocation, {
  readProcessTable: () => ({
    ok: true as const,
    value:
      parentCommand === undefined
        ? [
            { pid: process.pid, ppid: 1, command: "fixture-driver" },
            { pid: 1, ppid: 0, command: "init" },
          ]
        : [
            { pid: process.pid, ppid: process.pid + 1, command: "fixture-driver" },
            { pid: process.pid + 1, ppid: 1, command: parentCommand },
            { pid: 1, ppid: 0, command: "init" },
          ],
  }),
});

const exit = await runDecideFlow(
  invocation,
  { dbPath, id, accept: flag === "--accept", reject: flag === "--reject", ...(reason === undefined ? {} : { reason }) },
  ports,
);
process.exit(exit);
