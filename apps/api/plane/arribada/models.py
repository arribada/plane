# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid

from django.db import models


class ProjectSchedule(models.Model):
    """Planned start/target dates for a project.

    Upstream Plane has no project-level dates: PR #4355 added them in 2024 and the
    Community Edition later dropped them again. They are kept here, in a separate
    app with its own migration graph, rather than as fields on db.Project — so that
    upstream re-introducing Project.start_date can never collide with our schema.

    Dates are *planned* values, entered by a human. The portfolio view derives a
    second, read-only range from the project's work items (MIN start / MAX target);
    the gap between the two is what reveals drift.
    """

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    project = models.OneToOneField(
        "db.Project", on_delete=models.CASCADE, related_name="arribada_schedule"
    )
    start_date = models.DateField(null=True, blank=True)
    target_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "arribada_project_schedule"
        verbose_name = "Project schedule"
        verbose_name_plural = "Project schedules"

    def __str__(self):
        return f"{self.project_id} [{self.start_date} → {self.target_date}]"


class IssueBaseline(models.Model):
    """A frozen snapshot of an issue's planned dates, captured at a point in time.

    The gantt draws these as ghost bars behind the live bars so the drift between
    the committed plan and where things actually landed is visible. Same isolated-app
    pattern as ProjectSchedule: one row per issue, overwritten on re-capture.
    """

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    issue = models.OneToOneField(
        "db.Issue", on_delete=models.CASCADE, related_name="arribada_baseline"
    )
    start_date = models.DateField(null=True, blank=True)
    target_date = models.DateField(null=True, blank=True)
    captured_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "arribada_issue_baseline"
        verbose_name = "Issue baseline"
        verbose_name_plural = "Issue baselines"

    def __str__(self):
        return f"baseline {self.issue_id} [{self.start_date} → {self.target_date}]"


# The Colanode workspace every project doc lives in. It used to default to the
# AFFiNE workspace UUID, which no longer exists anywhere — a row created with it
# produced a deep link into a workspace the wiki has never heard of. Every existing
# row already carries this value; the default was the only place still stale.
WIKI_WORKSPACE_ID = "01ky60b09cad2nyfk7c75e6555wc"


class ProjectWikiDoc(models.Model):
    """Maps a Plane project to a doc in the self-hosted wiki (docs.arribada.org).

    The project's Pages section shows a private deep link to this doc — opened in a
    new tab where the user's own wiki session applies, so nothing is published.
    """

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    project = models.OneToOneField(
        "db.Project", on_delete=models.CASCADE, related_name="arribada_wiki_doc"
    )
    workspace_id = models.CharField(max_length=64, default=WIKI_WORKSPACE_ID)
    doc_id = models.CharField(max_length=64, null=True, blank=True)
    title = models.CharField(max_length=512, null=True, blank=True)
    # A Google Drive folder/file URL where the project's documents live — shown as a
    # reference link on the Pages view so the whole team has access, next to the wiki.
    google_drive_url = models.CharField(max_length=1024, null=True, blank=True)
    # The chat channel this project's notifications go to (link on the Pages view).
    chat_url = models.CharField(max_length=1024, null=True, blank=True)
    # GitHub repos associated with this project (a project can span several). Used both
    # as reference links on the Pages view and to route GitHub-inbox task warnings.
    github_repo_urls = models.JSONField(default=list, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "arribada_project_wiki_doc"
        verbose_name = "Project wiki doc"
        verbose_name_plural = "Project wiki docs"

    def __str__(self):
        return f"{self.project_id} -> wiki {self.doc_id}"


class ProjectFolder(models.Model):
    """A workspace-shared folder to group projects in the sidebar.

    Shared, not per-user: a project lead organizes for the whole team. Nesting via
    a self-FK. Separate from Plane's per-user favorite folders and from
    ProjectUserProperty.sort_order (which stays the flat fallback order).
    """

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="arribada_project_folders")
    name = models.CharField(max_length=255)
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.CASCADE, related_name="children")
    sort_order = models.FloatField(default=65535)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "arribada_project_folder"
        ordering = ("sort_order",)
        verbose_name = "Project folder"
        verbose_name_plural = "Project folders"

    def __str__(self):
        return self.name


class ProjectFolderItem(models.Model):
    """Membership of a project in a shared folder, with intra-folder order."""

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    folder = models.ForeignKey(ProjectFolder, on_delete=models.CASCADE, related_name="items")
    project = models.OneToOneField("db.Project", on_delete=models.CASCADE, related_name="arribada_folder_item")
    sort_order = models.FloatField(default=65535)

    class Meta:
        db_table = "arribada_project_folder_item"
        ordering = ("sort_order",)
        verbose_name = "Project folder item"
        verbose_name_plural = "Project folder items"

    def __str__(self):
        return f"{self.project_id} in {self.folder_id}"


class WorkspaceAiSettings(models.Model):
    """Which LLM the planning assistant talks to, per workspace.

    Groq is the default (the team already pays for it for the wiki) but a
    workspace can paste its own Claude or ChatGPT key here instead, so switching
    provider is a settings change rather than a redeploy. The key is stored
    encrypted with Plane's own Fernet helper and is never returned by the API —
    reads only report whether one is set.
    """

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    workspace = models.OneToOneField(
        "db.Workspace", on_delete=models.CASCADE, related_name="arribada_ai_settings"
    )
    provider = models.CharField(max_length=32, default="groq")
    # Empty means "use the provider's default" — so upgrading the default model
    # doesn't require every workspace to edit its row.
    model = models.CharField(max_length=128, blank=True, default="")
    base_url = models.CharField(max_length=512, blank=True, default="")
    encrypted_api_key = models.TextField(blank=True, default="")
    updated_by = models.ForeignKey("db.User", null=True, on_delete=models.SET_NULL, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "arribada_workspace_ai_settings"
        verbose_name = "Workspace AI settings"
        verbose_name_plural = "Workspace AI settings"

    def set_api_key(self, raw):
        from plane.license.utils.encryption import encrypt_data

        self.encrypted_api_key = encrypt_data(raw) if raw else ""

    def api_key_plain(self):
        from plane.license.utils.encryption import decrypt_data

        if not self.encrypted_api_key:
            return None
        return decrypt_data(self.encrypted_api_key) or None

    def __str__(self):
        return f"{self.workspace_id} -> {self.provider}"


# The disciplines a person can hold on a project. A suggestion list for the picker,
# deliberately NOT a validator: engineering teams invent job titles faster than anyone
# updates an enum, and a roster that refuses "acoustics" is a roster people stop filling
# in. ProjectTeamMember.roles therefore accepts any string; this only seeds the UI.
PROJECT_ROLES = [
    ("hardware engineer", "Hardware engineer"),
    ("embedded firmware", "Embedded firmware"),
    ("software", "Software"),
    ("mechanical", "Mechanical"),
    ("designer", "Designer"),
    ("data / science", "Data / science"),
    ("field ops", "Field ops"),
    ("QA / test", "QA / test"),
    ("reviewer", "Reviewer"),
    ("project manager", "Project manager"),
]

# "project lead" used to be a discipline of its own, which meant the same job could
# be recorded two ways and neither matched the other. Leading a project is not a
# discipline anyway — it is ProjectTeamMember.is_lead, a flag on the person. Kept
# here so anything still writing the old name (the wiki leader sync did) folds into
# the surviving one instead of inventing a third.
ROLE_ALIASES = {"project lead": "project manager", "project leader": "project manager"}


def canonical_role(value):
    """The surviving name for a discipline, trimmed. Unknown names pass through —
    the vocabulary is a suggestion list, not a validator."""
    role = str(value or "").strip()
    return ROLE_ALIASES.get(role.lower(), role)


class ProjectTeamMember(models.Model):
    """A person working on a project, and which disciplines they cover on it.

    Two things upstream Plane cannot express. First, ProjectMember.role is a
    *permission* level (20 admin / 15 member / 5 guest), not a job function, so there
    is nowhere to record that someone is the firmware engineer. Second, and the reason
    this is not simply an extra column on ProjectMember: a row here does not require a
    Plane account. The instance has two accounts while the real team is twenty, so a
    roster keyed on Plane users would be empty and the planning assistant would have
    nobody to reason about.

    `name` is therefore always present, `member` is filled in only when we know which
    account belongs to this person, and `email` is the key we link on later — when that
    person finally signs in, their address is what turns the row into a real user.
    """

    MANUAL = "manual"
    WIKI = "wiki"
    SOURCE_CHOICES = [(MANUAL, "Manual"), (WIKI, "Wiki")]

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    project = models.ForeignKey(
        "db.Project", on_delete=models.CASCADE, related_name="arribada_team"
    )
    member = models.ForeignKey(
        "db.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    name = models.CharField(max_length=255)
    email = models.CharField(max_length=255, blank=True, default="")
    roles = models.JSONField(default=list, blank=True)
    is_lead = models.BooleanField(default=False)

    # How much of a week this person actually gives the project. The scheduler
    # assumed five days for everyone, which is how a plan built around a
    # three-day-a-week engineer comes out nearly twice as fast as it runs.
    days_per_week = models.PositiveSmallIntegerField(default=5)

    # Leave, as [{"start": "2027-02-01", "end": "2027-02-14"}, ...]. JSON rather
    # than a table because nothing queries it: the scheduler reads the whole roster
    # into memory anyway, and a second table would buy an endpoint and a join for
    # a list that is never filtered on.
    leave = models.JSONField(default=list, blank=True)
    source = models.CharField(max_length=16, choices=SOURCE_CHOICES, default=MANUAL)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "arribada_project_team_member"
        ordering = ("-is_lead", "name")
        verbose_name = "Project team member"
        verbose_name_plural = "Project team members"
        constraints = [
            # Two partial unique indexes rather than an in-code check: the wiki cron and
            # a human editing the roster write concurrently, and only the database can
            # settle that race. The address is the identity whenever we have one; the
            # name is the fallback for the (common) roster row with no address yet.
            # Case folding is done in the callers, not here — a functional index over
            # Lower(name) cannot be expressed without a raw migration, and every write
            # path already normalises before it looks a person up.
            models.UniqueConstraint(
                fields=["project", "email"],
                condition=~models.Q(email=""),
                name="arribada_team_unique_project_email",
            ),
            models.UniqueConstraint(
                fields=["project", "name"],
                condition=models.Q(email=""),
                name="arribada_team_unique_project_name",
            ),
        ]

    def __str__(self):
        return f"{self.name} @ {self.project_id}"


class IssueRole(models.Model):
    """A discipline a work item needs, recorded independently of who holds it.

    Plane can only express "this item belongs to this account". That is unusable here:
    the instance has two accounts and the team is twenty, so nearly every item the
    planning assistant reasons about has no-one it is allowed to name, and the answer
    "firmware" — which is the useful one — had nowhere to live.

    A row is therefore the *requirement*, not the assignment. The assignment is derived:
    whoever currently holds this discipline on the project roster (ProjectTeamMember)
    and can actually be given work is added to the item's assignees. Nobody qualifying
    is the ordinary case, not an error — the requirement is still on the record, and the
    day that person gets an account the roster sync hands them the work.

    `role` is free text for the same reason ProjectTeamMember.roles is (see
    PROJECT_ROLES): a vocabulary that refuses "acoustics" is a vocabulary people route
    around. Matching against the roster is done case-insensitively by the callers.
    """

    MANUAL = "manual"
    AI = "ai"
    SOURCE_CHOICES = [(MANUAL, "Manual"), (AI, "AI")]

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    issue = models.ForeignKey(
        "db.Issue", on_delete=models.CASCADE, related_name="arribada_roles"
    )
    role = models.CharField(max_length=80)
    source = models.CharField(max_length=16, choices=SOURCE_CHOICES, default=MANUAL)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "arribada_issue_role"
        ordering = ("role",)
        verbose_name = "Issue role"
        verbose_name_plural = "Issue roles"
        constraints = [
            # A database constraint rather than a read-then-write check: the assistant
            # applying a plan and a human editing the same item are two writers, and
            # only the database can settle that race. Every writer pairs it with
            # bulk_create(ignore_conflicts=True) so the loser is a no-op, not a 500.
            models.UniqueConstraint(
                fields=["issue", "role"], name="arribada_issue_role_unique_issue_role"
            )
        ]

    def __str__(self):
        return f"{self.issue_id} needs {self.role}"


class ProjectStatusUpdate(models.Model):
    """An Asana-style status post on a project: a health signal (on track / at risk
    / off track) plus a short note, logged over time. Community Edition has no such
    concept; kept here so a project's trajectory is legible without reading the board.
    """

    ON_TRACK = "on_track"
    AT_RISK = "at_risk"
    OFF_TRACK = "off_track"
    STATUS_CHOICES = [
        (ON_TRACK, "On track"),
        (AT_RISK, "At risk"),
        (OFF_TRACK, "Off track"),
    ]

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="arribada_status_updates")
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=ON_TRACK)
    message = models.TextField(blank=True, default="")
    created_by = models.ForeignKey("db.User", null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "arribada_project_status_update"
        ordering = ("-created_at",)
        verbose_name = "Project status update"
        verbose_name_plural = "Project status updates"

    def __str__(self):
        return f"{self.project_id} {self.status} @ {self.created_at:%Y-%m-%d}"


class WorkspaceNonWorkingDay(models.Model):
    """A day nobody works: a public holiday, a company shutdown, a site closure.

    Workspace-wide rather than per project, because a holiday is a fact about the
    calendar and not about the work. Without it the scheduler counted Mon-Fri and
    nothing else, so every plan crossing Christmas or a national holiday came out
    optimistic by exactly the number of days it did not know about — the error is
    small per week and compounds over a quarter.
    """

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    workspace = models.ForeignKey(
        "db.Workspace", on_delete=models.CASCADE, related_name="arribada_non_working_days"
    )
    date = models.DateField()
    name = models.CharField(max_length=120, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "arribada_non_working_day"
        # One row per day: the same holiday entered twice is one holiday.
        unique_together = ("workspace", "date")
        ordering = ("date",)

    def __str__(self):
        return f"{self.date} {self.name}".strip()


class WorkspaceRoleRate(models.Model):
    """What an hour of a discipline costs.

    Workspace-wide, because a rate is a fact about the organisation and not about
    one project — and because entering it per project is how twenty projects end
    up with twenty different numbers for the same engineer.

    Keyed on the discipline string the roster and the task catalogue already use
    (lowercased), so a rate attaches to "hardware engineer" without a second
    vocabulary to keep in step.
    """

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    workspace = models.ForeignKey(
        "db.Workspace", on_delete=models.CASCADE, related_name="arribada_role_rates"
    )
    role = models.CharField(max_length=80)
    hourly_rate = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    # Stored per rate rather than globally: a subcontractor billed in dollars sits
    # beside a salaried engineer costed in euros, and summing them blindly would be
    # worse than showing them apart.
    currency = models.CharField(max_length=3, default="EUR")
    # A working day is not 24 hours and it is rarely 8. Per rate because a field
    # day and a bench day are not the same length.
    hours_per_day = models.DecimalField(max_digits=4, decimal_places=2, default=7)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "arribada_role_rate"
        unique_together = ("workspace", "role")
        ordering = ("role",)

    def __str__(self):
        return f"{self.role} @ {self.hourly_rate} {self.currency}/h"


class ProjectExpense(models.Model):
    """Money a project spends that is not somebody's time.

    Hardware, tooling, a field trip, shipping, a subcontracted service. Kept apart
    from the labour estimate on purpose: labour is *derived* from the plan and moves
    whenever the plan moves, while these are entered by a person and are the only
    numbers in the system somebody actually has a receipt for.

    `planned` distinguishes a budget line from a spend that happened, so a project
    can be costed before it starts and tracked against that afterwards.
    """

    HARDWARE = "hardware"
    TRAVEL = "travel"
    FIELD = "field"
    SERVICES = "services"
    SHIPPING = "shipping"
    OTHER = "other"
    CATEGORY_CHOICES = [
        (HARDWARE, "Hardware & components"),
        (TRAVEL, "Travel"),
        (FIELD, "Field trip"),
        (SERVICES, "Services & subcontracting"),
        (SHIPPING, "Shipping & customs"),
        (OTHER, "Other"),
    ]

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    project = models.ForeignKey(
        "db.Project", on_delete=models.CASCADE, related_name="arribada_expenses"
    )
    category = models.CharField(max_length=16, choices=CATEGORY_CHOICES, default=OTHER)
    label = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    currency = models.CharField(max_length=3, default="EUR")
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=1)
    # True = budgeted, not yet spent. False = it happened.
    planned = models.BooleanField(default=True)
    incurred_on = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        "db.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "arribada_project_expense"
        ordering = ("-incurred_on", "-created_at")
        indexes = [models.Index(fields=["project", "planned"])]

    @property
    def total(self):
        """Line total. Quantity defaults to 1, so a one-off is just its amount."""
        return self.amount * self.quantity

    def __str__(self):
        return f"{self.label} {self.total} {self.currency}"
