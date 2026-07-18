# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from .views import (
    PortfolioEndpoint,
    PortfolioItemsEndpoint,
    ProjectAutoScheduleEndpoint,
    ProjectBaselineEndpoint,
    ProjectCriticalPathEndpoint,
    ProjectProgressEndpoint,
    ProjectRelationsEndpoint,
    ProjectScheduleEndpoint,
)

urlpatterns = [
    path(
        "workspaces/<str:slug>/portfolio/",
        PortfolioEndpoint.as_view(),
        name="arribada-portfolio",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/items/",
        PortfolioItemsEndpoint.as_view(),
        name="arribada-portfolio-items",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/schedule/",
        ProjectScheduleEndpoint.as_view(),
        name="arribada-project-schedule",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/relations/",
        ProjectRelationsEndpoint.as_view(),
        name="arribada-project-relations",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/progress/",
        ProjectProgressEndpoint.as_view(),
        name="arribada-project-progress",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/baseline/",
        ProjectBaselineEndpoint.as_view(),
        name="arribada-project-baseline",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/auto-schedule/",
        ProjectAutoScheduleEndpoint.as_view(),
        name="arribada-project-auto-schedule",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/critical-path/",
        ProjectCriticalPathEndpoint.as_view(),
        name="arribada-project-critical-path",
    ),
]
