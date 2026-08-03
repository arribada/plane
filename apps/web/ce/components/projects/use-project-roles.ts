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
 */
import { useEffect, useState } from "react";
import { ArribadaService } from "@/plane-web/services/arribada.service";

const service = new ArribadaService();

/** projectId -> (memberId -> roles). Shared across every dropdown on the page. */
const cache = new Map<string, Map<string, string[]>>();
const inflight = new Map<string, Promise<Map<string, string[]>>>();

const load = async (slug: string, projectId: string): Promise<Map<string, string[]>> => {
  const cached = cache.get(projectId);
  if (cached) return cached;
  const running = inflight.get(projectId);
  if (running) return running;

  const request = service
    .getProjectTeam(slug, projectId)
    .then((response) => {
      const byMember = new Map<string, string[]>();
      for (const row of response?.team ?? []) {
        // Roster entries with no Plane account cannot be an assignee, so they
        // have nothing to label here.
        if (!row.member_id) continue;
        const roles = (row.roles ?? []).filter(Boolean);
        if (roles.length) byMember.set(row.member_id, roles);
      }
      cache.set(projectId, byMember);
      return byMember;
    })
    .catch(() => {
      // A roster that will not load must not break the dropdown it decorates.
      const empty = new Map<string, string[]>();
      cache.set(projectId, empty);
      return empty;
    })
    .finally(() => inflight.delete(projectId));

  inflight.set(projectId, request);
  return request;
};

/** Drop the cache for one project after the roster is edited. */
export const invalidateProjectRoles = (projectId: string) => {
  cache.delete(projectId);
};

export function useProjectRoles(
  workspaceSlug: string | undefined,
  projectId: string | undefined
): Map<string, string[]> {
  const [roles, setRoles] = useState<Map<string, string[]>>(() => cache.get(projectId ?? "") ?? new Map());

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
  }, [workspaceSlug, projectId]);

  return roles;
}
