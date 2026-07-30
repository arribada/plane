/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * One row of shortcuts out of the overview, so landing here never costs a click
 * compared with landing on Work items.
 */
import { observer } from "mobx-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Box, FileText, GanttChartSquare, LayoutGrid, ListTodo, RefreshCw } from "lucide-react";
import type { TProjectOverview } from "@/plane-web/types/arribada";

type Props = { project: TProjectOverview["project"] };

const BTN =
  "flex items-center gap-1.5 rounded-lg border border-subtle bg-layer-1 px-3 py-1.5 text-13 text-primary hover:bg-layer-2";
const ICON = "size-4 text-tertiary";

export const OverviewJumpBar = observer(function OverviewJumpBar({ project }: Props) {
  const { workspaceSlug, projectId } = useParams();
  const base = `/${workspaceSlug}/projects/${projectId}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={`${base}/issues`} className={BTN}>
        <ListTodo className={ICON} />
        Work items
      </Link>
      {project.cycle_view && (
        <Link href={`${base}/cycles`} className={BTN}>
          <RefreshCw className={ICON} />
          Sprints
        </Link>
      )}
      {project.module_view && (
        <Link href={`${base}/modules`} className={BTN}>
          <Box className={ICON} />
          Modules
        </Link>
      )}
      {project.issue_views_view && (
        <Link href={`${base}/views`} className={BTN}>
          <LayoutGrid className={ICON} />
          Views
        </Link>
      )}
      {project.page_view && (
        <Link href={`${base}/pages`} className={BTN}>
          <FileText className={ICON} />
          Pages
        </Link>
      )}
      <Link href={`/${workspaceSlug}/portfolio`} className={BTN}>
        <GanttChartSquare className={ICON} />
        Timeline
      </Link>
    </div>
  );
});
