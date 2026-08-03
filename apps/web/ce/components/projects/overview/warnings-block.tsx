/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What this project is missing, with the fix one click away — a warning the
 * reader can't act on is just noise.
 */
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "@plane/utils";
import { useAppRouter } from "@/hooks/use-app-router";
import type { TProjectOverview } from "@/plane-web/types/arribada";

type Warning = TProjectOverview["warnings"][number];

type Props = {
  warnings: Warning[];
  onConfigureLinks: () => void;
  /** Opens the bulk editor. A warning that names a number should hand back the
   *  rows behind it, not a route to go looking for them. */
  onFixDisciplines: () => void;
};

const MISSING_LINK_CODES = new Set(["no_github", "no_wiki", "no_chat"]);

const SEVERITY_STYLE: Record<Warning["severity"], string> = {
  error: "border-danger-strong/30 bg-danger-subtle text-danger-primary",
  warning: "border-warning-strong/30 bg-warning-subtle text-warning-primary",
  info: "border-subtle bg-layer-2 text-secondary",
};

const SeverityIcon = ({ severity }: { severity: Warning["severity"] }) => {
  if (severity === "error") return <AlertCircle className="mt-0.5 size-4 flex-shrink-0" />;
  if (severity === "warning") return <AlertTriangle className="mt-0.5 size-4 flex-shrink-0" />;
  return <Info className="mt-0.5 size-4 flex-shrink-0" />;
};

export const OverviewWarnings = observer(function OverviewWarnings({
  warnings,
  onConfigureLinks,
  onFixDisciplines,
}: Props) {
  const { workspaceSlug, projectId } = useParams();
  const router = useAppRouter();

  if (!warnings || warnings.length === 0) return null;

  const actionFor = (w: Warning): { label: string; onClick: () => void } | null => {
    if (MISSING_LINK_CODES.has(w.code)) return { label: "Configure links", onClick: onConfigureLinks };
    if (w.code === "undated_items")
      return { label: "Open timeline", onClick: () => router.push(`/${workspaceSlug}/portfolio`) };
    if (w.code === "overdue_items")
      return {
        label: "Open work items",
        onClick: () => router.push(`/${workspaceSlug}/projects/${projectId}/issues`),
      };
    // Opens the bulk editor rather than the work item list: seven missing
    // disciplines used to mean opening seven panels, which is a navigation
    // dressed as a correction.
    if (w.code === "no_discipline") return { label: "Set disciplines", onClick: onFixDisciplines };
    return null;
  };

  return (
    <div className="flex flex-col gap-2">
      {warnings.map((w) => {
        const action = actionFor(w);
        return (
          <div
            key={`${w.code}-${w.message}`}
            className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-13", SEVERITY_STYLE[w.severity])}
          >
            <SeverityIcon severity={w.severity} />
            <span className="flex-grow">{w.message}</span>
            {action && (
              <button
                type="button"
                onClick={action.onClick}
                className="flex-shrink-0 rounded border border-current px-2 py-0.5 text-12 font-medium hover:bg-layer-transparent-hover"
              >
                {action.label}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
});
