/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A discreet dropdown next to the breadcrumb to jump between a project's
 * sections (Overview / Work items / Cycles / Modules / Views / Pages / Intake)
 * without going back to the sidebar. Respects each project's enabled features.
 */
import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import {
  Box,
  Check,
  ChevronsUpDown,
  Wallet,
  FileText,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  ListTodo,
  RefreshCw,
} from "lucide-react";
import { cn } from "@plane/utils";
import { useProject } from "@/hooks/store/use-project";
import { useAppRouter } from "@/hooks/use-app-router";

type Section = {
  key: string;
  label: string;
  path: string;
  icon: React.ReactNode;
  enabled: (p: {
    cycle_view?: boolean;
    module_view?: boolean;
    issue_views_view?: boolean;
    page_view?: boolean;
    inbox_view?: boolean;
  }) => boolean;
};

const ICON = "size-4 text-tertiary";

const SECTIONS: Section[] = [
  {
    key: "overview",
    label: "Overview",
    path: "overview",
    icon: <LayoutDashboard className={ICON} />,
    enabled: () => true,
  },
  { key: "issues", label: "Work items", path: "issues", icon: <ListTodo className={ICON} />, enabled: () => true },
  {
    key: "cycles",
    label: "Sprints",
    path: "cycles",
    icon: <RefreshCw className={ICON} />,
    enabled: (p) => !!p.cycle_view,
  },
  {
    key: "modules",
    label: "Modules",
    path: "modules",
    icon: <Box className={ICON} />,
    enabled: (p) => !!p.module_view,
  },
  {
    key: "views",
    label: "Views",
    path: "views",
    icon: <LayoutGrid className={ICON} />,
    enabled: (p) => !!p.issue_views_view,
  },
  {
    key: "finance",
    label: "Finance",
    path: "finance",
    icon: <Wallet className={ICON} />,
    // Always on: every project has a budget question even when the answer is
    // "nobody has said", and that answer is worth being able to reach.
    enabled: () => true,
  },
  { key: "pages", label: "Pages", path: "pages", icon: <FileText className={ICON} />, enabled: (p) => !!p.page_view },
  { key: "intake", label: "Intake", path: "intake", icon: <Inbox className={ICON} />, enabled: (p) => !!p.inbox_view },
];

export const ProjectSectionSwitcher = observer(function ProjectSectionSwitcher({ current }: { current: string }) {
  const { workspaceSlug, projectId } = useParams();
  const router = useAppRouter();
  const { getProjectById } = useProject();
  const [open, setOpen] = useState(false);

  const project = projectId ? getProjectById(projectId.toString()) : undefined;
  const items = useMemo(() => SECTIONS.filter((s) => (project ? s.enabled(project) : s.key === "issues")), [project]);

  const go = (path: string) => {
    setOpen(false);
    router.push(`/${workspaceSlug}/projects/${projectId}/${path}/`);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Switch section"
        className="flex size-5 items-center justify-center rounded text-tertiary hover:bg-layer-1 hover:text-secondary"
      >
        <ChevronsUpDown className="size-3.5" />
      </button>
      {open && (
        <>
          {/* click-away backdrop; cursor-default keeps the plain arrow the div used to show */}
          <button
            type="button"
            aria-label="Close section switcher"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div // z-50: this menu hangs from the header and opens OVER the page body, whose
            // toolbars render later in the DOM and were painting through it — the gantt's
            // lock button showed straight across the open menu.
            className="shadow-lg absolute top-full left-0 z-50 mt-1 w-44 overflow-hidden rounded-md border border-subtle bg-layer-1 p-1"
          >
            {items.map((s) => (
              <button
                type="button"
                key={s.key}
                onClick={() => go(s.path)}
                className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-13 hover:bg-layer-2", {
                  "bg-accent-primary/10 font-medium text-accent-primary": s.key === current,
                })}
              >
                {s.icon}
                <span className="flex-grow truncate text-primary">{s.label}</span>
                {s.key === current && <Check className="size-3.5 text-tertiary" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
});
