/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Publish this project's schedule outside the login, and take it back.
 *
 * The copy here does the safety work. There is no expiry and no password: the
 * URL is the credential, so the one thing this block must never do is let
 * somebody publish without knowing exactly what leaves the login. It therefore
 * states the count of bars that go out and names what stays behind BEFORE the
 * confirm, not in a tooltip afterwards.
 */
import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Check, Copy, ExternalLink, Globe, Loader2 } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { renderFormattedDate } from "@plane/utils";
import { cn } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TPublicTimelineState } from "@/plane-web/types/arribada";

const service = new ArribadaService();

export const OverviewPublicLinkBlock = observer(function OverviewPublicLinkBlock() {
  const { workspaceSlug, projectId } = useParams();
  const [state, setState] = useState<TPublicTimelineState | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const slug = workspaceSlug?.toString();
  const pid = projectId?.toString();

  const load = async () => {
    if (!slug || !pid) return;
    try {
      setState(await service.getPublicTimelineState(slug, pid));
    } catch {
      setState(null);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, pid]);

  if (!slug || !pid || !state) return null;

  const url = state.link ? `${window.location.origin}/public/timeline/${state.link.anchor}` : null;

  const publish = async () => {
    const ok = window.confirm(
      `Publish this project's schedule?\n\n` +
        `${state.item_count} dated work ${state.item_count === 1 ? "item" : "items"} and their names become readable ` +
        `by anyone holding the link, with no login and no expiry.\n\n` +
        `Assignees, budgets, expenses, rates, estimates, descriptions and every other project stay private.\n\n` +
        `Work item names go out as written — rename anything that was written for the team rather than for a funder first.`
    );
    if (!ok) return;
    setBusy(true);
    try {
      await service.publishTimeline(slug, pid);
      await load();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Published",
        message: "Copy the link to share it. You can turn it off at any time.",
      });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't publish",
        message: (error as { error?: string })?.error ?? "Nothing was published.",
      });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    const ok = window.confirm(
      "Turn this link off?\n\nIt stops working immediately, and re-publishing later gives a different address — " +
        "the one you already sent out will stay dead.\n\nWhat people already read, they have already read."
    );
    if (!ok) return;
    setBusy(true);
    try {
      await service.revokeTimeline(slug, pid);
      await load();
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Link turned off", message: "The address no longer resolves." });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Couldn't turn it off",
        message: (error as { error?: string })?.error ?? "The link is still live.",
      });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't copy", message: "Select the address and copy it manually." });
    }
  };

  return (
    <div className="px-4 py-3">
      {!state.link ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-13 text-tertiary">
            Not published. A funder or partner who has no account can be sent a read-only view of the schedule —
            milestones and bars, nothing else.
          </p>
          {state.may_publish ? (
            <button
              type="button"
              onClick={() => void publish()}
              disabled={busy}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded border border-subtle px-2.5 py-1.5 text-12 text-secondary",
                busy ? "opacity-50" : "hover:bg-layer-2 hover:text-primary"
              )}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Globe className="size-3.5" />}
              Publish the schedule
            </button>
          ) : (
            <p className="shrink-0 text-12 text-tertiary">Only the project lead or an admin can publish it.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="bg-success-component-surface-medium flex items-center gap-1.5 rounded px-2 py-0.5 text-11 text-success-primary">
              <Globe className="size-3" />
              Live
            </span>
            <code className="min-w-0 flex-1 truncate rounded border border-subtle bg-layer-1 px-2 py-1 text-11 text-secondary">
              {url}
            </code>
            <button
              type="button"
              onClick={() => void copy()}
              aria-label="Copy the public link"
              className="rounded border border-subtle p-1.5 text-tertiary hover:text-primary"
            >
              {copied ? <Check className="size-3.5 text-success-primary" /> : <Copy className="size-3.5" />}
            </button>
            <a
              href={url ?? "#"}
              target="_blank"
              rel="noreferrer"
              aria-label="Open the public page"
              className="rounded border border-subtle p-1.5 text-tertiary hover:text-primary"
            >
              <ExternalLink className="size-3.5" />
            </a>
          </div>
          <p className="text-11 text-tertiary">
            Anyone with this address can read it — no login, no expiry. Published
            {state.link.created_by_name ? ` by ${state.link.created_by_name}` : ""}{" "}
            {renderFormattedDate(state.link.created_at)}. Showing {state.item_count} dated work{" "}
            {state.item_count === 1 ? "item" : "items"}.
          </p>
          {state.may_publish && (
            <button
              type="button"
              onClick={() => void revoke()}
              disabled={busy}
              className={cn("text-12 text-danger-primary", busy ? "opacity-50" : "hover:underline")}
            >
              Turn this link off
            </button>
          )}
        </div>
      )}
    </div>
  );
});
