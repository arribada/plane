/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Who is on this project and what each of them does. Plane's project members
 * are a permission list (admin / member / guest), never a job function, and
 * most of the people who actually build a tracker have no Plane account at all
 * — so the roster lives beside Plane's membership rather than inside it, and a
 * person with no account is a normal entry here, not a broken one.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Check, Crown, Loader2, Pencil, Plus, Trash2, UserPlus, X } from "lucide-react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EUserProjectRoles } from "@plane/types";
import { Avatar } from "@plane/ui";
import { cn, getFileURL } from "@plane/utils";
import { useMember } from "@/hooks/store/use-member";
import { ArribadaService } from "@/plane-web/services/arribada.service";
import type { TTeamMember } from "@/plane-web/types/arribada";

type TRole = { value: string; label: string };

// The editor must stay usable even when the vocabulary call is still in flight
// or has failed — these are only a starting point, the server list wins as soon
// as it lands and any typed role is accepted anyway.
const FALLBACK_ROLES: TRole[] = [
  { value: "hardware", label: "Hardware engineer" },
  { value: "firmware", label: "Embedded firmware engineer" },
  { value: "software", label: "Software engineer" },
  { value: "design", label: "Designer" },
  { value: "review", label: "Reviewer" },
  { value: "pm", label: "Project manager" },
];

const CHIP = "inline-flex max-w-full items-center gap-1.5 rounded-full border border-subtle px-2.5 py-1 text-12";
const INPUT =
  "w-full rounded border border-subtle bg-layer-2 px-2 py-1 text-13 text-primary outline-none focus:border-accent-strong";

// A row being edited; `id` is absent until the roster has been saved once.
type TDraftRow = {
  key: string;
  id?: string;
  member_id: string | null;
  name: string;
  email: string;
  roles: string[];
  is_lead: boolean;
  in_plane: boolean;
  assignable: boolean;
};

// A Plane project member who could be put on the roster in one click.
type TPlaneCandidate = { id: string; name: string; email: string; avatar?: string; assignable: boolean };

// What the PUT carries: the whole roster, as people rather than as memberships.
type TPayloadRow = {
  id?: string;
  member_id?: string;
  name: string;
  email: string;
  roles: string[];
  is_lead: boolean;
};

const toDraft = (m: TTeamMember, key: string): TDraftRow => ({
  key,
  id: m.id,
  member_id: m.member_id,
  name: m.name,
  email: m.email ?? "",
  roles: m.roles ?? [],
  is_lead: m.is_lead,
  in_plane: m.in_plane,
  assignable: m.assignable,
});

// "firmware_engineer" reads as "Firmware engineer" when the vocabulary hasn't
// been fetched — the read view is rendered from the overview payload alone.
const humanize = (value: string) =>
  value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());

const noteFor = (row: { in_plane: boolean; assignable: boolean }): string | null => {
  if (!row.in_plane) return "Not in Plane yet";
  if (!row.assignable) return "Cannot be assigned — not a project member";
  return null;
};

export const OverviewTeamBlock = observer(function OverviewTeamBlock({
  projectId,
  team,
  onSaved,
}: {
  projectId: string;
  team: TTeamMember[];
  onSaved?: () => void;
}) {
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString();
  const uid = useId();
  const service = useMemo(() => new ArribadaService(), []);
  const {
    project: { getProjectMemberIds, getProjectMemberDetails },
  } = useMember();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TDraftRow[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});
  const [vocabulary, setVocabulary] = useState<TRole[]>([]);
  const [vocabLoading, setVocabLoading] = useState(false);
  const [staleRoster, setStaleRoster] = useState(false);
  const [saving, setSaving] = useState(false);
  // The saved roster outranks the overview payload until the parent refetch
  // lands, so the block never shows what the user just replaced.
  const [override, setOverride] = useState<TTeamMember[] | null>(null);
  // A refetch must not overwrite what someone has already typed.
  const touched = useRef(false);
  const keySeq = useRef(0);

  const newKey = useCallback(() => {
    keySeq.current += 1;
    return `row-${keySeq.current}`;
  }, []);

  useEffect(() => setOverride(null), [team]);

  const roster = override ?? team ?? [];
  const vocab = vocabulary.length > 0 ? vocabulary : FALLBACK_ROLES;

  const roleLabel = useCallback(
    (value: string) => {
      const hit = vocabulary.find((o) => o.value === value) ?? FALLBACK_ROLES.find((o) => o.value === value);
      return hit ? hit.label : humanize(value);
    },
    [vocabulary]
  );

  // The vocabulary is only worth a round trip once someone actually edits, and
  // the same call returns the roster the server currently holds — which is what
  // a full-replace PUT has to be built from.
  useEffect(() => {
    let cancelled = false;
    if (editing && slug && projectId) {
      setVocabLoading(true);
      setStaleRoster(false);
      service
        .getProjectTeam(slug, projectId)
        .then((r) => {
          if (cancelled) return undefined;
          setVocabulary(r.roles_vocabulary ?? []);
          if (!touched.current) setDraft((r.team ?? []).map((m) => toDraft(m, m.id)));
          setVocabLoading(false);
          return undefined;
        })
        .catch(() => {
          if (cancelled) return;
          setStaleRoster(true);
          setVocabLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [editing, slug, projectId, service]);

  const openEditor = () => {
    touched.current = false;
    setRoleDrafts({});
    setDraft(roster.map((m) => toDraft(m, m.id)));
    setEditing(true);
  };

  const mutate = (fn: (rows: TDraftRow[]) => TDraftRow[]) => {
    touched.current = true;
    setDraft(fn);
  };

  const addBlankRow = () => {
    const key = newKey();
    mutate((rows) => [
      ...rows,
      { key, member_id: null, name: "", email: "", roles: [], is_lead: false, in_plane: false, assignable: false },
    ]);
  };

  const planeMemberToDraft = (member: TPlaneCandidate): TDraftRow => ({
    key: newKey(),
    member_id: member.id,
    name: member.name,
    email: member.email,
    roles: [],
    is_lead: false,
    in_plane: true,
    assignable: member.assignable,
  });

  const addPlaneMember = (member: TPlaneCandidate) => mutate((rows) => [...rows, planeMemberToDraft(member)]);

  // From the read view: the people are already on the row, the editor only has
  // to say what each of them does.
  const openEditorWith = (members: TPlaneCandidate[]) => {
    touched.current = true;
    setRoleDrafts({});
    setDraft([...roster.map((m) => toDraft(m, m.id)), ...members.map((m) => planeMemberToDraft(m))]);
    setEditing(true);
  };

  // Typing "Designer" must land on the same role the suggestion chip adds.
  const normalizeRole = (raw: string) => {
    const typed = raw.trim();
    if (!typed) return "";
    const hit = vocab.find((o) => o.label.toLowerCase() === typed.toLowerCase() || o.value === typed);
    return hit ? hit.value : typed;
  };

  const addRole = (key: string, raw: string) => {
    const value = normalizeRole(raw);
    if (!value) return;
    mutate((rows) =>
      rows.map((r) =>
        r.key === key && !r.roles.some((x) => x.toLowerCase() === value.toLowerCase())
          ? { ...r, roles: [...r.roles, value] }
          : r
      )
    );
    setRoleDrafts((d) => ({ ...d, [key]: "" }));
  };

  const removeRole = (key: string, value: string) =>
    mutate((rows) => rows.map((r) => (r.key === key ? { ...r, roles: r.roles.filter((x) => x !== value) } : r)));

  // One lead at a time; clicking the current lead clears it rather than trapping
  // a project that genuinely has no lead named yet.
  const toggleLead = (key: string) =>
    mutate((rows) => rows.map((r) => ({ ...r, is_lead: r.key === key ? !r.is_lead : false })));

  const save = async () => {
    if (!slug || saving) return;
    const payload: TPayloadRow[] = draft
      .filter((r) => r.name.trim().length > 0)
      .map((r) => {
        // A role still sitting in its input when Save is pressed was meant to
        // count — the click beats the blur that would have added it.
        const pending = normalizeRole(roleDrafts[r.key] ?? "");
        const roles =
          pending && !r.roles.some((x) => x.toLowerCase() === pending.toLowerCase()) ? [...r.roles, pending] : r.roles;
        const row: TPayloadRow = {
          name: r.name.trim(),
          email: r.email.trim(),
          roles,
          is_lead: r.is_lead,
        };
        if (r.id) row.id = r.id;
        if (r.member_id) row.member_id = r.member_id;
        return row;
      });

    setSaving(true);
    try {
      const r = await service.setProjectTeam(slug, projectId, payload);
      setOverride(r.team ?? []);
      if (r.roles_vocabulary?.length) setVocabulary(r.roles_vocabulary);
      setEditing(false);
      onSaved?.();
    } catch {
      // The editor stays open so nothing typed is lost with the error.
      setToast({ type: TOAST_TYPE.ERROR, title: "Couldn't save the team", message: "Please try again." });
    } finally {
      setSaving(false);
    }
  };

  const avatarFor = (memberId: string | null) => {
    if (!memberId) return undefined;
    const details = getProjectMemberDetails(memberId, projectId);
    return details?.member?.avatar_url ? getFileURL(details.member.avatar_url) : undefined;
  };

  // Read straight from the store rather than through useMemo: these are mobx
  // observables and a memo would keep serving the list from before the fetch.
  const planeMembersMissingFrom = (rows: { member_id: string | null; email: string }[]) => {
    const ids = getProjectMemberIds(projectId, true) ?? [];
    const takenIds = new Set(rows.map((r) => r.member_id).filter(Boolean));
    const takenEmails = new Set(rows.map((r) => (r.email ?? "").trim().toLowerCase()).filter(Boolean));
    return ids
      .map((id) => getProjectMemberDetails(id, projectId))
      .filter((d): d is NonNullable<typeof d> => !!d)
      .filter((d) => !d.member.is_bot && !takenIds.has(d.member.id))
      .map((d) => {
        const member = d.member;
        const email = member.email ?? "";
        return {
          id: member.id,
          name: member.display_name || [member.first_name, member.last_name].filter(Boolean).join(" ") || email,
          email,
          avatar: getFileURL(member.avatar_url),
          // ProjectMember.role is a permission level, and Plane only accepts an
          // assignee from member level up.
          assignable: Number(d.role) >= Number(EUserProjectRoles.MEMBER),
        };
      })
      .filter((m) => m.name.length > 0 && !takenEmails.has(m.email.trim().toLowerCase()));
  };

  const planeSuggestions = editing ? planeMembersMissingFrom(draft) : [];
  const missingFromRoster = editing || roster.length === 0 ? [] : planeMembersMissingFrom(roster);

  const leadName = roster.find((m) => m.is_lead)?.name ?? null;

  return (
    <div className="overflow-hidden rounded-lg border border-subtle bg-layer-1">
      <div className="flex items-center justify-between border-b border-subtle px-3 py-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-13 font-semibold text-primary">Team & roles</h2>
          <span className="truncate text-12 text-tertiary">
            {roster.length === 0 ? "Nobody listed" : `${roster.length} ${roster.length === 1 ? "person" : "people"}`}
            {leadName ? ` · Lead: ${leadName}` : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={() => (editing ? setEditing(false) : openEditor())}
          className="flex flex-shrink-0 items-center gap-1 rounded border border-subtle px-2 py-1 text-12 text-secondary hover:bg-layer-2"
        >
          {editing ? <X className="size-3" /> : <Pencil className="size-3" />}
          {editing ? "Cancel" : "Edit team"}
        </button>
      </div>

      {!editing && roster.length === 0 && (
        <div className="flex flex-wrap items-center gap-3 px-3 py-3">
          <p className="text-13 text-tertiary">
            No one is listed on this project yet — say who works on it and what each of them does.
          </p>
          <button
            type="button"
            onClick={openEditor}
            className="flex items-center gap-1.5 rounded border border-subtle px-2.5 py-1 text-12 text-secondary hover:bg-layer-2"
          >
            <UserPlus className="size-3.5" />
            Add people
          </button>
        </div>
      )}

      {!editing && roster.length > 0 && (
        <ul>
          {roster.map((m) => {
            const note = noteFor(m);
            const roles = m.roles ?? [];
            return (
              <li key={m.id} className="flex items-start gap-2.5 border-b border-subtle px-3 py-2.5 last:border-b-0">
                <span className="flex-shrink-0 pt-0.5">
                  <Avatar name={m.name} src={avatarFor(m.member_id)} size="base" showTooltip={false} />
                </span>
                <div className="min-w-0 flex-grow">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-13 font-medium text-primary">{m.name}</span>
                    {m.is_lead && (
                      <span className={cn(CHIP, "border-accent-strong text-accent-primary")}>
                        <Crown className="size-3" />
                        Lead
                      </span>
                    )}
                    {roles.length === 0 ? (
                      <span className="text-12 text-tertiary">No role set</span>
                    ) : (
                      roles.map((r) => (
                        <span key={r} className={cn(CHIP, "text-secondary")}>
                          {roleLabel(r)}
                        </span>
                      ))
                    )}
                  </div>
                  {(note || m.email) && (
                    <p className="mt-1 truncate text-11 text-tertiary">
                      {m.email}
                      {m.email && note ? " · " : ""}
                      {note}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {missingFromRoster.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-subtle px-3 py-2">
          <span className="text-11 text-tertiary">
            {missingFromRoster.length === 1
              ? "1 Plane member of this project isn't on the roster"
              : `${missingFromRoster.length} Plane members of this project aren't on the roster`}
          </span>
          <button
            type="button"
            onClick={() => openEditorWith(missingFromRoster)}
            className="flex items-center gap-1.5 rounded border border-subtle px-2 py-1 text-11 text-secondary hover:bg-layer-2"
          >
            <UserPlus className="size-3" />
            Add {missingFromRoster.map((m) => m.name).join(", ")}
          </button>
        </div>
      )}

      {editing && (
        <div className="flex flex-col gap-3 px-3 py-3">
          {staleRoster && (
            <p className="text-12 text-tertiary">
              Couldn&apos;t re-read the roster from the server — saving will replace it with what is on screen.
            </p>
          )}

          <datalist id={`${uid}-roles`}>
            {vocab.map((r) => (
              <option key={r.value} value={r.label} />
            ))}
          </datalist>

          {draft.length === 0 && !vocabLoading && (
            <p className="text-13 text-tertiary">Nobody on the roster yet. Add a person below.</p>
          )}

          {draft.map((row) => {
            const note = row.id ? noteFor(row) : null;
            const unused = vocab.filter((o) => !row.roles.some((r) => r.toLowerCase() === o.value.toLowerCase()));
            return (
              <div key={row.key} className="flex flex-col gap-2 rounded border border-subtle px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex-shrink-0">
                    <Avatar name={row.name || "?"} src={avatarFor(row.member_id)} size="base" showTooltip={false} />
                  </span>
                  <input
                    value={row.name}
                    onChange={(e) =>
                      mutate((rows) => rows.map((r) => (r.key === row.key ? { ...r, name: e.target.value } : r)))
                    }
                    placeholder="Name"
                    aria-label="Name"
                    className={cn(INPUT, "min-w-32 flex-1")}
                  />
                  <input
                    value={row.email}
                    onChange={(e) =>
                      mutate((rows) => rows.map((r) => (r.key === row.key ? { ...r, email: e.target.value } : r)))
                    }
                    placeholder="Email (optional)"
                    aria-label="Email"
                    className={cn(INPUT, "min-w-32 flex-1")}
                  />
                  <button
                    type="button"
                    onClick={() => toggleLead(row.key)}
                    className={cn(
                      CHIP,
                      "flex-shrink-0",
                      row.is_lead ? "border-accent-strong text-accent-primary" : "text-tertiary hover:bg-layer-2"
                    )}
                  >
                    <Crown className="size-3" />
                    Lead
                  </button>
                  <button
                    type="button"
                    onClick={() => mutate((rows) => rows.filter((r) => r.key !== row.key))}
                    aria-label={`Remove ${row.name || "this person"}`}
                    className="flex-shrink-0 rounded border border-subtle p-1.5 text-tertiary hover:bg-layer-2 hover:text-primary"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {row.roles.map((r) => (
                    <span key={r} className={cn(CHIP, "text-secondary")}>
                      {roleLabel(r)}
                      <button
                        type="button"
                        onClick={() => removeRole(row.key, r)}
                        aria-label={`Remove role ${roleLabel(r)}`}
                        className="text-tertiary hover:text-primary"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  {unused.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => addRole(row.key, o.value)}
                      className={cn(CHIP, "border-dashed text-tertiary hover:bg-layer-2 hover:text-primary")}
                    >
                      <Plus className="size-3" />
                      {o.label}
                    </button>
                  ))}
                  <input
                    value={roleDrafts[row.key] ?? ""}
                    onChange={(e) => setRoleDrafts((d) => ({ ...d, [row.key]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addRole(row.key, roleDrafts[row.key] ?? "");
                      }
                    }}
                    onBlur={() => addRole(row.key, roleDrafts[row.key] ?? "")}
                    list={`${uid}-roles`}
                    placeholder="Other role…"
                    aria-label="Add a role"
                    className={cn(INPUT, "w-40")}
                  />
                </div>

                {(note || !row.name.trim()) && (
                  <p className="text-11 text-tertiary">{row.name.trim() ? note : "Needs a name to be saved"}</p>
                )}
              </div>
            );
          })}

          {/* Members of this project first: picking one links a real account, which
              is what lets work actually be assigned. Someone with no Plane account
              is a normal roster entry too — just the second choice, not the first. */}
          {planeSuggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-subtle pt-3">
              <span className="text-11 font-medium tracking-wide text-secondary uppercase">
                Members of this project
              </span>
              {planeSuggestions.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => addPlaneMember(m)}
                  title={[m.email, m.assignable ? "" : "guest — cannot be assigned work"].filter(Boolean).join(" · ")}
                  className={cn(CHIP, "text-secondary hover:bg-layer-2")}
                >
                  <Avatar name={m.name} src={m.avatar} size="sm" showTooltip={false} />
                  <span className="truncate">{m.name}</span>
                  <Plus className="size-3 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-subtle pt-3">
            <span className="text-11 font-medium tracking-wide text-secondary uppercase">Not in Plane</span>
            <button
              type="button"
              onClick={addBlankRow}
              className="flex items-center gap-1.5 rounded border border-subtle px-2.5 py-1 text-12 text-secondary hover:bg-layer-2"
            >
              <Plus className="size-3.5" />
              Add someone by name
            </button>
            {vocabLoading && (
              <span className="flex items-center gap-1.5 text-12 text-tertiary">
                <Loader2 className="size-3.5 animate-spin" />
                Reading the roster…
              </span>
            )}
          </div>

          <div>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 rounded bg-accent-primary px-3 py-1.5 text-13 font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              <Check className="size-3.5" />
              {saving ? "Saving…" : "Save team"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
