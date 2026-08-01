/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { PageHead } from "@/components/core/page-title";
import { MyTimelineRoot } from "@/plane-web/components/profile/my-timeline-root";

// A static sibling of [profileViewId]/, exactly like activity/: that page only knows
// assigned/created/subscribed and renders null for anything else, so a tab it does not
// recognise has to be its own route or it would come up blank.
// The profile layout already provides the AppHeader and ContentWrapper.
function ProfileTimelinePage() {
  return (
    <>
      <PageHead title="Profile - Timeline" />
      <div className="relative h-full w-full overflow-hidden">
        <MyTimelineRoot />
      </div>
    </>
  );
}

export default observer(ProfileTimelinePage);
