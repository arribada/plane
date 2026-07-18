# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from .views import (
    PortfolioEndpoint,
    PortfolioItemsEndpoint,
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
]
