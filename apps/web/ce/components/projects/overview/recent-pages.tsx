/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The project's own Plane pages, under the links panel — notes and management
 * scratch work, as opposed to the wiki, which is where documentation lives.
 */
import { observer } from "mobx-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FileText } from "lucide-react";
import type { TProjectOverview } from "@/plane-web/types/arribada";

type Props = { pages: TProjectOverview["pages"] };

export const OverviewRecentPages = observer(function OverviewRecentPages({ pages }: Props) {
  const { workspaceSlug, projectId } = useParams();
  const base = `/${workspaceSlug}/projects/${projectId}`;

  return (
    <div className="px-4 py-3">
      {pages.recent.length === 0 ? (
        <p className="text-13 text-tertiary">
          No pages yet. Project documentation belongs in the wiki above — these are for ad-hoc notes.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {pages.recent.slice(0, 5).map((p) => (
            <li key={p.id}>
              <Link
                href={`${base}/pages/${p.id}`}
                className="flex items-center gap-2 text-13 text-primary hover:text-accent-primary"
              >
                <FileText className="size-3.5 flex-shrink-0 text-tertiary" />
                <span className="truncate">{p.name || "Untitled"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link href={`${base}/pages`} className="mt-2 inline-block text-12 text-accent-primary hover:underline">
        All pages
      </Link>
    </div>
  );
});
