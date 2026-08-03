/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Deliberately bare: no DefaultLayout and no AuthenticationWrapper. The wrapper
 * used by sign-up redirects users who ARE signed in, which would send the
 * project lead checking their own published page back to their dashboard.
 */

import { PublicTimelineRoot } from "@/plane-web/components/public-timeline/root";

export default function PublicTimelinePage() {
  return <PublicTimelineRoot />;
}
