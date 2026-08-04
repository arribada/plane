/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The frame every quick-fix modal shares.
 *
 * There are four of these now — discipline, assignee, dates, GitHub routing — and
 * they are the same shape every time: a warning names a number, this hands back
 * the rows behind it, you answer them in one pass and press one button. Written
 * once so the fourth one cannot quietly drift from the first in its scrolling,
 * its footer, or what its buttons are called.
 */
import type { ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@plane/utils";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** One line under the title saying why this matters. */
  blurb?: string;
  /** null while loading, [] once loaded and empty. */
  count: number | null;
  emptyMessage: string;
  /** How many rows carry an answer, shown beside the button. */
  filled: number;
  saving: boolean;
  onSave: () => void;
  saveLabel?: string;
  /** What "set" means here. "0 of 2 set" sitting beside a row that shows dates
   *  reads as a statement about the dates; naming the thing removes the doubt. */
  filledNoun?: string;
  children: ReactNode;
  /** Sits on the footer's left, before the count — used for "add a discipline". */
  footerExtra?: ReactNode;
};

export function GapModalShell(props: Props) {
  const {
    isOpen,
    onClose,
    title,
    blurb,
    count,
    emptyMessage,
    filled,
    saving,
    onSave,
    saveLabel = "Save",
    filledNoun = "set",
    children,
    footerExtra,
  } = props;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="shadow-lg relative z-10 flex max-h-[80vh] w-full max-w-3xl flex-col rounded-lg border border-subtle bg-layer-1">
        <header className="flex items-center gap-2 border-b border-subtle px-4 py-3">
          <h2 className="flex-1 text-14 font-medium text-primary">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-tertiary hover:text-primary">
            <X className="size-4" />
          </button>
        </header>

        {/* The list scrolls; the header and footer do not. Three nested scroll
            containers is how the Finance page ended up with a save button nobody
            could reach. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {count === null ? (
            <p className="text-13 text-tertiary">Loading…</p>
          ) : count === 0 ? (
            <p className="text-13 text-tertiary">{emptyMessage}</p>
          ) : (
            <>
              {blurb && <p className="mb-3 text-12 text-tertiary">{blurb}</p>}
              {children}
            </>
          )}
        </div>

        {count !== null && count > 0 && (
          <footer className="flex items-center gap-2 border-t border-subtle px-4 py-3">
            {footerExtra}
            <span className="ml-auto text-11 text-tertiary">
              {filled} of {count} {filledNoun}
            </span>
            <button type="button" onClick={onClose} className="rounded border border-subtle px-3 py-1.5 text-12">
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || filled === 0}
              className={cn(
                "flex items-center gap-1.5 rounded bg-accent-primary px-3 py-1.5 text-12 text-on-color",
                saving || filled === 0 ? "opacity-50" : "hover:opacity-90"
              )}
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {saveLabel} {filled}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
