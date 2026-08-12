/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * "Only the project lead edits the plan", in project settings.
 *
 * The help text below is the product of this feature as much as the switch is.
 * A permission whose boundary the reader cannot predict is worse than no
 * permission: they turn it on, somebody is refused something they did not expect
 * to lose, and the answer is to turn it off again. So the two lists are spelled
 * out, in the same words the 403 uses — `PLAN_LINE_LEAD` and
 * `PLAN_LINE_EVERYONE` in `plane/arribada/views.py` — rather than summarised.
 *
 * The switch itself is the lead's, and that is a DIFFERENT question from whether
 * the plan is: `can_set_governance` (the lead) versus `can_edit_plan` (the lead
 * or a workspace admin, because a plan needs a repair path when the lead is away).
 * Both come from the server on the schedule payload, so this file never works a
 * permission out for itself.
 */
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Lock } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { ToggleSwitch } from "@plane/ui";
import { SettingsBoxedControlItem } from "@/components/settings/boxed-control-item";
import { usePlanLock } from "@/plane-web/components/gantt-chart/use-plan-lock";
import { ArribadaService } from "@/plane-web/services/arribada.service";

type Props = {
  workspaceSlug: string;
  projectId: string;
};

const service = new ArribadaService();

export const ProjectPlanGovernanceSection = observer(function ProjectPlanGovernanceSection(props: Props) {
  const { workspaceSlug, projectId } = props;
  const planLock = usePlanLock(workspaceSlug, projectId);
  const [canSetGovernance, setCanSetGovernance] = useState(false);
  const [saving, setSaving] = useState(false);

  // `usePlanLock` carries the flags this screen toggles but not the answer to
  // "may I toggle them", because nothing else needs that one. Asked separately
  // rather than added to the hook, so the gantt does not pay for a question it
  // never puts.
  useEffect(() => {
    let live = true;
    service
      .getSchedule(workspaceSlug, projectId)
      .then((schedule) => {
        if (live) setCanSetGovernance(!!schedule?.can_set_governance);
        return undefined;
      })
      // Failing closed here is right: the switch is refused server-side anyway,
      // and a switch that looks available during an outage invites the click
      // that then fails.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [workspaceSlug, projectId]);

  const toggle = async () => {
    setSaving(true);
    const next = !planLock.leadOnlyEdits;
    const result = await planLock.setLeadOnlyEdits(next);
    setSaving(false);
    if (result.ok) {
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: next ? "The plan is now the lead's" : "The plan is open to the team again",
        message: next
          ? "Members keep their day-to-day: states, comments, checklists and the effort they actually spent."
          : "Anyone on the project can change dates, effort, disciplines and dependencies again.",
      });
      return;
    }
    const status = (result.error as { status?: number } | undefined)?.status;
    setToast({
      type: TOAST_TYPE.ERROR,
      title: status === 403 ? "Only the project lead can change this" : "Couldn't save that setting",
      message:
        status === 403
          ? "Who may change the plan is the lead's decision. Ask them, or ask a workspace admin to set a lead."
          : "Nothing was saved. Check your connection and try again.",
    });
  };

  return (
    <div className="mt-10">
      <SettingsBoxedControlItem
        title={
          <span className="flex items-center gap-2">
            <Lock className="size-4 shrink-0 text-tertiary" />
            Only the project lead edits the plan
          </span>
        }
        description={
          <>
            <span>
              With this on, only the project lead — or a workspace admin, so the plan can still be fixed when the lead
              is away — can change <b>dates</b>, <b>effort estimates</b>, <b>disciplines</b>, <b>parents</b>,{" "}
              <b>dependencies</b>, <b>sprint and module membership</b>, and the planning tools (auto-schedule, apply
              plan, baselines, the gap fillers).
            </span>
            <br />
            <span>
              Everyone else on the project keeps the day-to-day: moving a work item&apos;s <b>state</b>,{" "}
              <b>commenting</b>, <b>ticking a checklist</b>, recording the <b>effort they actually spent</b>, adding a
              link, and raising a purchase request.
            </span>
            <br />
            <span className="text-tertiary">
              This is a permission, so it does not apply to the lead. To freeze the plan for everyone including
              yourself, use the padlock on the timeline instead.
            </span>
          </>
        }
        control={
          <ToggleSwitch
            value={planLock.leadOnlyEdits}
            onChange={() => void toggle()}
            disabled={!planLock.loaded || !canSetGovernance || saving}
            size="sm"
          />
        }
      />
    </div>
  );
});
