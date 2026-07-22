/**
 * DefaultsPrecedenceTable — read-only display of the `defaults.*` (editor /
 * format / color) precedence across machine, project (team), and built-in
 * layers (SPEC-064 §Design D4). Rows come from the IMPORTED
 * `computeDefaultsPrecedence` (`@lore/core`) — this component never
 * re-derives project-wins precedence itself.
 *
 * Public surface: DefaultsPrecedenceTable
 * Invariants:
 *   - Purely presentational — takes `rows: DefaultsPrecedenceRow[]` and
 *     renders them; no computation happens here.
 *   - Exactly one layer cell per row is marked effective (`row.effectiveLayer`,
 *     already computed) via a highlighted background + a `data-effective`
 *     marker attribute, matching AC-064-1's "exactly 1 marked effective".
 * Side-effect class: pure (render only)
 * Source: SPEC-064 §Design D4
 */

import type { DefaultsPrecedenceRow } from "@lore/core";

/** Props for {@link DefaultsPrecedenceTable}. */
export interface DefaultsPrecedenceTableProps {
  rows: readonly DefaultsPrecedenceRow[];
}

function formatCell(value: unknown): string {
  return value === undefined ? "—" : typeof value === "string" ? value : JSON.stringify(value);
}

function LayerCell({ value, isEffective }: { value: unknown; isEffective: boolean }): React.ReactElement {
  return (
    <td
      className={
        "py-1.5 px-2 text-xs font-mono " +
        (isEffective ? "bg-primary/10 font-semibold" : "text-muted-foreground")
      }
      data-effective={isEffective ? "true" : undefined}
    >
      {formatCell(value)}
      {isEffective && <span className="ml-1 text-[10px] font-sans text-primary">(effective)</span>}
    </td>
  );
}

/**
 * Renders one row per `defaults.*` key showing machine / project / built-in
 * values with the effective layer highlighted.
 */
export function DefaultsPrecedenceTable({ rows }: DefaultsPrecedenceTableProps): React.ReactElement {
  return (
    <div className="rounded-lg border p-4" data-testid="defaults-precedence">
      <h3 className="text-sm font-semibold mb-1">CLI defaults — resolution order</h3>
      <p className="text-xs text-muted-foreground mb-3">
        Project (team) values win over machine values, which win over built-in defaults.
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="pb-1 pr-2">Key</th>
            <th className="pb-1 px-2">Machine</th>
            <th className="pb-1 px-2">Project (team)</th>
            <th className="pb-1 px-2">Built-in</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t" data-testid={`precedence-row-${row.key}`}>
              <td className="py-1.5 pr-2 font-mono">{row.key}</td>
              <LayerCell value={row.machine} isEffective={row.effectiveLayer === "machine"} />
              <LayerCell value={row.project} isEffective={row.effectiveLayer === "project"} />
              <LayerCell value={row.builtin} isEffective={row.effectiveLayer === "builtin"} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
