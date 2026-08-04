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
import { useCallback, useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { OverviewBudgetBlock } from "@/plane-web/components/projects/overview/budget-block";
import { ProjectWarningsPanel } from "@/plane-web/components/projects/overview/warnings-panel";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TProjectOverview } from "@/plane-web/types/arribada";

const service = new ArribadaService();

/**
 * Only the warnings that change a number on this page.
 *
 * The Overview shows every gap a project has; repeating all of them here would
 * make Finance a second Overview, and the two would drift. These three are the
 * ones whose answer is visible in the figures below: a day with no discipline
 * has no rate, a discipline nobody holds has no rate either, and labour is
 * attributed to the month a task ends — so an undated task is missing from the
 * curve rather than late in it.
 */
const MONEY_CODES = new Set(["no_discipline", "unheld_disciplines", "undated_items"]);

export const ProjectFinanceRoot = observer(function ProjectFinanceRoot() {
  const { workspaceSlug, projectId } = useParams();
  const [warnings, setWarnings] = useState<TProjectOverview["warnings"]>([]);

  const loadWarnings = useCallback(() => {
    if (!workspaceSlug || !projectId) return;
    service
      .getProjectOverview(workspaceSlug.toString(), projectId.toString())
      .then((data) => setWarnings((data.warnings ?? []).filter((w) => MONEY_CODES.has(w.code))))
      // A page about money must not go blank because a warnings call failed.
      .catch(() => setWarnings([]));
  }, [workspaceSlug, projectId]);

  useEffect(() => loadWarnings(), [loadWarnings]);

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

      {/* Above the figures, not below them: these are the reasons a figure is
          wrong, and reading the number first is how a wrong one gets quoted. */}
      {warnings.length > 0 && <ProjectWarningsPanel warnings={warnings} onFixed={loadWarnings} />}

      {/* The block carries the allocation, the spend curve, the expense ledger,
          the labour cost from the roster's rates, and the purchase queue. On the
          Overview it lives inside a collapsed section; here it is the page. */}
      <div className="overflow-hidden rounded-lg border border-subtle bg-layer-1">
        <OverviewBudgetBlock />
      </div>
    </div>
  );
});
