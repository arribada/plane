/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A project's money, on its own page.
 *
 * All of this already existed, folded inside a collapsed accordion on the
 * Overview called "What it costs" — which was the right call when it was one
 * number, and the wrong one once it grew a spend curve, an expense ledger and a
 * purchase queue. Three things nobody looks at daily, but which somebody has to
 * be able to sit down with: a page you can open, read top to bottom and send a
 * link to.
 *
 * Deliberately the same components as the accordion rather than a second copy.
 * Two surfaces that compute a budget slightly differently is how a project ends
 * up with two answers to "how much have we spent", and the one people quote is
 * whichever they saw last.
 */
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { OverviewBudgetBlock } from "@/plane-web/components/projects/overview/budget-block";

export const ProjectFinanceRoot = observer(function ProjectFinanceRoot() {
  const { projectId } = useParams();
  if (!projectId) return null;

  return (
    // No `h-full` and no `overflow-y-auto` here, deliberately. ContentWrapper
    // above already scrolls, and the page wrapper is `h-full` — adding a third
    // scroll container clamped to the viewport meant the panel that opens when
    // you set an hourly rate grew INSIDE a box that could not scroll, so its
    // save button was simply unreachable. Overview gets this right by being a
    // plain flex column and letting the wrapper do the scrolling.
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 md:px-6">
      <header>
        <h1 className="text-16 font-semibold text-primary">Finance</h1>
        <p className="mt-0.5 text-12 text-tertiary">
          What this project was given, what it has committed, and what is still waiting on a decision.
        </p>
      </header>

      {/* The block carries the allocation, the spend curve, the expense ledger,
          the labour cost from the roster's rates, and the purchase queue. On the
          Overview it lives inside a collapsed section; here it is the page. */}
      <div className="overflow-hidden rounded-lg border border-subtle bg-layer-1">
        <OverviewBudgetBlock />
      </div>
    </div>
  );
});
