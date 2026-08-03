/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Everything of ours that is currently readable without a login.
 *
 * Public links have no expiry by design — a funder relationship outlasts any
 * sensible timeout, and a link that dies mid-review is worse than one that
 * lives. The cost of that choice is that nothing ever prompts anybody to revoke,
 * so an unlisted link is a link nobody remembers. This is the list that keeps
 * them accountable: one place, every workspace member, no exceptions.
 *
 * Only the project name, who published it and when — never the contents. And no
 * revoke button here on purpose: turning a link off belongs on the project,
 * where the person doing it can see what they are switching off.
 */
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { ExternalLink, Globe, X } from "lucide-react";
import { renderFormattedDate } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TWorkspacePublicTimeline } from "@/plane-web/types/arribada";

const service = new ArribadaService();

type Props = { isOpen: boolean; onClose: () => void };

export const PublishedLinksModal = observer(function PublishedLinksModal({ isOpen, onClose }: Props) {
  const { workspaceSlug } = useParams();
  const [links, setLinks] = useState<TWorkspacePublicTimeline[] | null>(null);

  const slug = workspaceSlug?.toString();

  useEffect(() => {
    if (!isOpen || !slug) return;
    let live = true;
    // Re-fetched on every open rather than cached: this list is only worth
    // anything if it is current at the moment somebody asks the question.
    setLinks(null);
    const load = async () => {
      const rows = await service.getWorkspacePublicTimelines(slug);
      if (live) setLinks(rows);
    };
    void load();
    return () => {
      live = false;
    };
  }, [isOpen, slug]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="shadow-lg relative z-10 w-full max-w-2xl rounded-lg border border-subtle bg-layer-1">
        <header className="flex items-center gap-2 border-b border-subtle px-4 py-3">
          <Globe className="size-4 text-tertiary" />
          <h2 className="flex-1 text-14 font-medium text-primary">Published outside the login</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-tertiary hover:text-primary">
            <X className="size-4" />
          </button>
        </header>

        <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
          {links === null ? (
            <p className="text-13 text-tertiary">Loading…</p>
          ) : links.length === 0 ? (
            <p className="text-13 text-tertiary">
              Nothing is published. No project schedule in this workspace can be read without an account.
            </p>
          ) : (
            <>
              <p className="mb-3 text-12 text-tertiary">
                {links.length} {links.length === 1 ? "schedule is" : "schedules are"} readable by anyone holding the
                link — no login, no expiry. Turn one off from that project&apos;s overview.
              </p>
              <ul className="divide-y divide-subtle border-t border-subtle">
                {links.map((link) => (
                  <li key={link.anchor} className="flex items-baseline gap-3 py-2">
                    <span className="flex-1 truncate text-13 text-primary">{link.project_name}</span>
                    <span className="shrink-0 text-11 text-tertiary">
                      {link.created_by_name ? `${link.created_by_name}, ` : ""}
                      {renderFormattedDate(link.created_at)}
                    </span>
                    <a
                      href={`${window.location.origin}/public/timeline/${link.anchor}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open the public page for ${link.project_name}`}
                      className="shrink-0 text-tertiary hover:text-primary"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
});
