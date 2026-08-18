/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The one form for money a project spends that is not somebody's time.
 *
 * There used to be three: this modal, raised from the sidebar with no project in
 * the URL to infer one from, and two rows of inline inputs on the Finance page —
 * one to ask for a purchase and one for the lead to write a line straight onto
 * the sheet. Three forms for one object, and they had already drifted: only the
 * Finance page's could record a link or a part number, only this one could be
 * opened without first finding the project, and the work item a cost belongs to
 * could be named from none of them.
 *
 * So: one component, one set of fields, one place to fix a bug in either. The
 * only thing `mode` changes is what the last button does — "request" sends it to
 * the project lead, "record" writes the line, which the sheet's owner alone may
 * do. The fields are the same either way, because they describe the same
 * purchase; a field that appeared only on one route is exactly how the drift
 * started.
 *
 * Nothing is written until the last button, so backing out of any step costs
 * nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { ChevronLeft, Loader2, Search, X } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EModalWidth, ModalCore } from "@plane/ui";
import { cn } from "@plane/utils";
import type { ISearchIssueResponse } from "@plane/types";
import { useProject } from "@/hooks/store/use-project";
import { ProjectService } from "@/services/project";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TExpenseCategory, TProjectExpense } from "@/plane-web/types/arribada";

const service = new ArribadaService();
const projectService = new ProjectService();

/** Mirrors ProjectExpense.CATEGORY_CHOICES on the server. */
const CATEGORIES: { value: TExpenseCategory; label: string }[] = [
  { value: "hardware", label: "Hardware & components" },
  { value: "travel", label: "Travel" },
  { value: "field", label: "Field trip" },
  { value: "services", label: "Services & subcontracting" },
  { value: "shipping", label: "Shipping & customs" },
  { value: "other", label: "Other" },
];

const CURRENCIES = ["EUR", "GBP", "USD"];

const INPUT_CLASS =
  "w-full rounded border border-subtle bg-layer-1 px-2 py-1.5 text-13 text-primary outline-none focus:border-accent-primary";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  /** Fixed project. Given, the project step is skipped — the Finance page
   *  already knows whose budget this is, and asking again would be a step whose
   *  only possible answer is the page you are standing on. */
  projectId?: string;
  /** "request" goes to the lead and commits nothing; "record" writes the line.
   *  The caller decides, because only it knows whether this reader owns the
   *  sheet — the server enforces the same rule either way. */
  mode?: "request" | "record";
  /** An existing line to edit. Given, the modal prefills from it and PATCHes on
   *  save instead of creating — same fields, so the same form. The backend's
   *  ProjectExpenseDetailEndpoint.patch already enforces the money rules. */
  expense?: TProjectExpense | null;
  /** The currency a NEW line should default to — the project's own budget
   *  currency, so a GBP project does not open every form reading EUR. Ignored
   *  when editing, which keeps the line's own currency. */
  defaultCurrency?: string;
  /** So the page that opened it can re-read its figures. */
  onSaved?: () => void;
};

export const ExpenseModal = observer(function ExpenseModal(props: Props) {
  const {
    isOpen,
    onClose,
    workspaceSlug,
    projectId: fixedProjectId,
    mode = "request",
    expense = null,
    defaultCurrency,
    onSaved,
  } = props;
  // Editing an existing line rather than creating one. It reuses the "record"
  // field layout (a spent toggle, no justification) because an edited line is a
  // committed one, not a request.
  const isEdit = !!expense;
  const isRequest = mode === "request" && !isEdit;
  // store hooks
  const { joinedProjectIds, getProjectById } = useProject();
  // state
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const [projectQuery, setProjectQuery] = useState("");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [currency, setCurrency] = useState("EUR");
  const [category, setCategory] = useState<TExpenseCategory>("other");
  const [supplier, setSupplier] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [justification, setJustification] = useState("");
  const [url, setUrl] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [leadTime, setLeadTime] = useState("");
  const [spent, setSpent] = useState(false);
  // The work item this money is for, and whether it IS that item's whole cost.
  const [issue, setIssue] = useState<ISearchIssueResponse | null>(null);
  const [issueQuery, setIssueQuery] = useState("");
  const [issueResults, setIssueResults] = useState<ISearchIssueResponse[]>([]);
  const [searchingIssues, setSearchingIssues] = useState(false);
  const [replacesLabour, setReplacesLabour] = useState(false);
  const [saving, setSaving] = useState(false);
  // refs — `autoFocus` is linted out, and a ref is what it would have compiled to
  const projectSearchRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  const projectId = fixedProjectId ?? pickedProjectId;

  // The keyboard lands on whatever the current step is asking for.
  useEffect(() => {
    if (!isOpen) return;
    (projectId ? labelRef : projectSearchRef).current?.focus();
  }, [isOpen, projectId]);

  // A modal that reopens holding the last request would let somebody file the
  // same thing twice by pressing Enter, so every open starts clean — or, when
  // editing, prefilled from the line so a save that touches one field does not
  // silently blank the others.
  useEffect(() => {
    if (!isOpen) return;
    setPickedProjectId(null);
    setProjectQuery("");
    setNeededBy("");
    setJustification("");
    setIssueQuery("");
    setIssueResults([]);
    setSaving(false);
    if (expense) {
      setLabel(expense.label);
      setAmount(String(expense.amount));
      setQuantity(String(expense.quantity));
      setCurrency(expense.currency);
      setCategory(expense.category);
      setSupplier(expense.supplier ?? "");
      setUrl(expense.url ?? "");
      setPartNumber(expense.manufacturer_part_number ?? "");
      setLeadTime(expense.lead_time_days != null ? String(expense.lead_time_days) : "");
      // planned === budgeted; the toggle is "already spent", so it is the inverse.
      setSpent(!expense.planned);
      setReplacesLabour(!!expense.replaces_labour);
      // A partial stand-in for the search result: enough for the chip to name the
      // linked item. The project identifier is this project's, since the line
      // could not belong to another one.
      setIssue(
        expense.issue_id
          ? ({
              id: expense.issue_id,
              name: expense.issue_name ?? "",
              sequence_id: expense.issue_sequence_id ?? 0,
              project__identifier: getProjectById(fixedProjectId ?? "")?.identifier ?? "",
            } as unknown as ISearchIssueResponse)
          : null
      );
    } else {
      setLabel("");
      setAmount("");
      setQuantity("1");
      // The project's own budget currency, not a hardcoded EUR.
      setCurrency(defaultCurrency || "EUR");
      setCategory("other");
      setSupplier("");
      setUrl("");
      setPartNumber("");
      setLeadTime("");
      setSpent(false);
      setReplacesLabour(false);
      setIssue(null);
    }
  }, [isOpen, expense, defaultCurrency, fixedProjectId, getProjectById]);

  // joinedProjectIds is already "projects of this workspace where I am a member
  // and which are not archived" — the same set the server's _visible_projects
  // check enforces, so the picker cannot offer a project that would 404.
  const projects = useMemo(() => {
    const query = projectQuery.trim().toLowerCase();
    return joinedProjectIds
      .map((id) => getProjectById(id))
      .filter((project) => !!project)
      .filter((project) => (query ? `${project.name} ${project.identifier}`.toLowerCase().includes(query) : true));
  }, [joinedProjectIds, getProjectById, projectQuery]);

  const selectedProject = projectId ? getProjectById(projectId) : undefined;

  // Work items of THIS project only. The server refuses a work item from
  // another one anyway — attaching a line to a foreign item would take that
  // item out of a different project's labour estimate — so the picker asks the
  // same question the server will.
  const runIssueSearch = useCallback(
    async (query: string) => {
      if (!projectId) return;
      setSearchingIssues(true);
      try {
        const rows = await projectService.projectIssuesSearch(workspaceSlug, projectId, {
          search: query,
          workspace_search: false,
        });
        setIssueResults(rows.slice(0, 8));
      } catch {
        // A search that fails must not take the form down with it — everything
        // else on this modal still works without a work item.
        setIssueResults([]);
      } finally {
        setSearchingIssues(false);
      }
    },
    [workspaceSlug, projectId]
  );

  // Debounced, because this fires per keystroke against a search endpoint.
  useEffect(() => {
    if (!projectId || issue) return;
    const query = issueQuery.trim();
    if (query.length < 2) {
      setIssueResults([]);
      return;
    }
    const timer = setTimeout(() => void runIssueSearch(query), 250);
    return () => clearTimeout(timer);
  }, [issueQuery, projectId, issue, runIssueSearch]);

  const parsedAmount = Number(amount);
  const parsedLeadTime = leadTime.trim() === "" ? null : Number(leadTime);
  const canSubmit = !!projectId && label.trim().length > 0 && Number.isFinite(parsedAmount) && parsedAmount > 0;

  const clearIssue = () => {
    setIssue(null);
    setIssueQuery("");
    setIssueResults([]);
    // A flag with nothing to exclude reads on the Finance page as if it were
    // excluding something, so it goes with the link rather than lingering.
    setReplacesLabour(false);
  };

  const handleSubmit = async () => {
    if (!projectId || !canSubmit || saving) return;
    const link = url.trim();
    // Checked here as well as on the server so the answer arrives while the form
    // is still open with the text in it, rather than as a toast over a form that
    // has already been cleared.
    if (link && !/^https?:\/\//i.test(link)) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "That link needs to start with http:// or https://",
        message: "A link nobody can follow looks like evidence that exists. Nothing was saved.",
      });
      return;
    }
    if (parsedLeadTime !== null && (!Number.isInteger(parsedLeadTime) || parsedLeadTime <= 0)) {
      setToast({ type: TOAST_TYPE.ERROR, title: "The lead time has to be a whole number of days" });
      return;
    }
    setSaving(true);
    // Everything both routes share. The two calls below differ only in what
    // they do with it, which is the whole point of there being one form.
    const common = {
      label: label.trim(),
      amount: parsedAmount,
      quantity: Number(quantity) || 1,
      currency,
      category,
      supplier: supplier.trim(),
      url: link,
      manufacturer_part_number: partNumber.trim(),
      issue_id: issue?.id ?? null,
      lead_time_days: parsedLeadTime,
      replaces_labour: !!issue && replacesLabour,
    };
    try {
      if (isEdit && expense) {
        // PATCH only the fields the form owns; notes and incurred_on are absent
        // from the payload, so the server keeps them rather than blanking them.
        await service.updateExpense(workspaceSlug, projectId, expense.id, {
          ...common,
          planned: !spent,
        });
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: "Saved",
          message: `Updated on ${selectedProject?.name ?? "the project"}'s sheet.`,
        });
      } else if (mode === "record") {
        await service.addExpense(workspaceSlug, projectId, {
          ...common,
          // Unticked is a budget line; ticked is money that has gone.
          planned: !spent,
        });
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: "Recorded",
          message: `It is on ${selectedProject?.name ?? "the project"}'s sheet.`,
        });
      } else {
        await service.requestPurchase(workspaceSlug, projectId, {
          ...common,
          justification: justification.trim(),
          // The server only parses YYYY-MM-DD and silently drops anything else;
          // an empty date input gives "", which must go over as null.
          needed_by: neededBy || null,
        });
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: "Request sent",
          message: `${selectedProject?.name ?? "The project"} lead has it waiting on them.`,
        });
      }
      onSaved?.();
      onClose();
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: isEdit
          ? "Could not save that change"
          : mode === "record"
            ? "Could not record that line"
            : "Could not send the request",
        message: (error as { error?: string })?.error ?? "Nothing was saved. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const title = isEdit ? "Edit expense" : mode === "record" ? "Record an expense" : "Request an expense";

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} width={EModalWidth.XXL}>
      <div className="flex max-h-[80vh] flex-col">
        <header className="flex items-center gap-2 border-b border-subtle px-4 py-3">
          {/* Only when the project was chosen here. With one handed in there is
              nothing to go back to, and a back arrow that empties the form is a
              trap rather than an escape. */}
          {!fixedProjectId && pickedProjectId && (
            <button
              type="button"
              onClick={() => setPickedProjectId(null)}
              aria-label="Back to project selection"
              className="text-tertiary hover:text-primary"
            >
              <ChevronLeft className="size-4" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-14 font-medium text-primary">{title}</h2>
            <p className="truncate text-11 text-tertiary">
              {selectedProject
                ? isEdit
                  ? `Editing a line on ${selectedProject.name}'s sheet`
                  : mode === "record"
                    ? `Straight onto ${selectedProject.name}'s sheet`
                    : `${selectedProject.name} — the lead decides`
                : "Which project pays for it?"}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-tertiary hover:text-primary">
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {!projectId ? (
            <>
              <div className="relative mb-2">
                <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-tertiary" />
                <input
                  type="text"
                  value={projectQuery}
                  onChange={(e) => setProjectQuery(e.target.value)}
                  placeholder="Search projects"
                  className={cn(INPUT_CLASS, "pl-7")}
                  ref={projectSearchRef}
                />
              </div>
              {projects.length === 0 ? (
                <p className="py-6 text-center text-13 text-tertiary">
                  {joinedProjectIds.length === 0
                    ? "You are not a member of any project yet, so there is nothing to charge this to."
                    : "No project matches that."}
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {projects.map((project) => (
                    <li key={project.id}>
                      <button
                        type="button"
                        onClick={() => setPickedProjectId(project.id)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-layer-transparent-hover"
                      >
                        <span className="flex-shrink-0 rounded bg-layer-2 px-1.5 py-0.5 text-11 font-medium text-tertiary">
                          {project.identifier}
                        </span>
                        <span className="truncate text-13 text-primary">{project.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-12 text-tertiary">What do you need?</span>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. 20 GPS modules"
                  className={INPUT_CLASS}
                  maxLength={255}
                  ref={labelRef}
                />
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1">
                  <span className="text-12 text-tertiary">Unit price</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-12 text-tertiary">Quantity</span>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-12 text-tertiary">Currency</span>
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={INPUT_CLASS}>
                    {CURRENCIES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-12 text-tertiary">Category</span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as TExpenseCategory)}
                    className={INPUT_CLASS}
                  >
                    {CATEGORIES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {isRequest ? (
                  <label className="flex flex-col gap-1">
                    <span className="text-12 text-tertiary">Needed by</span>
                    <input
                      type="date"
                      value={neededBy}
                      onChange={(e) => setNeededBy(e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </label>
                ) : (
                  <label className="flex items-start gap-2 pt-6">
                    <input
                      type="checkbox"
                      checked={spent}
                      onChange={(e) => setSpent(e.target.checked)}
                      className="mt-0.5 size-3.5 shrink-0 text-accent-primary accent-current"
                    />
                    <span className="text-12 text-secondary">
                      Already spent
                      <span className="block text-11 text-tertiary">
                        Leave unticked while this is still a budget line.
                      </span>
                    </span>
                  </label>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-12 text-tertiary">Supplier</span>
                  <input
                    type="text"
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    placeholder="Optional — JLCPCB"
                    className={INPUT_CLASS}
                    maxLength={255}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  {/* A label is what somebody called it once. A part number is
                      what the next person types into a distributor's search box
                      eighteen months later, when the first batch is gone and
                      nobody remembers which module "GPS module" meant. */}
                  <span className="text-12 text-tertiary">Manufacturer part number</span>
                  <input
                    type="text"
                    value={partNumber}
                    onChange={(e) => setPartNumber(e.target.value)}
                    placeholder="Optional — MAX-M10S-00B"
                    className={cn(INPUT_CLASS, "font-mono")}
                    maxLength={120}
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-12 text-tertiary">Link</span>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Optional — where you found it, https://…"
                  className={INPUT_CLASS}
                />
              </label>

              {/* The work item this money is for. Without this the cost of a
                  bought thing and the item that IS that bought thing could not
                  be connected from anywhere, and the item went on being costed
                  as person-days on top of the invoice. */}
              <div className="flex flex-col gap-1">
                <span className="text-12 text-tertiary">Work item</span>
                {issue ? (
                  <div className="flex items-center gap-2 rounded border border-subtle bg-layer-1 px-2 py-1.5">
                    <span className="flex-shrink-0 rounded bg-layer-2 px-1.5 py-0.5 text-11 font-medium text-tertiary">
                      {issue.project__identifier}-{issue.sequence_id}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-13 text-primary">{issue.name}</span>
                    <button
                      type="button"
                      onClick={clearIssue}
                      aria-label="Unlink the work item"
                      className="flex-shrink-0 text-tertiary hover:text-primary"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-tertiary" />
                      <input
                        type="text"
                        value={issueQuery}
                        onChange={(e) => setIssueQuery(e.target.value)}
                        placeholder="Optional — search this project's work items"
                        className={cn(INPUT_CLASS, "pl-7")}
                      />
                      {searchingIssues && (
                        <Loader2 className="absolute top-1/2 right-2 size-3.5 -translate-y-1/2 animate-spin text-tertiary" />
                      )}
                    </div>
                    {issueResults.length > 0 && (
                      <ul className="mt-1 flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded border border-subtle p-1">
                        {issueResults.map((row) => (
                          <li key={row.id}>
                            <button
                              type="button"
                              onClick={() => setIssue(row)}
                              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-layer-transparent-hover"
                            >
                              <span className="flex-shrink-0 text-11 text-tertiary">
                                {row.project__identifier}-{row.sequence_id}
                              </span>
                              <span className="truncate text-13 text-primary">{row.name}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {issueQuery.trim().length >= 2 && !searchingIssues && issueResults.length === 0 && (
                      <p className="mt-1 text-11 text-tertiary">No work item in this project matches that.</p>
                    )}
                  </>
                )}
              </div>

              {/* Both only mean anything against a work item, so they are only
                  offered against one. A lead time with no item is a duration
                  belonging to nothing, and the flag would exclude nothing while
                  reading on the Finance page as if it did. */}
              {issue && (
                <div className="flex flex-col gap-3 rounded border border-subtle bg-layer-2 p-2.5">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={replacesLabour}
                      onChange={(e) => setReplacesLabour(e.target.checked)}
                      className="mt-0.5 size-3.5 shrink-0 text-accent-primary accent-current"
                    />
                    <span className="text-12 text-secondary">
                      This is that work item&apos;s whole cost
                      <span className="block text-11 text-tertiary">
                        It stops being costed as our time and stops booking anybody&apos;s capacity. Leave unticked for
                        parts bought for work we still do ourselves.
                      </span>
                    </span>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-12 text-tertiary">Lead time</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        step="1"
                        value={leadTime}
                        onChange={(e) => setLeadTime(e.target.value)}
                        placeholder="42"
                        aria-label="Lead time in calendar days"
                        className={cn(INPUT_CLASS, "w-24")}
                      />
                      {/* Calendar days, and it says so: a factory does not
                          observe our weekends, so six weeks is forty-two days
                          whatever our calendar thinks. Everywhere else in this
                          fork a number of days means WORKING days, which is
                          exactly why this one has to be labelled. */}
                      <span className="text-11 text-tertiary">calendar days the supplier quoted</span>
                    </div>
                  </label>
                </div>
              )}

              {isRequest && (
                <label className="flex flex-col gap-1">
                  <span className="text-12 text-tertiary">Why</span>
                  <textarea
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder="What this unblocks. The lead reads this before deciding."
                    className={cn(INPUT_CLASS, "resize-y")}
                  />
                </label>
              )}
            </div>
          )}
        </div>

        {projectId && (
          <footer className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t border-subtle px-4 py-3">
            <span className="mr-auto text-11 whitespace-nowrap text-tertiary">
              {Number.isFinite(parsedAmount) && parsedAmount > 0
                ? `Total ${(parsedAmount * (Number(quantity) || 1)).toLocaleString()} ${currency}`
                : "A price is required"}
            </span>
            <button type="button" onClick={onClose} className="rounded border border-subtle px-3 py-1.5 text-12">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit || saving}
              className={cn(
                "flex items-center gap-1.5 rounded bg-accent-primary px-3 py-1.5 text-12 text-on-color",
                !canSubmit || saving ? "opacity-50" : "hover:opacity-90"
              )}
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {isEdit ? "Save changes" : mode === "record" ? "Add the line" : "Send request"}
            </button>
          </footer>
        )}
      </div>
    </ModalCore>
  );
});
