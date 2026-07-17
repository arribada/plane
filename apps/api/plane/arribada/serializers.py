# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework import serializers

from .models import ProjectSchedule


class ProjectScheduleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectSchedule
        fields = ["id", "project", "start_date", "target_date", "created_at", "updated_at"]
        read_only_fields = ["id", "project", "created_at", "updated_at"]

    def validate(self, attrs):
        # partial updates must compare against the stored value, not just the payload
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        target = attrs.get("target_date", getattr(self.instance, "target_date", None))
        if start and target and start > target:
            raise serializers.ValidationError(
                {"target_date": "Target date cannot be earlier than the start date."}
            )
        return attrs
