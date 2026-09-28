# Copyright (c) 2026-present Arribada Initiative and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The plan grant for MCP tokens: two defaulted booleans, no `RunPython`.

`allow_plan` on `arribada_mcp_token` and `granted_plan` on
`arribada_mcp_authorization_code`, both `default=False`. Every token and every
code that exists today keeps exactly the authority it was issued with, and a
code-only rollback to `.144` strands nothing: that code never reads either
column, and a column it never reads costs it nothing.

`('db', '0121_alter_estimate_type')` is the same upstream pin every migration in
this app uses.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("arribada", "0046_mcp_oauth"),
        ("db", "0121_alter_estimate_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="mcptoken",
            name="allow_plan",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="mcpauthorizationcode",
            name="granted_plan",
            field=models.BooleanField(default=False),
        ),
    ]
