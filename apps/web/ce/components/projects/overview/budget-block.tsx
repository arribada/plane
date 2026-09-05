/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What a project costs: the human time its work items imply, and the money it
 * spends on everything else — hardware, a field trip, shipping, a subcontractor.
 *
 * The two are shown apart and never added together. Labour is *derived* from the
 * plan and moves the moment somebody drags a bar; an expense is a number a person
 * typed and usually has a receipt for. One combined figure would lend the estimate
 * the authority of the receipt.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import {
  ArrowLeftRight,
  CalendarOff,
  Check,
  Coins,
  Copy,
  Download,
  Link as LinkIcon,
  Pencil,
  Plus,
  ShoppingCart,
  Trash2,
  Wallet,
  Wand2,
  X,
} from "lucide-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn, renderFormattedDate, renderFormattedInstant } from "@plane/utils";
import { downloadText } from "@/plane-web/components/gantt-chart/export";
import { ExpenseModal } from "@/plane-web/components/workspace/expense-modal";
import { apiErrorMessage } from "@/plane-web/services/api-error";
import { buildBudgetCsv } from "./budget-export";
import { decisionVerb, statusPill } from "./helpers";
import { SpendAnalysis } from "./spend-analysis";
import { SpendCurve } from "./spend-curve";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type {
  TCurrencySettings,
  TExpenseCategory,
  TProcurementRequest,
  TNonWorkingDay,
  TProjectBudget,
  TProjectExpense,
  TRolePreset,
  TRoleRate,
} from "@/plane-web/types/arribada";

const CATEGORIES: { value: TExpenseCategory; label: string }[] = [
  { value: "hardware", label: "Hardware & components" },
  { value: "field", label: "Field trip" },
  { value: "travel", label: "Travel" },
  { value: "shipping", label: "Shipping & customs" },
  { value: "services", label: "Services & subcontracting" },
  { value: "other", label: "Other" },
];

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

/** Grouped digits and the currency's own symbol where the browser knows one. */
const money = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    // An unknown or malformed currency code must not blank the figure.
    return `${Math.round(amount).toLocaleString()} ${currency}`;
  }
};

/**
 * A converted figure, never written like a recorded one. The "≈" is doing real
 * work: it is the difference between a number somebody has a receipt for and a
 * number this page worked out from a rate a colleague typed last spring.
 */
const approx = (amount: number, currency: string) => `≈ ${money(amount, currency)}`;

/**
 * A date input's value on its way to the server.
 *
 * An emptied `<input type="date">` gives `""`, and the server parses YYYY-MM-DD
 * and ignores anything else — so `""` would silently leave yesterday's promised
 * delivery date in place, still holding the schedule's floor, while the form that
 * cleared it reported success.
 */
const dateOrNull = (value: string) => (value.trim() ? value.trim() : null);

/** The recorded amounts, side by side, for the line under a converted figure. */
const recorded = (rows: { currency: string; amount: number }[]) =>
  rows.map((t) => money(t.amount, t.currency)).join(" · ");

export const OverviewBudgetBlock = observer(function OverviewBudgetBlock() {
  const { workspaceSlug, projectId } = useParams();
  const service = useMemo(() => new ArribadaService(), []);
  const { allowPermissions } = useUserPermissions();
  // For the export filename and its title row — the budget payload carries
  // figures, not the project's name.
  const { getProjectById } = useProject();
  const slug = workspaceSlug?.toString() ?? "";
  const pid = projectId?.toString() ?? "";

  const [budget, setBudget] = useState<TProjectBudget | null>(null);
  const [expenses, setExpenses] = useState<TProjectExpense[]>([]);
  // "Nothing spent yet" and "we could not read it" look identical on screen and
  // are not the same thing; the second must not invite someone to re-enter a line.
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // Which form is open, if any: "request" goes to the lead, "record" writes the
  // line. Both are the same modal — see the comment where it is rendered.
  const [expenseForm, setExpenseForm] = useState<"request" | "record" | null>(null);
  // The recorded line whose edit form is open, if any. Separate from expenseForm
  // because it carries the row to prefill; the same modal serves both.
  const [editingExpense, setEditingExpense] = useState<TProjectExpense | null>(null);
  const [saving, setSaving] = useState(false);
  // The two workspace-level tables that make the labour figure mean anything.
  // Edited here rather than behind a settings page: this is where somebody
  // notices the number is wrong, and it is where they should be able to fix it.
  const [panel, setPanel] = useState<"rates" | "calendar" | "allocation" | "currency" | null>(null);
  const [rates, setRates] = useState<TRoleRate[]>([]);
  // The vocabulary a rate can attach to, and the indicative figures to offer
  // where one is missing. Both come from the server: a rate table that also lived
  // in this file would be two tables the day somebody edited one of them.
  const [knownRoles, setKnownRoles] = useState<{ value: string; label: string }[]>([]);
  const [presets, setPresets] = useState<TRolePreset[]>([]);
  const [days, setDays] = useState<TNonWorkingDay[]>([]);
  const [allocDraft, setAllocDraft] = useState("");
  const [allocCcy, setAllocCcy] = useState("EUR");
  const [requests, setRequests] = useState<TProcurementRequest[]>([]);
  // Which currency the figures are being read in, and the rate that gets them
  // there. "" until the first load answers with the workspace's own choice.
  const [currency, setCurrency] = useState<TCurrencySettings | null>(null);
  const [displayCcy, setDisplayCcy] = useState("");
  // Who may write to the sheet. Answered by the server, not inferred from the
  // workspace role: "project lead" is a job, and admin is a permission level.
  const [canApprove, setCanApprove] = useState(false);
  // The id of the request whose decision is in flight, or null. One at a time
  // across the whole queue rather than per row: the reload afterwards replaces
  // every row, so a second decision taken against the list being replaced is
  // acting on figures that are already stale.
  const [deciding, setDeciding] = useState<string | null>(null);
  // The purchase whose order details are open for editing, and the draft in that
  // form. One at a time, like the decision above and for the same reason: saving
  // reloads the whole list, so a second form open over the old rows is editing
  // figures that are about to be replaced.
  const [tracking, setTracking] = useState<string | null>(null);
  const [trackDraft, setTrackDraft] = useState({
    order_reference: "",
    ordered_on: "",
    expected_on: "",
    received_on: "",
  });
  const [trackSaving, setTrackSaving] = useState(false);

  // The sheet belongs to whoever answers for the budget. Everyone else asks.
  const canEdit = canApprove;
  // Recording that an order was placed or arrived is NOT the same permission as
  // approving one. Approving commits the money and writes an expense line, and the
  // server keeps that to the project lead (`can_approve`). The PATCH behind the
  // tracking form is `MONEY_ROLES` at project level — ADMIN or MEMBER on this
  // project — because the person who placed the order is usually not the lead and
  // is always the one who knows when it shipped. Same roles, same level, same
  // order as that decorator.
  const canTrack = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT,
    slug,
    pid
  );
  // Raising a request needs only write access to the project.
  const canRequest = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE,
    slug
  );
  // The hourly rates and the exchange rate are workspace-wide commercial facts and
  // the server has always gated both on workspace admin — a different rule from
  // everything else on this sheet, which the project lead owns. Asked here so a
  // lead who is not an admin is told before they type, rather than by a 403.
  const canWriteWorkspaceRates = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE, slug);

  // `ccy` is passed through to the budget read so the switch changes what this
  // page shows without changing it for everybody in the workspace.
  const load = useCallback(
    async (ccy?: string) => {
      if (!slug || !pid) return;
      try {
        const [b, e, r, c, p, cur] = await Promise.all([
          service.getBudget(slug, pid, ccy || undefined),
          service.getExpenses(slug, pid),
          service.getRoleRates(slug),
          service.getCalendar(slug),
          service.getProcurement(slug, pid),
          // Swallowed on its own rather than with the rest: a server that predates
          // the currency table should cost the reader a toggle, not the whole
          // sheet. Without a setting the budget reads in its own currency, which
          // is exactly what it did before any of this existed.
          service.getCurrencySettings(slug).catch(() => null),
        ]);
        setBudget(b);
        setExpenses(e?.expenses ?? []);
        setRates(r?.rates ?? []);
        setKnownRoles(r?.known_roles ?? []);
        setPresets(r?.presets ?? []);
        setDays(c?.days ?? []);
        setAllocDraft(b?.allocation?.amount != null ? String(b.allocation.amount) : "");
        setAllocCcy(b?.allocation?.currency ?? "EUR");
        setRequests(p?.requests ?? []);
        setCanApprove(!!p?.can_approve);
        setCurrency(cur ?? null);
        // Whatever the server settled on, so the toggle starts where the page is
        // rather than on a guess that would silently move the figures.
        setDisplayCcy(ccy || b?.display?.currency || "");
        setLoaded(true);
        setFailed(false);
      } catch {
        setFailed(true);
      }
    },
    [service, slug, pid]
  );

  useEffect(() => {
    void load();
  }, [load]);

  /** Re-read the budget in another currency. Nothing else on the page moves. */
  const switchDisplay = async (ccy: string) => {
    setDisplayCcy(ccy);
    try {
      setBudget(await service.getBudget(slug, pid, ccy));
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't switch currency",
        message: "The figures on screen are still the ones you were reading.",
      });
    }
  };

  const saveCurrency = async (data: { display_currency?: string; eur_gbp_rate?: number }) => {
    try {
      const next = await service.saveCurrencySettings(slug, data);
      setCurrency(next);
      setPanel(null);
      await load(displayCcy);
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't save the exchange rate",
        message: "Every converted figure on screen still uses the old one.",
      });
    }
  };

  const saveAllocation = async () => {
    const raw = allocDraft.trim();
    const amount = raw === "" ? null : Number(raw);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return;
    setSaving(true);
    try {
      // The currency goes with the amount. It was writable end to end and no UI
      // had ever sent it, which is why every allocation in the instance is euros
      // whether or not the project was funded in them.
      await service.updateSchedule(slug, pid, { budget_amount: amount, budget_currency: allocCcy });
      setPanel(null);
      await load(displayCcy);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't save the budget", message: "Nothing was changed." });
    } finally {
      setSaving(false);
    }
  };

  const saveRates = async (next: TRoleRate[]) => {
    setRates(next);
    try {
      await service.saveRoleRates(slug, next);
      await load(displayCcy);
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't save the rates",
        message:
          "The figures on screen are not what is stored. These are workspace-wide, so saving them needs workspace admin.",
      });
      // Re-thrown so the panel keeps its "not saved yet" warning up. Swallowing it
      // would leave a prefill looking committed when nothing reached the server.
      throw error;
    }
  };

  const addHoliday = async (date: string, name: string) => {
    if (!date) return;
    try {
      await service.addNonWorkingDay(slug, { date, name });
      await load(displayCcy);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't add that day", message: "The calendar is unchanged." });
    }
  };

  const removeHoliday = async (date: string) => {
    try {
      await service.removeNonWorkingDay(slug, date);
      await load(displayCcy);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't remove that day", message: "It is still there." });
    }
  };

  const setDeliveryScheduling = async (on: boolean) => {
    try {
      await service.updateSchedule(slug, pid, { schedule_from_deliveries: on });
      await load(displayCcy);
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't change that",
        message: "The schedule still ignores deliveries.",
      });
    }
  };

  const decide = async (id: string, decision: "approved" | "rejected") => {
    // Approving writes an expense line into the project. There was no in-flight
    // guard at all, so two clicks were two POSTs — and the server took its
    // idempotency decision from a copy of the request read before its own
    // transaction, so both of them created a line and the project paid twice.
    // The server is fixed and locks; this is the half that stops the second
    // request being sent at all, which is also the only half a user can see.
    if (deciding) return;
    setDeciding(id);
    try {
      await service.decidePurchase(slug, pid, id, decision);
      await load(displayCcy);
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't record that decision",
        message: "The request is unchanged.",
      });
    } finally {
      setDeciding(null);
    }
  };

  const withdraw = async (id: string) => {
    if (deciding) return;
    setDeciding(id);
    try {
      await service.withdrawPurchase(slug, pid, id);
      await load(displayCcy);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't withdraw it", message: "It is still there." });
    } finally {
      setDeciding(null);
    }
  };

  /** Open the order form on a decided request, seeded with what is already recorded. */
  const openTracking = (r: TProcurementRequest) => {
    setTracking(r.id);
    setTrackDraft({
      order_reference: r.order_reference ?? "",
      ordered_on: r.ordered_on ?? "",
      expected_on: r.expected_on ?? "",
      received_on: r.received_on ?? "",
    });
  };

  /**
   * Record what happened to an approved purchase after the money decision.
   *
   * `service.trackPurchase` has existed with no caller at all since the fields
   * were added, which cost three things at once: an approved purchase could never
   * be marked ordered or received; the audit list drew both of those states as
   * "Rejected"; and "Let the schedule wait for deliveries" could not do anything,
   * because auto-schedule builds its floors from `expected_on`/`received_on` and
   * nothing on earth could write them.
   *
   * The status is DERIVED from the dates rather than picked separately. Two
   * controls that can contradict each other — a date saying the parts arrived and
   * a dropdown still saying "ordered" — is a second source of truth about the same
   * fact, and the schedule reads the dates, so the dates are the fact.
   */
  const saveTracking = async (id: string) => {
    if (trackSaving) return;
    setTrackSaving(true);
    const ordered = dateOrNull(trackDraft.ordered_on);
    const received = dateOrNull(trackDraft.received_on);
    try {
      await service.trackPurchase(slug, pid, id, {
        status: received ? "received" : ordered ? "ordered" : "approved",
        order_reference: trackDraft.order_reference.trim(),
        ordered_on: ordered,
        expected_on: dateOrNull(trackDraft.expected_on),
        received_on: received,
      });
      setTracking(null);
      await load(displayCcy);
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't save the order details",
        message: apiErrorMessage(error, "Nothing was changed, and the schedule still has the old dates."),
      });
    } finally {
      setTrackSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await service.deleteExpense(slug, pid, id);
      await load(displayCcy);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't delete that line", message: "It is still there." });
    }
  };

  if (failed) {
    return (
      <p className="px-4 py-3 text-13 text-tertiary">
        Couldn&apos;t read this project&apos;s costs. Reload the page before adding anything.
      </p>
    );
  }
  if (!loaded) return <p className="px-4 py-3 text-13 text-tertiary">Loading…</p>;

  const labour = budget?.labour;
  const spend = budget?.expenses;
  // The slice of the ledger that stands in for our time. Absent on an older
  // server, which is why nothing below reads it without a guard.
  const supplied = spend?.supplied;

  const input =
    "rounded border border-subtle bg-layer-1 px-2 py-1 text-12 text-primary outline-none focus:border-accent-strong";
  // Only what still needs an answer: decided requests live on as expense lines.
  const pending = requests.filter((r) => r.status === "pending");
  // Everything already answered. Filtering to "pending" made a rejected request
  // vanish from the entire product the moment it was rejected, and an approved
  // one become an anonymous expense line — so "why did we not buy the boards"
  // and "who signed off on this" had no answer anywhere.
  const decided = requests.filter((r) => r.status !== "pending");
  const alloc = budget?.allocation;
  // The same figures read in one currency. `converted` is false when everything
  // was already in it, in which case these ARE the recorded numbers and nothing
  // needs marking as approximate.
  const disp = budget?.display;
  // The allocation currency itself may be one the pair cannot reach (a dollar
  // budget read in sterling); then there is nothing to show but the record.
  const useDisp = !!disp && (alloc?.amount == null || disp.allocation != null);
  // Whichever block is on screen, the "≈" follows THAT block. `allocation.committed`
  // converts too now, so reading it as exact would present an approximation as a
  // recorded figure on exactly the projects where the two most differ.
  const near = useDisp ? !!disp?.converted : !!alloc?.converted;
  const shownCcy = useDisp && disp ? disp.currency : (alloc?.currency ?? "EUR");
  const shownAmount = useDisp && disp ? disp.allocation : (alloc?.amount ?? null);
  const shownCommitted = useDisp && disp ? disp.committed : (alloc?.committed ?? 0);
  const shownRemaining = useDisp && disp ? disp.remaining : (alloc?.remaining ?? null);
  const shownPercent = useDisp && disp ? disp.percent : (alloc?.percent ?? null);
  const over = shownRemaining != null && shownRemaining < 0;
  // A total that swept up a converted figure is approximate; the allocation is
  // only approximate if it was itself converted. Marking a number that was typed
  // in this very currency would train people to ignore the mark.
  const allocApprox = useDisp && !!disp && (alloc?.currency ?? "") !== disp.currency;
  const fig = (amount: number) => (near ? approx(amount, shownCcy) : money(amount, shownCcy));
  // The currency `committed` is actually in, which is NOT always the allocation's.
  // A budget held outside the EUR/GBP pair cannot be converted into, so the server
  // sums in a currency it can reach and names it here. Formatting that total with
  // the allocation's code would stamp francs on a sterling figure — and reporting
  // it as zero, which is what happened before, was the €793,764 / €0 incident.
  const committedCcy = (!useDisp && alloc?.basis_mismatch && alloc?.committed_currency) || shownCcy;
  const figCommitted = (amount: number) => (near ? approx(amount, committedCcy) : money(amount, committedCcy));
  const figAlloc = (amount: number) => (allocApprox ? approx(amount, shownCcy) : money(amount, shownCcy));
  // Currencies no total on this page includes: the ones the EUR/GBP pair cannot
  // reach. Both blocks now mean the same thing by it — the allocation's list used
  // to mean "not the budget's own currency", which on this instance was every
  // rate in the workspace, so the caveat named the project's entire cost as
  // excluded from the project's cost.
  const missing = useDisp && disp ? disp.unconvertible : (alloc?.excluded_currencies ?? []);
  const options = currency?.available?.length ? currency.available : ["EUR", "GBP"];

  return (
    <div className="flex flex-col gap-4 px-4 py-3">
      {/* The allocation first: it is the number everything else is read against. */}
      <div className="rounded-lg border border-subtle bg-layer-2 px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-11 font-medium tracking-wide text-tertiary uppercase">Budget</span>
          {shownAmount == null ? (
            <span className="text-13 text-tertiary">No budget recorded</span>
          ) : (
            <>
              <span className={cn("text-18 font-semibold", over ? "text-danger-primary" : "text-primary")}>
                {figCommitted(shownCommitted)}
              </span>
              <span className="text-13 text-tertiary">of {figAlloc(shownAmount)}</span>
              {shownRemaining != null && (
                <span className={cn("text-12", over ? "text-danger-primary" : "text-secondary")}>
                  {over ? `${fig(Math.abs(shownRemaining))} over` : `${fig(shownRemaining)} left`}
                </span>
              )}
            </>
          )}
          <div className="flex-grow" />
          {/* Which currency to read in. A view, not a change to the record: the
              amounts stay as recorded and the switch is per reader. Only offered
              when the server actually answered with a converted reading — a
              toggle that quietly does nothing is worse than no toggle. */}
          <span className={cn("flex items-center overflow-hidden rounded border border-subtle", !disp && "hidden")}>
            {options.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => void switchDisplay(code)}
                aria-pressed={displayCcy === code}
                className={cn(
                  "px-2 py-0.5 text-11",
                  displayCcy === code ? "bg-accent-primary text-white" : "text-secondary hover:bg-layer-1"
                )}
              >
                {code}
              </button>
            ))}
          </span>
          {/* Anyone who can see the sheet can take it away. Reading is not writing,
              and the person assembling a funder's cost report is often not the lead. */}
          {(expenses.length > 0 || requests.length > 0) && (
            <button
              type="button"
              onClick={() =>
                downloadText(
                  buildBudgetCsv(expenses, requests, {
                    projectName: getProjectById(pid)?.name ?? "Project",
                    displayCurrency: disp ? shownCcy : "",
                    rate: disp?.rate,
                    rateCapturedOn: disp?.rate_captured_on,
                    rateConfigured: disp?.rate_configured,
                  }),
                  `${
                    (getProjectById(pid)?.name ?? "project")
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .slice(0, 60) || "project"
                  }-costs.csv`,
                  "text/csv"
                )
              }
              className="flex items-center gap-1 rounded border border-subtle px-3 py-1.5 text-11 text-secondary hover:bg-layer-1"
              title="Download the expenses and purchase requests as recorded"
            >
              <Download className="size-3" />
              CSV
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => setPanel(panel === "allocation" ? null : "allocation")}
              className="flex items-center gap-1 rounded border border-subtle px-3 py-1.5 text-11 text-secondary hover:bg-layer-1"
            >
              <Pencil className="size-3" />
              {alloc?.amount == null ? "Set a budget" : "Change"}
            </button>
          )}
        </div>

        {shownAmount != null && shownPercent != null && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-layer-1">
            <div
              className={cn("h-full rounded-full", over ? "bg-danger-primary" : "bg-accent-primary")}
              // Capped at 100 so an overrun fills the bar rather than escaping it;
              // the figure above already says by how much.
              style={{ width: `${Math.min(100, shownPercent)}%` }}
            />
          </div>
        )}

        {/* The provenance travels with the figure. A converted number whose rate
            and date are two clicks away is a number nobody can defend when the
            funder asks where it came from. */}
        {near && disp && (
          <p className="mt-1.5 text-11 text-tertiary">
            ≈ approximate. Converted at 1 EUR = {disp.rate} GBP
            {disp.rate_configured
              ? disp.rate_captured_on
                ? `, recorded ${renderFormattedDate(disp.rate_captured_on)}`
                : ", date unrecorded"
              : " — a starting value nobody has set yet"}
            . Every amount is still stored in the currency it was entered in — only this reading is converted.
            {canWriteWorkspaceRates && (
              <button
                type="button"
                onClick={() => setPanel(panel === "currency" ? null : "currency")}
                className="ml-1 underline hover:text-primary"
              >
                Change the rate
              </button>
            )}
          </p>
        )}

        {missing.length > 0 && (
          <p className="mt-1.5 text-11 text-tertiary">
            Not counted above: figures in {missing.join(", ")}. Only euros and sterling convert — anything else would
            need a rate nobody here chose, so it stays in its own.
          </p>
        )}

        {/* A budget held in something neither euros nor sterling can reach. The
            figures above are then simply the record, and saying so is cheaper
            than letting somebody wonder why the switch does nothing. */}
        {!useDisp && alloc?.amount != null && (
          <p className="mt-1.5 text-11 text-tertiary">
            {alloc.basis_mismatch ? (
              <>
                This budget is held in {alloc.currency}, which only euros and sterling can be converted between — so the
                committed figure is reported in {committedCcy} instead, and how much is left cannot be worked out from
                the two. Record the allocation in {committedCcy} to get one answer.
              </>
            ) : (
              <>
                This budget is held in {alloc.currency}, which this reading cannot convert. The figures above are the
                ones recorded, counted only against amounts in the same currency.
              </>
            )}
          </p>
        )}

        {panel === "allocation" && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={0}
              step="100"
              value={allocDraft}
              onChange={(e) => setAllocDraft(e.target.value)}
              placeholder="Leave empty for none"
              className={cn(input, "w-40")}
            />
            {/* The currency the project was actually funded in. It was storable
                all along and no screen ever asked, so every budget in the
                instance says euros whether or not that is true.

                Changing it CONVERTS the amount in the box. It used to relabel it:
                a €793,764 budget switched to GBP saved as £793,764, roughly a 17%
                raise chosen from a dropdown, on the ceiling every figure on this
                page is read against. The rate is the one a human recorded and
                which travels with every other converted figure here. */}
            <select
              value={allocCcy}
              onChange={(e) => {
                const next = e.target.value;
                const rate = currency?.eur_gbp_rate;
                const amount = Number(allocDraft);
                if (rate && allocDraft.trim() !== "" && Number.isFinite(amount)) {
                  if (allocCcy === "EUR" && next === "GBP")
                    setAllocDraft(String(Math.round(amount * rate * 100) / 100));
                  else if (allocCcy === "GBP" && next === "EUR")
                    setAllocDraft(String(Math.round((amount / rate) * 100) / 100));
                }
                setAllocCcy(next);
              }}
              className={cn(input, "w-20")}
            >
              {[...new Set([...options, allocCcy])].map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void saveAllocation()}
              disabled={saving}
              className="rounded bg-accent-primary px-2.5 py-1 text-12 text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setPanel(null)} className="text-12 text-secondary hover:text-primary">
              Cancel
            </button>
          </div>
        )}

        {panel === "currency" && currency && (
          <CurrencyPanel settings={currency} onSave={saveCurrency} onClose={() => setPanel(null)} />
        )}
      </div>

      {/* Money against time, above the two halves.
          A percentage has no time in it: 60% spent is healthy at month 8 of 12
          and a crisis at month 3, and everything below renders those identically. */}
      {/* Rate and composition first: they answer "will this hold", which the
          cumulative curve below cannot. `by_category` was already computed by the
          server and rendered nowhere — data that cost a query and reached no one. */}
      <div className="rounded-lg border border-subtle bg-layer-2">
        <SpendAnalysis
          rhythm={budget?.rhythm}
          byCategory={budget?.expenses?.by_category ?? []}
          byCategoryConverted={budget?.expenses?.by_category_converted}
          // The per-discipline breakdown was computed on every read and rendered
          // as a row of pills at the very bottom of the page, below the expense
          // ledger. On a project with no expenses — nearly all of them — it was
          // the only cost information on screen and it was the last thing on it.
          byRole={labour?.by_role ?? []}
          // Cost per sprint. The page could read a project by discipline and by
          // calendar month, and a manager commits to neither.
          byCycle={budget?.by_cycle}
          money={money}
          currency={alloc?.currency ?? "EUR"}
        />
      </div>

      {/* Gated on the SERIES having something in it, not on the expense list.
          A project whose cost is entirely people — most of them here — has an
          empty ledger and a full curve, and this block used to hide itself on
          exactly those. */}
      {(budget?.curve?.points?.length ?? 0) > 1 && (
        <div className="rounded-lg border border-subtle bg-layer-2 px-3 py-2.5">
          <p className="mb-1 text-11 font-medium tracking-wide text-tertiary uppercase">Spend over time</p>
          <SpendCurve curve={budget?.curve ?? undefined} money={money} />
        </div>
      )}

      {/* The two halves, side by side and clearly separate. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-subtle bg-layer-2 px-3 py-2.5">
          <p className="text-11 font-medium tracking-wide text-tertiary uppercase">Human time</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-2">
            {!labour?.totals.length ? (
              <span className="text-13 text-tertiary">No rates recorded yet</span>
            ) : near && disp ? (
              // Folded into one figure because the reader asked for one currency.
              // The recorded amounts follow immediately below, so the estimate is
              // never the only thing on screen.
              <span className="text-18 font-semibold text-primary">{approx(disp.labour_total, disp.currency)}</span>
            ) : (
              labour.totals.map((t) => (
                <span key={t.currency} className="text-18 font-semibold text-primary">
                  {money(t.amount, t.currency)}
                </span>
              ))
            )}
          </p>
          {near && labour?.totals.length ? (
            <p className="text-11 text-tertiary">recorded as {recorded(labour.totals)}</p>
          ) : null}
          <p className="mt-0.5 text-11 text-tertiary">
            Estimated from the dated work items — it moves when the plan moves.
          </p>
          {/* A stated omission, not a silent one. Without this the figure simply
              looks smaller, which is indistinguishable from work somebody forgot
              to plan — and the whole point of taking a supplier's six weeks out
              of the labour estimate is that a reader can SEE it was taken out. */}
          {(labour?.supplied_items ?? 0) > 0 && (
            <p className="mt-1.5 text-11 text-tertiary">
              {labour?.supplied_items} work item{labour?.supplied_items === 1 ? " is" : "s are"} supplied by a third
              party — their cost is in the ledger below, not here.
            </p>
          )}
          {labour && labour.unrated_roles.length > 0 && (
            <p className="mt-1.5 text-11 text-warning-primary">
              No hourly rate for {labour.unrated_roles.join(", ")} — those days are counted but not costed.
            </p>
          )}
          {canEdit && (
            <div className="mt-2 flex flex-wrap gap-2">
              {/* Both tables are workspace-wide, and both are edited from here:
                  this is where somebody notices the figure is wrong. */}
              <button
                type="button"
                onClick={() => setPanel(panel === "rates" ? null : "rates")}
                className="flex items-center gap-1 rounded border border-subtle px-2 py-0.5 text-11 text-secondary hover:bg-layer-1"
              >
                <Coins className="size-3" />
                Hourly rates
              </button>
              <button
                type="button"
                onClick={() => setPanel(panel === "calendar" ? null : "calendar")}
                className="flex items-center gap-1 rounded border border-subtle px-2 py-0.5 text-11 text-secondary hover:bg-layer-1"
                title="Days nobody works — they move every plan in the workspace"
              >
                <CalendarOff className="size-3" />
                Non-working days {days.length > 0 && `(${days.length})`}
              </button>
              {/* The third workspace-wide number, and the only one that is a
                  judgement call rather than a fact. Admin-gated, like the rates. */}
              {canWriteWorkspaceRates && (
                <button
                  type="button"
                  onClick={() => setPanel(panel === "currency" ? null : "currency")}
                  className="flex items-center gap-1 rounded border border-subtle px-2 py-0.5 text-11 text-secondary hover:bg-layer-1"
                  title="The EUR/GBP rate every converted figure is read at"
                >
                  <ArrowLeftRight className="size-3" />
                  Exchange rate
                </button>
              )}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-subtle bg-layer-2 px-3 py-2.5">
          <p className="text-11 font-medium tracking-wide text-tertiary uppercase">Everything else</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-3">
            {near && disp ? (
              <>
                {disp.expenses_actual > 0 ? (
                  <span className="text-18 font-semibold text-primary">
                    {approx(disp.expenses_actual, disp.currency)}
                    <span className="font-normal ml-1 text-11 text-tertiary">spent</span>
                  </span>
                ) : (
                  <span className="text-13 text-tertiary">Nothing spent yet</span>
                )}
                {disp.expenses_planned > 0 && (
                  <span className="text-13 text-secondary">
                    {approx(disp.expenses_planned, disp.currency)}
                    <span className="ml-1 text-11 text-tertiary">budgeted</span>
                  </span>
                )}
              </>
            ) : (
              <>
                {spend?.actual.length ? (
                  spend.actual.map((t) => (
                    <span key={`a-${t.currency}`} className="text-18 font-semibold text-primary">
                      {money(t.amount, t.currency)}
                      <span className="font-normal ml-1 text-11 text-tertiary">spent</span>
                    </span>
                  ))
                ) : (
                  <span className="text-13 text-tertiary">Nothing spent yet</span>
                )}
                {spend?.planned.map((t) => (
                  <span key={`p-${t.currency}`} className="text-13 text-secondary">
                    {money(t.amount, t.currency)}
                    <span className="ml-1 text-11 text-tertiary">budgeted</span>
                  </span>
                ))}
              </>
            )}
          </p>
          {/* An expense is the one figure here somebody has a receipt for, so the
              amount on the receipt stays on screen even when the card is read in
              another currency. */}
          {near && (spend?.actual.length || spend?.planned.length) ? (
            <p className="text-11 text-tertiary">
              recorded as {recorded([...(spend?.actual ?? []), ...(spend?.planned ?? [])])}
            </p>
          ) : null}
          <p className="mt-0.5 text-11 text-tertiary">Hardware, field trips, shipping, subcontracting.</p>
          {/* The two kinds, apart. A manager reading a budget can move people and
              cannot move a supplier's quote, so "how much of this is somebody
              else's invoice" is the first thing the number has to be able to say
              — and it is the half that is NOT also counted as time next door. */}
          {supplied && supplied.items > 0 && (
            <p className="mt-1.5 text-11 text-secondary">
              {[...supplied.actual, ...supplied.planned].length > 0 && (
                <span className="font-medium">
                  {recorded([...supplied.actual, ...supplied.planned])}
                  {" of it "}
                </span>
              )}
              pays for {supplied.items} work item{supplied.items === 1 ? "" : "s"} a supplier delivers — bought, not
              built here, so none of it is counted as our time.
            </p>
          )}
        </div>
      </div>

      {panel === "rates" && (
        <RatesPanel
          rates={rates}
          roles={labour?.by_role.map((r) => r.role) ?? []}
          knownRoles={knownRoles}
          presets={presets}
          displayCurrency={displayCcy}
          canWrite={canWriteWorkspaceRates}
          onSave={saveRates}
        />
      )}

      {panel === "calendar" && <CalendarPanel days={days} onAdd={addHoliday} onRemove={removeHoliday} />}

      {/* The per-discipline pills that used to sit here are gone: SpendAnalysis
          draws the same numbers as a sorted chart at the top of the page, which
          is where somebody looking for "what does this project cost" arrives. */}

      {/* Requests waiting on a decision. Above the sheet, because a pending
          request is a claim on the budget that the figures above do not yet show. */}
      {pending.length > 0 && (
        <div className="rounded-lg border border-warning-strong/40 bg-warning-subtle/40 p-2.5">
          <p className="mb-1.5 flex items-center gap-1.5 text-12 font-medium text-primary">
            <ShoppingCart className="size-3.5 text-warning-primary" />
            {pending.length} purchase request{pending.length === 1 ? "" : "s"} waiting
            {!canApprove && <span className="font-normal text-11 text-tertiary">— the project lead decides</span>}
          </p>
          {/* Said once, in the open. It used to live only in Approve's title
              attribute, which is nothing at all on a touch screen — and what the
              button does to the budget is not a detail to discover afterwards. */}
          {canApprove && (
            <p className="mb-1.5 text-11 text-tertiary">
              Approving writes the line straight into the project&apos;s expenses.
            </p>
          )}
          <ul className="flex flex-col gap-1">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1 truncate text-13 text-primary">{r.label}</span>
                {r.quantity !== 1 && (
                  <span className="flex-shrink-0 text-11 text-tertiary">
                    {r.quantity} × {money(r.amount, r.currency)}
                  </span>
                )}
                <span className="flex-shrink-0 text-13 font-medium text-primary tabular-nums">
                  {money(r.total, r.currency)}
                </span>
                {r.requested_by_name && (
                  <span className="flex-shrink-0 text-11 text-tertiary">by {r.requested_by_name}</span>
                )}
                {r.supplier && <span className="flex-shrink-0 text-11 text-tertiary">{r.supplier}</span>}
                {r.needed_by && (
                  <span className="flex-shrink-0 text-11 text-tertiary">needed {renderFormattedDate(r.needed_by)}</span>
                )}
                {r.justification && <span className="w-full text-11 text-tertiary italic">{r.justification}</span>}
                {/* gap-2 and a taller hit box below: this is the money screen, "can I
                    buy the 10 Linkit boards" is literally the form's placeholder, and
                    it is a decision people make away from a desk. Approve was a 20px
                    target 4px from Reject, and approving writes a line into the
                    project's expenses. */}
                {canApprove ? (
                  <span className="flex flex-col md:flex-row w-full md:w-auto flex-shrink-0 items-stretch md:items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void decide(r.id, "approved")}
                      // Disabled for the whole queue while any decision is in
                      // flight, and it SAYS so: a button that silently swallowed
                      // the second click would leave somebody pressing it harder.
                      disabled={!!deciding}
                      className="flex w-full md:w-auto items-center justify-center gap-1 rounded bg-success-primary px-4 py-2 text-12 text-white disabled:opacity-50"
                      // Keep the item in the accessible name ("Approve 10 Linkit boards"),
                      // not a bare "Approve purchase": it tells a screen-reader user WHICH
                      // purchase, and it is the name the approve test asserts on.
                      aria-label={`Approve ${r.label}`}
                    >
                      <Check className="size-3" />
                      {deciding === r.id ? "Saving…" : "Approve"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void decide(r.id, "rejected")}
                      disabled={!!deciding}
                      aria-label={`Reject ${r.label}`}
                      // Same box as Approve: the two sit 8px apart and one of them
                      // was a 20px target, which is how a thumb aiming at Reject
                      // approves a purchase instead.
                      className="flex w-full md:w-auto items-center justify-center gap-1 rounded border border-subtle px-4 py-2 text-12 text-secondary hover:bg-layer-1 disabled:opacity-50"
                    >
                      <X className="size-3" />
                      Reject
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void withdraw(r.id)}
                    disabled={!!deciding}
                    className="flex-shrink-0 text-11 text-tertiary hover:text-danger-primary disabled:opacity-50"
                    title="Withdraw your request"
                  >
                    Withdraw
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The lines themselves */}
      <div>
        {/* flex-wrap, and the spacer only pushes on a line wide enough to hold
            everything: the delivery-scheduling checkbox alone is a third of a
            phone's width, and with the two buttons and the decided-requests
            summary beside it this row could not be drawn narrower than about
            560px. It has no business scrolling the page sideways to say so. */}
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <Wallet className="size-3.5 text-tertiary" />
          <span className="text-12 font-medium text-secondary">
            Expenses {expenses.length > 0 && <span className="text-tertiary">({expenses.length})</span>}
          </span>
          <div className="flex-grow" />
          {/* Whether the plan waits for parts.
          Off unless this project says otherwise, and offered here because this is
          where deliveries are recorded — a reflow that moved somebody's dates
          because a colleague typed a supplier's promise into a form is one nobody
          would run twice. Most projects have no hardware waiting on anything. */}
          {canEdit && (pending.length > 0 || decided.length > 0) && (
            <label className="flex items-start gap-2 rounded-lg border border-subtle bg-layer-2 px-3 py-2 text-12 text-secondary">
              <input
                type="checkbox"
                checked={!!budget?.schedule_from_deliveries}
                onChange={(e) => void setDeliveryScheduling(e.target.checked)}
                className="mt-0.5"
                title="When on, work items linked to a purchase won't start before its expected delivery date."
              />
              <span>
                Let the schedule wait for deliveries
                <span className="block text-11 text-tertiary">
                  When Reflow runs, a work item linked to an approved purchase will not start before that purchase is
                  expected. Nothing moves until somebody runs a reflow.
                </span>
              </span>
            </label>
          )}

          {/* What was already answered. A rejected request used to disappear from the
          product the second it was rejected, and an approved one became an
          anonymous expense line — so a grant audit asking who wanted a part, from
          whom, why, and who signed it off had nowhere to look. */}
          {decided.length > 0 && (
            <details className="rounded-lg border border-subtle bg-layer-2 p-2.5">
              <summary className="cursor-pointer text-12 font-medium text-secondary">
                {decided.length} decided purchase request{decided.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {decided.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-subtle pt-1.5"
                  >
                    {/* A lookup, not a ternary. See REQUEST_STATUS_PILL in
                        ./helpers — the two-way version drew `ordered` and
                        `received` as "Rejected", in red, in the list a grant
                        reviewer reads. */}
                    <span
                      className={cn(
                        "flex-shrink-0 rounded px-1.5 py-0.5 text-10 font-medium",
                        statusPill(r.status).className
                      )}
                    >
                      {statusPill(r.status).label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-13 text-primary">{r.label}</span>
                    <span className="flex-shrink-0 text-13 text-secondary tabular-nums">
                      {money(r.total, r.currency)}
                    </span>
                    <span className="w-full text-11 text-tertiary">
                      {r.requested_by_name && `Asked by ${r.requested_by_name}`}
                      {r.supplier && ` · ${r.supplier}`}
                      {r.decided_by_name && ` · ${decisionVerb(r.status)} by ${r.decided_by_name}`}
                      {/* `decided_at` is the ONE date on this row that is an
                          instant. ProcurementRequest stamps it with
                          `timezone.now()` — a DateTimeField — while `needed_by`,
                          `ordered_on`, `expected_on` and `received_on` beside it
                          are DateFields somebody typed, and those stay on
                          renderFormattedDate. Reading the instant as a day put
                          an approval made at 5pm Pacific on the next morning,
                          which is precisely the row an auditor cross-references
                          against a bank statement. */}
                      {r.decided_at && ` on ${renderFormattedInstant(r.decided_at)}`}
                    </span>
                    {/* What happened after the yes. Only rendered where there is
                        something to say, so a project that buys nothing on a lead
                        time is not made to read about deliveries. */}
                    {(r.order_reference || r.ordered_on || r.expected_on || r.received_on) && (
                      <span className="w-full text-11 text-tertiary">
                        {r.ordered_on && `Ordered ${renderFormattedDate(r.ordered_on)}`}
                        {r.order_reference && ` · ref ${r.order_reference}`}
                        {r.received_on
                          ? ` · arrived ${renderFormattedDate(r.received_on)}`
                          : r.expected_on
                            ? ` · expected ${renderFormattedDate(r.expected_on)}`
                            : ""}
                      </span>
                    )}
                    {(r.justification || r.decision_note) && (
                      <span className="w-full text-11 text-tertiary italic">
                        {r.justification}
                        {r.justification && r.decision_note && " — "}
                        {r.decision_note}
                      </span>
                    )}
                    {/* The control that had no counterpart in the product at all.
                        Offered to anyone who may write to the sheet rather than to
                        the lead alone — approving spends money and is the lead's;
                        writing down that the boards shipped is bookkeeping, and the
                        person who placed the order is the one who knows. The server
                        draws the same line: PATCH is MONEY_ROLES, POST is lead. */}
                    {canTrack && r.status !== "rejected" && (
                      <button
                        type="button"
                        onClick={() => (tracking === r.id ? setTracking(null) : openTracking(r))}
                        aria-expanded={tracking === r.id}
                        // Two words on screen, the whole sentence in the accessible
                        // name. A row already carries the purchase's label; a button
                        // repeating it visibly would wrap this row onto three lines
                        // on a phone, and a screen reader hearing "Track order" nine
                        // times in a list would learn nothing from any of them.
                        aria-label={`${r.ordered_on || r.received_on || r.expected_on ? "Update" : "Track"} the order for ${r.label}`}
                        className="flex-shrink-0 text-11 text-tertiary hover:text-accent-primary"
                      >
                        {r.ordered_on || r.received_on || r.expected_on ? "Update order" : "Track order"}
                      </button>
                    )}
                    {canTrack && tracking === r.id && (
                      <div className="flex w-full flex-wrap items-end gap-2 rounded border border-subtle bg-layer-1 p-2">
                        <label className="flex w-full flex-col gap-0.5 text-10 text-tertiary sm:w-auto">
                          Order reference
                          <input
                            type="text"
                            value={trackDraft.order_reference}
                            onChange={(e) => setTrackDraft((d) => ({ ...d, order_reference: e.target.value }))}
                            placeholder="PO-2026-014"
                            className={input}
                          />
                        </label>
                        <label className="flex w-full flex-col gap-0.5 text-10 text-tertiary sm:w-auto">
                          Ordered on
                          <input
                            type="date"
                            value={trackDraft.ordered_on}
                            onChange={(e) => setTrackDraft((d) => ({ ...d, ordered_on: e.target.value }))}
                            className={input}
                          />
                        </label>
                        {/* The one date the planner reads. Says so here rather than
                            in a help panel nobody opens — it is the difference
                            between a note and a thing that moves somebody's dates. */}
                        <label className="flex w-full flex-col gap-0.5 text-10 text-tertiary sm:w-auto">
                          Expected
                          <input
                            type="date"
                            value={trackDraft.expected_on}
                            onChange={(e) => setTrackDraft((d) => ({ ...d, expected_on: e.target.value }))}
                            className={input}
                            title="Date the supplier promised delivery — constrains task start dates when delivery scheduling is on."
                          />
                        </label>
                        <label className="flex w-full flex-col gap-0.5 text-10 text-tertiary sm:w-auto">
                          Arrived
                          <input
                            type="date"
                            value={trackDraft.received_on}
                            onChange={(e) => setTrackDraft((d) => ({ ...d, received_on: e.target.value }))}
                            className={input}
                          />
                        </label>
                        <button
                          type="button"
                          disabled={trackSaving}
                          onClick={() => void saveTracking(r.id)}
                          className="rounded bg-accent-primary px-2 py-1 text-11 text-white disabled:opacity-50"
                        >
                          {trackSaving ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setTracking(null)}
                          className="px-2 py-1 text-11 text-tertiary hover:text-primary"
                        >
                          Cancel
                        </button>
                        <span className="w-full text-10 text-tertiary">
                          {budget?.schedule_from_deliveries
                            ? "This project's reflow will not start a linked work item before the arrival date — the expected date until the parts land, then the real one."
                            : "Recorded for the audit trail. Turn on “Let the schedule wait for deliveries” above to have a reflow respect these dates."}
                        </span>
                      </div>
                    )}
                    {canApprove && (
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            !window.confirm(`Remove the record of "${r.label}"? The audit trail for it goes with it.`)
                          )
                            return;
                          void withdraw(r.id);
                        }}
                        className="flex-shrink-0 text-11 text-tertiary hover:text-danger-primary"
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {canRequest && (
            <button
              type="button"
              onClick={() => setExpenseForm("request")}
              className="flex items-center gap-1 rounded border border-subtle px-2 py-1 text-11 text-secondary hover:bg-layer-2"
              title="Ask the project lead to approve a purchase"
            >
              <ShoppingCart className="size-3" />
              Request a purchase
            </button>
          )}
          {/* Writing straight to the sheet is the lead's alone: it is the record of
              what the project has committed, and a budget nobody owns is a budget
              nobody can defend. */}
          {canEdit && (
            <button
              type="button"
              onClick={() => setExpenseForm("record")}
              className="flex items-center gap-1 rounded border border-subtle px-2 py-1 text-11 text-secondary hover:bg-layer-2"
            >
              <Plus className="size-3" />
              Add a line
            </button>
          )}
        </div>

        {/* One modal for both, and the same one the sidebar opens. Three forms
            for one object is how they came to disagree about which fields exist:
            only this page could record a link or a part number, only the sidebar
            could be opened without first finding the project, and the work item a
            cost belongs to could be named from none of them. */}
        {(canRequest || canEdit) && (
          <ExpenseModal
            isOpen={expenseForm !== null || editingExpense !== null}
            onClose={() => {
              setExpenseForm(null);
              setEditingExpense(null);
            }}
            workspaceSlug={slug}
            projectId={pid}
            mode={expenseForm === "record" ? "record" : "request"}
            expense={editingExpense}
            // A new line defaults to the project's own budget currency, not EUR.
            defaultCurrency={allocCcy}
            onSaved={() => void load(displayCcy)}
          />
        )}

        {expenses.length === 0 ? (
          <p className="text-12 text-tertiary">
            Nothing recorded. Hardware, a field trip, shipping — anything the project pays for that is not
            somebody&apos;s time.
          </p>
        ) : (
          <ul className="divide-y divide-subtle rounded-lg border border-subtle">
            {expenses.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
                <span
                  className="flex-shrink-0 rounded bg-layer-2 px-1.5 py-0.5 text-10 text-tertiary"
                  title={CATEGORY_LABEL[e.category]}
                >
                  {CATEGORY_LABEL[e.category]}
                </span>
                <span className="min-w-0 flex-1 truncate text-13 text-primary">{e.label}</span>
                {/* Which work item this money is for, when it is for one. A line
                    that says "£4,000, hardware" and nothing else cannot be
                    checked against the plan by anybody who was not in the room. */}
                {e.issue_id && (
                  <span className="flex-shrink-0 truncate text-11 text-tertiary" title={e.issue_name ?? undefined}>
                    #{e.issue_sequence_id}
                  </span>
                )}
                {/* The one badge that changes what a number MEANS: this line is
                    the item's whole cost, so the item contributes no person-days
                    to the estimate above. That was said in a title attribute,
                    which a touch screen never shows — so a badge that rewrites a
                    figure elsewhere on the page meant nothing at all on a phone.
                    It says it out loud now; the title keeps the longer sentence
                    for anyone who hovers. */}
                {e.replaces_labour && (
                  <span
                    className="flex-shrink-0 rounded bg-layer-2 px-1.5 py-0.5 text-10 text-secondary"
                    title="This work item is bought, not built here — it is not costed as our time"
                  >
                    supplied · not costed as our time
                  </span>
                )}
                {e.supplier && <span className="flex-shrink-0 text-11 text-tertiary">{e.supplier}</span>}
                {/* In the row, not behind an edit form: a part number exists to be
                    copied into somebody else's search box, and a field you have to
                    open a form to read is one nobody uses twice. */}
                {e.manufacturer_part_number && <CopyablePart value={e.manufacturer_part_number} />}
                {e.url && (
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    // -m-2 p-2 keeps the icon where it is and takes the tap target
                    // to roughly 44px, which is what a finger needs.
                    className="-m-2 flex-shrink-0 p-2 text-tertiary hover:text-accent-primary"
                    title={`Where this came from — ${e.url}`}
                    aria-label={`Open the link for ${e.label}`}
                  >
                    <LinkIcon className="size-3.5" />
                  </a>
                )}
                {e.quantity !== 1 && (
                  <span className="flex-shrink-0 text-11 text-tertiary">
                    {e.quantity} × {money(e.amount, e.currency)}
                  </span>
                )}
                <span className="flex-shrink-0 text-13 font-medium text-primary tabular-nums">
                  {money(e.total, e.currency)}
                </span>
                <span
                  className={cn(
                    "flex-shrink-0 rounded px-1.5 py-0.5 text-10",
                    e.planned ? "bg-layer-2 text-tertiary" : "bg-success-subtle text-success-primary"
                  )}
                >
                  {e.planned ? "budgeted" : "spent"}
                </span>
                {e.incurred_on && (
                  <span className="flex-shrink-0 text-11 text-tertiary">{renderFormattedDate(e.incurred_on)}</span>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setEditingExpense(e)}
                    aria-label={`Edit ${e.label}`}
                    // p-2 -m-2 keeps the icon where it is and takes the tap target to
                    // roughly 44px, which is what a finger needs.
                    className="-m-2 flex-shrink-0 p-2 text-tertiary hover:text-accent-primary"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      // A confirm on a 14px icon that deletes a recorded amount. The
                      // sheet is what a grant is reconciled against and there is no
                      // undo; naming the line and the figure is what makes a misfire
                      // recoverable by simply saying no.
                      if (
                        !window.confirm(`Delete "${e.label}" — ${money(e.total, e.currency)}? This cannot be undone.`)
                      )
                        return;
                      void remove(e.id);
                    }}
                    aria-label={`Delete ${e.label}`}
                    // p-2 -m-2 keeps the icon where it is and takes the tap target to
                    // roughly 44px, which is what a finger needs.
                    className="-m-2 flex-shrink-0 p-2 text-tertiary hover:text-danger-primary"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});

/**
 * A manufacturer part number, and one click to take it away.
 *
 * Shown in monospace because that is the only way "MAX-M10S-00B" and
 * "MAXM10S00B" look different, and getting one character wrong is an order for
 * the wrong part. Selecting it by hand out of a dense row is fiddly and easy to
 * clip, so the whole chip is the copy button.
 */
function CopyablePart({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      // Long enough to be seen, short enough that the row is back to normal
      // before the next glance — the chip is not a status, it is a receipt.
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // A denied clipboard permission is not worth a toast: the number is right
      // there in selectable text, which is what it falls back to.
      setToast({
        type: TOAST_TYPE.INFO,
        title: "Couldn't reach the clipboard",
        message: `Select it by hand: ${value}`,
      });
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={copied ? "Copied" : `Copy the part number — ${value}`}
      aria-label={`Copy the part number ${value}`}
      className={cn(
        "font-mono flex max-w-[8rem] flex-shrink-0 items-center gap-1 rounded border border-subtle px-1.5 py-0.5 text-10 hover:bg-layer-2 sm:max-w-[14rem]",
        copied ? "text-success-primary" : "text-secondary"
      )}
    >
      <span className="truncate">{value}</span>
      {copied ? <Check className="size-3 flex-shrink-0" /> : <Copy className="size-3 flex-shrink-0 text-tertiary" />}
    </button>
  );
}

/**
 * Rates are stored lowercased and the vocabulary is not ("QA / test",
 * "data / science"), so everything is folded down before it is compared. Keying on
 * the vocabulary's own casing would quietly give those two roles a second row.
 */
const roleKey = (role: string) => role.trim().toLowerCase();

/**
 * Hourly rates, workspace-wide. Every discipline the catalogue knows about is
 * listed whether or not the project uses it and whether or not it has a rate, so a
 * gap is a blank field rather than an absence nobody notices — and so a project
 * with no dated work items still has somewhere to enter one.
 *
 * Where a rate is missing, the market averages the server holds are offered as a
 * greyed suggestion and behind an explicit button. Both are deliberate: a
 * suggestion that saved itself would be indistinguishable, a month later, from a
 * figure somebody decided on.
 */
function RatesPanel({
  rates,
  roles,
  knownRoles,
  presets,
  displayCurrency,
  canWrite,
  onSave,
}: {
  rates: TRoleRate[];
  roles: string[];
  knownRoles: { value: string; label: string }[];
  presets: TRolePreset[];
  displayCurrency: string;
  canWrite: boolean;
  onSave: (next: TRoleRate[]) => void | Promise<void>;
}) {
  const byRole = new Map(rates.map((r) => [roleKey(r.role), r]));
  const labelFor = new Map(knownRoles.map((r) => [roleKey(r.value), r.label]));
  // The disciplines the project uses, every discipline the catalogue defines, and
  // anything a rate was already recorded against — deleting the last task of a
  // discipline should not hide the rate somebody entered for it.
  const shown = [
    ...new Set([
      ...roles.map(roleKey),
      ...rates.map((r) => roleKey(r.role)),
      ...knownRoles.map((r) => roleKey(r.value)),
    ]),
    // toSorted is ES2023 and this workspace targets earlier; the spread already
    // made a fresh array, so sorting it in place mutates nothing anyone holds.
    // oxlint-disable-next-line unicorn/no-array-sort
  ].sort();

  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(shown.map((r) => [r, byRole.get(r)?.hourly_rate ? String(byRole.get(r)?.hourly_rate) : ""]))
  );
  // Currency and hours-per-day only for rows the user actually touched. A save
  // must not rewrite the currency of a rate somebody deliberately recorded in a
  // third one just because another row was prefilled.
  // Hours are held as the typed string, not a number: parsing on every keystroke
  // makes "7." collapse to "7" under the caret, and the next digit lands in the
  // wrong place. Parsed once, on save.
  const [override, setOverride] = useState<Record<string, { currency: string; hours: string }>>({});
  const [applied, setApplied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Which market's figures to show as ghosts: the one matching the currency being
  // read, so the suggestion and the budget are in the same money.
  const hint = presets.find((p) => p.currency === displayCurrency) ?? presets[0];
  const currencyOptions = [...new Set(presets.map((p) => p.currency))];

  const ccyOf = (role: string) => override[role]?.currency ?? byRole.get(role)?.currency ?? "EUR";
  const hoursOf = (role: string) => override[role]?.hours ?? String(byRole.get(role)?.hours_per_day ?? 7);
  // The server clamps this to 0.5..24 anyway; a blank or nonsense box falls back
  // to the seven-hour day the rest of the fork assumes.
  const hoursNumber = (role: string) => {
    const parsed = Number(hoursOf(role));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
  };

  /**
   * Fill in one market's figures. Explicit, reversible until saved, and only for
   * roles the table actually covers — a discipline the presets have never heard of
   * stays blank rather than inheriting somebody else's number.
   */
  const applyPreset = (preset: TRolePreset) => {
    const nextDraft = { ...draft };
    const nextOverride = { ...override };
    for (const role of shown) {
      const value = preset.rates[role];
      if (value == null) continue;
      nextDraft[role] = String(value);
      // A UK figure is meaningless stored as euros, so the currency and the
      // working day travel with the number.
      nextOverride[role] = { currency: preset.currency, hours: String(preset.hours_per_day) };
    }
    // The panel outlives a reload, so this has to be a state write: a prop change
    // alone would leave every field showing what it showed before.
    setDraft(nextDraft);
    setOverride(nextOverride);
    setApplied(preset.label);
  };

  const commit = async () => {
    setBusy(true);
    const next: TRoleRate[] = shown
      .map((role) => {
        const value = Number(draft[role]);
        return {
          role,
          hourly_rate: Number.isFinite(value) ? value : 0,
          hours_per_day: hoursNumber(role),
          currency: ccyOf(role),
        };
      })
      // A blank field means "no rate", which is not the same as zero: sending it
      // would turn an honest gap into a discipline that costs nothing.
      .filter((r) => r.hourly_rate > 0);
    try {
      await onSave(next);
      // Only now are these figures a decision rather than a suggestion, so only
      // now does the warning come down.
      setApplied(null);
    } catch {
      // The caller has already said what went wrong; the panel's job is to keep
      // the unsaved work and the warning that says it is unsaved.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-subtle bg-layer-2 p-3">
      <p className="mb-2 text-11 font-medium tracking-wide text-tertiary uppercase">
        Hourly rates · shared by every project in this workspace
      </p>

      {!canWrite && (
        <p className="mb-2 text-11 text-warning-primary">
          These are workspace-wide, so only a workspace admin can save them. You can still work out the figures here.
        </p>
      )}

      {presets.length > 0 && (
        <div className="mb-2 rounded border border-subtle bg-layer-1 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-11 text-secondary">Start from a market average:</span>
            {presets.map((preset) => (
              <button
                key={preset.country}
                type="button"
                onClick={() => applyPreset(preset)}
                className="flex items-center gap-1 rounded border border-subtle px-2 py-0.5 text-11 text-secondary hover:bg-layer-2"
                title={`Fill every blank and every filled box with ${preset.label} figures in ${preset.currency}`}
              >
                <Wand2 className="size-3" />
                {preset.label} ({preset.currency})
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-10 text-tertiary">
            {/* The caveat comes from the server with the numbers, so it cannot be
                left behind when somebody copies the figures somewhere else. */}
            {hint?.source} Taken {hint?.captured_on}.
          </p>
          {applied ? (
            <p className="mt-1 text-10 text-warning-primary">
              {applied} figures filled in. Nothing is stored until you press Save — change anything that is wrong first,
              because after that they read as numbers this organisation decided on.
            </p>
          ) : (
            <p className="mt-1 text-10 text-tertiary">
              Greyed figures are indicative {hint?.label} averages, not values. An empty box stays empty when you save.
            </p>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-12 text-tertiary">No disciplines on this project yet.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {shown.map((role) => (
            <label key={role} className="flex flex-wrap items-center gap-2">
              <span className="w-44 flex-shrink-0 truncate text-12 text-secondary" title={role}>
                {labelFor.get(role) ?? role}
              </span>
              <input
                type="number"
                min={0}
                step="1"
                value={draft[role] ?? ""}
                onChange={(e) => setDraft({ ...draft, [role]: e.target.value })}
                // A ghost, never a value: it is not saved and it disappears the
                // moment anything is typed.
                placeholder={hint?.rates[role] != null ? `~${hint.rates[role]}` : "—"}
                className="w-24 rounded border border-subtle bg-layer-1 px-2 py-1 text-12 text-primary outline-none focus:border-accent-strong"
              />
              <select
                value={ccyOf(role)}
                onChange={(e) =>
                  setOverride({ ...override, [role]: { currency: e.target.value, hours: hoursOf(role) } })
                }
                aria-label={`Currency for ${labelFor.get(role) ?? role}`}
                className="rounded border border-subtle bg-layer-1 px-1.5 py-1 text-11 text-secondary outline-none focus:border-accent-strong"
              >
                {[...new Set([...currencyOptions, ccyOf(role)])].map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <span className="text-11 text-tertiary">/ h ·</span>
              <input
                type="number"
                min={0.5}
                max={24}
                step="0.5"
                value={hoursOf(role)}
                onChange={(e) => setOverride({ ...override, [role]: { currency: ccyOf(role), hours: e.target.value } })}
                aria-label={`Hours per day for ${labelFor.get(role) ?? role}`}
                className="w-14 rounded border border-subtle bg-layer-1 px-1.5 py-1 text-11 text-secondary outline-none focus:border-accent-strong"
              />
              <span className="text-11 text-tertiary">h per day</span>
            </label>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => void commit()}
        disabled={busy || !canWrite}
        className="mt-2 rounded bg-accent-primary px-2.5 py-1 text-12 text-white disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save rates"}
      </button>
    </div>
  );
}

/**
 * The one exchange rate this fork will use, and the day somebody wrote it down.
 *
 * Not a feed. A rate that updates itself is a rate nobody can account for when the
 * figure is questioned six months later; this one is wrong in a way a reader can
 * see and an admin can fix.
 */
function CurrencyPanel({
  settings,
  onSave,
  onClose,
}: {
  settings: TCurrencySettings;
  onSave: (data: { display_currency?: string; eur_gbp_rate?: number }) => void | Promise<void>;
  onClose: () => void;
}) {
  const [rate, setRate] = useState(String(settings.eur_gbp_rate));
  const [preferred, setPreferred] = useState(settings.display_currency);
  const [busy, setBusy] = useState(false);
  const value = Number(rate);
  const valid = Number.isFinite(value) && value >= 0.1 && value <= 10;

  return (
    <div className="mt-2 rounded border border-subtle bg-layer-1 p-2.5">
      <p className="mb-2 text-11 font-medium tracking-wide text-tertiary uppercase">Exchange rate · workspace-wide</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-10 text-tertiary uppercase">1 EUR buys</span>
          <input
            type="number"
            min={0.1}
            max={10}
            step="0.001"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="w-24 rounded border border-subtle bg-layer-2 px-2 py-1 text-12 text-primary outline-none focus:border-accent-strong"
          />
        </label>
        <span className="pb-1.5 text-12 text-secondary">GBP</span>
        <label className="flex flex-col gap-0.5">
          <span className="text-10 text-tertiary uppercase">Everyone reads budgets in</span>
          <select
            value={preferred}
            onChange={(e) => setPreferred(e.target.value)}
            className="w-44 rounded border border-subtle bg-layer-2 px-2 py-1 text-12 text-primary outline-none focus:border-accent-strong"
          >
            {/* "" is a real answer, and the one that converts nothing. */}
            <option value="">each project&apos;s own currency</option>
            {settings.available.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || !valid}
          onClick={async () => {
            setBusy(true);
            await onSave({ eur_gbp_rate: value, display_currency: preferred });
            setBusy(false);
          }}
          className="rounded bg-accent-primary px-2.5 py-1 text-12 text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onClose} className="px-1 text-12 text-secondary hover:text-primary">
          Cancel
        </button>
      </div>
      <p className="mt-1.5 text-10 text-tertiary">
        Saving stamps today&apos;s date on it, and every converted figure says so. Nothing recorded is rewritten — the
        amounts stay in the currency they were entered in, and only the reading changes.
        {settings.rate_captured_on
          ? ` The rate on screen was recorded ${renderFormattedDate(settings.rate_captured_on)}.`
          : " Nobody has set this yet, so the figures use a starting value."}
      </p>
    </div>
  );
}

/** Days nobody works. Workspace-wide, and they move every plan in it. */
function CalendarPanel({
  days,
  onAdd,
  onRemove,
}: {
  days: TNonWorkingDay[];
  onAdd: (date: string, name: string) => void | Promise<void>;
  onRemove: (date: string) => void | Promise<void>;
}) {
  const [date, setDate] = useState("");
  const [name, setName] = useState("");

  return (
    <div className="rounded-lg border border-subtle bg-layer-2 p-3">
      <p className="mb-2 text-11 font-medium tracking-wide text-tertiary uppercase">
        Non-working days · they push every plan in this workspace
      </p>
      <div className="mb-2 flex flex-wrap items-end gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded border border-subtle bg-layer-1 px-2 py-1 text-12 text-primary outline-none focus:border-accent-strong"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Christmas, shutdown…"
          className="w-48 rounded border border-subtle bg-layer-1 px-2 py-1 text-12 text-primary outline-none focus:border-accent-strong"
        />
        <button
          type="button"
          disabled={!date}
          onClick={() => {
            void onAdd(date, name);
            setDate("");
            setName("");
          }}
          className="rounded bg-accent-primary px-2.5 py-1 text-12 text-white disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {days.length === 0 ? (
        <p className="text-12 text-tertiary">
          None recorded. Without them the scheduler counts Monday to Friday and nothing else.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {days.map((d) => (
            <span
              key={d.id}
              className="flex items-center gap-1.5 rounded bg-layer-1 px-2 py-0.5 text-11 text-secondary"
            >
              {d.date}
              {d.name && <span className="text-tertiary">{d.name}</span>}
              <button
                type="button"
                onClick={() => void onRemove(d.date)}
                aria-label={`Remove ${d.date}`}
                className="text-tertiary hover:text-danger-primary"
              >
                <Trash2 className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
