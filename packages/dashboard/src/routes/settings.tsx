/**
 * Settings route — two-scope config editing (SPEC-064 T4).
 * Path: /settings
 * Purpose: the ONLY UI surface for `.lore/config.yaml` (team scope, git-tracked,
 *   wins precedence) and the machine-scope XDG global config (never tracked,
 *   affects every corpus on this machine, loses precedence) — SPEC-062 shipped
 *   the write BACKEND with no UI; this route is that UI. Renders the two
 *   scopes as visually DISTINCT containers (never one undifferentiated list —
 *   see `ConfigScopePanel`'s two independent instances below) plus a shared
 *   `defaults.*` precedence table (SPEC-064 D4).
 * Concurrency: tracks each scope's own edit-session state independently (via
 *   `ConfigScopePanel`'s `onEditingChange`) and disables
 *   refetchOnWindowFocus/refetchOnReconnect on THAT scope's query while an
 *   edit session is open — same ASYNC2D-001 defense-in-depth pattern as
 *   `routes/docs.$id.tsx` (SPEC-064 D5, the SPEC-062-retro lost-update class).
 * SPEC-078 T10: no route-bound search/params here, so `SettingsPage` is
 *   exported and reused directly by the `/p/$name/settings` mirror route.
 *   `project` (`useProjectParam()`) threads into both config queries/saves
 *   AND `ConfigScopePanel`'s `project` prop (R-13 identity label next to
 *   Save/Edit).
 */

import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { computeDefaultsPrecedence } from "@lore/core";
import { apiGetConfig, apiGetMachineConfig } from "@/lib/api";
import { apiPatchConfig, apiPatchMachineConfig } from "@/api/mutations";
import { queryKeys, useProjectParam } from "@/lib/project-api";
import { ConfigScopePanel } from "@/components/ConfigScopePanel";
import { DefaultsPrecedenceTable } from "@/components/DefaultsPrecedenceTable";
import { TEAM_FIELD_SPECS, MACHINE_FIELD_SPECS } from "@/components/config-field-specs";
import { TriangleAlert } from "lucide-react";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

/** Exported for reuse by the `/p/$name/settings` mirror route (SPEC-078 T10). */
export function SettingsPage(): React.ReactElement {
  const project = useProjectParam();
  const queryClient = useQueryClient();
  const [isEditingTeam, setIsEditingTeam] = useState(false);
  const [isEditingMachine, setIsEditingMachine] = useState(false);

  const teamQuery = useQuery({
    queryKey: queryKeys.scope(project, ["config", "team"]),
    queryFn: () => apiGetConfig(project),
    refetchOnWindowFocus: !isEditingTeam,
    refetchOnReconnect: !isEditingTeam,
  });

  const machineQuery = useQuery({
    queryKey: queryKeys.scope(project, ["config", "machine"]),
    queryFn: () => apiGetMachineConfig(project),
    refetchOnWindowFocus: !isEditingMachine,
    refetchOnReconnect: !isEditingMachine,
  });

  const precedenceRows = computeDefaultsPrecedence(machineQuery.data?.config.defaults, teamQuery.data?.config.defaults);

  function invalidateTeam(): void {
    void queryClient.invalidateQueries({ queryKey: queryKeys.scope(project, ["config", "team"]) });
  }

  function invalidateMachine(): void {
    void queryClient.invalidateQueries({ queryKey: queryKeys.scope(project, ["config", "machine"]) });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Edit corpus configuration. Team settings are git-tracked and shared with everyone; machine settings
          apply only to this computer.
        </p>
      </div>

      {teamQuery.data !== undefined && (
        <DefaultsPrecedenceTable rows={precedenceRows} />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <ConfigScopePanel
          scope="team"
          title="Team — .lore/config.yaml"
          filePath=".lore/config.yaml (git-tracked — changes apply to the whole team)"
          fieldSpecs={TEAM_FIELD_SPECS}
          data={teamQuery.data}
          isLoading={teamQuery.isLoading}
          error={teamQuery.error}
          onSave={(patch, ifMatch) => apiPatchConfig(project, patch, ifMatch)}
          onSaved={invalidateTeam}
          onEditingChange={setIsEditingTeam}
          project={project}
          className="border-blue-200 dark:border-blue-900"
        />

        <ConfigScopePanel
          scope="machine"
          title="Machine — this computer only"
          filePath="~/.config/lore/config.yaml (never git-tracked)"
          fieldSpecs={MACHINE_FIELD_SPECS}
          data={machineQuery.data}
          isLoading={machineQuery.isLoading}
          error={machineQuery.error}
          onSave={(patch, ifMatch) => apiPatchMachineConfig(project, patch, ifMatch)}
          onSaved={invalidateMachine}
          onEditingChange={setIsEditingMachine}
          project={project}
          className="border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/10"
          headerExtra={
            <div
              className="mb-3 flex items-start gap-2 rounded-md border border-amber-400 bg-amber-100 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
              data-testid="machine-blast-radius-disclosure"
            >
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                These values affect every corpus on this machine, even though you are editing them from this
                one corpus's dashboard.
              </span>
            </div>
          }
        />
      </div>
    </div>
  );
}
