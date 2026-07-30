/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Which LLM the planning assistant talks to. The key is write-only server-side —
 * this dialog can say that one exists and where it came from, never what it is —
 * so saving sends the "__unchanged__" sentinel unless the user typed a new one.
 * Only workspace admins may save; a refusal is shown verbatim rather than hidden.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Check, KeyRound, Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@plane/utils";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import { useAiSettings } from "./use-ai-settings";

type Props = { isOpen: boolean; onClose: () => void };

const SOURCE_LABEL: Record<string, string> = {
  workspace: "workspace key",
  environment: "server environment",
  instance: "instance settings",
};

const errorMessage = (e: unknown, fallback: string) => (e as { error?: string })?.error ?? fallback;

export const AiSettingsModal = observer(function AiSettingsModal({ isOpen, onClose }: Props) {
  const { workspaceSlug } = useParams();
  const service = useMemo(() => new ArribadaService(), []);
  const { settings, loading, refresh } = useAiSettings();
  // Ties each label to its control without hard-coding ids this dialog would
  // share with the copy the plan modal and the wizard also mount.
  const uid = useId();

  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [keyMode, setKeyMode] = useState<"keep" | "replace" | "remove">("replace");
  const [keyDraft, setKeyDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const seeded = useRef(false);

  // Seed once per opening: re-seeding on every settings change would wipe the
  // draft (and the "Saved" confirmation) the moment a save refreshes the cache.
  useEffect(() => {
    if (!isOpen) {
      seeded.current = false;
      return;
    }
    if (seeded.current || !settings) return;
    seeded.current = true;
    setProvider(settings.provider || settings.default_provider || "");
    setModel(settings.model || "");
    setBaseUrl(settings.base_url || "");
    setKeyMode(settings.has_workspace_key ? "keep" : "replace");
    setKeyDraft("");
    setError(null);
    setSaved(false);
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const providers = settings?.providers ?? [];
  const defaultModel = settings?.provider_defaults?.[provider] ?? "";

  const save = async () => {
    if (!workspaceSlug || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await service.setAiSettings(workspaceSlug.toString(), {
        provider,
        model: model.trim(),
        // A base URL left over from "custom" would silently override another
        // provider's endpoint, so it only survives while custom is selected.
        base_url: provider === "custom" ? baseUrl.trim() : "",
        api_key:
          keyMode === "remove" ? "" : keyMode === "replace" && keyDraft.trim() ? keyDraft.trim() : "__unchanged__",
      });
      setKeyDraft("");
      setKeyMode(res.has_workspace_key ? "keep" : "replace");
      setSaved(true);
      refresh();
    } catch (e) {
      setError(errorMessage(e, "Could not save the assistant settings."));
    } finally {
      setSaving(false);
    }
  };

  const field =
    "w-full rounded border border-subtle bg-layer-1 px-2.5 py-1.5 text-13 text-primary outline-none focus:border-accent-strong";
  const label = "mb-1 block text-11 font-medium uppercase tracking-wide text-secondary";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40"
        onClick={saving ? undefined : onClose}
      />
      <div className="shadow-2xl relative z-10 w-full max-w-md rounded-xl border border-subtle bg-layer-1 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-16 font-semibold text-primary">
            <Sparkles className="size-4 text-secondary" />
            Planning assistant
          </h3>
          <button type="button" onClick={onClose} disabled={saving} className="text-secondary hover:text-primary">
            <X className="size-4" />
          </button>
        </div>

        {loading && !settings ? (
          <div className="flex items-center justify-center gap-2 py-10 text-13 text-secondary">
            <Loader2 className="size-4 animate-spin" /> Loading settings…
          </div>
        ) : (
          <div className="space-y-3">
            <p className="rounded bg-layer-2 px-2.5 py-1.5 text-12 text-secondary">
              {settings?.configured ? (
                <>
                  Answering with <span className="font-medium text-primary">{settings.active_model ?? "—"}</span>, using
                  the {SOURCE_LABEL[settings.source ?? ""] ?? "configured key"}.
                </>
              ) : (
                "No provider is configured yet — the assistant stays unavailable until a key is saved."
              )}
            </p>

            <div>
              <label className={label} htmlFor={`${uid}-provider`}>
                Provider
              </label>
              <select
                id={`${uid}-provider`}
                className={field}
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                {providers.length === 0 && <option value={provider}>{provider || "—"}</option>}
                {providers.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                    {p.value === settings?.default_provider ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={label} htmlFor={`${uid}-model`}>
                Model <span className="text-placeholder normal-case">(optional override)</span>
              </label>
              <input
                id={`${uid}-model`}
                className={field}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={defaultModel || "provider default"}
              />
            </div>

            {provider === "custom" && (
              <div>
                <label className={label} htmlFor={`${uid}-base-url`}>
                  Base URL
                </label>
                <input
                  id={`${uid}-base-url`}
                  className={field}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://…/v1"
                />
              </div>
            )}

            <div>
              <label className={label} htmlFor={`${uid}-api-key`}>
                API key
              </label>
              {keyMode === "keep" ? (
                <div className="flex flex-wrap items-center gap-2 rounded border border-subtle px-2.5 py-1.5">
                  <KeyRound className="size-3.5 text-secondary" />
                  <span className="text-13 text-secondary">A key is saved for this workspace</span>
                  <div className="flex-grow" />
                  <button
                    type="button"
                    onClick={() => setKeyMode("replace")}
                    className="rounded border border-subtle px-2 py-0.5 text-12 text-secondary hover:bg-layer-2"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={() => setKeyMode("remove")}
                    className="text-red-600 rounded border border-subtle px-2 py-0.5 text-12 hover:bg-layer-2"
                  >
                    Remove
                  </button>
                </div>
              ) : keyMode === "remove" ? (
                <div className="flex items-center gap-2 rounded border border-subtle px-2.5 py-1.5">
                  <span className="text-13 text-secondary">
                    The workspace key will be deleted when you save — the assistant then falls back to the server key,
                    if there is one.
                  </span>
                  <button
                    type="button"
                    onClick={() => setKeyMode("keep")}
                    className="ml-auto rounded border border-subtle px-2 py-0.5 text-12 text-secondary hover:bg-layer-2"
                  >
                    Undo
                  </button>
                </div>
              ) : (
                <>
                  <input
                    id={`${uid}-api-key`}
                    type="password"
                    className={field}
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder={settings?.has_workspace_key ? "Paste the new key" : "Paste the provider API key"}
                    autoComplete="off"
                  />
                  {settings?.has_workspace_key && (
                    <button
                      type="button"
                      onClick={() => {
                        setKeyDraft("");
                        setKeyMode("keep");
                      }}
                      className="mt-1 text-12 text-secondary hover:text-primary"
                    >
                      Keep the existing key
                    </button>
                  )}
                </>
              )}
            </div>

            {error && <p className="bg-red-500/10 text-red-600 rounded px-2.5 py-1.5 text-12">{error}</p>}
            {saved && !error && (
              <p className="flex items-center gap-1.5 text-12 text-secondary">
                <Check className="size-3.5" /> Saved.
              </p>
            )}
            <p className="text-11 text-tertiary">
              The key is stored encrypted and never sent back to the browser. Only workspace admins can change these
              settings.
            </p>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded px-3 py-1.5 text-13 text-secondary hover:bg-layer-2"
          >
            Close
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !provider}
            className={cn(
              "flex items-center gap-1.5 rounded bg-accent-primary px-3 py-1.5 text-13 font-medium text-white hover:opacity-90",
              (saving || !provider) && "opacity-50"
            )}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
});
