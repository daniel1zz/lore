/**
 * D2 (SPEC-073): citty's own built-in usage renderer (`renderUsage`,
 * `node_modules/citty/dist/index.mjs`) hardcodes EVERY declared alias —
 * regardless of length — as a single-dash token:
 *   `[...(arg.alias || []).map((a) => `-${a}`), `--${arg.name}`].join(", ")`
 * For a genuinely single-character alias (`-y`) that IS the correct
 * POSIX/citty convention. citty's own `ArgDef.alias` type permits any
 * string, though — so a MULTI-character alias (`lore verify`'s
 * `"allow-new-commands"` declares `alias: "yes"`) renders as
 * `-yes, --allow-new-commands`, actively teaching the exact broken
 * invocation SPEC-073 D1's `findSingleDashViolation` (`strict-flags.ts`) now
 * rejects — `-yes` is not `--yes`.
 *
 * Root-caused against citty 0.1.6's built-in renderer (verified in
 * `node_modules/citty/dist/index.mjs`'s `renderUsage` function body — no
 * config knob suppresses this, the single-dash prefix is unconditional).
 * citty exposes a supported override point instead of requiring a fork:
 * `runMain(cmd, opts)` accepts `opts.showUsage`, an alternative to its own
 * built-in `showUsage` (`node_modules/citty/dist/index.d.ts`'s
 * `RunMainOptions`). This module is the ONE post-process transform, wired at
 * the ONE `runMain()` call site (`../../index.ts`) — never per-command, never
 * a citty fork/patch.
 *
 * Public surface:
 *   - `fixSingleDashAliasRendering` — pure string transform over citty's own
 *     rendered usage text.
 *   - `renderUsageDoubleDash` — the `showUsage`-shaped composition-site
 *     wrapper `runMain({ showUsage })` is given; defers to citty's own
 *     `renderUsage` for every actual rendering decision (colors, column
 *     alignment, section layout) and applies ONLY the transform above before
 *     printing.
 *
 * Side-effect class: `fixSingleDashAliasRendering` is pure (no IO).
 * `renderUsageDoubleDash` is IO (delegates to citty's `renderUsage`, an
 * async fn that may itself resolve `Resolvable` values, then
 * `console.log`s) — this is citty's OWN side-effect shape for `showUsage`,
 * unchanged by this module.
 *
 * Source: SPEC-073 §Design D2
 */

import { renderUsage } from "citty";
import type { CommandDef } from "citty";

/**
 * Rewrite every single-dash, 2+-character token citty's `renderUsage`
 * rendered — i.e. an alias it printed as `-yes` — to its double-dash form
 * (`--yes`). A single-dash SINGLE-character token (`-h`) is left untouched:
 * that is citty's own legitimate POSIX short-flag rendering, unaffected by
 * SPEC-073. The negative lookbehind additionally excludes any `-`
 * immediately preceded by a word character or another `-`, so it never
 * touches the second dash of an already-double-dash token, nor an internal
 * hyphen inside a multi-word flag name (`--no-force`'s internal `-` sits
 * between two word characters and is excluded the same way).
 *
 * @param usageText - the raw string citty's own `renderUsage` returned
 * @returns the same text with every single-dash multi-char alias token
 *   rewritten to double-dash; everything else byte-identical
 * @example
 *   fixSingleDashAliasRendering("`-yes, --allow-new-commands`")
 *   // "`--yes, --allow-new-commands`"
 * @example
 *   fixSingleDashAliasRendering("`-h, --help`") // unchanged — -h is 1 char
 * @example
 *   fixSingleDashAliasRendering("`--no-force`") // unchanged — internal hyphen
 */
export function fixSingleDashAliasRendering(usageText: string): string {
  return usageText.replace(/(?<![\w-])-([a-zA-Z][\w-]+)/g, "--$1");
}

/**
 * `showUsage`-shaped composition-site wrapper (matches citty's own
 * `RunMainOptions["showUsage"]` signature exactly) — delegates the ENTIRE
 * rendering computation to citty's `renderUsage`, then applies the ONE
 * SPEC-073 D2 fix above before printing. Wired via
 * `runMain(main, { showUsage: renderUsageDoubleDash })` at the single CLI
 * entry point (`../../index.ts`) — never per-command.
 *
 * @param cmd - the resolved leaf/group CommandDef citty is about to render
 *   usage for (`--help`, or an unhandled `CLIError`'s auto usage-dump)
 * @param parent - the resolved parent CommandDef, if any (nested subcommand
 *   help, e.g. `lore phase add --help`)
 */
export async function renderUsageDoubleDash(cmd: CommandDef<any>, parent?: CommandDef<any>): Promise<void> {
  const text = await renderUsage(cmd, parent);
  // reason: this module's SOLE sanctioned CLI-surface console use — mirrors
  // citty's own built-in `showUsage`'s `consola.log(text + "\n")` call
  // exactly (see this file's header); it is not a debug/log statement, it
  // IS the `--help` output.
  console.log(fixSingleDashAliasRendering(text) + "\n");
}
