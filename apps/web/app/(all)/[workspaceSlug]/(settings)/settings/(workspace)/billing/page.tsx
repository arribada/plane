/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Billing and plans — removed on this instance.
 *
 * The page compares Plane's paid tiers and offers to buy one. Nobody on a
 * self-hosted fork can act on that, and a settings screen that exists only to
 * advertise is a screen somebody eventually reads as an obligation.
 *
 * A redirect rather than a deleted route: the route file is upstream's, the link
 * has already been taken out of the settings navigation, and anyone reaching this
 * from a bookmark or an old tab should land somewhere useful instead of a 404.
 */
import { useEffect } from "react";
import { useParams, useNavigate } from "react-router";

export default function BillingSettingsPage() {
  const { workspaceSlug } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (workspaceSlug) navigate(`/${workspaceSlug}/settings/`, { replace: true });
  }, [workspaceSlug, navigate]);

  return null;
}
