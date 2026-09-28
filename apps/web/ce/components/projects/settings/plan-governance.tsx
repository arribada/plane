/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Who may change this project, in project settings: "Only the project lead edits
 * the plan", and "External edits" (whether the wiki sync and connected agents may
 * write here at all).
 *
 * The help text below is the product of this feature as much as the switches are.
 * A permission whose boundary the reader cannot predict is worse than no
 * permission: they turn it on, somebody is refused something they did not expect
 * to lose, and the answer is to turn it off again. So the two lists are spelled
 * out, in the same words the 403 uses (`PLAN_LINE_LEAD` and
 * `PLAN_LINE_EVERYONE` in `plane/arribada/views.py`) rather than summarised.
 *
 * The lead-only switch is the lead's, and that is a DIFFERENT question from
 * whether the plan is: `can_set_governance` (the lead) versus `can_edit_plan`
 * (the lead or a workspace admin, because a plan needs a repair path when the
 * lead is away). External edits is a third answer, `can_set_external_edits`
 * (the lead or a workspace admin, decided 2026-09-25). All three come from the
 * server on the schedule payload, so this file never works a permission out for
 * itself.
 *
 * "External edits" is the switch's name on purpose: it is the field's name in the
 * API, the name the wiki sync's and the MCP server's refusals use, and so the
 * word somebody who was refused will come here looking for. It had no switch at
 * all until 2026-09-25, which is how a lead was told to "turn on external edits"
 * and could find nothing called that anywhere.
 */
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Lock, Plug } from "lucide-react";
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

  // External edits live here rather than in `usePlanLock`: the gantt reads that
  // hook and has no use for this flag, and a hook that grows every setting on the
  // row makes every timeline render pay for questions it never puts.
  const [externalEdits, setExternalEdits] = useState(false);
  const [canSetExternalEdits, setCanSetExternalEdits] = useState(false);
  const [externalLoaded, setExternalLoaded] = useState(false);
  const [savingExternal, setSavingExternal] = useState(false);

  // `usePlanLock` carries the flags this screen toggles but not the answer to
  // "may I toggle them", because nothing else needs that one. Asked separately
  // rather than added to the hook, so the gantt does not pay for a question it
  // never puts.
  useEffect(() => {
    let live = true;
    service
      .getSchedule(workspaceSlug, projectId)
      .then((schedule) => {
        if (!live) return undefined;
        setCanSetGovernance(!!schedule?.can_set_governance);
        setExternalEdits(!!schedule?.external_edits);
        setCanSetExternalEdits(!!schedule?.can_set_external_edits);
        setExternalLoaded(true);
        return undefined;
      })
      // Failing closed here is right: the switches are refused server-side anyway,
      // and a switch that looks available during an outage invites the click
      // that then fails. `externalLoaded` stays false, so that switch stays off
      // AND disabled rather than showing "off" as if it were a known answer.
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

  const toggleExternal = async () => {
    const next = !externalEdits;
    setSavingExternal(true);
    // Optimistic, then corrected from what the server says it saved: the same
    // shape `usePlanLock` uses for its switches.
    setExternalEdits(next);
    try {
      const saved = await service.updateSchedule(workspaceSlug, projectId, { external_edits: next });
      setExternalEdits(!!saved?.external_edits);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: next ? "Integrations can now write here" : "Integrations can no longer write here",
        message: next
          ? "The wiki sync and connected agents may create and update work items in this project."
          : "Nothing they already wrote is removed. New writes from the wiki sync and agents are refused.",
      });
    } catch (error) {
      setExternalEdits(!next);
      const status = (error as { status?: number } | undefined)?.status;
      setToast({
        type: TOAST_TYPE.ERROR,
        title:
          status === 403 ? "Only the project lead or a workspace admin can change this" : "Couldn't save that setting",
        message:
          status === 403
            ? "Whether integrations may write into this project is the lead's or a workspace admin's decision."
            : "Nothing was saved. Check your connection and try again.",
      });
    } finally {
      setSavingExternal(false);
    }
  };

  return (
    <div className="mt-10 flex flex-col gap-4">
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
              With this on, only the project lead, or a workspace admin so the plan can still be fixed when the lead is
              away, can change <b>dates</b>, <b>effort estimates</b>, <b>disciplines</b>, <b>parents</b>,{" "}
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
            label="Only the project lead edits the plan"
            disabled={!planLock.loaded || !canSetGovernance || saving}
            size="sm"
          />
        }
      />
      <SettingsBoxedControlItem
        title={
          <span className="flex items-center gap-2">
            <Plug className="size-4 shrink-0 text-tertiary" />
            External edits: accept edits from integrations
          </span>
        }
        description={
          <>
            <span>
              With this on, the <b>wiki sync</b> and <b>connected AI agents</b> (the Plane connector in Claude) may{" "}
              <b>create and update work items</b> in this project. An agent acts as the person who connected it and can
              never do more than that person could.
            </span>
            <br />
            <span>
              Changing <b>dates</b>, <b>parents</b>, <b>estimates</b>, <b>sprints</b> or <b>modules</b> also needs the
              connector&apos;s plan permission, is refused wherever the setting above keeps the plan for the lead, and
              never happens on a locked timeline.
            </span>
            <br />
            <span className="text-tertiary">Off by default. The project lead or a workspace admin can change it.</span>
          </>
        }
        control={
          <ToggleSwitch
            value={externalEdits}
            onChange={() => void toggleExternal()}
            label="External edits"
            disabled={!externalLoaded || !canSetExternalEdits || savingExternal}
            size="sm"
          />
        }
      />
    </div>
  );
});
