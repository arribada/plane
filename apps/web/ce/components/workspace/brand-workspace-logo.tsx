/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
// components
import { WorkspaceLogo } from "@/components/workspace/logo";

type Props = {
  logo: string | null | undefined;
  name: string | undefined;
  classNames?: string;
};

/**
 * Lives in apps/web/public, so it is served from the site root. The app has no
 * router basename (see react-router.config.ts), which makes the absolute path
 * safe.
 */
const ARRIBADA_MARK_URL = "/arribada-mark.svg";

/**
 * The workspace logo as shown in the app header.
 *
 * Identical to {@link WorkspaceLogo} except for the empty case: upstream falls
 * back to the first letter of the workspace name on an accent-coloured tile,
 * which is why this instance has been showing a bare "A". Here that fallback is
 * the Arribada mark instead.
 *
 * A workspace that has actually uploaded a logo still wins — this replaces the
 * fallback, never a real choice. That is also why only the header uses it: the
 * workspace switcher, the invitations list and the power-k menu enumerate
 * *other* workspaces, and there the initial letter is the thing that tells them
 * apart.
 */
export function BrandWorkspaceLogo(props: Props) {
  const { t } = useTranslation();

  if (props.logo) return <WorkspaceLogo {...props} />;

  return (
    <div
      className={cn(
        "relative grid h-6 w-6 flex-shrink-0 place-items-center overflow-hidden rounded-md",
        props.classNames
      )}
    >
      {/* object-contain, not object-cover: the mark is square and must never be
          cropped or stretched if it is ever handed a non-square box. */}
      <img
        src={ARRIBADA_MARK_URL}
        alt={t("aria_labels.projects_sidebar.workspace_logo")}
        className="absolute top-0 left-0 h-full w-full object-contain"
        draggable={false}
      />
    </div>
  );
}
