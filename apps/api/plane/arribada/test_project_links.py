# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Several Drive links per project, and a link that cannot run code.

TWO THINGS AT ONCE, because they are the same field.

1. `google_drive_url` was ONE column. A project's files are field data, CAD and
   the reports a funder reads — three places, three audiences — so it is a list
   now, with a label per entry because three bare Drive URLs are three
   identical-looking rows.

2. All three of these columns are `CharField`, not `URLField`, and the endpoint
   only `.strip()`ed them. `javascript:alert(1)` therefore stored cleanly and was
   rendered straight into an `href` on the Pages panel: stored XSS, one click,
   any project member as the author. The list makes that WORSE if it is not
   fixed here — twenty entries instead of one — so the scheme check applies to
   every entry, and to the repos beside them, which had the identical hole.

THE MIGRATION IS THE RISK. There are real links in production behind that
column; every project that has been set up has one. The last section of this
file runs `0041`'s data functions over real rows, forwards and backwards,
because a migration is the one piece of code that gets exactly one chance.

Run explicitly: `python -m pytest plane/arribada/test_project_links.py`
"""

import pytest
from django.urls import reverse

from plane.arribada.models import ProjectWikiDoc

# The two shapes a browser will happily execute out of an `href`. Both were
# storable before this pass.
DANGEROUS = ["javascript:alert(document.cookie)", "JavaScript:alert(1)", "data:text/html,<script>x</script>"]


@pytest.fixture
def links_url(money_project):
    return reverse(
        "arribada-project-wiki-doc",
        kwargs={"slug": money_project["slug"], "project_id": money_project["project_id"]},
    )


@pytest.fixture
def member(money_project):
    """An ordinary project member. These links are the team's, not the lead's."""
    return money_project["clients"]["member"]


# --- the scheme ---------------------------------------------------------------


@pytest.mark.parametrize("bad", DANGEROUS)
def test_a_drive_link_that_runs_code_is_refused(member, links_url, money_project, bad):
    """And is not stored, which is the part that matters.

    A 400 with the row written anyway would be the worst of both: the caller
    thinks it failed and the panel renders the payload to everyone else.
    """
    answer = member.put(links_url, {"google_drive_links": [{"url": bad, "label": "CAD"}]}, format="json")
    assert answer.status_code == 400, f"{bad!r} was accepted: {answer.status_code}"

    row = ProjectWikiDoc.objects.filter(project_id=money_project["project_id"]).first()
    assert not (row and row.google_drive_links), f"{bad!r} was stored despite the refusal"


@pytest.mark.parametrize("field", ["chat_url", "google_drive_url"])
def test_the_single_link_fields_refuse_the_same_scheme(member, links_url, field):
    """The two that stayed singular are held to the same rule.

    `chat_url` in particular: it is rendered as an `href` on the same panel, and
    it is ALSO parsed for a Zulip stream id by the reminder task, so a rubbish
    value there is two problems rather than one.
    """
    answer = member.put(links_url, {field: "javascript:alert(1)"}, format="json")
    assert answer.status_code == 400, f"{field} accepted a javascript: url"


def test_a_github_repo_that_runs_code_is_refused(member, links_url):
    """Same panel, same `href`, same hole under a different name.

    `github_repo_urls` was already a list and already unvalidated. Fixing the
    Drive links and leaving these would have moved the vulnerability one row down
    the same component.
    """
    answer = member.put(
        links_url, {"github_repo_urls": ["javascript:alert(1)"]}, format="json"
    )
    assert answer.status_code == 400


def test_an_ordinary_link_still_saves(member, links_url):
    """The half that a refuse-everything validator would pass without."""
    answer = member.put(
        links_url,
        {
            "google_drive_links": [
                {"url": "https://drive.google.com/drive/folders/abc", "label": "Field data"}
            ],
            "chat_url": "https://chat.arribada.org/#narrow/stream/23-gps",
            "github_repo_urls": ["https://github.com/arribada/linkit-v4-core"],
        },
        format="json",
    )
    assert answer.status_code == 200, answer.data
    assert answer.data["google_drive_links"] == [
        {"url": "https://drive.google.com/drive/folders/abc", "label": "Field data"}
    ]


# --- several links ------------------------------------------------------------


def test_several_drive_links_are_kept_in_order_with_their_labels(member, links_url):
    """The feature, stated: three places, three names, one project."""
    payload = [
        {"url": "https://drive.google.com/drive/folders/field", "label": "Field data"},
        {"url": "https://drive.google.com/drive/folders/cad", "label": "CAD"},
        {"url": "https://drive.google.com/drive/folders/reports", "label": "Reports"},
    ]
    answer = member.put(links_url, {"google_drive_links": payload}, format="json")
    assert answer.status_code == 200, answer.data
    assert answer.data["google_drive_links"] == payload
    assert [link["label"] for link in answer.data["google_drive_links"]] == [
        "Field data",
        "CAD",
        "Reports",
    ]


def test_the_same_link_twice_is_one_link(member, links_url):
    """Pasting a link you already added is a mistake, not a second row."""
    answer = member.put(
        links_url,
        {
            "google_drive_links": [
                {"url": "https://drive.google.com/x", "label": "One"},
                {"url": "https://drive.google.com/x", "label": "Two"},
            ]
        },
        format="json",
    )
    assert answer.status_code == 200
    assert len(answer.data["google_drive_links"]) == 1


def test_a_bare_string_is_accepted_as_an_unlabelled_link(member, links_url):
    """The old shape, and the shape of a paste. Neither should be a 400."""
    answer = member.put(
        links_url, {"google_drive_links": ["https://drive.google.com/drive/folders/abc"]}, format="json"
    )
    assert answer.status_code == 200
    assert answer.data["google_drive_links"] == [
        {"url": "https://drive.google.com/drive/folders/abc", "label": ""}
    ]


def test_editing_the_drive_link_does_not_wipe_the_wiki_link(member, links_url):
    """The partial-update promise this endpoint has always made."""
    member.put(links_url, {"doc_id": "abc123", "title": "GPS tag"}, format="json")
    answer = member.put(
        links_url, {"google_drive_links": ["https://drive.google.com/y"]}, format="json"
    )
    assert answer.status_code == 200
    assert answer.data["doc_id"] == "abc123"
    assert answer.data["title"] == "GPS tag"


# --- the old field, and the clients that still send it ------------------------


def test_the_deprecated_single_field_is_answered_from_the_list(member, links_url):
    """A client built before the list keeps seeing a Drive link.

    This fork ships its backend and its frontend as two images on two schedules —
    the web build is gated on `workflow_dispatch` and is not even in ghcr — so
    there is always a window where an old client talks to a new server. In that
    window `google_drive_url` has to keep answering, or every project appears to
    have lost its Drive folder.
    """
    member.put(
        links_url,
        {
            "google_drive_links": [
                {"url": "https://drive.google.com/first", "label": "Field data"},
                {"url": "https://drive.google.com/second", "label": "CAD"},
            ]
        },
        format="json",
    )
    read = member.get(links_url)
    assert read.status_code == 200
    assert read.data["google_drive_url"] == "https://drive.google.com/first"


def test_an_old_client_editing_the_single_field_keeps_the_links_it_cannot_see(
    member, links_url, money_project
):
    """The bug this endpoint would have had, written down before it could happen.

    An old client shows ONE Drive link and sends `google_drive_url` when it is
    edited. Reading that as "the list is now this one link" is the obvious
    implementation and it silently deletes two folders that client has never been
    able to display — the same shape as the roster bug this fork already fixed,
    where a stale tab removed people by omission.
    """
    member.put(
        links_url,
        {
            "google_drive_links": [
                {"url": "https://drive.google.com/first", "label": "Field data"},
                {"url": "https://drive.google.com/second", "label": "CAD"},
                {"url": "https://drive.google.com/third", "label": "Reports"},
            ]
        },
        format="json",
    )
    answer = member.put(
        links_url, {"google_drive_url": "https://drive.google.com/corrected"}, format="json"
    )
    assert answer.status_code == 200
    urls = [link["url"] for link in answer.data["google_drive_links"]]
    assert urls == [
        "https://drive.google.com/corrected",
        "https://drive.google.com/second",
        "https://drive.google.com/third",
    ]
    # The label on the entry it replaced survives: the old client never had one
    # to send, and dropping it would be losing information nobody asked to lose.
    assert answer.data["google_drive_links"][0]["label"] == "Field data"


# --- the migration ------------------------------------------------------------


class _RealApps:
    """`apps` as a `RunPython` receives it — near enough, and the limit is stated.

    The suite runs with `--nomigrations`, so there is no historical model
    registry to hand these functions. They get the live model instead. That is
    NOT the same thing: a historical model has only the fields that existed at
    0041, and the live one has whatever the model has now. What this proves is
    the part that can actually be wrong — the data movement, on real rows, in
    both directions. What it does not prove is that the operation list applies
    cleanly to a 0040 schema, which only a real `migrate` run can show.
    """

    @staticmethod
    def get_model(app_label, model_name):
        from django.apps import apps

        return apps.get_model(app_label, model_name)


@pytest.fixture
def migration_functions():
    """0041's two data functions, imported by file rather than by module name.

    Migration modules are not importable as attributes of a package the normal
    way — the name starts with a digit — so this goes through importlib.
    """
    import importlib

    module = importlib.import_module("plane.arribada.migrations.0041_project_wiki_doc_drive_links")
    return module.single_to_list, module.list_to_single


def test_the_migration_keeps_an_existing_single_drive_link(money_project, migration_functions):
    """The one thing this migration must not do is lose a link.

    Every project that has been set up in production has a value in this column.
    A migration that dropped it would be discovered by somebody looking for a
    folder they can no longer reach, weeks later, with no way back.
    """
    single_to_list, _reverse = migration_functions
    row = ProjectWikiDoc.objects.create(
        project_id=money_project["project_id"],
        google_drive_url="https://drive.google.com/drive/folders/real",
    )

    single_to_list(_RealApps(), None)

    row.refresh_from_db()
    assert row.google_drive_links == [
        # No label, and that is the honest answer: nobody was ever asked for one.
        {"url": "https://drive.google.com/drive/folders/real", "label": ""}
    ]
    # The column is not cleared. It is the derived mirror afterwards, and it is
    # what makes the reverse below possible.
    assert row.google_drive_url == "https://drive.google.com/drive/folders/real"


def test_the_migration_can_be_run_twice_without_duplicating(money_project, migration_functions):
    """A migration that is only correct once cannot be re-run against a restore."""
    single_to_list, _reverse = migration_functions
    ProjectWikiDoc.objects.create(
        project_id=money_project["project_id"], google_drive_url="https://drive.google.com/a"
    )
    single_to_list(_RealApps(), None)
    single_to_list(_RealApps(), None)

    row = ProjectWikiDoc.objects.get(project_id=money_project["project_id"])
    assert len(row.google_drive_links) == 1


def test_a_project_with_no_drive_link_is_left_alone(money_project, migration_functions):
    """Most rows. An empty list, not `[{"url": None}]`."""
    single_to_list, _reverse = migration_functions
    ProjectWikiDoc.objects.create(project_id=money_project["project_id"], google_drive_url=None)
    single_to_list(_RealApps(), None)

    row = ProjectWikiDoc.objects.get(project_id=money_project["project_id"])
    assert row.google_drive_links == []


def test_the_reverse_restores_the_column_for_real(money_project, migration_functions):
    """`0038` and `0014` both reverse to a no-op. This one does not.

    The case that makes it worth writing: a link ADDED or CORRECTED after the
    upgrade. A reverse that trusted the old column would roll the project back to
    the address it had in July, which is worse than failing — it looks like data.
    """
    _forward, list_to_single = migration_functions
    row = ProjectWikiDoc.objects.create(
        project_id=money_project["project_id"],
        google_drive_url="https://drive.google.com/stale",
        google_drive_links=[
            {"url": "https://drive.google.com/current", "label": "Field data"},
            {"url": "https://drive.google.com/cad", "label": "CAD"},
        ],
    )

    list_to_single(_RealApps(), None)

    row.refresh_from_db()
    assert row.google_drive_url == "https://drive.google.com/current", (
        "the reverse left the stale column value in place — which is the failure mode that "
        "looks like success"
    )
