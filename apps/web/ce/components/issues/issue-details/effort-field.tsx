/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * How much work this item is, in person-days.
 *
 * Deliberately beside Plane's estimate points rather than replacing them. Points
 * are a team-relative currency that refuses to convert into time, which is right
 * for a sprint board; this answers the two questions points cannot — how long
 * should the bar be when nobody typed a date, and what does the work cost when
 * the rate is per day.
 *
 * The suggested span is OFFERED, never applied. A field that moved somebody's
 * dates the moment they recorded an estimate is a field people stop filling in.
 */
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Gauge, Loader2 } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { renderFormattedDate } from "@plane/utils";
import { cn } from "@plane/utils";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TIssueEffort } from "@/plane-web/types/arribada";

const service = new ArribadaService();

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  isEditable: boolean;
};

export const IssueEffortField = observer(function IssueEffortField(props: Props) {
  const { workspaceSlug, projectId, issueId, isEditable } = props;
  const { updateIssue } = useIssueDetail();
  const [state, setState] = useState<TIssueEffort | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!workspaceSlug || !projectId || !issueId) return;
    let live = true;
    const load = async () => {
      try {
        const data = await service.getIssueEffort(workspaceSlug, projectId, issueId);
        if (!live) return;
        setState(data);
        setDraft(data.days == null ? "" : String(data.days));
      } catch {
        if (live) setState(null);
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [workspaceSlug, projectId, issueId]);

  const commit = async () => {
    const trimmed = draft.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed <= 0)) {
      setToast({ type: TOAST_TYPE.ERROR, title: "That is not a number of days" });
      setDraft(state?.days == null ? "" : String(state.days));
      return;
    }
    // Nothing changed: skip the round trip rather than writing the same value and
    // stamping a new updated_by on it.
    if ((state?.days ?? null) === parsed) return;
    setBusy(true);
    try {
      setState(await service.setIssueEffort(workspaceSlug, projectId, issueId, parsed));
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't save the effort",
        message: (error as { error?: string })?.error ?? "It was not changed.",
      });
      setDraft(state?.days == null ? "" : String(state.days));
    } finally {
      setBusy(false);
    }
  };

  const applySuggestion = async () => {
    const dates = state?.suggested_dates;
    if (!dates) return;
    setBusy(true);
    try {
      await updateIssue(workspaceSlug, projectId, issueId, {
        start_date: dates.start_date,
        target_date: dates.target_date,
      });
      // The suggestion only exists while a date is missing, so once it is taken
      // it has to go — leaving it offers to re-apply what is already there.
      setState({ ...state, suggested_dates: null } as TIssueEffort);
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Dates set from the estimate" });
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't set the dates" });
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;

  return (
    <div className="space-y-1.5 py-1">
      <div className="flex items-center gap-2">
        <span className="flex w-2/5 flex-shrink-0 items-center gap-1.5 text-13 text-secondary">
          <Gauge className="size-4 flex-shrink-0" />
          Effort
        </span>
        <div className="flex h-full w-3/5 items-center gap-1.5">
          <input
            type="number"
            min={0.5}
            step={0.5}
            disabled={!isEditable || busy}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder="—"
            aria-label="Effort in person-days"
            className={cn(
              "w-20 rounded border border-transparent bg-transparent px-2 py-0.5 text-13 text-primary outline-none",
              isEditable && "hover:border-subtle focus:border-accent-strong"
            )}
          />
          <span className="text-12 text-tertiary">person-days</span>
          {busy && <Loader2 className="size-3 animate-spin text-tertiary" />}
        </div>
      </div>

      {state.suggested_dates && isEditable && (
        <button
          type="button"
          onClick={() => void applySuggestion()}
          disabled={busy}
          className="ml-[40%] block text-11 text-accent-primary hover:underline"
        >
          Use {renderFormattedDate(state.suggested_dates.start_date)} →{" "}
          {renderFormattedDate(state.suggested_dates.target_date)}
        </button>
      )}
    </div>
  );
});
