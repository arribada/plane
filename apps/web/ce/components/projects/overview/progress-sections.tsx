/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Sprints and modules as one-line-each progress rows. A project that has the
 * feature switched off gets no section at all — an empty box would only ask
 * the reader to work out why it is empty.
 */
import type { ReactNode } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { cn } from "@plane/utils";
import type { TProjectOverview } from "@/plane-web/types/arribada";
import { formatRange, percent } from "./helpers";

type Props = { overview: TProjectOverview };

type RowProps = {
  name: string;
  range: string;
  completed: number;
  total: number;
  chip?: ReactNode;
  href: string;
};

const Row = ({ name, range, completed, total, chip, href }: RowProps) => (
  <Link
    href={href}
    className="flex items-center gap-3 border-b border-subtle px-3 py-2.5 last:border-b-0 hover:bg-layer-transparent-hover"
  >
    <div className="min-w-0 flex-grow">
      <div className="flex items-center gap-2">
        <span className="truncate text-13 font-medium text-primary">{name}</span>
        {chip}
      </div>
      <span className="text-11 text-tertiary">{range || "No dates"}</span>
    </div>
    <div className="hidden w-28 flex-shrink-0 overflow-hidden rounded-full bg-layer-2 sm:block">
      <div className="h-1.5 rounded-full bg-accent-primary" style={{ width: `${percent(completed, total)}%` }} />
    </div>
    <span className="w-14 flex-shrink-0 text-right text-12 text-secondary tabular-nums">
      {completed}/{total}
    </span>
  </Link>
);

const Section = ({ title, action, children }: { title: string; action: ReactNode; children: ReactNode }) => (
  <div className="overflow-hidden rounded-lg border border-subtle bg-layer-1">
    <div className="flex items-center justify-between border-b border-subtle px-3 py-2">
      <h2 className="text-13 font-semibold text-primary">{title}</h2>
      {action}
    </div>
    {children}
  </div>
);

const CHIP = "flex-shrink-0 rounded-full px-1.5 py-0.5 text-10 font-medium uppercase tracking-wide";

export const OverviewProgressSections = observer(function OverviewProgressSections({ overview }: Props) {
  const { workspaceSlug, projectId } = useParams();
  const { project, cycles, modules } = overview;

  const base = `/${workspaceSlug}/projects/${projectId}`;
  const linkClass = "text-12 text-accent-primary hover:underline";

  if (!project.cycle_view && !project.module_view) return null;

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {project.cycle_view && (
        <Section
          title="Sprints"
          action={
            <Link href={`${base}/cycles`} className={linkClass}>
              All sprints
            </Link>
          }
        >
          {cycles.length === 0 ? (
            <p className="px-3 py-3 text-13 text-tertiary">
              No sprints yet —{" "}
              <Link href={`${base}/cycles`} className="text-accent-primary hover:underline">
                open Sprints
              </Link>{" "}
              to create one.
            </p>
          ) : (
            cycles.map((c) => (
              <Row
                key={c.id}
                name={c.name}
                range={formatRange(c.start_date, c.end_date)}
                completed={c.completed}
                total={c.total}
                href={`${base}/cycles/${c.id}`}
                chip={
                  c.is_active ? (
                    <span className={cn(CHIP, "bg-emerald-500/15 text-emerald-600")}>Active</span>
                  ) : c.is_upcoming ? (
                    <span className={cn(CHIP, "bg-accent-primary/15 text-accent-primary")}>Upcoming</span>
                  ) : null
                }
              />
            ))
          )}
        </Section>
      )}

      {project.module_view && (
        <Section
          title="Modules"
          action={
            <Link href={`${base}/modules`} className={linkClass}>
              All modules
            </Link>
          }
        >
          {modules.length === 0 ? (
            <p className="px-3 py-3 text-13 text-tertiary">
              No modules yet —{" "}
              <Link href={`${base}/modules`} className="text-accent-primary hover:underline">
                open Modules
              </Link>{" "}
              to create one.
            </p>
          ) : (
            modules.map((m) => (
              <Row
                key={m.id}
                name={m.name}
                range={formatRange(m.start_date, m.target_date)}
                completed={m.completed}
                total={m.total}
                href={`${base}/modules/${m.id}`}
              />
            ))
          )}
        </Section>
      )}
    </div>
  );
});
