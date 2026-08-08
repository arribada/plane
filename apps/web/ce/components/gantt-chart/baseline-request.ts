/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * One baseline read per gantt mount, shared by the two things that need it.
 *
 * `BaselinePicker` wants the list of snapshots; `GanttAdditionalLayers` wants the
 * entries of the selected one. Both come back in the same payload from the same
 * endpoint, and both components mount in the same commit — so the chart made the
 * identical request twice, every time. The comments in both files already
 * acknowledged they were "the same request"; this is the part that makes that
 * true at runtime.
 *
 * Deliberately an IN-FLIGHT share and not a cache. There is no TTL and nothing is
 * remembered after the promise settles: capturing a snapshot, deleting one or
 * switching which one is selected must all read the server again, and a cache
 * with a lifetime — however short — is how a freshly captured baseline comes back
 * missing from the picker that captured it.
 */
import { ArribadaService } from "@/plane-web/services/arribada.service";

type TBaselinePayload = Awaited<ReturnType<ArribadaService["getBaseline"]>>;

const service = new ArribadaService();
const inFlight = new Map<string, Promise<TBaselinePayload>>();

export function getBaselineShared(
  workspaceSlug: string,
  projectId: string,
  baselineId?: string
): Promise<TBaselinePayload> {
  // The id is part of the key: two callers asking for different snapshots are
  // two different questions and must not be handed each other's answer.
  const key = [workspaceSlug, projectId, baselineId ?? ""].join("|");
  const running = inFlight.get(key);
  if (running) return running;

  const request = service.getBaseline(workspaceSlug, projectId, baselineId).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}
