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
import { CalendarOff, Coins, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import { useUserPermissions } from "@/hooks/store/user";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type {
  TExpenseCategory,
  TNonWorkingDay,
  TProjectBudget,
  TProjectExpense,
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

const EMPTY_DRAFT = {
  category: "hardware" as TExpenseCategory,
  label: "",
  amount: "",
  quantity: "1",
  currency: "EUR",
  planned: true,
};

export const OverviewBudgetBlock = observer(function OverviewBudgetBlock() {
  const { workspaceSlug, projectId } = useParams();
  const service = useMemo(() => new ArribadaService(), []);
  const { allowPermissions } = useUserPermissions();
  const slug = workspaceSlug?.toString() ?? "";
  const pid = projectId?.toString() ?? "";

  const [budget, setBudget] = useState<TProjectBudget | null>(null);
  const [expenses, setExpenses] = useState<TProjectExpense[]>([]);
  // "Nothing spent yet" and "we could not read it" look identical on screen and
  // are not the same thing; the second must not invite someone to re-enter a line.
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  // The two workspace-level tables that make the labour figure mean anything.
  // Edited here rather than behind a settings page: this is where somebody
  // notices the number is wrong, and it is where they should be able to fix it.
  const [panel, setPanel] = useState<"rates" | "calendar" | "allocation" | null>(null);
  const [rates, setRates] = useState<TRoleRate[]>([]);
  const [days, setDays] = useState<TNonWorkingDay[]>([]);
  const [allocDraft, setAllocDraft] = useState("");

  const canEdit = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE,
    slug
  );

  const load = useCallback(async () => {
    if (!slug || !pid) return;
    try {
      const [b, e, r, c] = await Promise.all([
        service.getBudget(slug, pid),
        service.getExpenses(slug, pid),
        service.getRoleRates(slug),
        service.getCalendar(slug),
      ]);
      setBudget(b);
      setExpenses(e?.expenses ?? []);
      setRates(r?.rates ?? []);
      setDays(c?.days ?? []);
      setAllocDraft(b?.allocation?.amount != null ? String(b.allocation.amount) : "");
      setLoaded(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [service, slug, pid]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const label = draft.label.trim();
    const amount = Number(draft.amount);
    if (!label || !Number.isFinite(amount) || amount <= 0) return;
    setSaving(true);
    try {
      await service.addExpense(slug, pid, {
        category: draft.category,
        label,
        amount,
        quantity: Number(draft.quantity) || 1,
        currency: draft.currency.trim().toUpperCase() || "EUR",
        planned: draft.planned,
      });
      setDraft(EMPTY_DRAFT);
      setAdding(false);
      await load();
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't save that line",
        message: "Nothing was recorded. Check the amount and try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const saveAllocation = async () => {
    const raw = allocDraft.trim();
    const amount = raw === "" ? null : Number(raw);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return;
    setSaving(true);
    try {
      await service.updateSchedule(slug, pid, { budget_amount: amount });
      setPanel(null);
      await load();
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
      await load();
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't save the rates",
        message: "The figures on screen are not what is stored. Reload before relying on them.",
      });
    }
  };

  const addHoliday = async (date: string, name: string) => {
    if (!date) return;
    try {
      await service.addNonWorkingDay(slug, { date, name });
      await load();
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't add that day", message: "The calendar is unchanged." });
    }
  };

  const removeHoliday = async (date: string) => {
    try {
      await service.removeNonWorkingDay(slug, date);
      await load();
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't remove that day", message: "It is still there." });
    }
  };

  const remove = async (id: string) => {
    try {
      await service.deleteExpense(slug, pid, id);
      await load();
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

  const input =
    "rounded border border-subtle bg-layer-1 px-2 py-1 text-12 text-primary outline-none focus:border-accent-strong";
  const alloc = budget?.allocation;
  const over = alloc?.remaining != null && alloc.remaining < 0;

  return (
    <div className="flex flex-col gap-4 px-4 py-3">
      {/* The allocation first: it is the number everything else is read against. */}
      <div className="rounded-lg border border-subtle bg-layer-2 px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-11 font-medium tracking-wide text-tertiary uppercase">Budget</span>
          {alloc?.amount == null ? (
            <span className="text-13 text-tertiary">No budget recorded</span>
          ) : (
            <>
              <span className={cn("text-18 font-semibold", over ? "text-danger-primary" : "text-primary")}>
                {money(alloc.committed, alloc.currency)}
              </span>
              <span className="text-13 text-tertiary">of {money(alloc.amount, alloc.currency)}</span>
              {alloc.remaining != null && (
                <span className={cn("text-12", over ? "text-danger-primary" : "text-secondary")}>
                  {over
                    ? `${money(Math.abs(alloc.remaining), alloc.currency)} over`
                    : `${money(alloc.remaining, alloc.currency)} left`}
                </span>
              )}
            </>
          )}
          <div className="flex-grow" />
          {canEdit && (
            <button
              type="button"
              onClick={() => setPanel(panel === "allocation" ? null : "allocation")}
              className="flex items-center gap-1 rounded border border-subtle px-2 py-0.5 text-11 text-secondary hover:bg-layer-1"
            >
              <Pencil className="size-3" />
              {alloc?.amount == null ? "Set a budget" : "Change"}
            </button>
          )}
        </div>

        {alloc?.amount != null && alloc.percent != null && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-layer-1">
            <div
              className={cn("h-full rounded-full", over ? "bg-danger-primary" : "bg-accent-primary")}
              // Capped at 100 so an overrun fills the bar rather than escaping it;
              // the figure above already says by how much.
              style={{ width: `${Math.min(100, alloc.percent)}%` }}
            />
          </div>
        )}

        {alloc && alloc.excluded_currencies.length > 0 && (
          <p className="mt-1.5 text-11 text-tertiary">
            Not counted here: figures in {alloc.excluded_currencies.join(", ")}. Nothing is converted — no exchange rate
            in this system would be one anybody chose.
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
            <span className="text-11 text-tertiary">{alloc?.currency ?? "EUR"}</span>
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
      </div>

      {/* The two halves, side by side and clearly separate. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-subtle bg-layer-2 px-3 py-2.5">
          <p className="text-11 font-medium tracking-wide text-tertiary uppercase">Human time</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-2">
            {labour?.totals.length ? (
              labour.totals.map((t) => (
                <span key={t.currency} className="text-18 font-semibold text-primary">
                  {money(t.amount, t.currency)}
                </span>
              ))
            ) : (
              <span className="text-13 text-tertiary">No rates recorded yet</span>
            )}
          </p>
          <p className="mt-0.5 text-11 text-tertiary">
            Estimated from the dated work items — it moves when the plan moves.
          </p>
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
            </div>
          )}
        </div>

        <div className="rounded-lg border border-subtle bg-layer-2 px-3 py-2.5">
          <p className="text-11 font-medium tracking-wide text-tertiary uppercase">Everything else</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-3">
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
          </p>
          <p className="mt-0.5 text-11 text-tertiary">Hardware, field trips, shipping, subcontracting.</p>
        </div>
      </div>

      {panel === "rates" && (
        <RatesPanel rates={rates} roles={labour?.by_role.map((r) => r.role) ?? []} onSave={saveRates} />
      )}

      {panel === "calendar" && <CalendarPanel days={days} onAdd={addHoliday} onRemove={removeHoliday} />}

      {labour && labour.by_role.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {labour.by_role.map((r) => (
            <span
              key={r.role}
              className={cn(
                "rounded px-2 py-0.5 text-11",
                r.rated ? "bg-layer-2 text-secondary" : "bg-warning-subtle text-warning-primary"
              )}
              title={r.rated ? `${r.days} day(s), ${Math.round(r.hours)} hours` : "No hourly rate recorded"}
            >
              {r.role} · {r.days}d{r.rated && r.currency ? ` · ${money(r.cost, r.currency)}` : ""}
            </span>
          ))}
        </div>
      )}

      {/* The lines themselves */}
      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <Wallet className="size-3.5 text-tertiary" />
          <span className="text-12 font-medium text-secondary">
            Expenses {expenses.length > 0 && <span className="text-tertiary">({expenses.length})</span>}
          </span>
          <div className="flex-grow" />
          {canEdit && !adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex items-center gap-1 rounded border border-subtle px-2 py-1 text-11 text-secondary hover:bg-layer-2"
            >
              <Plus className="size-3" />
              Add a line
            </button>
          )}
        </div>

        {adding && (
          <div className="mb-2 flex flex-wrap items-end gap-2 rounded-lg border border-subtle bg-layer-2 p-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-10 text-tertiary uppercase">What</span>
              <input
                // The form only exists because "Add a line" was just pressed, so
                // the caret belongs in its first field; there is nothing to steal
                // focus from.
                // oxlint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder="10 x Linkit V4 boards"
                className={cn(input, "w-56")}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-10 text-tertiary uppercase">Category</span>
              <select
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value as TExpenseCategory })}
                className={cn(input, "w-44")}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-10 text-tertiary uppercase">Unit price</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                className={cn(input, "w-24")}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-10 text-tertiary uppercase">Qty</span>
              <input
                type="number"
                min={0}
                step="1"
                value={draft.quantity}
                onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
                className={cn(input, "w-16")}
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-10 text-tertiary uppercase">Ccy</span>
              <input
                value={draft.currency}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
                maxLength={3}
                className={cn(input, "w-14 uppercase")}
              />
            </label>
            <label className="flex items-center gap-1.5 pb-1.5">
              <input
                type="checkbox"
                checked={!draft.planned}
                onChange={(e) => setDraft({ ...draft, planned: !e.target.checked })}
                className="size-3.5 text-accent-primary accent-current"
              />
              <span className="text-11 text-secondary" title="Leave unticked while this is still a budget line">
                Already spent
              </span>
            </label>
            <button
              type="button"
              onClick={() => void add()}
              disabled={saving || !draft.label.trim() || !(Number(draft.amount) > 0)}
              className="rounded bg-accent-primary px-2.5 py-1 text-12 text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setDraft(EMPTY_DRAFT);
              }}
              className="px-1 text-12 text-secondary hover:text-primary"
            >
              Cancel
            </button>
          </div>
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
                {e.incurred_on && <span className="flex-shrink-0 text-11 text-tertiary">{e.incurred_on}</span>}
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => void remove(e.id)}
                    aria-label={`Delete ${e.label}`}
                    className="flex-shrink-0 text-tertiary hover:text-danger-primary"
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
 * Hourly rates, workspace-wide. Every discipline the project uses is listed
 * whether or not it has a rate, so a gap is a blank field rather than an absence
 * nobody notices.
 */
function RatesPanel({
  rates,
  roles,
  onSave,
}: {
  rates: TRoleRate[];
  roles: string[];
  onSave: (next: TRoleRate[]) => void | Promise<void>;
}) {
  const byRole = new Map(rates.map((r) => [r.role, r]));
  // The project's own disciplines first, then any rate recorded for something it
  // does not currently use — deleting the last task of a discipline should not
  // hide the rate somebody entered for it.
  // toSorted is ES2023 and this workspace targets earlier; the spread already made
  // a fresh array, so sorting it in place mutates nothing anyone holds.
  // oxlint-disable-next-line unicorn/no-array-sort
  const shown = [...new Set([...roles, ...rates.map((r) => r.role)])].sort();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(shown.map((r) => [r, byRole.get(r)?.hourly_rate ? String(byRole.get(r)?.hourly_rate) : ""]))
  );
  const [busy, setBusy] = useState(false);

  const commit = async () => {
    setBusy(true);
    const next: TRoleRate[] = shown
      .map((role) => {
        const value = Number(draft[role]);
        const existing = byRole.get(role);
        return {
          role,
          hourly_rate: Number.isFinite(value) ? value : 0,
          hours_per_day: existing?.hours_per_day ?? 7,
          currency: existing?.currency ?? "EUR",
        };
      })
      // A blank field means "no rate", which is not the same as zero: sending it
      // would turn an honest gap into a discipline that costs nothing.
      .filter((r) => r.hourly_rate > 0);
    await onSave(next);
    setBusy(false);
  };

  return (
    <div className="rounded-lg border border-subtle bg-layer-2 p-3">
      <p className="mb-2 text-11 font-medium tracking-wide text-tertiary uppercase">
        Hourly rates · shared by every project in this workspace
      </p>
      {shown.length === 0 ? (
        <p className="text-12 text-tertiary">No disciplines on this project yet.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {shown.map((role) => (
            <label key={role} className="flex items-center gap-2">
              <span className="w-44 flex-shrink-0 truncate text-12 text-secondary">{role}</span>
              <input
                type="number"
                min={0}
                step="1"
                value={draft[role] ?? ""}
                onChange={(e) => setDraft({ ...draft, [role]: e.target.value })}
                placeholder="—"
                className="w-24 rounded border border-subtle bg-layer-1 px-2 py-1 text-12 text-primary outline-none focus:border-accent-strong"
              />
              <span className="text-11 text-tertiary">
                {byRole.get(role)?.currency ?? "EUR"} / h · {byRole.get(role)?.hours_per_day ?? 7} h per day
              </span>
            </label>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => void commit()}
        disabled={busy}
        className="mt-2 rounded bg-accent-primary px-2.5 py-1 text-12 text-white disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save rates"}
      </button>
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
