/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Four optional Home widgets, each showing something the product already knows
 * and shows nowhere anybody passes.
 *
 * They share one shell because the interesting part of each is three lines of
 * selection, not its chrome — and four hand-rolled cards would drift apart within
 * a month. All four are off until switched on in Manage widgets; nothing here
 * appears for somebody who did not ask for it.
 */
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { AlertTriangle, Flag, ShoppingCart, TrendingDown } from "lucide-react";
import { renderFormattedDate } from "@plane/utils";
import { cn } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";

const service = new ArribadaService();

/** Days between two ISO dates, positive when `later` is after `earlier`. */
const daysBetween = (earlier: string, later: string) =>
  Math.round((new Date(later).getTime() - new Date(earlier).getTime()) / 86_400_000);

const today = () => new Date().toISOString().slice(0, 10);

/** Grouped digits and the currency's own symbol where the browser knows one. */
const money = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    // An unknown or malformed currency code must not blank the figure.
    return `${Math.round(amount).toLocaleString()} ${currency}`;
  }
};

type ShellProps = {
  title: string;
  icon: React.ReactNode;
  loading: boolean;
  /** What to say when there is genuinely nothing — which is good news here, and
   *  should read like it rather than like a failed load. */
  empty: string;
  children: React.ReactNode;
  count: number;
};

function WidgetShell({ title, icon, loading, empty, children, count }: ShellProps) {
  return (
    <div className="rounded-lg border border-subtle bg-layer-2 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-12 font-medium text-secondary">
        {icon}
        {title}
        {count > 0 && <span className="font-normal text-11 text-tertiary">· {count}</span>}
      </p>
      {loading ? (
        <div className="h-16 animate-pulse rounded bg-layer-1" />
      ) : count === 0 ? (
        <p className="py-3 text-11 text-tertiary">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1">{children}</ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Upcoming deliverables                                                       */
/* -------------------------------------------------------------------------- */

type TDeliverable = {
  issue_id: string;
  kind: string;
  label: string;
  target_date: string | null;
  done: boolean;
  project_id: string;
  project_identifier: string;
};

export const DeliverablesWidget = observer(function DeliverablesWidget() {
  const { workspaceSlug } = useParams();
  const [rows, setRows] = useState<TDeliverable[] | null>(null);

  useEffect(() => {
    if (!workspaceSlug) return;
    let cancelled = false;
    service
      .getWorkspaceDeliverables(workspaceSlug.toString())
      .then((found) => {
        if (!cancelled) setRows(found);
        return undefined;
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug]);

  // Delivered ones are history; this widget is about what is coming.
  const pending = (rows ?? []).filter((r) => !r.done).slice(0, 6);
  const now = today();

  return (
    <WidgetShell
      title="Upcoming deliverables"
      icon={<Flag className="size-3.5 text-tertiary" />}
      loading={rows === null}
      empty="Nothing marked as a deliverable yet. Mark one from a project's timeline."
      count={pending.length}
    >
      {pending.map((row) => {
        const late = !!row.target_date && row.target_date < now;
        return (
          <li key={row.issue_id} className="flex items-baseline gap-2 text-12">
            <a
              href={`/${workspaceSlug}/projects/${row.project_id}/issues/${row.issue_id}`}
              className="min-w-0 flex-1 truncate text-primary hover:underline"
            >
              {row.label}
            </a>
            <span className="flex-shrink-0 text-11 text-tertiary">{row.project_identifier}</span>
            <span
              className={cn(
                "flex-shrink-0 text-11 tabular-nums",
                late ? "font-medium text-danger-primary" : "text-secondary"
              )}
            >
              {row.target_date ? renderFormattedDate(row.target_date) : "no date"}
            </span>
          </li>
        );
      })}
    </WidgetShell>
  );
});

/* -------------------------------------------------------------------------- */
/* Workload conflicts                                                          */
/* -------------------------------------------------------------------------- */

export const ConflictsWidget = observer(function ConflictsWidget() {
  const { workspaceSlug } = useParams();
  const [people, setPeople] = useState<{ user_id: string; name: string; conflict_count: number }[] | null>(null);

  useEffect(() => {
    if (!workspaceSlug) return;
    let cancelled = false;
    service
      .getWorkloadTimeline(workspaceSlug.toString())
      .then((payload) => {
        if (!cancelled)
          setPeople(
            (payload?.people ?? [])
              .filter((p) => p.conflict_count > 0)
              .map((p) => ({ user_id: p.user_id, name: p.name, conflict_count: p.conflict_count }))
          );
        return undefined;
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug]);

  const rows = (people ?? []).slice(0, 6);

  return (
    <WidgetShell
      title="Double-booked"
      icon={<AlertTriangle className="size-3.5 text-tertiary" />}
      loading={people === null}
      empty="Nobody is on two things at once. "
      count={rows.length}
    >
      {rows.map((person) => (
        <li key={person.user_id} className="flex items-baseline gap-2 text-12">
          <a href={`/${workspaceSlug}/workload`} className="min-w-0 flex-1 truncate text-primary hover:underline">
            {person.name}
          </a>
          <span className="flex-shrink-0 text-11 font-medium text-danger-primary">
            {person.conflict_count} clash{person.conflict_count === 1 ? "" : "es"}
          </span>
        </li>
      ))}
    </WidgetShell>
  );
});

/* -------------------------------------------------------------------------- */
/* Purchases awaiting me                                                       */
/* -------------------------------------------------------------------------- */

type TApproval = {
  id: string;
  label: string;
  total: number;
  currency: string;
  requested_by_name: string | null;
  project_id: string;
  project_name: string;
};

export const MyApprovalsWidget = observer(function MyApprovalsWidget() {
  const { workspaceSlug } = useParams();
  const [rows, setRows] = useState<TApproval[] | null>(null);

  useEffect(() => {
    if (!workspaceSlug) return;
    let cancelled = false;
    service
      .getMyApprovals(workspaceSlug.toString())
      .then((found) => {
        if (!cancelled) setRows(found);
        return undefined;
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug]);

  const pending = (rows ?? []).slice(0, 6);

  return (
    <WidgetShell
      title="Waiting on you"
      icon={<ShoppingCart className="size-3.5 text-tertiary" />}
      loading={rows === null}
      empty="No purchase requests need your decision."
      count={pending.length}
    >
      {pending.map((row) => (
        <li key={row.id} className="flex items-baseline gap-2 text-12">
          <a
            href={`/${workspaceSlug}/projects/${row.project_id}/overview`}
            className="min-w-0 flex-1 truncate text-primary hover:underline"
          >
            {row.label}
          </a>
          {row.requested_by_name && (
            <span className="flex-shrink-0 text-11 text-tertiary">{row.requested_by_name}</span>
          )}
          <span className="flex-shrink-0 text-11 text-secondary tabular-nums">{money(row.total, row.currency)}</span>
        </li>
      ))}
    </WidgetShell>
  );
});

/* -------------------------------------------------------------------------- */
/* Projects drifting                                                           */
/* -------------------------------------------------------------------------- */

export const DriftWidget = observer(function DriftWidget() {
  const { workspaceSlug } = useParams();
  const [rows, setRows] = useState<{ id: string; name: string; identifier: string; drift: number }[] | null>(null);

  useEffect(() => {
    if (!workspaceSlug) return;
    let cancelled = false;
    service
      .getPortfolio(workspaceSlug.toString())
      .then((projects) => {
        if (cancelled) return undefined;
        const drifting = projects
          // Drift is what the work now implies MINUS what was promised. A project
          // with no promised end cannot drift from anything, so it is not here.
          .filter((p) => p.target_date && p.derived_target_date && p.derived_target_date > p.target_date)
          .map((p) => ({
            id: p.id,
            name: p.name,
            identifier: p.identifier,
            drift: daysBetween(p.target_date as string, p.derived_target_date as string),
          }));
        drifting.sort((a, b) => b.drift - a.drift);
        setRows(drifting);
        return undefined;
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug]);

  const drifting = (rows ?? []).slice(0, 6);

  return (
    <WidgetShell
      title="Drifting past the plan"
      icon={<TrendingDown className="size-3.5 text-tertiary" />}
      loading={rows === null}
      empty="No project's work runs past its planned end."
      count={drifting.length}
    >
      {drifting.map((row) => (
        <li key={row.id} className="flex items-baseline gap-2 text-12">
          <a
            href={`/${workspaceSlug}/projects/${row.id}/overview`}
            className="min-w-0 flex-1 truncate text-primary hover:underline"
          >
            {row.name}
          </a>
          <span className="flex-shrink-0 text-11 text-tertiary">{row.identifier}</span>
          <span className="flex-shrink-0 text-11 font-medium text-danger-primary tabular-nums">+{row.drift} d</span>
        </li>
      ))}
    </WidgetShell>
  );
});
