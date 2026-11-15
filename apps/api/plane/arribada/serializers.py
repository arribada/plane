# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework import serializers

from .models import ProjectSchedule


# The two fields on this row that are money rather than plan.
#
# They live here because a project's allocation has nowhere else to live — the
# schedule row is the project's single settings row — and that accident put the
# budget behind the schedule's permissions instead of the budget's. The endpoint
# strips them from a read by anyone outside MONEY_ROLES and writes them only for
# the lead; the names are exported so that rule has one definition rather than a
# list repeated at each of the three places that has to know it.
MONEY_FIELDS = ("budget_amount", "budget_currency")


class ProjectScheduleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectSchedule
        fields = [
            "id",
            "project",
            "start_date",
            "target_date",
            # ARRIBADA: lifecycle status (Active/On hold/Completed/Cancelled). Writable: it is a
            # plan state a human sets, not money, so it is not in read_only_fields.
            "lifecycle_status",
            # What the project was given to spend. Null means nobody has said,
            # which the budget view reports differently from zero.
            "budget_amount",
            # Whether the reflow treats an expected delivery as a floor. Off by
            # default and per project: a planner that moved dates because of a
            # supplier's promise nobody opted into is one people stop using.
            "schedule_from_deliveries",
            # Who may change the plan. All permissive by default — see the model.
            "timeline_locked",
            "allow_edit_others",
            "allow_add_items",
            # And the one that is a permission rather than a state of the plan:
            # with it on, the plan is the lead's and the work is everyone's.
            "lead_only_edits",
            # And the one that is about a CALLER rather than a person: whether a
            # write declaring `external_source` (the wiki sync) may land here.
            # Off by default, so a project accepts nothing until its lead says so.
            "external_edits",
            "budget_currency",
            "created_at",
            "updated_at",
        ]
        # The allocation is READ-ONLY THROUGH THIS SERIALIZER, deliberately.
        #
        # It was writable, and it was the fifth door into the budget: PATCH
        # /schedule/ took `budget_amount` straight off the body, so anybody who
        # could set a project's dates could also rewrite what it had been given
        # to spend — no money role, no lead check, and none of it visible from
        # ProjectBudgetEndpoint, where all the thinking about who may touch the
        # budget had been done. Locking it here rather than in the handler means
        # the NEXT view that pipes a request body through this serializer cannot
        # reopen it. The one place that legitimately writes an allocation does so
        # explicitly, after asking the lead question — see ProjectScheduleEndpoint.
        read_only_fields = ["id", "project", "created_at", "updated_at", *MONEY_FIELDS]

    def validate(self, attrs):
        # partial updates must compare against the stored value, not just the payload
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        target = attrs.get("target_date", getattr(self.instance, "target_date", None))
        if start and target and start > target:
            raise serializers.ValidationError(
                {"target_date": "Target date cannot be earlier than the start date."}
            )

        return attrs

    # The project window is bounded the way every other plan date is.
    #
    # `_parse_date` refuses a work-item date outside [1970, now + 50 years], and
    # it does so because one row dated 9999-12-31 made two calendar walks raise
    # `OverflowError` on every request after it — a permanent 500 with no way
    # back from inside the product. This serializer took the project's own
    # `start_date` straight from DRF's DateField, which accepts any year the
    # `date` type does, and the undated-gap screen then walked from that start.
    # Same bound, same reason, asked here so the next view that pipes a body
    # through this serializer cannot reopen it.
    #
    # Imported inside the method: views.py imports this module at load, so a
    # module-level import back would be a cycle. The bound stays defined once.
    @staticmethod
    def _within_plan_window(value):
        from .views import PLAN_DATE_FLOOR, _plan_date_ceiling

        return PLAN_DATE_FLOOR <= value <= _plan_date_ceiling()

    def validate_start_date(self, value):
        if value and not self._within_plan_window(value):
            raise serializers.ValidationError("Start date is outside the plannable window.")
        return value

    def validate_target_date(self, value):
        if value and not self._within_plan_window(value):
            raise serializers.ValidationError("Target date is outside the plannable window.")
        return value
