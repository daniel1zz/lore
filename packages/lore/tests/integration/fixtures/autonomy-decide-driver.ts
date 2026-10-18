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
import { liveInvocation } from "../../live-invocation.js";
import { runDecideFlow } from "../../../src/adapters/cli/decide-flow.js";
import { createProductionHumanChannelPorts } from "../../../src/adapters/real-human-channel-port.js";

const [dbPath, id, flag, reason] = process.argv.slice(2);
if (dbPath === undefined || id === undefined || flag === undefined) {
  process.stderr.write("usage: autonomy-decide-driver <dbPath> <id> <--accept|--reject> [reason]\n");
  process.exit(64);
}

const parentCommand = process.env["FIXTURE_ANCESTRY_COMMAND"];
const ports = createProductionHumanChannelPorts(liveInvocation(), {
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
  { dbPath, id, accept: flag === "--accept", reject: flag === "--reject", ...(reason === undefined ? {} : { reason }) },
  ports,
);
process.exit(exit);
