/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Save the arrangement you just dragged into place, and get it back later.
 *
 * Plane has exactly one manual order — `Issue.sort_order` — and dragging
 * rewrites it in place. That is enough right up to the moment somebody arranges
 * a board for a review, sorts by due date to answer a question, and wants their
 * arrangement back: it is gone, because there was only ever one.
 *
 * Restoring rewrites sort_order rather than introducing a fourth sort mode, so a
 * restored arrangement IS the live manual order and every other view agrees with
 * it. The ordinary sort and filter controls keep working exactly as before —
 * this adds a way back, it does not take one away.
 */
import { useCallback, useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Bookmark, Check, Loader2, Trash2 } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { cn } from "@plane/utils";
import type { EIssuesStoreType } from "@plane/types";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { useIssuesActions } from "@/hooks/use-issues-actions";
import { ArribadaService } from "@/plane-web/services/arribada.service";

const service = new ArribadaService();

type TOrder = { id: string; name: string; count: number; updated_at: string | null };

type Props = {
  /** The sequence currently on screen — what "this order" means to a reader. */
  visibleIssueIds: string[];
};

export const SavedOrderMenu = observer(function SavedOrderMenu({ visibleIssueIds }: Props) {
  const { workspaceSlug, projectId } = useParams();
  // Refetches itself rather than taking a callback: restoring rewrites
  // sort_order on the server, and a list that keeps its old sequence until the
  // page is reloaded reads as the restore having done nothing.
  const { fetchIssues } = useIssuesActions(useIssueStoreType() as EIssuesStoreType);
  const [orders, setOrders] = useState<TOrder[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const slug = workspaceSlug?.toString();
  const pid = projectId?.toString();

  const refetch = useCallback(() => {
    if (!slug || !pid) return;
    service
      .getIssueOrders(slug, pid)
      .then((r) => {
        setOrders(r.orders ?? []);
        return undefined;
      })
      // A list of saved orders that will not load must not break the toolbar.
      .catch(() => undefined);
  }, [slug, pid]);

  useEffect(() => {
    if (open) refetch();
  }, [open, refetch]);

  if (!slug || !pid) return null;

  const save = async () => {
    const name = window.prompt("Name this arrangement");
    if (!name?.trim()) return;
    setBusy(true);
    try {
      const result = await service.saveIssueOrder(slug, pid, name.trim(), visibleIssueIds);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: `"${result.name}" saved`,
        message: `${result.count} work items, in the order on screen.`,
      });
      refetch();
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't save the order",
        message: (error as { error?: string })?.error ?? "Nothing was stored.",
      });
    } finally {
      setBusy(false);
    }
  };

  const apply = async (order: TOrder) => {
    setBusy(true);
    try {
      const result = await service.applyIssueOrder(slug, pid, order.id);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: `"${order.name}" restored`,
        message:
          result.applied < result.saved
            ? `${result.applied} of ${result.saved} — the rest have been deleted since.`
            : "The manual order now matches it.",
      });
      setOpen(false);
      fetchIssues("mutation", { canGroup: false, perPageCount: 100 });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't restore it",
        message: (error as { error?: string })?.error ?? "The order was left as it was.",
      });
    } finally {
      setBusy(false);
    }
  };

  const forget = async (order: TOrder) => {
    if (!window.confirm(`Forget "${order.name}"? The work items keep their current order.`)) return;
    await service.deleteIssueOrder(slug, pid, order.id);
    refetch();
  };

  return (
    <details
      className="group relative flex-shrink-0"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md bg-layer-transparent p-1 px-2 text-11 whitespace-nowrap hover:bg-layer-transparent-hover">
        <Bookmark className="size-3.5" />
        Saved order
      </summary>
      <div className="shadow-lg absolute top-full right-0 z-30 mt-1 w-72 rounded border border-subtle bg-layer-1 p-1">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || visibleIssueIds.length === 0}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-12 text-primary hover:bg-layer-2 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          Save the order on screen ({visibleIssueIds.length})
        </button>

        {orders.length > 0 && <div className="my-1 border-t border-subtle" />}

        {orders.map((order) => (
          <div key={order.id} className="group/row flex items-center gap-1">
            <button
              type="button"
              onClick={() => void apply(order)}
              disabled={busy}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-start rounded px-2 py-1 text-left hover:bg-layer-2",
                busy && "opacity-50"
              )}
            >
              <span className="w-full truncate text-12 text-primary">{order.name}</span>
              <span className="text-10 text-tertiary">{order.count} work items</span>
            </button>
            <button
              type="button"
              onClick={() => void forget(order)}
              aria-label={`Forget ${order.name}`}
              className="flex-shrink-0 px-1 text-placeholder opacity-0 group-hover/row:opacity-100 hover:text-danger-primary"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}

        {orders.length === 0 && (
          <p className="px-2 py-1 text-10 text-tertiary">
            Nothing saved yet. Drag the rows into the order you want, then save it here.
          </p>
        )}
      </div>
    </details>
  );
});
