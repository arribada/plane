/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Policy note on a project's Pages section: durable documentation belongs in the
 * team wiki, Plane pages are scratch space. Kept separate from AffineWikiPanel,
 * which carries the *links* — this one only carries the *rule*.
 */
import { useState } from "react";
import { observer } from "mobx-react";
import { BookOpen, X } from "lucide-react";
import { cn } from "@plane/utils";

const DISMISS_KEY = "arribada.pages.wikiNotice.dismissed";

// localStorage throws in embedded/partitioned contexts — a missing preference is
// never worth breaking the page over.
const readDismissed = (): boolean => {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
};

export const WikiNoticeBanner = observer(function WikiNoticeBanner({ className }: { className?: string }) {
  // Lazy initial read so a dismissed banner never flashes on navigation.
  const [dismissed, setDismissed] = useState(readDismissed);

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // preference just won't survive a reload
    }
    setDismissed(true);
  };

  if (dismissed) return null;

  return (
    <div
      className={cn(
        "mb-3 flex items-start gap-2 rounded-md border border-warning-strong/30 bg-warning-subtle px-3 py-2 text-13 text-warning-primary",
        className
      )}
    >
      <BookOpen className="mt-0.5 size-4 flex-shrink-0" />
      <span className="flex-grow">
        The team wiki at{" "}
        <a href="https://docs.arribada.org" target="_blank" rel="noreferrer" className="font-medium underline">
          docs.arribada.org
        </a>{" "}
        is where project documentation lives. These project pages are for ad-hoc notes and management scratch work — if
        others will need to find it later, it belongs in the wiki.
      </span>
      <button type="button" onClick={dismiss} className="flex-shrink-0 opacity-70 hover:opacity-100" title="Dismiss">
        <X className="size-4" />
      </button>
    </div>
  );
});
