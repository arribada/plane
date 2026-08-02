/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A foldable section. The overview used to stack every block open at once,
 * which turned the page a project opens on into a wall nobody read — the detail
 * is kept, one fold away, so the top of the page can stay a sentence.
 */
import { useState, type ReactNode } from "react";
import { observer } from "mobx-react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@plane/utils";

type Props = {
  title: string;
  /** Shown next to the title, e.g. how many rows are inside. */
  badge?: string | number;
  defaultOpen?: boolean;
  children: ReactNode;
};

export const OverviewSection = observer(function OverviewSection({ title, badge, defaultOpen, children }: Props) {
  const [open, setOpen] = useState(!!defaultOpen);

  return (
    <div className="overflow-hidden rounded-lg border border-subtle bg-layer-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-layer-2"
      >
        {open ? (
          <ChevronDown className="size-4 flex-shrink-0 text-tertiary" />
        ) : (
          <ChevronRight className="size-4 flex-shrink-0 text-tertiary" />
        )}
        <span className="text-13 font-semibold text-primary">{title}</span>
        {badge !== undefined && badge !== "" && (
          <span className="rounded-full bg-layer-2 px-2 py-0.5 text-11 text-secondary">{badge}</span>
        )}
      </button>
      {/* print:overview-body is the hook the print stylesheet uses to open every
          section: a report with its budget collapsed is not a report. */}
      <div className={cn("overview-section-body border-t border-subtle", { hidden: !open })}>{children}</div>
    </div>
  );
});
