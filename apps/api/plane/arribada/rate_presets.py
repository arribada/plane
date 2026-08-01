# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Indicative hourly rates, and the two currencies this fork can convert between.

Why this file exists
--------------------
A blank rate box is the reason the labour figure on a project stays at zero: the
person who opens it does not know what an hour of firmware costs the organisation,
so they close the panel and the estimate never happens. A defensible starting
number is more useful than an empty field — provided it is unmistakably a
suggestion and not a decision somebody made.

Two tables, not one table and an exchange rate
----------------------------------------------
The French and UK figures are *separate markets*, not the same numbers converted.
France loads roughly 40-45% employer social charges onto a gross salary and its
engineering salary bands are compressed; the UK loads roughly 20% (NI + auto-
enrolment pension) onto a wider salary spread. Running the French table through an
FX rate would produce numbers that are wrong in both countries — most visibly at
the ends, where a UK field technician costs far less relative to a UK firmware
engineer than the French pair do to each other.

What the numbers are
--------------------
Fully-loaded internal cost per *productive* hour: gross salary + employer
contributions + a share of overhead (space, equipment, admin, non-billable time),
divided by roughly 1,500 productive hours a year. This is the basis a grant is
costed on, which is the reason anyone opens the panel in the first place. They are
NOT charge-out day rates and they are NOT anybody's salary.

Provenance and staleness
------------------------
Assembled 2026-08-01 from public 2025-2026 engineering salary bands for the sector
(small conservation-technology organisations and comparable engineering SMEs in
France and the UK), plus the standard employer on-costs for each country. Nobody
audited them. They are averages, they go stale, and the first person asked to
justify a labour estimate should be pointing at their own organisation's payroll,
not at this file. Treat every figure here as a placeholder somebody is expected to
overwrite.

Keys
----
Roles are keyed LOWERCASED, because that is how WorkspaceRoleRate stores them
(views lowercases on write and on read) while PROJECT_ROLES keeps the display
casing of "QA / test" and "data / science". A preset keyed on the PROJECT_ROLES
value verbatim would silently miss those two.
"""

from datetime import date

# Every value in PROJECT_ROLES, lowercased, plus a few names a workspace may have
# recorded a rate against before the vocabulary settled ("technician", "field
# scientist") and the retired "project lead" alias. Covering them costs nothing and
# means an existing row is not the one left blank.
RATE_PRESETS = [
    {
        "country": "FR",
        "label": "France",
        "currency": "EUR",
        # 35-hour week: a French working day is 7 hours.
        "hours_per_day": 7.0,
        "rates": {
            "hardware engineer": 68.0,
            "embedded firmware": 72.0,
            "software": 66.0,
            "mechanical": 60.0,
            "designer": 56.0,
            "data / science": 64.0,
            "field ops": 46.0,
            "qa / test": 54.0,
            "reviewer": 76.0,
            "project manager": 64.0,
            # Outside PROJECT_ROLES, kept so an existing row is not left blank.
            "technician": 42.0,
            "field scientist": 52.0,
            "project lead": 64.0,
        },
    },
    {
        "country": "UK",
        "label": "United Kingdom",
        "currency": "GBP",
        # 37.5-hour week: a UK working day is 7.5 hours.
        "hours_per_day": 7.5,
        "rates": {
            "hardware engineer": 60.0,
            "embedded firmware": 68.0,
            "software": 64.0,
            "mechanical": 50.0,
            "designer": 45.0,
            "data / science": 58.0,
            "field ops": 32.0,
            "qa / test": 42.0,
            "reviewer": 70.0,
            "project manager": 56.0,
            # Outside PROJECT_ROLES, kept so an existing row is not left blank.
            "technician": 28.0,
            "field scientist": 40.0,
            "project lead": 56.0,
        },
    },
]

# One line of provenance, shipped to the client so the caveat travels with the
# numbers instead of living only in this docstring.
PRESET_SOURCE = (
    "Indicative fully-loaded internal cost per productive hour — public 2025-2026 "
    "engineering salary bands for the sector plus each country's employer on-costs "
    "and overhead. Averages, not audited figures. Replace them with your own payroll."
)
PRESET_CAPTURED_ON = date(2026, 8, 1)


# --- display currency -------------------------------------------------------

# The only pair this fork will convert. Not an FX feed and not an ambition to be
# one: two currencies with one rate a human typed is defensible, a table of
# thirty rates nobody maintains is not.
DISPLAY_CURRENCIES = ("EUR", "GBP")

# GBP per 1 EUR. A starting value so the feature works out of the box, dated so
# that "it is out of date" is a thing somebody can see rather than discover.
DEFAULT_EUR_GBP_RATE = 0.85
DEFAULT_RATE_CAPTURED_ON = date(2026, 8, 1)


def preset_payload():
    """The presets in the shape the client renders, JSON-safe.

    The server stays the authority on what a preset contains: the client holds no
    second copy of the numbers, only what this returns.
    """
    return [
        {
            "country": p["country"],
            "label": p["label"],
            "currency": p["currency"],
            "hours_per_day": p["hours_per_day"],
            "rates": dict(p["rates"]),
            "source": PRESET_SOURCE,
            "captured_on": PRESET_CAPTURED_ON.isoformat(),
        }
        for p in RATE_PRESETS
    ]


def convert(amount, source, target, eur_gbp_rate):
    """`amount` moved from `source` into `target`, or None if that cannot be done.

    `eur_gbp_rate` is GBP per 1 EUR. Anything outside the EUR/GBP pair returns
    None rather than a guess — a figure in dollars has no honest position in a
    sterling total, and dropping it silently is what the excluded-currency notice
    exists to prevent.
    """
    src = (source or "").strip().upper()
    dst = (target or "").strip().upper()
    if not src or not dst:
        return None
    if src == dst:
        return float(amount)
    try:
        rate = float(eur_gbp_rate)
    except (TypeError, ValueError):
        return None
    if rate <= 0:
        return None
    if src == "EUR" and dst == "GBP":
        return float(amount) * rate
    if src == "GBP" and dst == "EUR":
        return float(amount) / rate
    return None
