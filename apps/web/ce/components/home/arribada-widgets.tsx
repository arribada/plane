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
 *
 * EVERY EMPTY STATE HERE IS GOOD NEWS, which is exactly why a failed load may
 * never borrow one. All four fetches used to end `.catch(() => setRows([]))` and
 * the shell had no error state to put anywhere: a 403, a 500 or a dropped
 * connection landed a guest on a landing page reading "No purchase requests need
 * your decision" and "Nobody is on two things at once". The card knew nothing and
 * said everything was fine.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { AlertTriangle, Flag, Github, RefreshCw, ShoppingCart, TrendingDown } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { renderFormattedDate } from "@plane/utils";
import { cn } from "@plane/utils";
import { todayIso } from "@/plane-web/components/gantt-chart/working-days";
import { githubSyncToast } from "@/plane-web/components/github-triage/sync-toast";
import { apiErrorMessage } from "@/plane-web/services/api-error";
import { ArribadaService } from "@/plane-web/services/arribada.service";

const service = new ArribadaService();

/**
 * One widget's data in the three states it actually has — loading, loaded,
 * failed — rather than the two it used to be squeezed into.
 *
 * `load` is a fresh arrow on every render, so it is read through a ref: the fetch
 * keys off the workspace and the reload counter alone, or every parent render
 * would refetch four endpoints.
 */
function useWidgetLoad<T>(slug: string | undefined, load: (slug: string) => Promise<T>) {
  const [rows, setRows] = useState<T | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [token, setToken] = useState(0);
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });

  useEffect(() => {
    if (!slug) return undefined;
    let cancelled = false;
    setRows(null);
    setFailure(null);
    latest
      .current(slug)
      .then((found) => {
        if (!cancelled) setRows(found);
        return undefined;
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailure(apiErrorMessage(error, "The server did not answer."));
      });
    return () => {
      cancelled = true;
    };
  }, [slug, token]);

  const reload = useCallback(() => setToken((n) => n + 1), []);
  return { rows, failure, reload };
}

/** Days between two ISO dates, positive when `later` is after `earlier`. */
const daysBetween = (earlier: string, later: string) =>
  Math.round((new Date(later).getTime() - new Date(earlier).getTime()) / 86_400_000);

/** The reader's own day. `toISOString()` answers in UTC, which at UTC+13 stamps
 *  the whole local morning as yesterday — and every widget on this page compares
 *  it against plain-day plan dates. */
const today = todayIso;

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
  /** Why nothing could be read. Takes precedence over `empty`, always: this card
   *  may not claim the happy path on the strength of a request that failed. */
  failure?: string | null;
  /** Offered beside the failure, so the answer to an outage is not a full reload. */
  onRetry?: () => void;
  children: React.ReactNode;
  count: number;
};

function WidgetShell({ title, icon, loading, empty, failure, onRetry, children, count }: ShellProps) {
  return (
    <div className="rounded-lg border border-subtle bg-layer-2 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-12 font-medium text-secondary">
        {icon}
        {title}
        {count > 0 && !failure && <span className="font-normal text-11 text-tertiary">· {count}</span>}
      </p>
      {failure ? (
        <div role="alert" className="flex flex-col items-start gap-1 py-3">
          <p className="flex items-start gap-1.5 text-11 text-danger-primary">
            <AlertTriangle className="mt-px size-3 shrink-0" />
            <span>
              <span className="font-medium">Couldn&apos;t load this.</span> {failure} Nothing below is a statement about
              your work.
            </span>
          </p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="text-11 text-accent-primary hover:underline">
              Try again
            </button>
          )}
        </div>
      ) : loading ? (
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
  const { rows, failure, reload } = useWidgetLoad<TDeliverable[]>(workspaceSlug?.toString(), (slug) =>
    service.getWorkspaceDeliverables(slug)
  );

  // Delivered ones are history; this widget is about what is coming.
  const pending = (rows ?? []).filter((r) => !r.done).slice(0, 6);
  const now = today();

  return (
    <WidgetShell
      title="Upcoming deliverables"
      icon={<Flag className="size-3.5 text-tertiary" />}
      loading={rows === null}
      failure={failure}
      onRetry={reload}
      empty="Nothing marked as a deliverable yet. Mark one from a project's timeline."
      count={pending.length}
    >
      {pending.map((row) => {
        const late = !!row.target_date && row.target_date < now;
        return (
          <li key={row.issue_id} className="flex items-baseline gap-2 text-12">
            <a
              href={`/${workspaceSlug}/projects/${row.project_id}/issues/${row.issue_id}`}
              title={row.label}
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
  const {
    rows: people,
    failure,
    reload,
  } = useWidgetLoad<{ user_id: string; name: string; conflict_count: number }[]>(
    workspaceSlug?.toString(),
    async (slug) => {
      const payload = await service.getWorkloadTimeline(slug);
      return (payload?.people ?? [])
        .filter((p) => p.conflict_count > 0)
        .map((p) => ({ user_id: p.user_id, name: p.name, conflict_count: p.conflict_count }));
    }
  );

  const rows = (people ?? []).slice(0, 6);

  return (
    <WidgetShell
      title="Double-booked"
      icon={<AlertTriangle className="size-3.5 text-tertiary" />}
      loading={people === null}
      failure={failure}
      onRetry={reload}
      empty="Nobody is on two things at once. "
      count={rows.length}
    >
      {rows.map((person) => (
        <li key={person.user_id} className="flex items-baseline gap-2 text-12">
          <a href={`/${workspaceSlug}/workload`} title={person.name} className="min-w-0 flex-1 truncate text-primary hover:underline">
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
  const { rows, failure, reload } = useWidgetLoad<TApproval[]>(workspaceSlug?.toString(), (slug) =>
    service.getMyApprovals(slug)
  );

  const pending = (rows ?? []).slice(0, 6);

  return (
    <WidgetShell
      title="Waiting on you"
      icon={<ShoppingCart className="size-3.5 text-tertiary" />}
      loading={rows === null}
      failure={failure}
      onRetry={reload}
      empty="No purchase requests need your decision."
      count={pending.length}
    >
      {pending.map((row) => (
        <li key={row.id} className="flex items-baseline gap-2 text-12">
          <a
            href={`/${workspaceSlug}/projects/${row.project_id}/overview`}
            title={row.label}
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
  const { rows, failure, reload } = useWidgetLoad<{ id: string; name: string; identifier: string; drift: number }[]>(
    workspaceSlug?.toString(),
    async (slug) => {
      const projects = await service.getPortfolio(slug);
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
      return drifting;
    }
  );

  const drifting = (rows ?? []).slice(0, 6);

  return (
    <WidgetShell
      title="Drifting past the plan"
      icon={<TrendingDown className="size-3.5 text-tertiary" />}
      loading={rows === null}
      failure={failure}
      onRetry={reload}
      empty="No project's work runs past its planned end."
      count={drifting.length}
    >
      {drifting.map((row) => (
        <li key={row.id} className="flex items-baseline gap-2 text-12">
          <a
            href={`/${workspaceSlug}/projects/${row.id}/overview`}
            title={row.name}
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

/**
 * Why the GitHub inbox is still full, split by what you can actually do.
 *
 * Two different problems wear the same face on the board, and reporting them
 * together as "unrouted" is what makes the fixable ones look unfixable. A repo NO
 * project claims is a link somebody forgot — one edit and its issues file
 * themselves on the next sync. A repo SEVERAL projects claim cannot be routed at
 * all, because guessing an owner would put work under a project that never asked
 * for it, so those stay a human decision per issue.
 *
 * The widget states which is which and how many issues each is holding, because
 * "39 in the inbox" is a number nobody can act on.
 */
export const GithubInboxWidget = observer(function GithubInboxWidget() {
  const { workspaceSlug } = useParams();
  const [syncing, setSyncing] = useState(false);
  // The load had no `.catch` at all: a failure left an unhandled rejection and
  // `gap` null forever, so the card sat on its loading skeleton with nothing to
  // say and no way to say it.
  const {
    rows: gap,
    failure,
    reload,
  } = useWidgetLoad<Awaited<ReturnType<ArribadaService["getGithubInboxGap"]>>>(workspaceSlug?.toString(), (slug) =>
    service.getGithubInboxGap(slug)
  );

  const resync = async () => {
    if (!workspaceSlug || !gap?.sync_project_id) return;
    setSyncing(true);
    try {
      const r = await service.githubSyncNow(workspaceSlug.toString(), gap.sync_project_id);
      setToast(
        r.skipped ? { type: TOAST_TYPE.INFO, title: "Nothing was pulled", message: r.skipped } : githubSyncToast(r)
      );
      reload();
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't sync",
        message: apiErrorMessage(error, "GitHub did not answer."),
      });
    } finally {
      setSyncing(false);
    }
  };

  const unclaimed = gap?.unclaimed ?? [];
  const contested = gap?.contested ?? [];

  return (
    <WidgetShell
      title="GitHub inbox"
      icon={<Github className="size-3.5" />}
      loading={gap === null}
      failure={failure}
      onRetry={reload}
      count={unclaimed.length + contested.length}
      // "Nothing is stuck" is a claim, and it was being made while 27 issues sat
      // in repos two projects were arguing over — the endpoint had given up early
      // and returned nothing, which looks identical to good news. It is only good
      // news when something was actually examined, so an empty answer computed
      // from nothing says so instead. A request that FAILED never gets this far:
      // `failure` above wins over both.
      empty={
        gap?.tracked
          ? "Nothing is stuck: every synced repo belongs to exactly one project."
          : "Nothing has been captured from GitHub yet, so there is nothing to say about it."
      }
    >
      <div className="space-y-2">
        {unclaimed.length > 0 && (
          <div>
            <p className="mb-1 text-11 text-warning-primary">
              No project claims these — link the repo on that project and they file themselves.
            </p>
            <ul className="space-y-0.5">
              {unclaimed.map((row) => (
                <li key={row.repo} className="flex items-baseline gap-2 text-11">
                  <span className="min-w-0 flex-1 truncate text-secondary">{row.repo}</span>
                  <span className="flex-shrink-0 text-tertiary tabular-nums">{row.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {contested.length > 0 && (
          <div className={unclaimed.length > 0 ? "border-t border-subtle pt-2" : ""}>
            <p className="mb-1 text-11 text-tertiary">
              Claimed by several projects, so nobody can route them for you — these stay a per-issue call.
            </p>
            <ul className="space-y-0.5">
              {contested.map((row) => (
                <li key={row.repo} className="flex items-baseline gap-2 text-11">
                  <span className="min-w-0 flex-1 truncate text-secondary" title={row.projects.join(", ")}>
                    {row.repo}
                  </span>
                  <span className="flex-shrink-0 text-tertiary">{row.projects.length} projects</span>
                  <span className="flex-shrink-0 text-tertiary tabular-nums">{row.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {unclaimed.length > 0 && gap?.sync_project_id && (
          <button
            type="button"
            onClick={() => void resync()}
            disabled={syncing}
            className={cn(
              "flex items-center gap-1.5 rounded border border-subtle px-2 py-1 text-11 text-secondary",
              syncing ? "opacity-50" : "hover:bg-layer-1 hover:text-primary"
            )}
          >
            <RefreshCw className={cn("size-3", syncing && "animate-spin")} />
            {syncing ? "Syncing…" : "Sync again"}
          </button>
        )}
      </div>
    </WidgetShell>
  );
});
