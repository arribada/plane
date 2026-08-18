/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { useSearchParams } from "next/navigation";
import { API_BASE_URL } from "@plane/constants";
import type { TOAuthConfigs, TOAuthOption } from "@plane/types";
// assets
// ARRIBADA: the "GitLab" provider IS our device dashboard (GITLAB_HOST=devices.arribada.org),
// so it is surfaced and branded as "Arribada", not GitLab. Google is kept (same accounts as
// the dashboard). GitHub and Gitea buttons are dropped — the team signs in through the
// Arribada dashboard, Google, or email/password only.
import arribadaLogo from "@/app/assets/favicon/arribada-favicon.svg?url";
import googleLogo from "@/app/assets/logos/google-logo.svg?url";
// hooks
import { useInstance } from "@/hooks/store/use-instance";

export const useCoreOAuthConfig = (oauthActionText: string): TOAuthConfigs => {
  //router
  const searchParams = useSearchParams();
  // query params
  const next_path = searchParams.get("next_path");
  // store hooks
  const { config } = useInstance();
  // derived values
  // ARRIBADA: only the two providers we surface — the Arribada dashboard SSO
  // (is_gitlab_enabled, GITLAB_HOST=devices.arribada.org) and Google.
  const isOAuthEnabled = (config && (config?.is_google_enabled || config?.is_gitlab_enabled)) || false;
  const oAuthOptions: TOAuthOption[] = [
    {
      // The id stays "gitlab" because the endpoint is /auth/gitlab/ — but it resolves to the
      // Arribada device dashboard (GITLAB_HOST), so it is labelled and iconed as Arribada.
      id: "gitlab",
      text: `${oauthActionText} with Arribada`,
      icon: <img src={arribadaLogo} height={18} width={18} alt="Arribada" />,
      onClick: () => {
        window.location.assign(`${API_BASE_URL}/auth/gitlab/${next_path ? `?next_path=${next_path}` : ``}`);
      },
      enabled: config?.is_gitlab_enabled,
    },
    {
      id: "google",
      text: `${oauthActionText} with Google`,
      icon: <img src={googleLogo} height={18} width={18} alt="Google Logo" />,
      onClick: () => {
        window.location.assign(`${API_BASE_URL}/auth/google/${next_path ? `?next_path=${next_path}` : ``}`);
      },
      enabled: config?.is_google_enabled,
    },
  ];

  return {
    isOAuthEnabled,
    oAuthOptions,
  };
};
