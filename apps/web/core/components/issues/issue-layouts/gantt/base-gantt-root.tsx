/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { ALL_ISSUES, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { EIssuesStoreType, IBlockUpdateData, TIssue } from "@plane/types";
import { EIssueLayoutTypes, GANTT_TIMELINE_TYPE } from "@plane/types";
import { renderFormattedPayloadDate } from "@plane/utils";
// components
import { TimeLineTypeContext } from "@/components/gantt-chart/contexts";
import { GanttChartRoot } from "@/components/gantt-chart/root";
import { GanttColorBy } from "@/plane-web/components/gantt-chart/color-by";
import { GanttGroupBy } from "@/plane-web/components/gantt-chart/group-by";
import { GanttGroupContext } from "@/plane-web/components/gantt-chart/group-context";
import { orderByDependency } from "@/plane-web/components/gantt-chart/dependency-order";
import { GanttExportButton } from "@/plane-web/components/gantt-chart/export-button";
import { BaselinePicker } from "@/plane-web/components/gantt-chart/baseline-picker";
import { DependencyViolationBanner } from "@/plane-web/components/gantt-chart/violation-banner";
import type { TExportEdge, TExportRow } from "@/plane-web/components/gantt-chart/export";
import { groupKeyFromRowId, groupRowId, isGroupRowId } from "@/plane-web/components/gantt-chart/grouping";
import { buildGroups, flattenGroups } from "@/plane-web/components/gantt-chart/grouping";
import { useProjectRelations } from "@/plane-web/components/gantt-chart/use-project-relations";
import { ganttDisplay } from "@/plane-web/store/gantt-display";
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

export const BaseGanttRoot = observer(function BaseGanttRoot(props: IBaseGanttRoot) {
  const { viewId, isCompletedCycle = false, isEpic = false } = props;
  const { t } = useTranslation();
  // router
  const { workspaceSlug, projectId } = useParams();

  const storeType = useIssueStoreType() as GanttStoreType;
  const { issues, issuesFilter } = useIssues(storeType);
  const { fetchIssues, fetchNextIssues, updateIssue, quickAddIssue } = useIssuesActions(storeType);
  const { initGantt } = useTimeLineChart(GANTT_TIMELINE_TYPE.ISSUE);
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
  } = useIssueDetail();
  const { getModuleById } = useModule();
  const { getLabelById } = useLabel();
  const { getStateById } = useProjectState();
  const { getCycleById } = useCycle();
  const { getProjectById } = useProject();
  const projectDetails = projectId ? getProjectById(projectId.toString()) : undefined;
  const { getUserDetails } = useMember();

  const { groupBy, collapsedGroups, rowOrder } = ganttDisplay;
  const relations = useProjectRelations(workspaceSlug?.toString(), projectId?.toString());
  const milestones = useProjectMilestones(workspaceSlug?.toString(), projectId?.toString());

  // Along the graph before anything is grouped, so a band's rows read top-to-bottom
  // in the order the work actually has to happen.
  const orderedIds = useMemo(
    () => (rowOrder === "graph" && relations.length > 0 ? orderByDependency(issuesIds, relations) : issuesIds),
    [issuesIds, relations, rowOrder]
  );

  const groups = useMemo(
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

  // The id list both panes walk: unchanged when grouping is off, so nothing about
  // the ungrouped chart moves.
  const rowIds = useMemo(
    () => (groupBy === "none" ? orderedIds : flattenGroups(groups, collapsedGroups)),
    [orderedIds, groups, groupBy, collapsedGroups]
  );

  // Links the current dates break: a successor that starts before its predecessor
  // finishes. Computed from the two things already in hand — the relation set and
  // each item's dates — so it costs nothing beyond a walk, and it is the only way
  // a drag can be non-destructive AND honest: nothing moves, but nothing is
  // quietly wrong either.
  const violations = useMemo(() => {
    const broken: { from: string; to: string }[] = [];
    for (const edge of relations) {
      const [from, to] =
        edge.relation_type === "blocked_by"
          ? [edge.related_issue_id, edge.issue_id]
          : [edge.issue_id, edge.related_issue_id];
      const predecessor = getIssueById(from);
      const successor = getIssueById(to);
      if (!predecessor?.target_date || !successor?.start_date) continue;
      if (successor.start_date <= predecessor.target_date) broken.push({ from, to });
    }
    return broken;
  }, [relations, getIssueById]);

  // Read here rather than further down: the export needs it to know whether the
  // file it is about to build would stop short.
  const nextPageResults = issues.getPaginationData(undefined, undefined)?.nextPageResults;

  // Built at click time, not kept in state: the export must be the chart as it is
  // at that instant — same order, same bands, same filters — and nothing here is
  // worth recomputing on every render for a button that is rarely pressed.
  const collectForExport = useCallback(() => {
    const hasMilestoneMarks = Object.keys(milestones).length > 0;
    const parsed = (value: string | null | undefined) => {
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    };
    // The EXPORT set, not the DISPLAY set. rowIds is what the panes paint, so it
    // omits a collapsed band's items entirely — and the gantt pages a hundred at a
    // time, so on a large project it is also only as much as has been scrolled
    // into view. Exporting it produced a clean-looking CSV / PNG / MS-Project file
    // that silently stopped at 100 rows, with a success toast. A wrong artefact
    // that looks right is worse than a refusal, and blueprint-generated
    // catalogues put >100 items well inside the normal case here.
    const exportIds =
      groupBy === "none" ? orderedIds : groups.flatMap((group) => [groupRowId(group.key), ...group.ids]);

    const exportRows: TExportRow[] = exportIds.map((id) => {
      if (isGroupRowId(id)) {
        const group = groups.find((g) => g.key === groupKeyFromRowId(id));
        return { id, kind: "group" as const, label: group?.label ?? "", start: null, end: null };
      }
      const issue = getIssueById(id);
      const state = issue?.state_id ? getStateById(issue.state_id) : null;
      const owner = issue?.assignee_ids?.[0];
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
        color: state?.color ?? undefined,
        assignee: owner ? (getUserDetails(owner)?.display_name ?? undefined) : undefined,
        state: state?.name,
      };
    });
    const visible = new Set(exportIds);
    const exportEdges: TExportEdge[] = relations
      .map((edge) =>
        edge.relation_type === "blocked_by"
          ? { from: edge.related_issue_id, to: edge.issue_id }
          : { from: edge.issue_id, to: edge.related_issue_id }
      )
      .filter((edge) => visible.has(edge.from) && visible.has(edge.to));

    return {
      rows: exportRows,
      edges: exportEdges,
      title: projectDetails?.name ?? "Timeline",
      showWeekends: true,
      // True when the server still has pages the client has not fetched, so the
      // button can say so rather than hand over a partial plan as a whole one.
      partial: !!nextPageResults,
    };
  }, [
    orderedIds,
    groupBy,
    groups,
    milestones,
    nextPageResults,
    getIssueById,
    getStateById,
    getUserDetails,
    relations,
    projectDetails,
  ]);

  const groupContext = useMemo(
    () => ({
      byKey: new Map(groups.map((g) => [g.key, g])),
      isCollapsed: (key: string) => collapsedGroups.has(key),
      toggle: (key: string) => ganttDisplay.toggleGroupCollapsed(key),
    }),
    [groups, collapsedGroups]
  );

  const { enableIssueCreation } = issues?.viewFlags || {};

  const loadMoreIssues = useCallback(() => {
    fetchNextIssues();
  }, [fetchNextIssues]);

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

    // record the pre-change dates so Ctrl+Z / Undo can revert a bar drag or resize
    if (data.start_date !== undefined || data.target_date !== undefined) {
      ganttUndo.push({
        projectId: issue.project_id,
        issueId: issue.id,
        prev: { start_date: issue.start_date, target_date: issue.target_date },
      });
    }

    const payload: any = { ...data };
    if (data.sort_order) payload.sort_order = data.sort_order.newSortOrder;

    if (updateIssue) await updateIssue(issue.project_id, issue.id, payload);
  };

  // revert the last recorded bar date edit
  const handleGanttUndo = useCallback(async () => {
    const entry = ganttUndo.pop();
    if (!entry || !updateIssue) return;
    await updateIssue(entry.projectId, entry.issueId, entry.prev);
  }, [updateIssue]);

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
  const isAllowed = permitted && !planLock.locked;
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
  const updateBlockDates = useCallback(
    (
      updates: {
        id: string;
        start_date?: string;
        target_date?: string;
      }[]
    ) =>
      issues
        .updateIssueDates(workspaceSlug.toString(), updates, projectId.toString())
        .then(() => {
          // Float, the critical path and rolled-up progress are all derived from
          // these dates and cached per project. Without this the tails and the red
          // arrows keep painting the pre-drag answer until a hard reload — the
          // module-scope cache survives client-side navigation.
          invalidateProjectSlack(workspaceSlug.toString(), projectId.toString());
          invalidateProjectProgress(workspaceSlug.toString(), projectId.toString());
          return undefined;
        })
        .catch(() => {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: t("toast.error"),
            message: "Error while updating work item dates, Please try again Later",
          });
        }),
    [issues, projectId, workspaceSlug, t]
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
        <div className="relative flex h-full w-full flex-col">
          {/* Named as soon as it exists, fixed only when asked. A drag that
              silently cascaded twenty tasks is how people stop trusting a chart. */}
          {workspaceSlug && projectId && (
            <DependencyViolationBanner
              workspaceSlug={workspaceSlug.toString()}
              projectId={projectId.toString()}
              violations={violations}
            />
          )}
          <div className="relative min-h-0 flex-1">
            <GanttLinkPreview />
            <GanttGroupContext.Provider value={groupContext}>
              <div className="absolute top-1.5 left-3 z-20 flex items-center gap-2">
                <GanttColorBy />
                <GanttGroupBy />
                <GanttLockButton lock={planLock} />
                <BaselinePicker />
                <GanttExportButton collect={collectForExport} />
                <GanttUndoButton onUndo={handleGanttUndo} />
              </div>
              <GanttChartRoot
                border={false}
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
                // Dragging to reorder writes a sort_order derived from the rows either
                // side. With bands on screen those neighbours can be headers, or sit in
                // another group entirely, so the drag would mean something the user did
                // not ask for. Grouping and manual order are exclusive.
                enableReorder={appliedDisplayFilters?.order_by === "sort_order" && isAllowed && groupBy === "none"}
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
      </TimeLineTypeContext.Provider>
    </IssueLayoutHOC>
  );
});
