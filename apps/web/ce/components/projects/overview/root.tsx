/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The page a project opens on. It answers, in this order: where is this project,
 * where does its knowledge live, and how do I get to the rest. Everything the
 * first version stacked open — tiles, cycles, modules, roster — is one fold down,
 * because a page you have to scan is a page nobody reads.
 *
 * One aggregate endpoint feeds the whole tree, so opening a project stays a
 * single round trip.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { renderFormattedDate } from "@plane/utils";
import { Eraser, FileText, Loader2, Printer, Settings2, Sparkles, Wand2 } from "lucide-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { useUserPermissions } from "@/hooks/store/user";
import { WikiLinksPanel } from "@/plane-web/components/pages/wiki-links-panel";
import { AiPlanModal } from "@/plane-web/components/planning/ai-plan-modal";
import { AiSettingsModal } from "@/plane-web/components/planning/ai-settings-modal";
import { ProjectSetupWizard } from "@/plane-web/components/planning/project-setup-wizard";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TProjectOverview } from "@/plane-web/types/arribada";
import { CleanProjectModal } from "./clean-project-modal";
import { OverviewJumpBar } from "./jump-bar";
import { OverviewBudgetBlock } from "./budget-block";
import { OverviewKpiTiles } from "./kpi-tiles";
import { OverviewProgressSections } from "./progress-sections";
import { OverviewPrintAnnex } from "./print-annex";
import { OverviewPublicLinkBlock } from "./public-link-block";
import { OverviewRecentPages } from "./recent-pages";
import { OverviewSection } from "./section";
import { OverviewSummary } from "./summary";
import { OverviewTeamBlock } from "./team-block";
import { OverviewWarnings } from "./warnings-block";

const LINKS_ANCHOR = "arribada-project-links";

// Stable identity: the team block treats a new array as "the roster changed",
// so an inline `?? []` fallback would churn it on every render.
const EMPTY_TEAM = [] as TProjectOverview["team"];

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
  const [wizardOpen, setWizardOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [cleanOpen, setCleanOpen] = useState(false);
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

  // Built on demand rather than kept in state: it is a rarely-pressed button, and
  // a report has to be the record as it is at the moment somebody asks for it.
  const [reporting, setReporting] = useState(false);
  const buildReport = async () => {
    if (!data || !workspaceSlug || !projectId || reporting) return;
    setReporting(true);
    try {
      const [budget, expenseRows, procurement, milestoneRows] = await Promise.all([
        service.getBudget(workspaceSlug.toString(), projectId.toString()).catch(() => null),
        service.getExpenses(workspaceSlug.toString(), projectId.toString()).catch(() => null),
        service.getProcurement(workspaceSlug.toString(), projectId.toString()).catch(() => null),
        service.getProjectMilestones(workspaceSlug.toString(), projectId.toString()).catch(() => []),
      ]);
      // Ordered by the date they land on, because that is how a funder reads a
      // deliverable list. Undated ones sort last rather than being dropped: an
      // undated deliverable is a real thing to report, and hiding it is how it
      // stays undated. toSorted is ES2023 and this workspace targets below it.
      const orderedMilestones = [...milestoneRows];
      // oxlint-disable-next-line unicorn/no-array-sort -- fresh spread, nothing shared
      orderedMilestones.sort((a, b) => (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999"));

      const { downloadFunderReport } = await import("./funder-report");
      await downloadFunderReport({
        overview: data,
        budget,
        expenses: expenseRows?.expenses ?? [],
        requests: procurement?.requests ?? [],
        milestones: orderedMilestones.map((m) => ({
          id: m.issue_id,
          name: m.label,
          date: m.target_date,
          kind: m.kind,
          done: m.done,
        })),
        money: (amount, currency) => {
          try {
            return new Intl.NumberFormat(undefined, {
              style: "currency",
              currency,
              maximumFractionDigits: 0,
            }).format(amount);
          } catch {
            return `${Math.round(amount).toLocaleString()} ${currency}`;
          }
        },
        generatedOn: renderFormattedDate(new Date()) ?? "",
      });
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't build the report",
        message: "Nothing was downloaded. Try again.",
      });
    } finally {
      setReporting(false);
    }
  };

  const scrollToLinks = useCallback(() => {
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

  const needsAttention = data.warnings.filter((w) => w.severity !== "info");
  const sprintCount = data.cycles.length + data.modules.length;

  return (
    <div className="print-root mx-auto flex max-w-4xl flex-col gap-3 px-4 py-6 md:px-6">
      {/* The one control the print stylesheet keeps out of the printout itself.
          Ctrl-P works just as well; this exists because nobody discovers that a
          page prints properly unless something says so. */}
      <div className="print-hide flex justify-end gap-2">
        <button
          type="button"
          onClick={() => void buildReport()}
          disabled={reporting}
          className="flex items-center gap-1.5 rounded border border-subtle px-3 py-1.5 text-11 text-secondary hover:bg-layer-1 disabled:opacity-50"
          title="A PDF a funder can read: period, status, deliverables and the money as recorded"
        >
          <FileText className="size-3" />
          {reporting ? "Building…" : "Funder report"}
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded border border-subtle px-3 py-1.5 text-11 text-secondary hover:bg-layer-1"
          title="Print this overview, or save it as a PDF — every section is expanded on paper"
        >
          <Printer className="size-3" />
          Print / PDF
        </button>
      </div>

      <OverviewSummary overview={data} saving={savingSchedule} onScheduleChange={handleScheduleChange} />

      {/* The same panel the Pages view shows — one row per link, each editable in
          place. Reused rather than reimplemented so the two never drift apart. */}
      <div id={LINKS_ANCHOR}>
        <WikiLinksPanel />
      </div>

      {needsAttention.length > 0 && (
        <OverviewSection title="Needs attention" badge={needsAttention.length} defaultOpen>
          <div className="px-4 py-3">
            <OverviewWarnings warnings={needsAttention} onConfigureLinks={scrollToLinks} />
          </div>
        </OverviewSection>
      )}

      {/* Cost sits after the counts and before the sprints: it is a summary of the
          project, not a detail of its schedule. Collapsed by default — most days
          nobody is looking at money. */}
      <OverviewSection title="What it costs">
        <OverviewBudgetBlock />
      </OverviewSection>

      {/* Straight after cost, and collapsed: publishing is rare, but somebody
          looking for it looks among the project's outward-facing settings rather
          than down among the sprints. */}
      <OverviewSection title="Shared outside the login">
        <OverviewPublicLinkBlock />
      </OverviewSection>

      <OverviewSection title="The numbers">
        <div className="px-4 py-3">
          <OverviewKpiTiles items={data.items} />
        </div>
      </OverviewSection>

      {sprintCount > 0 && (
        <OverviewSection title="Sprints & modules" badge={sprintCount}>
          <div className="px-4 py-3">
            <OverviewProgressSections overview={data} />
          </div>
        </OverviewSection>
      )}

      <OverviewSection title="Team & roles" badge={data.team?.length || undefined}>
        <OverviewTeamBlock projectId={data.project.id} team={data.team ?? EMPTY_TEAM} onSaved={refresh} />
      </OverviewSection>

      {data.project.page_view && (
        <OverviewSection title="Pages" badge={data.pages.count}>
          <OverviewRecentPages pages={data.pages} />
        </OverviewSection>
      )}

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
        {/* Setting a project up is cheap now, so starting over has to be too. */}
        <button
          type="button"
          onClick={() => setCleanOpen(true)}
          className="flex items-center gap-1.5 rounded border border-subtle px-3 py-1.5 text-13 font-medium text-secondary hover:bg-layer-2 hover:text-danger-primary"
        >
          <Eraser className="size-4" />
          Clean project
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
      {cleanOpen && (
        <CleanProjectModal
          projectId={pid ?? null}
          identifier={data.project.identifier}
          onClose={() => setCleanOpen(false)}
          onCleaned={refresh}
        />
      )}
      {/* Printed only: the screen has counts and a link to the list, paper has
          neither. */}
      <OverviewPrintAnnex overview={data} />
    </div>
  );
});
