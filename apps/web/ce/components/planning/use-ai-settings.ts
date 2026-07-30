/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The workspace's planning-assistant configuration. The plan modal, the setup
 * wizard and the settings dialog can all be on screen at once and all ask the
 * same question, so the answer is cached at module level and invalidated only
 * when someone saves new settings.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TAiSettings } from "@/plane-web/types/arribada";

let cache: { slug: string; promise: Promise<TAiSettings> } | null = null;
// Mounted hooks re-read together, so saving in one dialog updates the others.
const listeners = new Set<() => void>();

export function useAiSettings(): { settings: TAiSettings | null; loading: boolean; refresh: () => void } {
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() ?? "";
  const service = useMemo(() => new ArribadaService(), []);
  const [settings, setSettings] = useState<TAiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    const bump = () => setReloads((n) => n + 1);
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);

  useEffect(() => {
    if (!slug) {
      setLoading(false);
      return;
    }
    if (!cache || cache.slug !== slug) cache = { slug, promise: service.getAiSettings(slug) };
    const pending = cache.promise;
    let cancelled = false;
    setLoading(true);
    pending
      .then((r) => {
        if (!cancelled) setSettings(r ?? null);
        return undefined;
      })
      .catch(() => {
        // A failed lookup must not be remembered, or the UI stays broken until reload.
        if (cache?.promise === pending) cache = null;
        if (!cancelled) setSettings(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, service, reloads]);

  const refresh = useCallback(() => {
    cache = null;
    listeners.forEach((fn) => fn());
  }, []);

  return { settings, loading, refresh };
}
