/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A discreet dropdown next to the breadcrumb to jump between a project's
 * sections (Work items / Cycles / Modules / Views / Pages) without going back
 * to the sidebar. Respects each project's enabled features.
 */
import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Box, Check, ChevronsUpDown, FileText, LayoutGrid, ListTodo, RefreshCw } from "lucide-react";
import { cn } from "@plane/utils";
import { useProject } from "@/hooks/store/use-project";
import { useAppRouter } from "@/hooks/use-app-router";

type Section = {
  key: string;
  label: string;
  path: string;
  icon: React.ReactNode;
  enabled: (p: { cycle_view?: boolean; module_view?: boolean; issue_views_view?: boolean; page_view?: boolean }) => boolean;
};

const ICON = "size-4 text-tertiary";

const SECTIONS: Section[] = [
  { key: "issues", label: "Work items", path: "issues", icon: <ListTodo className={ICON} />, enabled: () => true },
  { key: "cycles", label: "Cycles", path: "cycles", icon: <RefreshCw className={ICON} />, enabled: (p) => !!p.cycle_view },
  { key: "modules", label: "Modules", path: "modules", icon: <Box className={ICON} />, enabled: (p) => !!p.module_view },
  { key: "views", label: "Views", path: "views", icon: <LayoutGrid className={ICON} />, enabled: (p) => !!p.issue_views_view },
  { key: "pages", label: "Pages", path: "pages", icon: <FileText className={ICON} />, enabled: (p) => !!p.page_view },
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
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-md border border-subtle bg-layer-1 p-1 shadow-lg">
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
