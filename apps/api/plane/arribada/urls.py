# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from .views import (
    AdoptIssuesEndpoint,
    WorkloadEndpoint,
    PortfolioEndpoint,
    PortfolioItemsEndpoint,
    ProjectAffineDocEndpoint,
    ProjectAutoScheduleEndpoint,
    ProjectBaselineEndpoint,
    ProjectCriticalPathEndpoint,
    ProjectFolderAssignEndpoint,
    ProjectFolderDetailEndpoint,
    ProjectFoldersEndpoint,
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
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/affine-doc/",
        ProjectAffineDocEndpoint.as_view(),
        name="arribada-project-affine-doc",
    ),
    path(
        "workspaces/<str:slug>/adopt-issues/",
        AdoptIssuesEndpoint.as_view(),
        name="arribada-adopt-issues",
    ),
    path(
        "workspaces/<str:slug>/workload/",
        WorkloadEndpoint.as_view(),
        name="arribada-workload",
    ),
    path(
        "workspaces/<str:slug>/project-folders/",
        ProjectFoldersEndpoint.as_view(),
        name="arribada-project-folders",
    ),
    path(
        "workspaces/<str:slug>/project-folders/assign/",
        ProjectFolderAssignEndpoint.as_view(),
        name="arribada-project-folder-assign",
    ),
    path(
        "workspaces/<str:slug>/project-folders/<uuid:folder_id>/",
        ProjectFolderDetailEndpoint.as_view(),
        name="arribada-project-folder-detail",
    ),
]
