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

    # What this project has been given to spend. Null means nobody has said — which
    # is different from zero, and the difference matters: a project with no budget
    # recorded should not be reported as 100% over.
    #
    # Beside the dates rather than in its own table because it is the same kind of
    # fact: a planned figure a human entered, against which the derived numbers are
    # read. The dates say when, this says how much.
    budget_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    budget_currency = models.CharField(max_length=3, default="EUR")
    # Whether the scheduler should treat an expected delivery as a constraint on
    # the work item waiting for it.
    #
    # Off by default, and deliberately per project rather than workspace-wide. A
    # planner that silently pushed somebody's dates because a colleague typed a
    # supplier's promise into a purchase form would be a planner nobody trusts —
    # and most projects here have no hardware waiting on anything. A project that
    # IS gated on a twelve-week chip lead time turns it on once and the constraint
    # then holds for every reflow.
    schedule_from_deliveries = models.BooleanField(default=False)

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
    # Which country's public holidays this person does not work.
    #
    # A CACHE of the central profile, never the place a human edits it: every user
    # has one profile shared by the wiki, Zulip, Plane and the dashboard, and that
    # is where the country is set. It is copied here because the scheduler runs on
    # every reflow and must not make a network call to know whether the 14th of
    # July is a working day.
    #
    # Empty means the workspace default, GB. The 14th of July is not a British
    # engineer's day off and Boxing Day is not a French one's, which is the whole
    # reason this is per person rather than per workspace.
    work_country = models.CharField(max_length=2, blank=True, default="")

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


class ProcurementRequest(models.Model):
    """Somebody asking to spend the project's money, and the lead answering.

    The expense sheet is the record of what was committed, so it is not something
    every member should be able to write to directly — a budget nobody owns is a
    budget nobody can defend. Anyone on the project can *ask*; only the lead can
    say yes, and saying yes is what creates the expense line.

    `expense` is the line that approval produced, kept so the two can never drift:
    reject-after-approve removes it, and nothing else can create an expense that
    claims to have come from a request.
    """

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    # Ordered and received extend the record past the decision. Approving says the
    # money is committed; it says nothing about when the parts land, and for a
    # hardware organisation that second date is the one that moves a deployment —
    # a twelve-week Kineis chip lead time shifts a field season further than any
    # person-day ever will.
    ORDERED = "ordered"
    RECEIVED = "received"
    STATUS_CHOICES = [
        (PENDING, "Pending"),
        (APPROVED, "Approved"),
        (REJECTED, "Rejected"),
        (ORDERED, "Ordered"),
        (RECEIVED, "Received"),
    ]

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    project = models.ForeignKey(
        "db.Project", on_delete=models.CASCADE, related_name="arribada_procurement"
    )
    requested_by = models.ForeignKey(
        "db.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    # The same shape as the expense it becomes, so approval is a copy and not a
    # translation — a field that existed only on one side would be a field that
    # silently disappears at the moment of approval.
    category = models.CharField(
        max_length=16, choices=ProjectExpense.CATEGORY_CHOICES, default=ProjectExpense.OTHER
    )
    label = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    quantity = models.DecimalField(max_digits=10, decimal_places=2, default=1)
    currency = models.CharField(max_length=3, default="EUR")

    supplier = models.CharField(max_length=255, blank=True, default="")
    justification = models.TextField(blank=True, default="")
    # The purchasing record past approval.
    order_reference = models.CharField(max_length=255, blank=True, default="")
    ordered_on = models.DateField(null=True, blank=True)
    # What the supplier promised. This is the date the scheduler can be asked to
    # respect; `received_on` is what actually happened.
    expected_on = models.DateField(null=True, blank=True)
    received_on = models.DateField(null=True, blank=True)
    # The work item this delivery unblocks. Null is the ordinary case — most
    # purchases are consumables nothing waits on — and only a linked request with
    # an expected date can ever constrain a plan.
    issue = models.ForeignKey(
        "db.Issue",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="arribada_procurement",
    )
    needed_by = models.DateField(null=True, blank=True)

    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    decided_by = models.ForeignKey(
        "db.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True, default="")
    expense = models.ForeignKey(
        ProjectExpense, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "arribada_procurement_request"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["project", "status"])]

    @property
    def total(self):
        return self.amount * self.quantity

    def __str__(self):
        return f"{self.label} ({self.status})"


class WorkspaceCurrencySettings(models.Model):
    """Which currency this workspace reads its budgets in, and at what rate.

    The rest of this app deliberately refuses to convert: a rate row, an expense and
    an allocation each carry their own currency and are shown side by side rather
    than summed, because a subcontractor billed in dollars beside a salaried
    engineer costed in euros has no meaningful total. That refusal was never about
    arithmetic — it was about *provenance*. An exchange rate pulled from a feed
    moves under the reader, is attributable to nobody, and turns a figure somebody
    could defend into one they cannot.

    A rate a human typed, with the date they typed it, is a different object. It is
    wrong in a way that is visible and fixable. So this holds exactly one pair —
    EUR and GBP, the two currencies this organisation actually works in — and every
    figure derived from it is reported in a separate `display` block, marked as an
    approximation, next to the rate and the date it was captured. The recorded
    amounts are never rewritten.

    One row per workspace, created on first write. Absent means "no display
    currency chosen", which is not the same as EUR: with no row, every project is
    read in its own allocation currency and nothing is converted at all.
    """

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    workspace = models.OneToOneField(
        "db.Workspace", on_delete=models.CASCADE, related_name="arribada_currency_settings"
    )
    # "" = follow each project's own allocation currency and convert nothing.
    display_currency = models.CharField(max_length=3, blank=True, default="")
    # GBP per 1 EUR. Six decimal places because a rate rounded to two is a rate
    # that visibly disagrees with the bank statement it is meant to approximate.
    eur_gbp_rate = models.DecimalField(max_digits=12, decimal_places=6, default=0.85)
    # When the human took the rate down. Shown beside every converted figure: a
    # rate without a date is indistinguishable from a rate from four years ago.
    rate_captured_on = models.DateField(null=True, blank=True)
    updated_by = models.ForeignKey(
        "db.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "arribada_currency_settings"
        verbose_name = "Workspace currency settings"
        verbose_name_plural = "Workspace currency settings"

    def __str__(self):
        return f"{self.workspace_id} display={self.display_currency or 'project'} @ {self.eur_gbp_rate}"


class IssueMilestone(models.Model):
    """A work item that IS a deliverable, rather than a step toward one.

    A milestone was inferred from a zero-day duration, which is wrong in both
    directions. A one-day bench test drew as an amber diamond labelled like a gate,
    and "PDR delivered" — a real funder deliverable that happens to span the two
    days the review takes — got no marker at all. The MS Project export inherited
    the same guess and stamped every one-day task as a Project milestone.

    For a grant-funded organisation the milestone is the reporting unit: PDR, tag
    delivery, the field deployment window. Those are the objects a funder tracks
    and they cannot be a side effect of how long something happens to take.

    Deliberately a row rather than a boolean column on the item: this fork does not
    own db.Issue, and a separate table keeps the upstream schema untouched (the
    same reasoning as IssueRole and ProjectSchedule). A row's existence is the
    flag; `label` is what a report calls it when the item's own name is written for
    the team rather than for the funder, and `kind` lets the chart tell a gate that
    must be passed from a delivery that must arrive.
    """

    GATE = "gate"
    DELIVERY = "delivery"
    REVIEW = "review"
    KIND_CHOICES = [(GATE, "Gate"), (DELIVERY, "Delivery"), (REVIEW, "Review")]

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    issue = models.OneToOneField(
        "db.Issue", on_delete=models.CASCADE, related_name="arribada_milestone"
    )
    kind = models.CharField(max_length=16, choices=KIND_CHOICES, default=DELIVERY)
    # Empty means "use the work item's own name". Only worth filling when the
    # internal name is not what a funder should read.
    label = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "arribada_issue_milestone"
        ordering = ("created_at",)
        verbose_name = "Issue milestone"
        verbose_name_plural = "Issue milestones"

    def __str__(self):
        return f"{self.issue_id} {self.kind}"


class IssueArtifact(models.Model):
    """Evidence for a work item: where the proof of it lives.

    The only external links this fork had were on the PROJECT — a wiki doc, a
    Drive folder, a chat channel, some repos. So "show me the test evidence for
    deliverable 3.2" had no answer finer than "here is the project's entire Drive
    folder", which is not an answer a reviewer accepts.

    The wiki remains the system of record for the durable stuff — hardware
    catalogue, unit serials, orders (see the Colanode traceability work). These
    rows are POINTERS, never a second copy: the boundary is written into
    ARRIBADA.md so it does not survive only as folklore. What lands here is the
    link from a task to the artefact that proves it: a test report, a BOM, a board
    revision, a build.

    `kind` is a closed set because it drives an icon and, more importantly, tells
    a reader whether they are about to open a wiki page or a repository — three
    destinations with three different access stories.
    """

    WIKI = "wiki"
    DRIVE = "drive"
    GITHUB = "github"
    OTHER = "other"
    KIND_CHOICES = [
        (WIKI, "Wiki"),
        (DRIVE, "Google Drive"),
        (GITHUB, "GitHub"),
        (OTHER, "Other link"),
    ]

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    issue = models.ForeignKey(
        "db.Issue", on_delete=models.CASCADE, related_name="arribada_artifacts"
    )
    kind = models.CharField(max_length=16, choices=KIND_CHOICES, default=OTHER)
    url = models.URLField(max_length=2000)
    # What to call it when the URL itself is unreadable, which a Drive link always
    # is. Empty falls back to the host.
    label = models.CharField(max_length=255, blank=True, default="")
    created_by = models.ForeignKey(
        "db.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "arribada_issue_artifact"
        ordering = ("created_at",)
        verbose_name = "Issue artifact"
        verbose_name_plural = "Issue artifacts"

    def __str__(self):
        return f"{self.issue_id} {self.kind}"


class ProjectBaseline(models.Model):
    """A named, dated snapshot of a project's plan.

    A baseline is the plan as it was when it was PROMISED. The single
    `IssueBaseline` row per work item could not express that: re-capturing
    overwrote it, so a project frozen in January and re-frozen in March had no way
    to show a funder what January said. "Here is what we committed to" needs to
    name WHICH plan, or it is not an answer.

    Several can coexist per project — "PDR January 2026", "After amendment 2" —
    and the chart draws the ghosts of whichever one the reader picks. The old
    per-issue rows migrate in as "Initial baseline" so nothing frozen is lost and
    the existing ghost bars keep drawing through the transition.

    Immutable by construction: there is no update path. A plan that changed after
    it was agreed is a NEW baseline, and being able to see both is the entire
    point.
    """

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    project = models.ForeignKey(
        "db.Project", on_delete=models.CASCADE, related_name="arribada_baselines"
    )
    name = models.CharField(max_length=255)
    # Who froze it and when. A baseline with no author is a number nobody can be
    # asked about six months later.
    captured_by = models.ForeignKey(
        "db.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    captured_at = models.DateTimeField(auto_now_add=True)
    note = models.TextField(blank=True, default="")

    class Meta:
        db_table = "arribada_project_baseline"
        ordering = ("-captured_at",)
        verbose_name = "Project baseline"
        verbose_name_plural = "Project baselines"

    def __str__(self):
        return f"{self.project_id} {self.name}"


class BaselineEntry(models.Model):
    """One work item's dates inside one baseline.

    Denormalised on purpose: the item's name is copied in. A baseline has to stay
    readable after the work item is renamed or deleted — a frozen plan that
    silently loses a line when somebody tidies the backlog is not a record of
    anything.
    """

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    baseline = models.ForeignKey(ProjectBaseline, on_delete=models.CASCADE, related_name="entries")
    # SET_NULL rather than CASCADE: deleting a work item must not silently rewrite
    # what was promised.
    issue = models.ForeignKey(
        "db.Issue", null=True, blank=True, on_delete=models.SET_NULL, related_name="arribada_baseline_entries"
    )
    issue_name = models.CharField(max_length=255, blank=True, default="")
    start_date = models.DateField(null=True, blank=True)
    target_date = models.DateField(null=True, blank=True)

    class Meta:
        db_table = "arribada_baseline_entry"
        verbose_name = "Baseline entry"
        verbose_name_plural = "Baseline entries"
        constraints = [
            models.UniqueConstraint(fields=["baseline", "issue"], name="arribada_baseline_entry_unique_issue")
        ]

    def __str__(self):
        return f"{self.baseline_id} {self.issue_id}"


class IssueAllocation(models.Model):
    """How much of one person's time one work item takes.

    The workload bar was `assigned / maxAssigned` — a rank, not a capacity. The
    busiest person was always exactly 100% whether they held three items or
    thirty, and if everybody held one item everybody rendered full. It could not
    express over-allocation because it had no denominator.

    A denominator needs a numerator that means something, and "a three-week task"
    is not fifteen person-days. So the share is recorded: "Mathieu is 50% on this,
    Ruby 20%". Per ASSIGNEE rather than per item, because two people on one item
    routinely give it different shares — a single per-item number is wrong the
    moment the item is shared.

    A missing row means 100%: somebody who has not said is assumed to be on it
    fully, which over-states load rather than under-stating it. A planner that
    quietly reports spare capacity is the failure mode worth avoiding.
    """

    id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, db_index=True, primary_key=True
    )
    issue = models.ForeignKey(
        "db.Issue", on_delete=models.CASCADE, related_name="arribada_allocations"
    )
    assignee = models.ForeignKey("db.User", on_delete=models.CASCADE, related_name="+")
    # 1-100. Above 100 would say somebody gives an item more time than they have,
    # which is a statement about the plan rather than about the item.
    percent = models.PositiveSmallIntegerField(default=100)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "arribada_issue_allocation"
        verbose_name = "Issue allocation"
        verbose_name_plural = "Issue allocations"
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "assignee"], name="arribada_issue_allocation_unique_pair"
            )
        ]

    def __str__(self):
        return f"{self.issue_id} {self.assignee_id} {self.percent}%"
