/**
 * ConfigScopePanel — the generic, reusable editor for ONE config scope (team
 * or machine), driven entirely by a declared `FieldSpec[]` plus the loaded
 * `ConfigReadResponse` (SPEC-064 T4). Both the Team and Machine containers on
 * `routes/settings.tsx` render one instance of this component each, with
 * different `fieldSpecs`/`onSave` — the row rendering, deny-key detection,
 * edit-session CAS-freeze, and conflict handling are scope-agnostic and live
 * here exactly once.
 *
 * Public surface: ConfigScopePanel, ConfigScopePanelProps
 * Invariants:
 *   - D2: the server is the boundary. This component NEVER decides on its own
 *     that a key is safe to edit — every row's "editable" classification comes
 *     from `findDeniedConfigKeys` (`@lore/core`, the SAME table
 *     `ConfigService`/`GlobalConfigService` enforce server-side) run against a
 *     PROBE object built from `fieldSpecs` — so a denied key renders ZERO
 *     enabled `<input>`/`<select>` elements, only plain text, regardless of
 *     `isEditing` (D1/D2, AC-064-1).
 *   - Row set is the UNION of (a) every declared `fieldSpecs` path — rendered
 *     even when currently ABSENT from the loaded config, so e.g. `sync.enabled`
 *     has a row to toggle on even on a fresh corpus with no `sync:` section —
 *     and (b) every OTHER leaf actually present in the loaded config
 *     (`flattenConfigLeafPaths`), rendered read-only — this is what makes
 *     "every CONFIG_DENY_KEYS entry present in either config" (AC-064-1)
 *     satisfied even for a denied key outside the curated field list (e.g. an
 *     `ai.providers.<name>.command` entry a fixture happens to seed).
 *   - D5: `Edit` freezes `baseHash`/`baseline` from the CURRENT query data at
 *     click-time; `onEditingChange` is called so the caller can disable
 *     refetchOnWindowFocus/refetchOnReconnect on the underlying query while an
 *     edit session is open (mirrors `DocDetail`'s `editBaseVersion` precedent
 *     exactly — the SPEC-062-retro lost-update class this spec explicitly
 *     calls out).
 *   - The outgoing patch is built via `buildPatchFromChangedPaths` over ONLY
 *     the editable `fieldSpecs` paths — never the whole draft tree — so
 *     `restart_required` in the save result reflects exactly what the user
 *     changed (SPEC-062 D5), never every restart-classified key regardless of
 *     whether it was touched.
 *   - A 409 (`ConfigConflictError`) never triggers a silent retry/force —
 *     `ConfigConflictModal` is shown and the write is confirmed to have never
 *     happened (server rejects before touching disk).
 *
 * Side-effect class: IO (via the injected `onSave`/`onSaved` callbacks — this
 *   component itself calls neither `fetch` nor `@lore/core/node`)
 * Source: SPEC-064 §Design D1, D2, D4 (precedence is a SIBLING display, not
 *   here), D5, D6
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ConfigEffect } from "@lore/core";
import { classifyConfigEffect, findDeniedConfigKeys, flattenConfigLeafPaths } from "@lore/core";
import type { ConfigReadResponse } from "@/lib/api";
import { ConfigConflictError, DashboardApiError, type ConfigUpdateResult } from "@/api/mutations";
import { buildPatchFromChangedPaths, getByPath, setByPath } from "@/components/config-path-utils";
import type { FieldSpec } from "@/components/config-field-specs";
import { ConfigConflictModal, type ConfigConflictRow } from "@/components/ConfigConflictModal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectIdentityLabel } from "@/components/ProjectIdentityLabel";

/** Props for {@link ConfigScopePanel} — one scope's config editor, driven entirely by `fieldSpecs`. */
export interface ConfigScopePanelProps<C> {
  /** Machine-readable scope id, used in test ids (`"team" | "machine"`). */
  scope: "team" | "machine";
  title: string;
  /** Human-readable file path shown in the "edit via YAML" note. */
  filePath: string;
  fieldSpecs: readonly FieldSpec[];
  data: ConfigReadResponse<C> | undefined;
  isLoading: boolean;
  error: unknown;
  onSave: (patch: Record<string, unknown>, ifMatch: string) => Promise<ConfigUpdateResult<C>>;
  /** Called after a successful save (and after a discarded conflict) — the caller should invalidate/refetch its query. */
  onSaved: () => void;
  onEditingChange?: (isEditing: boolean) => void;
  className?: string;
  /** Extra content rendered in the panel header, ABOVE the field rows — e.g. the machine scope's blast-radius disclosure. */
  headerExtra?: React.ReactNode;
  /**
   * Active project (SPEC-078 T10 R-13) — rendered via `ProjectIdentityLabel`
   * immediately adjacent to the Save/Edit controls. `undefined`/`null` both
   * render nothing (registry-less mode, R-15 byte-identical default).
   */
  project?: string | null;
}

interface ConfigRow {
  path: string;
  label: string;
  section: string;
  type: FieldSpec["type"];
  options?: readonly string[];
  editable: boolean;
}

function formatDisplayValue(value: unknown): string {
  if (value === undefined) return "(unset)";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function buildRows(config: unknown, fieldSpecs: readonly FieldSpec[], deniedPaths: ReadonlySet<string>): ConfigRow[] {
  const rows: ConfigRow[] = [];
  const seen = new Set<string>();
  for (const spec of fieldSpecs) {
    rows.push({
      path: spec.path,
      label: spec.label,
      section: spec.section,
      type: spec.type,
      editable: !deniedPaths.has(spec.path),
      // reason: exactOptionalPropertyTypes — conditional spread omits the key
      // entirely when absent, rather than setting `options: undefined`
      // (mirrors the codebase's existing pattern, e.g. routes/library.tsx).
      ...(spec.options !== undefined ? { options: spec.options } : {}),
    });
    seen.add(spec.path);
  }
  for (const path of flattenConfigLeafPaths(config)) {
    if (seen.has(path)) continue;
    const section = path.split(".")[0] ?? path;
    rows.push({ path, label: path, section, type: "string", editable: false });
    seen.add(path);
  }
  rows.sort((a, b) => (a.section === b.section ? a.path.localeCompare(b.path) : a.section.localeCompare(b.section)));
  return rows;
}

function EditableInput({
  row,
  value,
  onChange,
}: {
  row: ConfigRow;
  value: unknown;
  onChange: (path: string, value: unknown) => void;
}): React.ReactElement {
  if (row.type === "boolean") {
    return (
      <input
        type="checkbox"
        className="h-4 w-4"
        checked={Boolean(value)}
        onChange={(e) => onChange(row.path, e.target.checked)}
        data-testid={`config-input-${row.path}`}
      />
    );
  }
  if (row.type === "number") {
    return (
      <Input
        type="number"
        className="h-7 w-28 text-xs"
        value={value === undefined ? "" : String(value)}
        onChange={(e) => onChange(row.path, e.target.value === "" ? undefined : Number(e.target.value))}
        data-testid={`config-input-${row.path}`}
      />
    );
  }
  if (row.type === "enum") {
    return (
      <select
        className="h-7 rounded border bg-background px-1 text-xs"
        value={value === undefined ? "" : String(value)}
        onChange={(e) => onChange(row.path, e.target.value)}
        data-testid={`config-input-${row.path}`}
      >
        <option value="">(unset)</option>
        {(row.options ?? []).map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }
  return (
    <Input
      type="text"
      className="h-7 w-48 text-xs"
      value={value === undefined ? "" : String(value)}
      onChange={(e) => onChange(row.path, e.target.value)}
      data-testid={`config-input-${row.path}`}
    />
  );
}

function ConfigRowView({
  row,
  value,
  effect,
  isEditing,
  onChange,
}: {
  row: ConfigRow;
  value: unknown;
  effect: ConfigEffect;
  isEditing: boolean;
  onChange: (path: string, value: unknown) => void;
}): React.ReactElement {
  const showInput = isEditing && row.editable;
  return (
    <div
      className="flex items-center justify-between gap-4 py-2 border-b last:border-0"
      data-testid={`config-row-${row.path}`}
      data-denied={row.editable ? undefined : "true"}
    >
      <div className="min-w-0">
        <div className="text-xs font-mono truncate">{row.path}</div>
        <div className="text-[11px] text-muted-foreground">{row.label}</div>
        {!row.editable && (
          <div className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">Read-only — edit via YAML</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground"
          data-testid={`config-effect-${row.path}`}
        >
          {effect === "restart_required" ? "restart required" : "live"}
        </span>
        {showInput ? (
          <EditableInput row={row} value={value} onChange={onChange} />
        ) : (
          <span className="max-w-[220px] truncate font-mono text-xs" title={formatDisplayValue(value)}>
            {formatDisplayValue(value)}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * One scope's config editor — see module header for the full contract.
 */
export function ConfigScopePanel<C>({
  scope,
  title,
  filePath,
  fieldSpecs,
  data,
  isLoading,
  error,
  onSave,
  onSaved,
  onEditingChange,
  className,
  headerExtra,
  project = null,
}: ConfigScopePanelProps<C>): React.ReactElement {
  const [isEditing, setIsEditing] = useState(false);
  const [baseHash, setBaseHash] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<unknown>(null);
  const [draft, setDraft] = useState<unknown>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ updated: string[]; restart_required: string[] } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConfigConflictError | null>(null);

  // reason: SPEC-064 D5 — let the caller (routes/settings.tsx) disable
  // refetchOnWindowFocus/refetchOnReconnect on THIS scope's query while an
  // edit session is open, mirroring DocDetail.tsx's identical precedent.
  // Optional/no-op when the caller doesn't wire it.
  useEffect(() => {
    onEditingChange?.(isEditing);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fire ONLY on isEditing transitions, not on onEditingChange identity churn (optional broadcast callback, see reason above)
  }, [isEditing]);

  const { deniedPaths, rows } = useMemo(() => {
    if (data === undefined) return { deniedPaths: new Set<string>(), rows: [] as ConfigRow[] };
    // reason: probe includes every curated field path (even if absent from the
    // real config) UNIONED with the real config's own leaves — deny
    // classification depends only on the PATH, not the value, so setting
    // arbitrary probe values is safe (SPEC-064 D2).
    // reason: `data.config` is already server-validated (`LoreConfigSchema`/
    // `GlobalLoreConfigSchema`, both plain objects) — widening to `object` here
    // is only to seed `setByPath`'s generic accumulator, not a claim about an
    // unverified runtime shape.
    const probe = fieldSpecs.reduce<object>((acc, spec) => setByPath(acc, spec.path, true), data.config as object);
    const denied = new Set(findDeniedConfigKeys(probe));
    return { deniedPaths: denied, rows: buildRows(data.config, fieldSpecs, denied) };
  }, [data, fieldSpecs]);

  function getEffect(path: string): ConfigEffect {
    return data?.effects[path] ?? classifyConfigEffect(path);
  }

  function startEditing(): void {
    if (data === undefined) return;
    setBaseHash(data.hash);
    setBaseline(data.config);
    setDraft(data.config);
    setSaveResult(null);
    setSaveError(null);
    setIsEditing(true);
  }

  function cancelEditing(): void {
    setIsEditing(false);
    setBaseHash(null);
    setBaseline(null);
    setDraft(null);
    setSaveError(null);
  }

  function handleFieldChange(path: string, value: unknown): void {
    setDraft((prev: unknown) => setByPath(prev, path, value));
  }

  const editableCandidatePaths = useMemo(
    () => fieldSpecs.filter((spec) => !deniedPaths.has(spec.path)).map((spec) => spec.path),
    [fieldSpecs, deniedPaths],
  );

  async function handleSave(): Promise<void> {
    if (baseHash === null || isSaving) return;
    const { patch, changedPaths } = buildPatchFromChangedPaths(baseline, draft, editableCandidatePaths);
    if (changedPaths.length === 0) {
      cancelEditing();
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await onSave(patch, baseHash);
      setSaveResult({ updated: result.updated, restart_required: result.restart_required });
      toast.success(
        `${title} saved — ${result.updated.length} key(s) updated` +
          (result.restart_required.length > 0 ? `, ${result.restart_required.length} need a restart` : ""),
      );
      cancelEditing();
      onSaved();
    } catch (err) {
      if (err instanceof ConfigConflictError) {
        setConflict(err);
      } else {
        const message = err instanceof DashboardApiError ? err.message : "Failed to save config";
        setSaveError(message);
        toast.error(message);
      }
    } finally {
      setIsSaving(false);
    }
  }

  function handleConflictDiscard(): void {
    setConflict(null);
    cancelEditing();
    onSaved();
  }

  function handleConflictAdoptFreshBase(): void {
    if (conflict === null) return;
    // reason: `draft` already holds ABSOLUTE target values (not deltas), so
    // keeping it as-is and only swapping the baseline/hash is correct — the
    // next Save recomputes the diff against the fresh baseline.
    setBaseHash(conflict.currentHash);
    setBaseline(conflict.currentConfig);
    setConflict(null);
  }

  // reason: intentionally recomputed ONLY when a NEW conflict object arrives
  // (not on every draft keystroke) — this list is a snapshot of "what did the
  // user attempt" at the moment of rejection, read from `baseline`/`draft`
  // which are stable for the conflict's lifetime (nothing else mutates them
  // while `conflict !== null` — `handleFieldChange` is unreachable, the
  // editable inputs are replaced by `ConfigConflictModal`).
  const conflictChangedRows: ConfigConflictRow[] = useMemo(() => {
    if (conflict === null) return [];
    return editableCandidatePaths
      .filter((path) => !Object.is(getByPath(baseline, path), getByPath(draft, path)))
      .map((path) => ({
        path,
        label: fieldSpecs.find((s) => s.path === path)?.label ?? path,
        mine: getByPath(draft, path),
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: recompute ONLY when a NEW conflict object arrives, not on every draft keystroke (baseline/draft are frozen for the conflict's lifetime, see reason above)
  }, [conflict]);

  let lastSection = "";

  return (
    <div className={`rounded-lg border p-4 ${className ?? ""}`} data-testid={`settings-${scope}-scope`}>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{filePath}</p>
        </div>
        {!isLoading && error === null && data !== undefined && (
          <div className="flex items-center gap-2">
            <ProjectIdentityLabel project={project} />
            {isEditing ? (
              <>
                <Button variant="outline" size="sm" onClick={cancelEditing} disabled={isSaving}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleSave()}
                  disabled={isSaving}
                  data-testid={`settings-${scope}-save`}
                >
                  {isSaving ? "Saving…" : "Save"}
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={startEditing} data-testid={`settings-${scope}-edit`}>
                Edit
              </Button>
            )}
          </div>
        )}
      </div>

      {headerExtra}

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-3/4" />
        </div>
      )}

      {!isLoading && error !== null && (
        <div
          className="rounded-md border border-destructive/50 p-3 text-sm text-destructive"
          data-testid={`settings-${scope}-error`}
        >
          Failed to load {scope} config: {error instanceof Error ? error.message : "unknown error"}
        </div>
      )}

      {!isLoading && error === null && data !== undefined && (
        <div>
          {rows.map((row) => {
            const showSection = row.section !== lastSection;
            lastSection = row.section;
            const value = isEditing ? getByPath(draft, row.path) : getByPath(data.config, row.path);
            return (
              <div key={row.path}>
                {showSection && (
                  <h3 className="mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">
                    {row.section}
                  </h3>
                )}
                <ConfigRowView
                  row={row}
                  value={value}
                  effect={getEffect(row.path)}
                  isEditing={isEditing}
                  onChange={handleFieldChange}
                />
              </div>
            );
          })}
        </div>
      )}

      {saveError !== null && (
        <div className="mt-3 rounded-md border border-destructive/50 p-2 text-xs text-destructive">{saveError}</div>
      )}

      {saveResult !== null && (
        <div className="mt-3 rounded-md border p-2 text-xs" data-testid={`settings-${scope}-save-result`}>
          <div>Updated: {saveResult.updated.length === 0 ? "(none)" : saveResult.updated.join(", ")}</div>
          <div data-testid={`settings-${scope}-restart-required`}>
            Restart required:{" "}
            {saveResult.restart_required.length === 0 ? "(none)" : saveResult.restart_required.join(", ")}
          </div>
        </div>
      )}

      {conflict !== null && (
        <ConfigConflictModal
          scopeLabel={scope}
          currentConfig={conflict.currentConfig}
          currentHash={conflict.currentHash}
          changedRows={conflictChangedRows}
          onDiscard={handleConflictDiscard}
          onAdoptFreshBase={handleConflictAdoptFreshBase}
        />
      )}
    </div>
  );
}
