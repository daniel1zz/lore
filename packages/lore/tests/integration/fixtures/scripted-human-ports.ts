/**
 * In-process HumanChannelPorts for tests: a clean TTY, clean env, clean ancestry, and a scripted terminal that
 * types back whatever `typeBack(nonce)` returns. This is the INJECTABLE SEAM of the human channel — the only way a
 * test (or any in-process caller) obtains a HumanChannelProof without a real pseudo-terminal. It is a test fixture:
 * the product CLI never builds ports like this.
 */
import type { HumanChannelPorts } from "../../../src/service/human-channel.js";

export interface ScriptedPortsOptions {
  /** What the "human" types after seeing the nonce. Default: the nonce itself (correct answer). */
  readonly typeBack?: (nonce: string) => string;
  readonly stdinIsTty?: boolean;
  readonly stdoutIsTty?: boolean;
  readonly env?: Record<string, string | undefined>;
  readonly argv?: readonly string[];
  readonly parentCommand?: string;
  /** Collects everything written to the terminal (where the nonce is shown). */
  readonly terminalLog?: string[];
}

export function scriptedHumanPorts(options: ScriptedPortsOptions = {}): HumanChannelPorts {
  const typeBack = options.typeBack ?? ((nonce: string) => nonce);
  const log = options.terminalLog ?? [];
  let lastNonce = "";
  let counter = 0;
  return {
    stdinIsTty: () => options.stdinIsTty ?? true,
    stdoutIsTty: () => options.stdoutIsTty ?? true,
    env: () => options.env ?? {},
    argv: () => options.argv ?? [],
    selfPid: () => 4242,
    readProcessTable: () => ({
      ok: true as const,
      value:
        options.parentCommand === undefined
          ? [
              { pid: 4242, ppid: 1, command: "scripted-test" },
              { pid: 1, ppid: 0, command: "init" },
            ]
          : [
              { pid: 4242, ppid: 4243, command: "scripted-test" },
              { pid: 4243, ppid: 1, command: options.parentCommand },
              { pid: 1, ppid: 0, command: "init" },
            ],
    }),
    newNonce: () => {
      counter += 1;
      lastNonce = `TESTN0${String(counter).padStart(2, "0")}`.slice(0, 8);
      return lastNonce;
    },
    openTerminal: () => ({
      write: (text: string) => {
        log.push(text);
      },
      readLine: () => typeBack(lastNonce),
      close: () => undefined,
    }),
  };
}
