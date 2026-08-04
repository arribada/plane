# Hand-written. Four nullable floats, so this is a metadata-only ALTER on
# PostgreSQL: adding a nullable column with no default does not rewrite the
# table, and `stickies` is not a table anyone can afford a lock on mid-day.
#
# NULL is the "never moved, lay it out automatically" state, which is why none
# of these carry a default — a default would mean every existing sticky woke up
# claiming a position it never had.

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0121_alter_estimate_type")]

    operations = [
        migrations.AddField(
            model_name="sticky",
            name="position_x",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="sticky",
            name="position_y",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="sticky",
            name="width",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="sticky",
            name="height",
            field=models.FloatField(blank=True, null=True),
        ),
    ]
