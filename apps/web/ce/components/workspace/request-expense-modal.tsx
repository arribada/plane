/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Raising a purchase request from the sidebar, without first finding the project.
 *
 * The same request the project Overview raises — same endpoint, same model, same
 * lead approval afterwards. The only thing added here is the project step: from
 * the sidebar there is no project in the URL to infer one from, so it is asked
 * for first and everything else follows. Nothing is written until the last
 * button, so backing out of step two costs nothing.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { ChevronLeft, Loader2, Search, X } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EModalWidth, ModalCore } from "@plane/ui";
import { cn } from "@plane/utils";
import { useProject } from "@/hooks/store/use-project";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TExpenseCategory } from "@/plane-web/types/arribada";

const service = new ArribadaService();

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
};

export const RequestExpenseModal = observer(function RequestExpenseModal(props: Props) {
  const { isOpen, onClose, workspaceSlug } = props;
  // store hooks
  const { joinedProjectIds, getProjectById } = useProject();
  // state
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectQuery, setProjectQuery] = useState("");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [currency, setCurrency] = useState("EUR");
  const [category, setCategory] = useState<TExpenseCategory>("other");
  const [supplier, setSupplier] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [justification, setJustification] = useState("");
  const [saving, setSaving] = useState(false);
  // refs — `autoFocus` is linted out, and a ref is what it would have compiled to
  const projectSearchRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  // The keyboard lands on whatever the current step is asking for.
  useEffect(() => {
    if (!isOpen) return;
    (projectId ? labelRef : projectSearchRef).current?.focus();
  }, [isOpen, projectId]);

  // A modal that reopens holding the last request would let somebody file the
  // same thing twice by pressing Enter, so every open starts clean.
  useEffect(() => {
    if (!isOpen) return;
    setProjectId(null);
    setProjectQuery("");
    setLabel("");
    setAmount("");
    setQuantity("1");
    setCurrency("EUR");
    setCategory("other");
    setSupplier("");
    setNeededBy("");
    setJustification("");
    setSaving(false);
  }, [isOpen]);

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
  const parsedAmount = Number(amount);
  const canSubmit = !!projectId && label.trim().length > 0 && Number.isFinite(parsedAmount) && parsedAmount > 0;

  const handleSubmit = async () => {
    if (!projectId || !canSubmit || saving) return;
    setSaving(true);
    try {
      await service.requestPurchase(workspaceSlug, projectId, {
        label: label.trim(),
        amount: parsedAmount,
        quantity: Number(quantity) || 1,
        currency,
        category,
        supplier: supplier.trim(),
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
      onClose();
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Could not send the request",
        message: (error as { error?: string })?.error ?? "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} width={EModalWidth.XXL}>
      <div className="flex max-h-[80vh] flex-col">
        <header className="flex items-center gap-2 border-b border-subtle px-4 py-3">
          {projectId && (
            <button
              type="button"
              onClick={() => setProjectId(null)}
              aria-label="Back to project selection"
              className="text-tertiary hover:text-primary"
            >
              <ChevronLeft className="size-4" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-14 font-medium text-primary">Request an expense</h2>
            <p className="truncate text-11 text-tertiary">
              {selectedProject ? selectedProject.name : "Which project pays for it?"}
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
                        onClick={() => setProjectId(project.id)}
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
                <label className="flex flex-col gap-1">
                  <span className="text-12 text-tertiary">Needed by</span>
                  <input
                    type="date"
                    value={neededBy}
                    onChange={(e) => setNeededBy(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-12 text-tertiary">Supplier</span>
                <input
                  type="text"
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  placeholder="Optional"
                  className={INPUT_CLASS}
                  maxLength={255}
                />
              </label>

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
              Send request
            </button>
          </footer>
        )}
      </div>
    </ModalCore>
  );
});
