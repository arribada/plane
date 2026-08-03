# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework import serializers

from .models import ProjectSchedule


class ProjectScheduleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectSchedule
        fields = [
            "id",
            "project",
            "start_date",
            "target_date",
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
            "budget_currency",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "project", "created_at", "updated_at"]

    def validate(self, attrs):
        # partial updates must compare against the stored value, not just the payload
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        target = attrs.get("target_date", getattr(self.instance, "target_date", None))
        if start and target and start > target:
            raise serializers.ValidationError(
                {"target_date": "Target date cannot be earlier than the start date."}
            )

        amount = attrs.get("budget_amount", getattr(self.instance, "budget_amount", None))
        if amount is not None and amount < 0:
            raise serializers.ValidationError({"budget_amount": "A budget cannot be negative."})
        return attrs
