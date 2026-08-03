/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The part of the printed report the screen does not need.
 *
 * The Overview shows COUNTS — twelve done, five in progress — which is the right
 * density for somebody who can click through to the list. On paper there is
 * nothing to click, so a count is a dead end: a funder reading "five in progress"
 * cannot ask which five. This is that list, plus a condensed timeline, and it
 * exists only in the printout.
 *
 * Fetched on mount rather than on print: `window.print()` is synchronous, so
 * anything not already in the DOM when it fires does not make it onto the page.
 */
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { renderFormattedDate } from "@plane/utils";
import { useProjectState } from "@/hooks/store/use-project-state";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TPortfolioItem, TProjectBudget, TProjectOverview } from "@/plane-web/types/arribada";

const service = new ArribadaService();

/** Done first: a report is read for what was achieved before what is pending. */
const GROUPS: { key: string; title: string; match: (state: string) => boolean }[] = [
  { key: "completed", title: "Completed", match: (s) => s === "completed" },
  { key: "started", title: "In progress", match: (s) => s === "started" },
  { key: "unstarted", title: "Not started", match: (s) => s === "unstarted" || s === "backlog" },
];

type Props = { overview: TProjectOverview | null };

export const OverviewPrintAnnex = observer(function OverviewPrintAnnex({ overview }: Props) {
  const { workspaceSlug, projectId } = useParams();
  // The items payload carries a state ID, not a group — the group lives in the
  // project's own state list, which is the only place that mapping exists.
  const { getStateById } = useProjectState();
  const [items, setItems] = useState<TPortfolioItem[] | null>(null);
  const [budget, setBudget] = useState<TProjectBudget | null>(null);

  useEffect(() => {
    const slug = workspaceSlug?.toString();
    const pid = projectId?.toString();
    if (!slug || !pid) return;
    let live = true;
    const load = async () => {
      try {
        const [rows, money] = await Promise.all([
          service.getProjectItems(slug, pid),
          service.getBudget(slug, pid).catch(() => null),
        ]);
        if (!live) return;
        setItems(rows);
        setBudget(money);
      } catch {
        // The annex is an extra. Failing to load it must not cost the report.
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [workspaceSlug, projectId]);

  if (!items?.length) return null;

  const dated = items.filter((item) => item.start_date && item.target_date);
  const min = dated.length ? dated.reduce((a, b) => (a.start_date! < b.start_date! ? a : b)).start_date! : null;
  const max = dated.length ? dated.reduce((a, b) => (a.target_date! > b.target_date! ? a : b)).target_date! : null;
  const span = min && max ? Math.max(Date.parse(max) - Date.parse(min), 1) : 1;

  return (
    // Hidden on screen, printed on paper. The Overview is already dense enough
    // for a monitor; this would be noise there and is the point on a page.
    <div className="print-annex hidden">
      {dated.length > 0 && min && max && (
        <section className="mt-6">
          <h2 className="mb-1 text-13 font-semibold">Timeline</h2>
          <p className="mb-2 text-11 text-tertiary">
            {renderFormattedDate(min)} → {renderFormattedDate(max)}
          </p>
          <ul className="space-y-0.5">
            {[...dated]
              // oxlint-disable-next-line unicorn/no-array-sort -- a fresh array from filter()
              .sort((a, b) => (a.start_date! < b.start_date! ? -1 : 1))
              .map((item) => {
                const left = ((Date.parse(item.start_date!) - Date.parse(min)) / span) * 100;
                const width = Math.max(
                  ((Date.parse(item.target_date!) - Date.parse(item.start_date!)) / span) * 100,
                  0.8
                );
                return (
                  <li key={item.id} className="flex items-center gap-2 text-10">
                    <span className="w-1/3 truncate">{item.name}</span>
                    <span className="relative h-2 flex-1 rounded bg-layer-2">
                      <span
                        className="absolute h-2 rounded bg-accent-primary"
                        style={{ left: `${left}%`, width: `${width}%` }}
                      />
                    </span>
                  </li>
                );
              })}
          </ul>
        </section>
      )}

      {GROUPS.map((group) => {
        const rows = items.filter((item) => group.match(getStateById(item.state_id ?? "")?.group ?? ""));
        if (!rows.length) return null;
        return (
          <section key={group.key} className="mt-5">
            <h2 className="mb-1 text-13 font-semibold">
              {group.title} <span className="font-normal text-tertiary">({rows.length})</span>
            </h2>
            <ul className="space-y-0.5">
              {rows.map((item) => (
                <li key={item.id} className="flex items-baseline gap-2 text-10">
                  <span className="flex-1 truncate">{item.name}</span>
                  <span className="flex-shrink-0 text-tertiary">
                    {item.start_date ? renderFormattedDate(item.start_date) : "—"} →{" "}
                    {item.target_date ? renderFormattedDate(item.target_date) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {(overview?.team?.length ?? 0) > 0 && (
        <section className="mt-5">
          <h2 className="mb-1 text-13 font-semibold">Who works on this</h2>
          <ul className="space-y-0.5">
            {overview!.team.map((member) => (
              <li key={member.name} className="flex items-baseline gap-2 text-10">
                <span className="flex-1 truncate">
                  {member.name}
                  {member.is_lead ? " · lead" : ""}
                </span>
                {/* The discipline, not the permission level. A report that said
                    "member" would answer a question nobody asked. */}
                <span className="flex-shrink-0 text-tertiary">
                  {member.roles?.length ? member.roles.join(", ") : "no discipline recorded"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(budget?.labour?.by_role?.length ?? 0) > 0 && (
        <section className="mt-5">
          <h2 className="mb-1 text-13 font-semibold">What it costs</h2>
          <ul className="space-y-0.5">
            {budget!.labour.by_role.map((row) => (
              <li key={row.role} className="flex items-baseline gap-2 text-10">
                <span className="flex-1 truncate">{row.role}</span>
                <span className="flex-shrink-0 text-tertiary tabular-nums">
                  {row.days} d
                  {/* An unrated discipline still shows its days. Printing a blank
                      would hide work the project is doing. */}
                  {row.rated ? ` · ${Math.round(row.cost).toLocaleString()} ${row.currency ?? ""}` : " · not costed"}
                </span>
              </li>
            ))}
          </ul>
          {(budget?.expenses?.by_category?.length ?? 0) > 0 && (
            <ul className="mt-1 space-y-0.5 border-t border-subtle pt-1">
              {budget!.expenses.by_category.map((row) => (
                <li key={row.category} className="flex items-baseline gap-2 text-10">
                  <span className="flex-1 truncate">{row.category}</span>
                  <span className="flex-shrink-0 text-tertiary tabular-nums">
                    {Math.round(row.actual).toLocaleString()} {row.currency}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {((overview?.cycles?.length ?? 0) > 0 || (overview?.modules?.length ?? 0) > 0) && (
        <section className="mt-5">
          <h2 className="mb-1 text-13 font-semibold">Sprints and modules</h2>
          <ul className="space-y-0.5">
            {(overview?.cycles ?? []).map((cycle) => (
              <li key={cycle.id} className="flex items-baseline gap-2 text-10">
                <span className="flex-1 truncate">
                  {cycle.name}
                  {cycle.is_active ? " · running" : cycle.is_upcoming ? " · upcoming" : ""}
                </span>
                <span className="flex-shrink-0 text-tertiary tabular-nums">
                  {cycle.completed}/{cycle.total}
                </span>
              </li>
            ))}
            {(overview?.modules ?? []).map((mod) => (
              <li key={mod.id} className="flex items-baseline gap-2 text-10">
                <span className="flex-1 truncate">
                  {mod.name} · {mod.status}
                </span>
                <span className="flex-shrink-0 text-tertiary tabular-nums">
                  {mod.completed}/{mod.total}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
});
