/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { Clock } from "lucide-react";
// plane imports
import { Avatar, Row } from "@plane/ui";
import { cn, calculateTimeAgo, renderFormattedDate, renderFormattedTime, getFileURL } from "@plane/utils";
// hooks
import { useWorkspaceNotifications } from "@/hooks/store/notifications";
import { useNotification } from "@/hooks/store/notifications/use-notification";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useWorkspace } from "@/hooks/store/use-workspace";
// local imports
import { NotificationContent } from "./content";
import { NotificationOption } from "./options";

type TNotificationItem = {
  workspaceSlug: string;
  notificationId: string;
};

export const NotificationItem = observer(function NotificationItem(props: TNotificationItem) {
  const { workspaceSlug, notificationId } = props;
  // hooks
  const { currentSelectedNotificationId, setCurrentSelectedNotificationId } = useWorkspaceNotifications();
  const { asJson: notification, markNotificationAsRead } = useNotification(notificationId);
  const { getIsIssuePeeked, setPeekIssue } = useIssueDetail();
  const { getWorkspaceBySlug } = useWorkspace();
  // states
  const [isSnoozeStateModalOpen, setIsSnoozeStateModalOpen] = useState(false);
  const [customSnoozeModal, setCustomSnoozeModal] = useState(false);

  // derived values
  const projectId = notification?.project || undefined;
  const issueId = notification?.data?.issue?.id || undefined;
  const workspace = getWorkspaceBySlug(workspaceSlug);

  const notificationIssue = notification?.data?.issue;
  const notificationField = notification?.data?.issue_activity?.field || undefined;
  // Whether there is anything at all to render. A notification sent by something
  // other than the issue-activity pipeline — the fork's own deadline reminders,
  // for one — carries no `data`, so the field is absent and this component used
  // to hard-return an empty fragment. The row rendered as nothing while the bell
  // still counted it, and a count that cannot be cleared by clicking teaches
  // people to dismiss the whole inbox.
  const hasBody = !!notificationField || !!notification?.title || !!notification?.message_html;
  const notificationTriggeredBy = notification.triggered_by_details || undefined;

  /**
   * Clicking a notification does three things, and they used to be one `if`.
   *
   * The guard required `projectId && issueId`, and `issueId` is
   * `data.issue.id` — a field no notification this fork raises has ever
   * carried. So a click on an overdue reminder or a GitHub triage warning did
   * nothing at all: it did not select the row, it did not open the pane, and it
   * did not mark the thing read. The badge counted notifications that could not
   * be cleared by reading them, which is what teaches people to mark the whole
   * inbox read without looking.
   *
   * Selecting and marking read are true of every notification. Only the PEEK —
   * opening a work item in place — needs a work item to open, so only the peek
   * is still gated on one. When there is nothing to peek, the pane falls to this
   * fork's own detail panel, which renders what the notification actually holds.
   */
  const handleNotificationClick = async () => {
    if (!workspaceSlug || isSnoozeStateModalOpen || customSnoozeModal) return;

    setPeekIssue(undefined);
    setCurrentSelectedNotificationId(notificationId);

    // mark the notification as read
    if (notification.read_at === null) {
      try {
        await markNotificationAsRead(workspaceSlug);
      } catch (error) {
        console.error(error);
      }
    }

    if (projectId && issueId && notification?.is_inbox_issue === false && !getIsIssuePeeked(issueId)) {
      setPeekIssue({ workspaceSlug, projectId, issueId });
    }
  };

  // `projectId` is deliberately NOT required here. Both GitHub triage
  // notifications are raised with `project=None` — there is no project yet, that
  // is the entire complaint — and this returned an empty fragment for them, so
  // they rendered as nothing while still counting toward the unread badge.
  if (!workspaceSlug || !notificationId || !notification?.id || !hasBody || !workspace?.id) return <></>;

  return (
    <Row
      className={cn(
        "group relative flex cursor-pointer items-center gap-2 border-b border-subtle py-4 transition-all",
        {
          "bg-layer-1/30": currentSelectedNotificationId === notification?.id,
          "bg-accent-primary/5": notification.read_at === null,
        }
      )}
      onClick={handleNotificationClick}
    >
      {notification.read_at === null && (
        <div className="absolute top-[50%] left-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-primary" />
      )}

      <div className="relative flex w-full gap-2">
        <div className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-layer-1">
          {notificationTriggeredBy && (
            <Avatar
              name={notificationTriggeredBy.display_name || notificationTriggeredBy?.first_name}
              src={getFileURL(notificationTriggeredBy.avatar_url)}
              size={42}
              shape="circle"
              className="bg-layer-1 text-body-sm-medium"
            />
          )}
        </div>

        <div className="-mt-2 w-full space-y-1">
          <div className="relative flex h-8 items-center gap-3">
            <div className="line-clamp-1 w-full truncate overflow-hidden text-body-xs-medium break-all whitespace-normal text-primary">
              <NotificationContent
                notification={notification}
                workspaceId={workspace.id}
                workspaceSlug={workspaceSlug}
                projectId={projectId ?? ""}
              />
            </div>
            <NotificationOption
              workspaceSlug={workspaceSlug}
              notificationId={notification?.id}
              isSnoozeStateModalOpen={isSnoozeStateModalOpen}
              setIsSnoozeStateModalOpen={setIsSnoozeStateModalOpen}
              customSnoozeModal={customSnoozeModal}
              setCustomSnoozeModal={setCustomSnoozeModal}
            />
          </div>

          <div className="relative flex items-center gap-3 text-caption-sm-regular text-secondary">
            {/* Both halves are conditional. This line used to interpolate
                `identifier`-`sequence_id` unconditionally, so a notification with
                no `data` — every one this fork raises — rendered its subtitle as
                a bare hyphen under the title. */}
            <div className="line-clamp-1 w-full truncate overflow-hidden break-words whitespace-normal">
              {notificationIssue?.identifier && notificationIssue?.sequence_id !== undefined && (
                <>
                  {notificationIssue.identifier}-{notificationIssue.sequence_id}&nbsp;
                </>
              )}
              {notificationIssue?.name}
            </div>
            <div className="flex-shrink-0">
              {notification?.snoozed_till ? (
                <p className="flex flex-shrink-0 items-center justify-end gap-x-1 text-tertiary">
                  <Clock className="h-4 w-4" />
                  <span>
                    Till {renderFormattedDate(notification.snoozed_till)},&nbsp;
                    {renderFormattedTime(notification.snoozed_till, "12-hour")}
                  </span>
                </p>
              ) : (
                <p className="mt-auto flex-shrink-0 text-tertiary">
                  {notification.created_at && calculateTimeAgo(notification.created_at)}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </Row>
  );
});
