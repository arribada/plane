/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The page a project opens on: the plan window, the numbers that matter, what
 * needs attention, and the way out to everything else. One aggregate endpoint
 * feeds the whole tree, so opening a project stays a single round trip.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Loader2, Settings2, Sparkles, Wand2 } from "lucide-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { useUserPermissions } from "@/hooks/store/user";
import { AiPlanModal } from "@/plane-web/components/planning/ai-plan-modal";
import { AiSettingsModal } from "@/plane-web/components/planning/ai-settings-modal";
import { ProjectSetupWizard } from "@/plane-web/components/planning/project-setup-wizard";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TProjectOverview } from "@/plane-web/types/arribada";
import { OverviewHeaderBlock } from "./header-block";
import { OverviewJumpBar } from "./jump-bar";
import { OverviewKpiTiles } from "./kpi-tiles";
import { OverviewLinksBlock } from "./links-block";
import { OverviewProgressSections } from "./progress-sections";
import { OverviewWarnings } from "./warnings-block";

const LINKS_ANCHOR = "arribada-project-links";

export const ProjectOverviewRoot = observer(function ProjectOverviewRoot() {
  const { workspaceSlug, projectId } = useParams();
  const service = useMemo(() => new ArribadaService(), []);
  const { allowPermissions } = useUserPermissions();
  const slug = workspaceSlug?.toString();
  const pid = projectId?.toString();

  const [data, setData] = useState<TProjectOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [linksEditorOpen, setLinksEditorOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  // Which project the page already showed, so a post-save refetch swaps the data
  // in place instead of blanking the page behind a spinner.
  const loadedKey = useRef<string | null>(null);

  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (slug && pid) {
      const key = `${slug}/${pid}`;
      if (loadedKey.current !== key) setLoading(true);
      service
        .getProjectOverview(slug, pid)
        .then((r) => {
          if (!cancelled) {
            setData(r ?? null);
            loadedKey.current = key;
          }
          return undefined;
        })
        .catch(() => {
          if (!cancelled) setData(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [service, slug, pid, reloadToken]);

  // Only the PUT behind this modal is admin-only — the GET answers members and
  // guests too, so the role is what decides whether the entry point is shown.
  const canOpenAiSettings = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE, slug);

  const handleScheduleChange = useCallback(
    async (patch: { start_date?: string | null; target_date?: string | null }) => {
      if (!slug || !pid) return;
      setSavingSchedule(true);
      // optimistic: the date inputs are controlled by this state, so they must
      // move the moment the user picks a date, not a round trip later.
      setData((d) => (d ? { ...d, schedule: { ...d.schedule, ...patch } } : d));
      try {
        const saved = await service.updateSchedule(slug, pid, patch);
        setData((d) => (d ? { ...d, schedule: { start_date: saved.start_date, target_date: saved.target_date } } : d));
        // The warnings are computed server-side, so the one this just fixed only
        // disappears on a refetch.
        refresh();
      } catch {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "Couldn't save the project window",
          message: "Please try again.",
        });
        refresh();
      } finally {
        setSavingSchedule(false);
      }
    },
    [service, slug, pid, refresh]
  );

  const openLinksEditor = useCallback(() => {
    setLinksEditorOpen(true);
    document.getElementById(LINKS_ANCHOR)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-secondary">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-13 text-secondary">
        Couldn&apos;t load this project&apos;s overview.
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 md:px-6">
      <OverviewHeaderBlock overview={data} saving={savingSchedule} onScheduleChange={handleScheduleChange} />
      <OverviewKpiTiles items={data.items} />
      <OverviewWarnings warnings={data.warnings} onConfigureLinks={openLinksEditor} />
      <OverviewProgressSections overview={data} />
      <OverviewLinksBlock
        anchorId={LINKS_ANCHOR}
        overview={data}
        editorOpen={linksEditorOpen}
        onEditorOpenChange={setLinksEditorOpen}
        onSaved={refresh}
      />
      <OverviewJumpBar project={data.project} />

      <div className="flex flex-wrap items-center gap-2 border-t border-subtle pt-4">
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-13 font-medium text-white hover:opacity-90"
        >
          <Wand2 className="size-4" />
          Project setup wizard
        </button>
        <button
          type="button"
          onClick={() => setPlanOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-subtle bg-layer-1 px-3 py-1.5 text-13 font-medium text-primary hover:bg-layer-2"
        >
          <Sparkles className="size-4 text-accent-primary" />
          AI schedule
        </button>
        {canOpenAiSettings && (
          <button
            type="button"
            onClick={() => setAiSettingsOpen(true)}
            className="ml-auto flex items-center gap-1 text-12 text-secondary hover:text-primary"
          >
            <Settings2 className="size-3.5" />
            AI settings
          </button>
        )}
      </div>

      <ProjectSetupWizard
        projectId={wizardOpen ? (pid ?? null) : null}
        onClose={() => setWizardOpen(false)}
        onCompleted={refresh}
      />
      <AiPlanModal
        projectId={planOpen ? (pid ?? null) : null}
        projectName={data.project.name}
        onClose={() => setPlanOpen(false)}
        onApplied={refresh}
        onReflowed={refresh}
      />
      <AiSettingsModal isOpen={aiSettingsOpen} onClose={() => setAiSettingsOpen(false)} />
    </div>
  );
});
