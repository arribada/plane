/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Date every work item that has no dates, without leaving the page.
 *
 * "Open timeline" was the only offer, and it is a place to go rather than a fix:
 * the items are undated precisely because they are not on the timeline, so it
 * opens on a chart that does not show them. The timeline is still one click away
 * for anyone who would rather draw the bars.
 *
 * Spans arrive suggested from the recorded effort where there is one, so most
 * rows are a confirmation.
 */
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import { GapModalShell } from "./gap-modal-shell";

const service = new ArribadaService();

type TItem = {
  id: string;
  name: string;
  sequence_id: number;
  start_date: string | null;
  target_date: string | null;
  suggested_start: string;
  suggested_target: string;
  effort_days: number | null;
};

type TSpan = { start_date: string; target_date: string };

type Props = { isOpen: boolean; onClose: () => void; onDone: () => void; onOpenTimeline: () => void };

export const UndatedGapModal = observer(function UndatedGapModal(props: Props) {
  const { isOpen, onClose, onDone, onOpenTimeline } = props;
  const { workspaceSlug, projectId } = useParams();
  const [items, setItems] = useState<TItem[] | null>(null);
  const [spans, setSpans] = useState<Record<string, TSpan>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !workspaceSlug || !projectId) return;
    let live = true;
    setItems(null);
    const load = async () => {
      try {
        const data = await service.getUndatedGap(workspaceSlug.toString(), projectId.toString());
        if (!live) return;
        setItems(data.items);
        setSpans(
          Object.fromEntries(
            data.items.map((i) => [i.id, { start_date: i.suggested_start, target_date: i.suggested_target }])
          )
        );
      } catch {
        if (live) setItems([]);
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [isOpen, workspaceSlug, projectId]);

  // A span that ends before it starts is refused by the server, so it must not
  // be counted here either — otherwise the button promises more than it does.
  const valid = Object.entries(spans).filter(([, s]) => s.start_date && s.target_date && s.target_date >= s.start_date);
  const backwards = Object.values(spans).filter(
    (s) => s.start_date && s.target_date && s.target_date < s.start_date
  ).length;

  const save = async () => {
    if (!workspaceSlug || !projectId || valid.length === 0) return;
    setSaving(true);
    try {
      const result = await service.setUndatedGap(
        workspaceSlug.toString(),
        projectId.toString(),
        Object.fromEntries(valid)
      );
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: `${result.written} dated`,
        message: "They appear on the timeline and count towards the plan.",
      });
      onDone();
      onClose();
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't save",
        message: (error as { error?: string })?.error ?? "Nothing was changed.",
      });
    } finally {
      setSaving(false);
    }
  };

  const setDate = (id: string, key: keyof TSpan, value: string) =>
    setSpans((current) => ({
      ...current,
      [id]: { ...(current[id] ?? { start_date: "", target_date: "" }), [key]: value },
    }));

  return (
    <GapModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Give these work items dates"
      blurb="Spans are suggested from the recorded effort where there is one, counting working days. Nothing is saved until you press the button."
      count={items?.length ?? null}
      emptyMessage="Every open work item already has a start and an end."
      filled={valid.length}
      saving={saving}
      onSave={() => void save()}
      saveLabel="Date"
      filledNoun="ready to save"
      footerExtra={
        <>
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenTimeline();
            }}
            className="rounded border border-subtle px-3 py-1.5 text-12 text-secondary hover:text-primary"
          >
            Open timeline instead
          </button>
          {backwards > 0 && (
            <span className="text-11 text-warning-primary">{backwards} end before they start and will be skipped</span>
          )}
        </>
      }
    >
      <ul className="space-y-1.5">
        {(items ?? []).map((item) => {
          const span = spans[item.id];
          const bad = span?.start_date && span?.target_date && span.target_date < span.start_date;
          return (
            <li key={item.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-13 text-primary" title={item.name}>
                {item.name}
              </span>
              <span className="w-20 flex-shrink-0 text-right text-11 text-tertiary">
                {item.effort_days ? `${item.effort_days} d effort` : "no effort"}
              </span>
              <input
                type="date"
                value={span?.start_date ?? ""}
                onChange={(e) => setDate(item.id, "start_date", e.target.value)}
                aria-label={`Start date for ${item.name}`}
                className="w-36 flex-shrink-0 rounded border border-subtle bg-layer-2 px-2 py-1 text-12 text-primary outline-none focus:border-accent-strong"
              />
              <input
                type="date"
                value={span?.target_date ?? ""}
                onChange={(e) => setDate(item.id, "target_date", e.target.value)}
                aria-label={`Due date for ${item.name}`}
                className={
                  bad
                    ? "w-36 flex-shrink-0 rounded border border-danger-strong bg-layer-2 px-2 py-1 text-12 text-danger-primary outline-none"
                    : "w-36 flex-shrink-0 rounded border border-subtle bg-layer-2 px-2 py-1 text-12 text-primary outline-none focus:border-accent-strong"
                }
              />
            </li>
          );
        })}
      </ul>
    </GapModalShell>
  );
});
