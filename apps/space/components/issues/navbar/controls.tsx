/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { useRouter, useSearchParams } from "next/navigation";
// components
import { IssueFiltersDropdown } from "@/components/issues/filters";
// helpers
import { queryParamGenerator } from "@/helpers/query-param-generator";
// hooks
import { useIssueDetails } from "@/hooks/store/use-issue-details";
import { useIssueFilter } from "@/hooks/store/use-issue-filter";
import useIsInIframe from "@/hooks/use-is-in-iframe";
// store
import type { PublishStore } from "@/store/publish/publish.store";
// types
import type { TIssueLayout } from "@/types/issue";
// local imports
import { IssuesLayoutSelection } from "./layout-selection";
import { NavbarTheme } from "./theme";
import { UserAvatar } from "./user-avatar";

export type NavbarControlsProps = {
  publishSettings: PublishStore;
};

export const NavbarControls = observer(function NavbarControls(props: NavbarControlsProps) {
  // props
  const { publishSettings } = props;
  // router
  const router = useRouter();
  const searchParams = useSearchParams();
  // query params
  const board = searchParams.get("board") || undefined;
  const labels = searchParams.get("labels") || undefined;
  const state = searchParams.get("state") || undefined;
  const priority = searchParams.get("priority") || undefined;
  const peekId = searchParams.get("peekId") || undefined;
  // hooks
  const { getIssueFilters, isIssueFiltersUpdated, initIssueFilters } = useIssueFilter();
  const { setPeekId } = useIssueDetails();
  // derived values
  const { anchor, view_props, workspace_detail } = publishSettings;
  const issueFilters = anchor ? getIssueFilters(anchor) : undefined;
  const activeLayout = issueFilters?.display_filters?.layout || undefined;

  const isInIframe = useIsInIframe();

  useEffect(() => {
    if (anchor && workspace_detail) {
      const viewsAcceptable: string[] = [];
      let currentBoard: TIssueLayout | null = null;

      // Only the two this app can actually draw. SITES_ISSUE_LAYOUTS holds list and
      // kanban, and apps/space has exactly those two layout directories — so a
      // board published with view_props.gantt used to put a Gantt button in the
      // toolbar of the one surface Arribada can show a funder without an account,
      // and clicking it landed on a blank pane. Offering a view that does not
      // exist is worse on that page than anywhere else in the product.
      if (view_props?.list) viewsAcceptable.push("list");
      if (view_props?.kanban) viewsAcceptable.push("kanban");

      if (board) {
        if (viewsAcceptable.includes(board.toString())) currentBoard = board.toString() as TIssueLayout;
        else {
          if (viewsAcceptable && viewsAcceptable.length > 0) currentBoard = viewsAcceptable[0] as TIssueLayout;
        }
      } else {
        if (viewsAcceptable && viewsAcceptable.length > 0) currentBoard = viewsAcceptable[0] as TIssueLayout;
      }

      if (currentBoard) {
        if (activeLayout === undefined || activeLayout !== currentBoard) {
          const { query, queryParam } = queryParamGenerator({ board: currentBoard, peekId, priority, state, labels });
          const params: any = {
            // The `?.` was false comfort: an absent `query` makes this undefined and
            // the index throws on the next character. currentBoard is what the board
            // was derived from a few lines up, so it is the honest fallback.
            display_filters: { layout: (query?.board as string[] | undefined)?.[0] ?? currentBoard },
            filters: {
              priority: query?.priority ?? undefined,
              state: query?.state ?? undefined,
              labels: query?.labels ?? undefined,
            },
          };

          if (!isIssueFiltersUpdated(anchor, params)) {
            initIssueFilters(anchor, params);
            router.push(`/issues/${anchor}?${queryParam}`);
          }
        }
      }
    }
  }, [
    anchor,
    board,
    labels,
    state,
    priority,
    peekId,
    activeLayout,
    router,
    initIssueFilters,
    setPeekId,
    isIssueFiltersUpdated,
    view_props,
    workspace_detail,
  ]);

  if (!anchor) return null;

  return (
    <>
      {/* issue views */}
      <div className="shrink-0">
        <IssuesLayoutSelection anchor={anchor} />
      </div>

      {/* issue filters */}
      <div className="shrink-0">
        <IssueFiltersDropdown anchor={anchor} />
      </div>

      {/* theming */}
      <div className="shrink-0">
        <NavbarTheme />
      </div>

      {!isInIframe && <UserAvatar />}
    </>
  );
});
