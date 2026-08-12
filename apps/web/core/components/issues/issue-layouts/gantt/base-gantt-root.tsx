/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { ALL_ISSUES, EIssueFilterType, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { EIssuesStoreType, IBlockUpdateData, TIssue } from "@plane/types";
import { EIssueLayoutTypes, GANTT_TIMELINE_TYPE } from "@plane/types";
import { renderFormattedPayloadDate } from "@plane/utils";
// components
import { TimeLineTypeContext } from "@/components/gantt-chart/contexts";
import { GanttChartRoot } from "@/components/gantt-chart/root";
import { GanttToolbarDivider } from "@/components/gantt-chart/chart/header";
import { GanttColorBy } from "@/plane-web/components/gantt-chart/color-by";
import { GanttColorScaleProvider, useIssueColorScale } from "@/plane-web/components/gantt-chart/color-scale";
import { GanttLegend, type TLegendMark } from "@/plane-web/components/gantt-chart/legend";
import { useProjectDisciplines } from "@/plane-web/components/gantt-chart/use-project-disciplines";
import { GanttGroupBy } from "@/plane-web/components/gantt-chart/group-by";
import { GanttGroupContext } from "@/plane-web/components/gantt-chart/group-context";
import { orderByDependency } from "@/plane-web/components/gantt-chart/dependency-order";
import { graphEdges } from "@/plane-web/components/gantt-chart/edges";
import type { TPushOutcome } from "@/plane-web/components/gantt-chart/push-dependents";
import { describePush, pushDependents as pushDependents_ } from "@/plane-web/components/gantt-chart/push-dependents";
import { PushDependentsToggle } from "@/plane-web/components/gantt-chart/push-dependents-toggle";
import { useWorkspaceHolidays } from "@/plane-web/components/gantt-chart/use-workspace-holidays";
import { useProjectSlack } from "@/plane-web/components/gantt-chart/use-project-slack";
import { GanttExportButton } from "@/plane-web/components/gantt-chart/export-button";
import type { TExportScope } from "@/plane-web/components/gantt-chart/export-button";
import { BaselinePicker } from "@/plane-web/components/gantt-chart/baseline-picker";
import { shownBaseline } from "@/plane-web/components/gantt-chart/baseline-shown";
import { DependencyViolationBanner } from "@/plane-web/components/gantt-chart/violation-banner";
import { CriticalPathBanner } from "@/plane-web/components/gantt-chart/critical-path-banner";
import { describeFilters } from "@/plane-web/components/gantt-chart/export";
import type { TExportEdge, TExportMeta, TExportRow } from "@/plane-web/components/gantt-chart/export";
import { groupKeyFromRowId, groupRowId, isGroupRowId } from "@/plane-web/components/gantt-chart/grouping";
import { GROUP_BY_OPTIONS, buildGroups, flattenGroups } from "@/plane-web/components/gantt-chart/grouping";
import { frozenOrder } from "@/plane-web/components/gantt-chart/reorder";
import {
  EMPTY_SUBTASK_TREE,
  buildSubtaskTree,
  hideCollapsedDescendants,
  nestGroups,
  parentIds,
  subtaskRollup,
} from "@/plane-web/components/gantt-chart/subtasks";
import { useProjectRelations } from "@/plane-web/components/gantt-chart/use-project-relations";
import { useRowSnapshot } from "@/plane-web/components/gantt-chart/row-snapshot";
import { ganttDisplay } from "@/plane-web/store/gantt-display";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import { useProject } from "@/hooks/store/use-project";
import { GanttUndoButton } from "@/plane-web/components/gantt-chart/undo-button";
import { GanttLinkPreview } from "@/plane-web/components/gantt-chart/link-preview";
import { ganttUndo } from "@/plane-web/store/gantt-undo";
import { IssueGanttSidebar } from "@/components/gantt-chart/sidebar/issues/sidebar";
// hooks
import { useCycle } from "@/hooks/store/use-cycle";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useLabel } from "@/hooks/store/use-label";
import { useMember } from "@/hooks/store/use-member";
import { useModule } from "@/hooks/store/use-module";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useUser, useUserPermissions } from "@/hooks/store/user";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { useIssuesActions } from "@/hooks/use-issues-actions";
import { useTimeLineChart } from "@/hooks/use-timeline-chart";
// plane web hooks
import { useBulkOperationStatus } from "@/plane-web/hooks/use-bulk-operation-status";
import { GanttLockButton } from "@/plane-web/components/gantt-chart/lock-button";
import { usePlanLock } from "@/plane-web/components/gantt-chart/use-plan-lock";
import { useProjectMilestones } from "@/plane-web/components/gantt-chart/use-project-milestones";
import { invalidateProjectProgress } from "@/plane-web/components/gantt-chart/use-project-progress";
import { invalidateProjectSlack } from "@/plane-web/components/gantt-chart/use-project-slack";

import { IssueLayoutHOC } from "../issue-layout-HOC";
import { GanttQuickAddIssueButton, QuickAddIssueRoot } from "../quick-add";
import { IssueGanttBlock } from "./blocks";

interface IBaseGanttRoot {
  viewId?: string | undefined;
  isCompletedCycle?: boolean;
  isEpic?: boolean;
}

export type GanttStoreType =
  | EIssuesStoreType.PROJECT
  | EIssuesStoreType.MODULE
  | EIssuesStoreType.CYCLE
  | EIssuesStoreType.PROJECT_VIEW
  | EIssuesStoreType.EPIC;

/** Stable identity: `?? []` would mint a new array on every render and defeat every
 *  memo downstream of it. */
const NO_IDS: string[] = [];

const arribadaService = new ArribadaService();

export const BaseGanttRoot = observer(function BaseGanttRoot(props: IBaseGanttRoot) {
  const { viewId, isCompletedCycle = false, isEpic = false } = props;
  const { t } = useTranslation();
  // router
  const { workspaceSlug, projectId } = useParams();

  const storeType = useIssueStoreType() as GanttStoreType;
  const { issues, issuesFilter } = useIssues(storeType);
  const { fetchIssues, fetchNextIssues, updateIssue, quickAddIssue } = useIssuesActions(storeType);
  const timeline = useTimeLineChart(GANTT_TIMELINE_TYPE.ISSUE);
  const { initGantt } = timeline;
  // Whether a drag carries the chain with it. Read here rather than inside the
  // handler so the callback is rebuilt when it changes — a stale `false` captured
  // in a closure is a switch that appears to do nothing.
  const pushDependents = timeline.pushDependents;
  // store hooks
  const { allowPermissions } = useUserPermissions();
  const { data: currentUser } = useUser();

  const appliedDisplayFilters = issuesFilter.issueFilters?.displayFilters;
  // plane web hooks
  const isBulkOperationsEnabled = useBulkOperationStatus();
  // derived values
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + 1);

  useEffect(() => {
    fetchIssues("init-loader", { canGroup: false, perPageCount: 100 }, viewId);
  }, [fetchIssues, storeType, viewId]);

  useEffect(() => {
    initGantt();
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per mount, by design
  }, []);

  const issuesIds = (issues.groupedIssueIds?.[ALL_ISSUES] as string[]) ?? NO_IDS;

  // Optional grouping. The categories are the project's own — the setup wizard
  // creates one module per component, and labels are whatever the team invented —
  // so this needs nothing configured to be useful on a generated plan.
  const {
    issue: { getIssueById },
    addCycleToIssue,
    removeIssueFromCycle,
    changeModulesInIssue,
  } = useIssueDetail();
  const { getModuleById } = useModule();
  const { getLabelById } = useLabel();
  const { getStateById } = useProjectState();
  const { getCycleById } = useCycle();
  const { getProjectById } = useProject();
  const projectDetails = projectId ? getProjectById(projectId.toString()) : undefined;
  const { getUserDetails } = useMember();

  const { groupBy, collapsedGroups, rowOrder, nestSubtasks, collapsedSubtasks } = ganttDisplay;
  // Display preferences are per workspace. The store reads the slug off the URL
  // when it is constructed, so the first paint is already right; this is the
  // client-side navigation case, where no module is re-imported.
  useEffect(() => {
    ganttDisplay.setScope(workspaceSlug?.toString());
  }, [workspaceSlug]);
  const relations = useProjectRelations(workspaceSlug?.toString(), projectId?.toString());
  const milestones = useProjectMilestones(workspaceSlug?.toString(), projectId?.toString());
  /**
   * The relation set as predecessor→successor edges with the kind of constraint
   * each one is.
   *
   * Not the two-way ternary used elsewhere in this file. Three of Plane's five
   * schedulable relation types name the SUCCESSOR first — `finish_after`,
   * `start_after` and `blocked_by` — and a ternary that special-cases only
   * `blocked_by` points the other two backwards. That is survivable for row
   * ordering; it is not survivable for anything that moves dates, which would
   * push the wrong end of the chain. See `edges.ts`.
   */
  const graph = useMemo(() => graphEdges(relations), [relations]);
  // Free/total float, and the dates a delivery pins. Already fetched by the
  // overlay for the slack tails; this is the same shared read, so the floors cost
  // no extra request.
  // Also read whole by the export, which puts free and total float in the
  // spreadsheet — "this can slip four days" is the column a lead reads first.
  const slack = useProjectSlack(workspaceSlug?.toString(), projectId?.toString());
  const { deliveryFloors } = slack;
  // Weekends are arithmetic; a workspace closure is not, so a push that steps over
  // one has to be told about it. Same map the overlay shades with, so the bar and
  // the band cannot disagree about what a working day is.
  const holidays = useWorkspaceHolidays(workspaceSlug?.toString());

  /**
   * What every memo below is really keyed on.
   *
   * `issuesIds` is a MobX observable array and a delete splices it IN PLACE, so
   * `Object.is` says nothing happened; `getIssueById` is a `computedFn`, so it is
   * one function for the life of the store and the issue objects it returns are
   * mutated rather than replaced. Both re-render this component and neither
   * re-keys a memo — which is why dropping a work item on a sprint band left the
   * row in the band it came from, and why a deleted row stayed on the chart until
   * a reload.
   *
   * `liveIds` is the same ids with an identity that changes when they, or anything
   * the chart derives from them, actually do. Everything downstream reads it
   * instead of `issuesIds`; see `row-snapshot.ts`.
   */
  const liveIds = useRowSnapshot(issuesIds, getIssueById);

  // Along the graph before anything is grouped, so a band's rows read top-to-bottom
  // in the order the work actually has to happen.
  const orderedIds = useMemo(
    () => (rowOrder === "graph" && relations.length > 0 ? orderByDependency(liveIds, relations) : liveIds),
    [liveIds, relations, rowOrder]
  );

  const rawGroups = useMemo(
    () =>
      buildGroups(orderedIds, groupBy, {
        getIssue: getIssueById,
        getModule: getModuleById,
        getLabel: getLabelById,
        getMemberName: (id) => getUserDetails(id)?.display_name,
        getState: getStateById,
        getCycle: getCycleById,
      }),
    [orderedIds, groupBy, getIssueById, getModuleById, getLabelById, getStateById, getCycleById, getUserDetails]
  );

  /**
   * Sub-task nesting, applied AFTER the bands are decided.
   *
   * The order matters and it is the whole composition: `buildGroups` says what
   * belongs in which band, and a band has to keep meaning "everything with this
   * field value" or the header is a lie. So nesting reorders each band's members
   * among themselves. A sub-task whose parent is in another band — or in another
   * project, which is the portfolio case — keeps a row of its own, because the
   * alternative is a chevron pointing at a row that is not on screen.
   */
  const { groups, subtaskTree } = useMemo(() => {
    if (!nestSubtasks) return { groups: rawGroups, subtaskTree: EMPTY_SUBTASK_TREE };
    if (groupBy !== "none") {
      const nested = nestGroups(rawGroups, getIssueById);
      return { groups: nested.groups, subtaskTree: nested.tree };
    }
    return { groups: rawGroups, subtaskTree: buildSubtaskTree(orderedIds, getIssueById) };
  }, [rawGroups, groupBy, nestSubtasks, orderedIds, getIssueById]);

  /**
   * The colour scale, computed once over EVERY loaded row rather than per bar.
   *
   * The domain is `orderedIds`, not `rowIds`: folding a band shut must not
   * repaint the bars that are still on screen. Colour follows the entity, never
   * its rank in whatever subset is visible — see the note at the top of
   * `palette.ts`.
   */
  const disciplines = useProjectDisciplines(
    workspaceSlug?.toString(),
    projectId?.toString(),
    ganttDisplay.colorBy === "discipline"
  );
  const colorResolvers = useMemo(
    () => ({
      getStateById,
      getLabelById,
      getCycleById,
      getModuleById,
      getMemberName: (id: string) => getUserDetails(id)?.display_name,
      getDiscipline: (issueId: string) => disciplines[issueId],
    }),
    [getStateById, getLabelById, getCycleById, getModuleById, getUserDetails, disciplines]
  );
  const colorContext = useIssueColorScale(
    orderedIds,
    ganttDisplay.colorBy,
    getIssueById,
    colorResolvers,
    ganttDisplay.showCompleted
  );

  /** Marks: what the chart draws on top of a bar regardless of its series. Kept
   *  apart from the series swatches by a rule in the legend, because they answer
   *  a different question. */
  const legendMarks = useMemo(() => {
    const marks: TLegendMark[] = [];
    if (ganttDisplay.showCompleted)
      marks.push({
        key: "done",
        label: "Finished",
        kind: "hatch",
        color: "#64748b",
        title: "Hatched, with a tick — the item is in a done or cancelled state.",
      });
    if (slack.critical.size > 0)
      marks.push({
        key: "critical",
        label: "Critical path",
        kind: "ring",
        color: "#dc2626",
        title: "No slack: if this slips, the project's end date slips with it.",
      });
    if (Object.keys(milestones).length > 0)
      marks.push({ key: "milestone", label: "Deliverable", kind: "diamond", color: "#64748b" });
    return marks;
    // showCompleted is read above, so it must be a dependency: without it the
    // legend went on claiming a hatch the bars had stopped drawing.
  }, [slack.critical.size, milestones]);

  // The id list both panes walk: unchanged when grouping is off and nesting has
  // nothing to nest, so nothing about a flat chart moves.
  const rowIds = useMemo(() => {
    const rows =
      groupBy === "none" ? (nestSubtasks ? subtaskTree.order : orderedIds) : flattenGroups(groups, collapsedGroups);
    return nestSubtasks ? hideCollapsedDescendants(rows, subtaskTree, collapsedSubtasks) : rows;
  }, [orderedIds, groups, groupBy, collapsedGroups, nestSubtasks, subtaskTree, collapsedSubtasks]);

  // Links the current dates break: a successor that starts before its predecessor
  // finishes. Computed from the two things already in hand — the relation set and
  // each item's dates — so it costs nothing beyond a walk, and it is the only way
  // a drag can be non-destructive AND honest: nothing moves, but nothing is
  // quietly wrong either.
  const violations = useMemo(() => {
    const broken: { from: string; to: string }[] = [];
    // `graph`, not the raw relations through a local ternary — see the note on
    // `graph` above. The ternary pointed `finish_after` and `start_after` the wrong
    // way round, so the banner named the wrong end of those links as the offender
    // and stayed silent about the end that had actually moved.
    for (const { from, to, kind } of graph) {
      const predecessor = getIssueById(from);
      const successor = getIssueById(to);
      if (!successor?.start_date) continue;
      // The two kinds break on different dates. An FS successor may not start
      // until the predecessor has FINISHED; an SS successor may not start before
      // the predecessor STARTS, and starting on the same day is exactly what the
      // link asks for. Judging an SS link by the FS rule reported every correctly
      // scheduled start-to-start pair as broken.
      if (kind === "SS") {
        if (predecessor?.start_date && successor.start_date < predecessor.start_date) broken.push({ from, to });
        continue;
      }
      if (!predecessor?.target_date) continue;
      if (successor.start_date <= predecessor.target_date) broken.push({ from, to });
    }
    return broken;
    // `liveIds` is here for its identity, not its contents: the walk reads dates
    // through `getIssueById`, which is one function for the life of the store, so
    // without it this memo answered with the dates the chart had when it first
    // rendered — the banner stayed up after a reflow had fixed every link, and
    // stayed down after an edit had broken one.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [graph, liveIds, getIssueById]);

  // Read here rather than further down: the export needs it to know whether the
  // file it is about to build would stop short.
  const nextPageResults = issues.getPaginationData(undefined, undefined)?.nextPageResults;

  /**
   * The rows the export is OF, built at click time.
   *
   * `scope` is the whole point of the rewrite. It used to be one list — every
   * band at full membership, folds ignored — so somebody who collapsed nine of
   * ten sprints to get the picture they wanted still got all ten in the file,
   * and nothing said so. The default is now the chart as it stands: `rowIds` is
   * literally what the two panes paint, folds and all.
   *
   * "all" keeps the old behaviour deliberately, because the other reading of
   * "export this plan" is just as legitimate; it is now a choice rather than an
   * assumption, and either way the answer is recorded in the file's own header
   * rows.
   *
   * The truncation this used to guard against has its own guard: `partial` is
   * true while the server still holds unfetched pages, and the button refuses.
   * A folded band is a decision somebody made; an unfetched page is not, and
   * conflating the two is what made the fold impossible to honour.
   */
  const collectForExport = useCallback(
    (scope: TExportScope) => {
      const hasMilestoneMarks = Object.keys(milestones).length > 0;
      // What the ghost bars on screen are drawn from, read synchronously. Absent
      // when no baseline is shown, and the picture then says nothing about one
      // rather than inventing a comparison.
      const shownBase = shownBaseline(workspaceSlug?.toString(), projectId?.toString());
      const parsed = (value: string | null | undefined) => {
        if (!value) return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
      };
      const exportIds =
        scope === "view"
          ? rowIds
          : groupBy === "none"
            ? orderedIds
            : groups.flatMap((group) => [groupRowId(group.key), ...group.ids]);

      const exportRows: TExportRow[] = exportIds.map((id) => {
        if (isGroupRowId(id)) {
          const group = groups.find((g) => g.key === groupKeyFromRowId(id));
          return { id, kind: "group" as const, label: group?.label ?? "", start: null, end: null };
        }
        const issue = getIssueById(id);
        const state = issue?.state_id ? getStateById(issue.state_id) : null;
        const float = slack.byIssue[id];
        const parent = issue?.parent_id ? getIssueById(issue.parent_id) : undefined;
        const names = (issue?.assignee_ids ?? [])
          .map((memberId) => getUserDetails(memberId)?.display_name)
          .filter((name): name is string => !!name);
        return {
          id,
          kind: "item" as const,
          label: issue?.name ?? "",
          identifier: issue?.sequence_id ? `${projectDetails?.identifier ?? ""}-${issue.sequence_id}` : undefined,
          start: parsed(issue?.start_date),
          end: parsed(issue?.target_date),
          // undefined when this project has no marks at all, so the exporters keep
          // their old one-day guess rather than declaring nothing a milestone.
          milestone: hasMilestoneMarks ? !!milestones[id] : undefined,
          // The colour the BAR is wearing, not the state's — the whole reported
          // defect is that pressing Export while looking at a chart coloured by
          // assignee produced a chart coloured by state.
          color: colorContext.colorForIssue?.(id) ?? state?.color ?? undefined,
          seriesLabel: colorContext.seriesLabelForIssue?.(id),
          // Drawn distinctly only when the screen is drawing it distinctly. The
          // toggle is a display setting and the file is of the display.
          done: ganttDisplay.showCompleted ? state?.group === "completed" || state?.group === "cancelled" : undefined,
          // The frozen plan the ghosts are drawn against — present only when
          // ghosts were actually on screen. See baseline-shown.ts.
          baselineStart: parsed(shownBase?.entries[id]?.start),
          baselineEnd: parsed(shownBase?.entries[id]?.target),
          slack: float?.free ?? undefined,
          assignee: names[0],
          state: state?.name,
          // The spreadsheet columns. Cheap here — every lookup is a store read
          // the chart has already paid for — and the difference between a file
          // somebody can work in and one they have to come back to the app for.
          project: projectDetails?.name,
          sprint: issue?.cycle_id ? getCycleById(issue.cycle_id)?.name : undefined,
          modules: (issue?.module_ids ?? [])
            .map((moduleId) => getModuleById(moduleId)?.name)
            .filter(Boolean)
            .join(", "),
          parent: parent
            ? `${parent.sequence_id ? `${projectDetails?.identifier ?? ""}-${parent.sequence_id} ` : ""}${parent.name}`
            : undefined,
          assignees: names.join(", "),
          priority: issue?.priority ?? undefined,
          labels: (issue?.label_ids ?? [])
            .map((labelId) => getLabelById(labelId)?.name)
            .filter(Boolean)
            .join(", "),
          freeFloat: float?.free,
          totalFloat: float?.total,
          critical: slack.critical.has(id),
          depth: nestSubtasks ? (subtaskTree.byId.get(id)?.depth ?? 0) : 0,
        };
      });
      const visible = new Set(exportIds);
      // From `graph` for the third time, and for the reason that matters most
      // here: these edges become MS Project `PredecessorLink`s and the arrows in
      // the exported picture. A backwards `finish_after` is a plan that reads as
      // if the work happens in the opposite order, in the file that leaves the
      // building.
      const exportEdges: TExportEdge[] = graph
        .map(({ from, to }) => ({ from, to }))
        .filter((edge) => visible.has(edge.from) && visible.has(edge.to));

      const folded =
        (groupBy === "none" ? 0 : groups.filter((group) => collapsedGroups.has(group.key)).length) +
        (nestSubtasks ? [...collapsedSubtasks].filter((id) => subtaskTree.byId.has(id)).length : 0);

      return {
        rows: exportRows,
        edges: exportEdges,
        showWeekends: true,
        // The same entries the on-screen legend is showing, in the same order.
        // One list, so the picture cannot label its colours differently from the
        // screen it was taken from.
        legend: colorContext.scale.entries.map((entry) => ({
          label: entry.folded ? `${entry.label}: ${entry.folded.join(", ")}` : entry.label,
          color: entry.color,
          count: entry.count,
        })),
        meta: {
          title: projectDetails?.name ?? "Timeline",
          scope,
          groupBy:
            groupBy === "none" ? undefined : (GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label ?? groupBy),
          colorBy: colorContext.dimensionLabel,
          baselineName:
            shownBase && Object.keys(shownBase.entries).length > 0
              ? shownBase.name || "the latest snapshot"
              : undefined,
          sortBy: appliedDisplayFilters?.order_by === "sort_order" ? "manual order" : appliedDisplayFilters?.order_by,
          collapsed: folded,
          filters: describeFilters(issuesFilter.issueFilters?.richFilters),
          // Named rather than left for a reader to notice missing. Both live
          // behind per-item endpoints the timeline does not call, so putting
          // them in this file would mean one request per row.
          omissions: ["the discipline each item belongs to", "recorded effort in days"],
        } satisfies TExportMeta,
        // True when the server still has pages the client has not fetched, so the
        // button can say so rather than hand over a partial plan as a whole one.
        partial: !!nextPageResults,
      };
    },
    [
      rowIds,
      orderedIds,
      groupBy,
      groups,
      collapsedGroups,
      collapsedSubtasks,
      nestSubtasks,
      subtaskTree,
      milestones,
      nextPageResults,
      appliedDisplayFilters?.order_by,
      issuesFilter.issueFilters?.richFilters,
      slack,
      getIssueById,
      getStateById,
      getUserDetails,
      getCycleById,
      getModuleById,
      getLabelById,
      graph,
      projectDetails,
      // `colorContext` and the route params are read inside but deliberately not
      // listed. `colorContext` is rebuilt on every render by its provider, so
      // listing it would rebuild this callback every render and defeat the memo
      // entirely; the export reads it at the moment the button is pressed, which
      // is the value on screen by definition. `workspaceSlug` and `projectId`
      // cannot change without unmounting this route.
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- see above
    ]
  );

  /**
   * Dropping a work item on a band moves it into that band — but only where the
   * band is a real container. Sprint and module are: an item belongs to one, and
   * putting it there is the edit somebody means. State, priority and assignee
   * bands are views of a field, and dragging onto "High" to re-prioritise is a
   * gesture nobody intends to make by aiming at a header, so those refuse it.
   *
   * UNSET moves it out, which is what dropping on "Not in a sprint" reads as.
   */
  const assignToGroup = useCallback(
    async (issueId: string, groupKey: string) => {
      const issue = getIssueById(issueId);
      const slug = workspaceSlug?.toString();
      // project_id is nullable on the type: a draft item has none, and there is
      // nothing to file one into.
      const pid = issue?.project_id;
      if (!issue || !slug || !pid) return;
      const value = groupKey === "__unset__" ? null : groupKey;
      // Not updateIssue({ cycle_id }) / ({ module_ids }): a cycle or module
      // membership is its own endpoint, and writing the field went through
      // without the local store ever learning — so the row stayed in the band it
      // came from until the page was reloaded, which reads as the drop having
      // failed. These are the same operations the work item panel uses.
      if (groupBy === "cycle") {
        if (value) await addCycleToIssue(slug, pid, value, issue.id);
        else if (issue.cycle_id) await removeIssueFromCycle(slug, pid, issue.cycle_id, issue.id);
        return;
      }
      if (groupBy === "module") {
        // Modules are a list and an item can sit in several. A drop means "put
        // it in this one" and leaves the band it came from — not "make this its
        // only one", which would silently strip memberships nobody touched.
        const leaving = (issue.module_ids ?? []).filter((id) => groups.some((g) => g.key === id));
        const joining = value && !(issue.module_ids ?? []).includes(value) ? [value] : [];
        if (joining.length === 0 && leaving.length === 0) return;
        await changeModulesInIssue(
          slug,
          pid,
          issue.id,
          joining,
          leaving.filter((id) => id !== value)
        );
      }
    },
    [getIssueById, workspaceSlug, groupBy, groups, addCycleToIssue, removeIssueFromCycle, changeModulesInIssue]
  );

  /**
   * Runs before a reorder lands. The sequence in front of the reader is written
   * down AS the manual order, and whatever was producing it — a field sort, a
   * grouping, or both — is stood down. Dragging IS how somebody says "I want
   * this order", and making them find a menu first is a rule nobody discovers.
   *
   * The freeze has to come first. Switching to sort_order alone would redraw the
   * list in whatever that column happens to hold, so the drop would appear to
   * scramble the board rather than move one row. Same for dropping the bands:
   * ungrouping without freezing first puts the rows back in the ungrouped order
   * under the reader's hand.
   *
   * The bands are consumed at their full membership, collapsed ones included — a
   * fold is a display state, not a statement that those rows left the plan.
   */
  const handleReorderStart = useCallback(async () => {
    const slug = workspaceSlug?.toString();
    const pid = projectId?.toString();
    if (!slug || !pid) return undefined;

    const grouped = groupBy !== "none";
    const sorted = appliedDisplayFilters?.order_by !== "sort_order";
    if (!grouped && !sorted) return undefined;

    const sequence = (grouped ? groups.flatMap((group) => group.ids) : orderedIds).filter((id) => !isGroupRowId(id));
    if (sequence.length === 0) return undefined;

    try {
      await arribadaService.freezeIssueOrder(slug, pid, sequence);
      if (sorted) {
        // The fifth argument is the view id: a saved view carries its own
        // display filters, and omitting it would write the switch onto the
        // project's filters while the reader is looking at a view.
        await issuesFilter.updateFilters(
          slug,
          pid,
          EIssueFilterType.DISPLAY_FILTERS,
          { order_by: "sort_order" },
          viewId ?? ""
        );
      }
      if (grouped) {
        const label = GROUP_BY_OPTIONS.find((option) => option.value === groupBy)?.label ?? groupBy;
        ganttDisplay.flattenGrouping(groupBy);
        // Said out loud, and said reversibly. A grouping that disappears on a
        // drag with no explanation reads as the chart having lost its mind; the
        // Group control keeps saying "Manual (from Module)" afterwards, so this
        // toast is the announcement and that label is the record.
        setToast({
          type: TOAST_TYPE.INFO,
          title: `${label} bands folded into a manual order`,
          message: `The rows kept the order ${label} put them in. Pick ${label} again to bring the bands back.`,
        });
      }
      // The freeze rewrote every sort_order server-side; the store still holds
      // the old ones. Hand the drop what was actually written.
      return frozenOrder(sequence);
    } catch {
      // Leave the sort and the bands alone rather than half-switching them.
      return undefined;
    }
  }, [appliedDisplayFilters?.order_by, workspaceSlug, projectId, orderedIds, groups, groupBy, issuesFilter, viewId]);

  const groupContext = useMemo(
    () => ({
      byKey: new Map(groups.map((g) => [g.key, g])),
      isCollapsed: (key: string) => collapsedGroups.has(key),
      toggle: (key: string) => ganttDisplay.toggleGroupCollapsed(key),
      groupBy,
      assign: groupBy === "cycle" || groupBy === "module" ? assignToGroup : null,
      subtasks: {
        enabled: nestSubtasks,
        depthOf: (id: string) => subtaskTree.byId.get(id)?.depth ?? 0,
        childCountOf: (id: string) => subtaskTree.byId.get(id)?.childIds.length ?? 0,
        parentOf: (id: string) => subtaskTree.byId.get(id)?.parentId ?? null,
        isCollapsed: (id: string) => collapsedSubtasks.has(id),
        toggle: (id: string) => ganttDisplay.toggleSubtaskCollapsed(id),
        parentIds: parentIds(subtaskTree),
        rollupOf: (id: string) => subtaskRollup(id, subtaskTree, getIssueById),
      },
    }),
    [groups, collapsedGroups, groupBy, assignToGroup, nestSubtasks, subtaskTree, collapsedSubtasks, getIssueById]
  );

  const { enableIssueCreation } = issues?.viewFlags || {};

  const loadMoreIssues = useCallback(() => {
    fetchNextIssues();
  }, [fetchNextIssues]);

  /**
   * After the server has moved dates the client never wrote.
   *
   * "Reflow this project" is one POST that reschedules every work item whose
   * dependencies it violates — dozens of rows at once, none of which went through
   * a store, so nothing in `issuesMap` knew. The banner already dropped the caches
   * for the float tails and the arrows, and the bars themselves kept the dates from
   * before the reflow until a hard reload; the reflow then had nothing left to do,
   * so pressing the button again said "moved 0 work items" over a chart still
   * showing the violations. Same refetch `saved-order.tsx:112` does after applying
   * a saved arrangement, and for the same reason.
   */
  const reloadAfterServerReschedule = useCallback(() => {
    fetchIssues("mutation", { canGroup: false, perPageCount: 100 }, viewId);
  }, [fetchIssues, viewId]);

  // Grouping and dependency order are statements about the whole project, and the
  // gantt pages a hundred at a time — so a band that really holds forty items would
  // read as twelve until somebody scrolled. Pull the rest in, one page per pass,
  // bounded so a runaway page cursor cannot loop forever.
  const autoPages = useRef(0);
  const wantsEverything = groupBy !== "none" || rowOrder === "graph";
  useEffect(() => {
    if (!wantsEverything) {
      autoPages.current = 0;
      return;
    }
    if (!nextPageResults || issues.getIssueLoader() || autoPages.current >= 20) return;
    autoPages.current += 1;
    fetchNextIssues();
  }, [wantsEverything, nextPageResults, issuesIds.length, fetchNextIssues, issues]);

  const updateIssueBlockStructure = async (issue: TIssue, data: IBlockUpdateData) => {
    if (!workspaceSlug) return;

    // The dates before the change, so Ctrl+Z / Undo can put them back. This is
    // the add-block and reorder path; the DRAG records its own — see
    // `updateBlockDates`, which is where a bar drag actually lands and which fed
    // this stack nothing at all until now.
    if (data.start_date !== undefined || data.target_date !== undefined) {
      ganttUndo.push({
        projectId: issue.project_id,
        items: [{ issueId: issue.id, prev: { start_date: issue.start_date, target_date: issue.target_date } }],
        label: "the dates just set",
      });
    }

    const payload: any = { ...data };
    if (data.sort_order) payload.sort_order = data.sort_order.newSortOrder;

    if (updateIssue) await updateIssue(issue.project_id, issue.id, payload);
  };

  // revert the last recorded bar date edit
  /** Put back everything the last gesture moved — one entry can hold a whole
   *  pushed chain, and reverting part of it would leave a plan nobody chose. */
  const handleGanttUndo = useCallback(async () => {
    const entry = ganttUndo.pop();
    if (!entry || !updateIssue) return;
    const slug = workspaceSlug?.toString();
    const pid = projectId?.toString();
    // Sequential on purpose, and `updateIssue` rather than the bulk date write:
    // an undo has to be able to restore a NULL date, which `updateIssueDates`
    // skips (`if (update.start_date)`), and firing the chain's writes at once
    // races several optimistic mutations of the same issue map.
    // oxlint-disable-next-line no-await-in-loop
    for (const item of entry.items) await updateIssue(entry.projectId, item.issueId, item.prev);
    // The same derived caches the forward move drops. Without this an undo left
    // the tails and the red arrows describing the state it just reverted.
    if (slug && pid) {
      invalidateProjectSlack(slug, pid);
      invalidateProjectProgress(slug, pid);
    }
  }, [updateIssue, workspaceSlug, projectId]);

  // Ctrl/Cmd+Z reverts the last bar date edit (ignored while typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z")) return;
      const el = document.activeElement as HTMLElement | null;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable) return;
      if (!ganttUndo.canUndo) return;
      e.preventDefault();
      void handleGanttUndo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleGanttUndo]);

  // undo history is scoped to the current project
  useEffect(() => {
    ganttUndo.clear();
    return () => ganttUndo.clear();
  }, [projectId]);

  const permitted = allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.PROJECT);
  const planLock = usePlanLock(workspaceSlug?.toString(), projectId?.toString());
  // Plane's permission is necessary but no longer sufficient. A locked plan stops
  // everyone, the lead included, because the lock says "this is agreed" rather
  // than "you may not" — a lock its owner can ignore by accident is not a lock.
  //
  // `canEditPlan` is the other half and it IS a permission: with
  // `lead_only_edits` on, a bar drag posts to upstream's issue-dates endpoint and
  // the middleware in `plane/arribada/plan_guard.py` answers 403. Drawing a
  // draggable bar for somebody the server will refuse is the failure this fork
  // has shipped three times; the flag is the server's own answer, so the two
  // cannot disagree.
  const isAllowed = permitted && !planLock.locked && planLock.canEditPlan;
  // Adding is gated separately: a project can be open to edits and closed to new
  // items, which is the usual shape once a scope has been agreed with a funder.
  const canAddItems = isAllowed && planLock.allowAddItems;

  /**
   * Whether this specific bar may be moved.
   *
   * With `allow_edit_others` off, only the item's own assignees and the lead may
   * touch it. Checked per block rather than globally because the answer differs
   * per row — which is exactly why the gantt's enable* props accept a function.
   */
  const canEditBlock = useCallback(
    (blockId: string) => {
      if (!isAllowed) return false;
      if (planLock.allowEditOthers) return true;
      const assignees = getIssueById(blockId)?.assignee_ids ?? [];
      return assignees.includes(currentUser?.id ?? "");
    },
    [isAllowed, planLock.allowEditOthers, getIssueById, currentUser?.id]
  );
  /**
   * What a bar drag or resize writes.
   *
   * Two things happen here that did not before.
   *
   * UNDO NOW COVERS THE DRAG. `ganttUndo` was only ever fed by
   * `updateIssueBlockStructure`, which a bar drag does not go through — it is
   * reached by the add-block affordance and the sidebar reorder. So the Undo
   * button and Ctrl+Z, whose own comment said they revert "a bar drag or
   * resize", reverted everything except that. The pre-change dates are recorded
   * here, where the drag actually lands.
   *
   * AND THE CHAIN CAN COME WITH IT. With "push dependents" on, everything
   * downstream of a moved bar is translated by the same number of working days —
   * see `push-dependents.ts` for why that is a different computation from
   * `cascade()` and must not be folded into it. The whole gesture, origin and
   * chain, goes in as ONE undo entry: putting back the bar under the cursor and
   * leaving its chain moved would produce a plan nobody chose.
   */
  const updateBlockDates = useCallback(
    async (
      updates: {
        id: string;
        start_date?: string;
        target_date?: string;
      }[]
    ) => {
      const slug = workspaceSlug?.toString();
      const pid = projectId?.toString();
      if (!slug || !pid || updates.length === 0) return;

      const spanOf = (id: string) => {
        const issue = getIssueById(id);
        return { start_date: issue?.start_date, target_date: issue?.target_date };
      };
      // Captured BEFORE anything is applied: the store is written optimistically
      // and the previous dates would be gone by the time we asked for them.
      const undoItems = updates.map((update) => ({ issueId: update.id, prev: spanOf(update.id) }));
      let pushed: TPushOutcome | null = null;
      let payload = updates;

      if (pushDependents && graph.length > 0) {
        // One origin per gesture. The gantt sends a single-element array for a
        // drag or a resize; a multi-item payload only arrives from the dependency
        // helper, which has already decided where everything goes.
        const [origin] = updates;
        if (updates.length === 1 && origin) {
          const spans: Record<string, { start_date?: string | null; target_date?: string | null }> = {};
          for (const id of issuesIds) spans[id] = spanOf(id);
          const outcome = pushDependents_({
            originId: origin.id,
            before: spanOf(origin.id),
            after: { start_date: origin.start_date, target_date: origin.target_date },
            edges: graph,
            spans,
            notEditable: new Set(issuesIds.filter((id) => id !== origin.id && !canEditBlock(id))),
            floors: deliveryFloors,
            isHoliday: (iso: string) => !!holidays[iso],
          });
          // Reported whenever there is anything to report, not only when
          // something moved. A chain that was entirely held at a delivery — or
          // entirely made of items this person may not edit — is the case where
          // saying nothing is worst: the switch is on, the bar moved, and the
          // chain visibly did not.
          if (outcome.moves.length > 0 || outcome.held.length > 0 || outcome.refused.length > 0) {
            pushed = outcome;
            payload = [...updates, ...outcome.moves];
            for (const move of outcome.moves) undoItems.push({ issueId: move.id, prev: spanOf(move.id) });
          }
        }
      }

      try {
        await issues.updateIssueDates(slug, payload, pid);
        // Float, the critical path and rolled-up progress are all derived from
        // these dates and cached per project. Without this the tails and the red
        // arrows keep painting the pre-drag answer until a hard reload — the
        // module-scope cache survives client-side navigation.
        invalidateProjectSlack(slug, pid);
        invalidateProjectProgress(slug, pid);
        ganttUndo.push({
          projectId: pid,
          items: undoItems,
          label: undoItems.length > 1 ? `${undoItems.length} work items moved` : "the last date change",
        });
        // Said out loud, and reversibly. A drag that quietly rewrote nine dates is
        // the shape this fork's own violation banner exists to avoid; naming them
        // afterwards with a one-key way back is the honest version of it.
        if (pushed)
          setToast({
            type: TOAST_TYPE.INFO,
            title: pushed.moves.length > 0 ? "The chain moved with it" : "The chain did not move",
            message:
              pushed.moves.length > 0 ? `${describePush(pushed)} Ctrl+Z puts all of it back.` : describePush(pushed),
          });
      } catch {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("toast.error"),
          message: "Error while updating work item dates, Please try again Later",
        });
      }
    },
    [
      issues,
      projectId,
      workspaceSlug,
      t,
      pushDependents,
      graph,
      issuesIds,
      getIssueById,
      canEditBlock,
      deliveryFloors,
      holidays,
    ]
  );

  const quickAdd =
    enableIssueCreation && canAddItems && !isCompletedCycle ? (
      <QuickAddIssueRoot
        layout={EIssueLayoutTypes.GANTT}
        QuickAddButton={GanttQuickAddIssueButton}
        containerClassName="sticky bottom-0 z-[1]"
        prePopulatedData={{
          start_date: renderFormattedPayloadDate(new Date()),
          target_date: renderFormattedPayloadDate(targetDate),
        }}
        quickAddCallback={quickAddIssue}
        isEpic={isEpic}
      />
    ) : undefined;

  return (
    <IssueLayoutHOC layout={EIssueLayoutTypes.GANTT}>
      <TimeLineTypeContext.Provider value={GANTT_TIMELINE_TYPE.ISSUE}>
        {/* One scale for the whole chart, published to every bar and to the
            legend, so the two can never disagree about what teal means. */}
        <GanttColorScaleProvider value={colorContext}>
          <div className="relative flex h-full w-full flex-col">
            {/* Named as soon as it exists, fixed only when asked. A drag that
              silently cascaded twenty tasks is how people stop trusting a chart. */}
            {workspaceSlug && projectId && (
              <DependencyViolationBanner
                workspaceSlug={workspaceSlug.toString()}
                projectId={projectId.toString()}
                violations={violations}
                onFixed={reloadAfterServerReschedule}
              />
            )}
            {/* Said out loud rather than left to the colour of an arrow. The chain
              was only ever expressed as a redder dependency line, so a project
              with no links — which is most of them here — showed nothing at all
              and the feature read as doing nothing. */}
            <CriticalPathBanner diagnostics={slack.diagnostics} markedCount={slack.critical.size} />
            {/* Mandatory the moment two series are on screen: without it the colour
              is a puzzle rather than an encoding, and there is nowhere on a bar to
              write "this teal one is Ruby". The marks below the rule are things
              drawn ON TOP of a bar whatever series it is in. */}
            <GanttLegend scale={colorContext.scale} dimensionLabel={colorContext.dimensionLabel} marks={legendMarks} />
            <div className="relative min-h-0 flex-1">
              <GanttLinkPreview />
              <GanttGroupContext.Provider value={groupContext}>
                <GanttChartRoot
                  border={false}
                  // These used to be an absolutely positioned strip floating over the
                  // chart's toolbar. An overlay takes part in no layout: it did not
                  // push the toolbar's own controls aside, it painted on top of them,
                  // and Export landed squarely on the "62 Work items" count. In the
                  // row they are ordinary flex children, so the whole toolbar wraps
                  // as one and nothing can overlap at any width.
                  toolbarLeading={
                    <>
                      {/* What is shown */}
                      <div className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap">
                        <GanttColorBy />
                        <GanttGroupBy />
                      </div>
                      <GanttToolbarDivider />
                      {/* The plan itself: who may change it, what a drag changes,
                        what it was promised to be, and a way back from the last
                        change. "Push dependents" belongs here rather than in the
                        Display menu — it is not about what the chart draws, it is
                        about what a drag writes. */}
                      <div className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap">
                        <GanttLockButton lock={planLock} />
                        <PushDependentsToggle />
                        <BaselinePicker />
                        <GanttUndoButton onUndo={handleGanttUndo} />
                      </div>
                    </>
                  }
                  // Beside Saved order and Display rather than with the plan controls:
                  // it is about getting this chart out of here, like they are.
                  toolbarActions={<GanttExportButton collect={collectForExport} />}
                  title={isEpic ? t("epic.label", { count: 2 }) : t("issue.label", { count: 2 })}
                  loaderTitle={isEpic ? t("epic.label", { count: 2 }) : t("issue.label", { count: 2 })}
                  blockIds={rowIds}
                  blockUpdateHandler={updateIssueBlockStructure}
                  blockToRender={(data: TIssue) => <IssueGanttBlock issueId={data.id} isEpic={isEpic} />}
                  sidebarToRender={(sidebarProps) => (
                    <IssueGanttSidebar {...sidebarProps} showAllBlocks isEpic={isEpic} />
                  )}
                  enableBlockLeftResize={canEditBlock}
                  enableBlockRightResize={canEditBlock}
                  enableBlockMove={canEditBlock}
                  // Draggable whatever the sort AND whatever the grouping: the
                  // switch to a plain manual order happens in handleReorderStart,
                  // on the first drop, which freezes the arrangement on screen
                  // first so nothing jumps. Grouping and manual order are still
                  // exclusive — the drag is what resolves them, rather than the
                  // chart refusing the gesture and saying nothing.
                  enableReorder={isAllowed}
                  onReorderStart={handleReorderStart}
                  enableAddBlock={canAddItems}
                  enableSelection={isBulkOperationsEnabled && isAllowed}
                  quickAdd={quickAdd}
                  loadMoreBlocks={loadMoreIssues}
                  canLoadMoreBlocks={nextPageResults}
                  updateBlockDates={updateBlockDates}
                  showAllBlocks
                  enableDependency
                  isEpic={isEpic}
                />
              </GanttGroupContext.Provider>
            </div>
          </div>
        </GanttColorScaleProvider>
      </TimeLineTypeContext.Provider>
    </IssueLayoutHOC>
  );
});
