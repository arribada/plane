/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * One project's schedule, readable with no account.
 *
 * The audience is a funder or a partner who cannot be issued a login, and whose
 * alternative today is a screenshot pasted into an email — stale the moment it
 * is sent.
 *
 * Everything drawn here comes from the anchor endpoint, which builds its payload
 * field by field. There are no assignees, budgets or estimates to hide because
 * they never arrive. Nothing in this file may fetch anything else: any other
 * endpoint would be behind the login and would 401 for the very reader this page
 * exists for.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { renderFormattedDate } from "@plane/utils";
import { cn } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TPublicTimeline } from "@/plane-web/types/arribada";

const service = new ArribadaService();

const DAY_MS = 24 * 60 * 60 * 1000;

/** Bar fill by state group. Deliberately one hue per state rather than a ramp:
 * these are categories, not magnitudes. */
const GROUP_FILL: Record<string, string> = {
  completed: "#2f855a",
  started: "#2b6cb0",
  unstarted: "#718096",
  backlog: "#a0aec0",
  cancelled: "#a0aec0",
};

const MILESTONE_LABEL: Record<string, string> = {
  gate: "Gate",
  delivery: "Delivery",
  review: "Review",
};

type TStatus = "loading" | "ok" | "revoked" | "missing";

function parse(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function PublicTimelineRoot() {
  const { anchor } = useParams();
  const [status, setStatus] = useState<TStatus>("loading");
  const [data, setData] = useState<TPublicTimeline | null>(null);

  useEffect(() => {
    const key = anchor?.toString();
    if (!key) {
      setStatus("missing");
      return;
    }
    let live = true;
    const load = async () => {
      try {
        const payload = await service.getPublicTimeline(key);
        if (!live) return;
        setData(payload);
        setStatus("ok");
      } catch (response) {
        if (!live) return;
        // 410 means the lead turned it off; 404 means it never existed. Saying
        // which is the difference between "ask them for a new link" and "check
        // the address", and the reader can act on neither if both read alike.
        setStatus((response as { status?: number } | undefined)?.status === 410 ? "revoked" : "missing");
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [anchor]);

  const chart = useMemo(() => {
    if (!data) return null;
    const items = data.items
      .map((item, index) => {
        const start = parse(item.start_date);
        const end = parse(item.target_date);
        // The payload guarantees at least one of the two, so a single-dated item
        // draws as a one-day mark rather than being dropped.
        const from = start ?? end;
        const to = end ?? start;
        if (from == null || to == null) return null;
        return {
          // Two bars can legitimately share a name AND both dates, so neither is
          // a key. The position in the payload is, and the payload is sorted
          // server-side — this list never reorders under a stable `data`.
          key: `${index}-${item.name}`,
          name: item.name,
          start_date: item.start_date,
          target_date: item.target_date,
          state_group: item.state_group,
          milestone: item.milestone,
          from: Math.min(from, to),
          to: Math.max(from, to),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    if (items.length === 0) return null;

    const planFrom = parse(data.project.start_date);
    const planTo = parse(data.project.target_date);
    // The project's own planned window is included in the span so a plan that
    // runs past the last bar is still visible as the gap it is.
    const min = Math.min(...items.map((i) => i.from), ...(planFrom != null ? [planFrom] : []));
    const max = Math.max(...items.map((i) => i.to), ...(planTo != null ? [planTo] : []));
    const span = Math.max(max - min, DAY_MS);

    const pct = (ms: number) => ((ms - min) / span) * 100;

    // One tick per month across the span, for reading a bar against a date.
    const ticks: { at: number; label: string }[] = [];
    const cursor = new Date(min);
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);
    while (cursor.getTime() <= max && ticks.length < 60) {
      const at = cursor.getTime();
      if (at >= min) {
        ticks.push({
          at: pct(at),
          label: cursor.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
        });
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }

    const today = Date.now();
    return {
      items: items.map((item) => {
        const left = pct(item.from);
        return {
          key: item.key,
          name: item.name,
          start_date: item.start_date,
          target_date: item.target_date,
          state_group: item.state_group,
          milestone: item.milestone,
          left,
          // A floor, so a one-day item is a visible mark rather than a hairline.
          width: Math.max(pct(item.to) - left, 0.6),
        };
      }),
      ticks,
      todayAt: today >= min && today <= max ? pct(today) : null,
    };
  }, [data]);

  if (status === "loading") {
    return (
      <Shell>
        <p className="text-13 text-tertiary">Loading…</p>
      </Shell>
    );
  }

  if (status === "revoked") {
    return (
      <Shell>
        <h1 className="text-16 font-semibold text-primary">This link has been turned off</h1>
        <p className="mt-2 text-13 text-tertiary">
          The project team revoked it. Ask them for a new one if you still need access.
        </p>
      </Shell>
    );
  }

  if (status === "missing" || !data) {
    return (
      <Shell>
        <h1 className="text-16 font-semibold text-primary">Nothing here</h1>
        <p className="mt-2 text-13 text-tertiary">Check the address, or ask whoever sent it for the link again.</p>
      </Shell>
    );
  }

  const { project } = data;
  // Read off the chart rather than the raw payload: those rows already carry a
  // key, and an undated milestone has no place on a schedule anyway.
  const milestones = (chart?.items ?? []).filter((item) => item.milestone);

  return (
    <Shell>
      <header className="border-b border-subtle pb-4">
        <p className="text-11 tracking-wide text-tertiary uppercase">Project schedule</p>
        <h1 className="mt-1 text-20 font-semibold text-primary">{project.name}</h1>
        {(project.start_date || project.target_date) && (
          <p className="mt-1 text-12 text-tertiary">
            Planned {renderFormattedDate(project.start_date) ?? "—"} → {renderFormattedDate(project.target_date) ?? "—"}
          </p>
        )}
      </header>

      {!chart ? (
        <p className="py-8 text-13 text-tertiary">This project has no dated work to show yet.</p>
      ) : (
        <>
          <section className="mt-6" aria-label="Timeline">
            <div className="relative mb-1 h-4">
              {chart.ticks.map((tick) => (
                <span
                  key={tick.label + tick.at}
                  className="absolute -translate-x-1/2 text-10 text-tertiary"
                  style={{ left: `${tick.at}%` }}
                >
                  {tick.label}
                </span>
              ))}
            </div>
            <div className="relative">
              {/* Month gridlines and today, behind the bars. */}
              <div className="pointer-events-none absolute inset-0">
                {chart.ticks.map((tick) => (
                  <span
                    key={`grid-${tick.label}-${tick.at}`}
                    className="bg-subtle absolute top-0 bottom-0 w-px"
                    style={{ left: `${tick.at}%` }}
                  />
                ))}
                {chart.todayAt !== null && (
                  <span
                    className="absolute top-0 bottom-0 w-px bg-danger-primary/60"
                    style={{ left: `${chart.todayAt}%` }}
                    aria-hidden
                  />
                )}
              </div>

              <ul className="relative space-y-1.5">
                {chart.items.map((item) => (
                  <li key={item.key} className="relative h-6">
                    <span
                      className={cn("absolute top-1 h-4 rounded", item.milestone ? "ring-warning-primary ring-2" : "")}
                      style={{
                        left: `${item.left}%`,
                        width: `${item.width}%`,
                        backgroundColor: GROUP_FILL[item.state_group ?? ""] ?? GROUP_FILL.unstarted,
                      }}
                      title={`${item.name} · ${renderFormattedDate(item.start_date) ?? "—"} → ${
                        renderFormattedDate(item.target_date) ?? "—"
                      }`}
                    />
                    <span
                      className="absolute top-0.5 text-12 whitespace-nowrap text-secondary"
                      // Past the halfway mark the label would run off the right
                      // edge, so it flips to the left of the bar instead.
                      style={
                        item.left > 55
                          ? { right: `${100 - item.left}%`, paddingRight: 8 }
                          : { left: `${item.left + item.width}%`, paddingLeft: 8 }
                      }
                    >
                      {item.name}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {milestones.length > 0 && (
            <section className="mt-8">
              <h2 className="text-11 tracking-wide text-tertiary uppercase">Milestones</h2>
              <ul className="mt-2 divide-y divide-subtle border-t border-subtle">
                {milestones.map((item) => (
                  <li key={item.key} className="flex items-baseline gap-3 py-2">
                    <span className="text-10 text-tertiary uppercase">
                      {MILESTONE_LABEL[item.milestone?.kind ?? ""] ?? "Milestone"}
                    </span>
                    <span className="flex-1 text-13 text-primary">{item.name}</span>
                    <span className="text-12 text-tertiary">
                      {renderFormattedDate(item.target_date ?? item.start_date) ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-8 flex flex-wrap gap-x-4 gap-y-2" aria-label="Legend">
            {[
              ["completed", "Done"],
              ["started", "In progress"],
              ["unstarted", "Not started"],
              ["backlog", "Backlog"],
            ].map(([group, label]) => (
              <span key={group} className="flex items-center gap-1.5 text-11 text-tertiary">
                <span className="size-2.5 rounded-sm" style={{ backgroundColor: GROUP_FILL[group] }} />
                {label}
              </span>
            ))}
          </section>
        </>
      )}

      <footer className="mt-10 border-t border-subtle pt-4 text-11 text-tertiary">
        Shared by the project team. Dates are the current plan and move as the work does.
      </footer>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-layer-1 px-4 py-10">
      <main className="mx-auto max-w-4xl overflow-x-auto rounded-lg border border-subtle bg-layer-2 p-6">
        {children}
      </main>
    </div>
  );
}
