/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * What each person does on this project, keyed by their Plane account.
 *
 * Plane's own project role is a permission level — admin / member / guest — and
 * says nothing about whether somebody builds enclosures or writes firmware. The
 * arribada roster carries that, and it is the thing a lead is actually choosing
 * between when they open an assignee list: "who does H.C.C" is the question,
 * "who is a member" is not.
 *
 * Cached per project for the lifetime of the page: the assignee dropdown mounts
 * once per work item and there can be dozens on screen, so this must never be a
 * fetch per dropdown.
 *
 * Shaped like `use-project-relations`, `use-project-slack`, `use-project-progress`
 * and `use-project-milestones`, which it used to differ from in the two ways that
 * matter:
 *
 *  - It cached the EMPTY result on failure (`cache.set(projectId, empty)`), so one
 *    502 meant every assignee dropdown in the tab was unlabelled until a reload.
 *    Its four siblings drop the entry and let the next mount try again.
 *  - Its invalidator only dropped the entry, which reaches the NEXT mount and not
 *    the dropdowns already on screen — and nothing in the repository called it at
 *    all, so saving a roster left the old disciplines showing for the session.
 *    `bumpProjectRevision` is what reaches a mounted component; see
 *    `../gantt-chart/derived-revision.ts`.
 */
import { useEffect, useState } from "react";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import { bumpProjectRevision, useProjectRevision } from "@/plane-web/components/gantt-chart/derived-revision";

const service = new ArribadaService();

const EMPTY: Map<string, string[]> = new Map();

/** `${workspaceSlug}/${projectId}` -> (memberId -> roles). Shared across every
 *  dropdown on the page. Keyed by both, like every sibling: a project id is only
 *  unique inside its workspace, and the endpoint takes both. */
const cache = new Map<string, Map<string, string[]>>();
const inflight = new Map<string, Promise<Map<string, string[]>>>();

const keyFor = (workspaceSlug: string, projectId: string) => `${workspaceSlug}/${projectId}`;

const load = async (workspaceSlug: string, projectId: string): Promise<Map<string, string[]>> => {
  const key = keyFor(workspaceSlug, projectId);
  const cached = cache.get(key);
  if (cached) return cached;
  const running = inflight.get(key);
  if (running) return running;

  const request = service
    .getProjectTeam(workspaceSlug, projectId)
    .then((response) => {
      const byMember = new Map<string, string[]>();
      for (const row of response?.team ?? []) {
        // Roster entries with no Plane account cannot be an assignee, so they
        // have nothing to label here.
        if (!row.member_id) continue;
        const roles = (row.roles ?? []).filter(Boolean);
        if (roles.length) byMember.set(row.member_id, roles);
      }
      cache.set(key, byMember);
      return byMember;
    })
    .catch(() => {
      // A roster that will not load must not break the dropdown it decorates —
      // but it must not be remembered as "this project has no disciplines"
      // either. Nothing is cached, so the next dropdown to mount asks again.
      cache.delete(key);
      return EMPTY;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, request);
  return request;
};

/** Drop the cache for one project after the roster is edited, and tell the
 *  dropdowns already on screen. */
export const invalidateProjectRoles = (workspaceSlug: string, projectId: string): void => {
  cache.delete(keyFor(workspaceSlug, projectId));
  // Dropping the entry only helps the NEXT mount; this is what reaches the
  // components already open.
  bumpProjectRevision(workspaceSlug, projectId);
};

export function useProjectRoles(
  workspaceSlug: string | undefined,
  projectId: string | undefined
): Map<string, string[]> {
  const revision = useProjectRevision(workspaceSlug, projectId);
  const [roles, setRoles] = useState<Map<string, string[]>>(
    () => (workspaceSlug && projectId ? cache.get(keyFor(workspaceSlug, projectId)) : undefined) ?? EMPTY
  );

  useEffect(() => {
    if (!workspaceSlug || !projectId) return;
    let live = true;
    const run = async () => {
      const byMember = await load(workspaceSlug, projectId);
      if (live) setRoles(byMember);
    };
    void run();
    return () => {
      live = false;
    };
  }, [workspaceSlug, projectId, revision]);

  return roles;
}
