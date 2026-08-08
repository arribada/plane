/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Which promised plan the ghost bars are drawing.
 *
 * A baseline is the plan as it was when it was agreed. Holding several of them —
 * "PDR January 2026", "After amendment 2" — is what makes "here is what we
 * committed to" answerable: a funder asking that needs to be shown WHICH plan,
 * and the single overwritten snapshot this fork used to keep could not say.
 *
 * Capturing is deliberately a named act with a confirmation. It used to be one
 * unguarded menu item that re-froze every project in scope at once.
 */
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Flag, Plus, Trash2 } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { renderFormattedDate } from "@plane/utils";
import { cn } from "@plane/utils";
import { useTimeLineChartStore } from "@/hooks/use-timeline-chart";
import { apiErrorMessage } from "@/plane-web/services/api-error";
import { ArribadaService } from "@/plane-web/services/arribada.service";

const service = new ArribadaService();

type TSnapshot = {
  id: string;
  name: string;
  captured_at: string;
  captured_by_name: string | null;
  entry_count: number;
};

export const BaselinePicker = observer(function BaselinePicker() {
  const { workspaceSlug, projectId } = useParams();
  const store = useTimeLineChartStore();
  const [snapshots, setSnapshots] = useState<TSnapshot[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const slug = workspaceSlug?.toString();
  const pid = projectId?.toString();

  const load = async () => {
    if (!slug || !pid) return;
    try {
      const payload = await service.getBaseline(slug, pid);
      setSnapshots(payload?.baselines ?? []);
      setFailure(null);
    } catch (error) {
      // An empty list hides the picker entirely and leaves only the capture
      // button — which reads as "this project has never been baselined", on the
      // one control a lead uses to answer "what did we commit to". Same request
      // the ghost-bar overlay makes, so this chip is what reports both: when it
      // fails there are no ghost bars behind the live ones either.
      setSnapshots([]);
      setFailure(apiErrorMessage(error, "The snapshots could not be read."));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, pid]);

  if (!slug || !pid || snapshots === null) return null;

  if (failure)
    return (
      <button
        type="button"
        onClick={() => void load()}
        title={`${failure} The ghost bars behind the plan are missing for the same reason. Click to try again.`}
        className="flex items-center gap-1 rounded border border-danger-strong/40 px-1.5 py-1 text-11 text-danger-primary"
      >
        <Flag className="size-3" />
        Baselines unavailable
      </button>
    );

  const capture = async () => {
    const name = window.prompt(
      "Name this snapshot of the plan — a funder needs to know which one they are being shown.",
      `Baseline ${renderFormattedDate(new Date()) ?? ""}`
    );
    // Cancelled, not empty: an empty name is filled in by the server with a dated
    // one, but a cancel means they changed their mind.
    if (name === null) return;
    setBusy(true);
    try {
      const created = await service.captureBaseline(slug, pid, name.trim());
      await load();
      // Show what was just frozen rather than leaving the reader on an older one.
      store.setSelectedBaselineId(created.id);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: `Froze ${created.captured} work ${created.captured === 1 ? "item" : "items"}`,
        message: "Nothing was overwritten — earlier baselines are still there to compare against.",
      });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't capture that",
        message: apiErrorMessage(error, "No snapshot was taken."),
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (snapshot: TSnapshot) => {
    if (!window.confirm(`Delete "${snapshot.name}"? The plan it recorded cannot be recovered.`)) return;
    try {
      await service.deleteBaseline(slug, pid, snapshot.id);
      if (store.selectedBaselineId === snapshot.id) store.setSelectedBaselineId("");
      await load();
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't delete that",
        message: apiErrorMessage(error, "It is still there."),
      });
    }
  };

  const selected = store.selectedBaselineId || snapshots[0]?.id || "";
  const current = snapshots.find((s) => s.id === selected);

  return (
    <span className="flex items-center gap-1">
      {snapshots.length > 0 && (
        <span className="flex items-center overflow-hidden rounded border border-subtle">
          <Flag className="ml-1.5 size-3 text-tertiary" />
          <select
            value={selected}
            onChange={(e) => store.setSelectedBaselineId(e.target.value)}
            aria-label="Which promised plan the ghost bars show"
            title={
              current
                ? `Frozen ${renderFormattedDate(current.captured_at)}${
                    current.captured_by_name ? ` by ${current.captured_by_name}` : ""
                  } · ${current.entry_count} work items`
                : undefined
            }
            // The outline is suppressed because it drew a box outside the
            // rounded wrapper; a ring inside it says the same thing without the
            // clipping. Suppressing it and putting nothing back left a control
            // that gives a keyboard no sign of where it is.
            className="bg-transparent px-1.5 py-1 text-11 text-secondary outline-none focus:ring-1 focus:ring-accent-strong"
          >
            {snapshots.map((snapshot) => (
              <option key={snapshot.id} value={snapshot.id}>
                {snapshot.name}
              </option>
            ))}
          </select>
          {current && (
            <button
              type="button"
              onClick={() => void remove(current)}
              aria-label={`Delete the baseline ${current.name}`}
              className="p-1 text-tertiary hover:text-danger-primary"
            >
              <Trash2 className="size-3" />
            </button>
          )}
        </span>
      )}
      <button
        type="button"
        onClick={() => void capture()}
        disabled={busy}
        title="Freeze today's dates as a new named snapshot. Nothing existing is overwritten."
        className={cn(
          "flex items-center gap-1 rounded border border-subtle px-2 py-1 text-11 text-secondary",
          busy ? "opacity-50" : "hover:bg-layer-1 hover:text-primary"
        )}
      >
        <Plus className="size-3" />
        {busy ? "Freezing…" : snapshots.length === 0 ? "Freeze the plan" : "New baseline"}
      </button>
    </span>
  );
});
