"""
Command-line tools, run with `flask <command>` (set DATABASE_URL to point
at the database you mean - local, or the live one).

There is no payment processor yet, so the paid tier is handed out by hand:
    flask grant-paid <username>
    flask revoke-paid <username>
    flask list-paid
"""

import click

from app.extensions import db
from app.models.user import User
from app.services.tiers import STAFF_ROLES


def _find_user(username: str) -> User | None:
    return User.query.filter_by(username=username, is_deleted=False).first()


def register_cli(app) -> None:
    @app.cli.command("grant-paid")
    @click.argument("username")
    def grant_paid(username):
        """Marks USERNAME's account as paid."""
        user = _find_user(username)
        if user is None:
            raise click.ClickException(f"no account named {username!r}")
        if user.is_paid:
            click.echo(f"{user.username} is already paid.")
            return
        user.is_paid = True
        db.session.commit()
        click.echo(f"{user.username} is now paid.")

    @app.cli.command("revoke-paid")
    @click.argument("username")
    def revoke_paid(username):
        """Takes the paid flag off USERNAME's account (staff roles stay paid)."""
        user = _find_user(username)
        if user is None:
            raise click.ClickException(f"no account named {username!r}")
        if not user.is_paid:
            click.echo(f"{user.username} isn't marked paid.")
            return
        user.is_paid = False
        db.session.commit()
        if user.role in STAFF_ROLES:
            click.echo(f"{user.username} is no longer marked paid, but their {user.role.value} role still counts as paid.")
        else:
            click.echo(f"{user.username} is no longer paid.")

    @app.cli.command("list-paid")
    def list_paid():
        """Lists the accounts marked paid by hand (staff roles aren't listed)."""
        users = User.query.filter_by(is_paid=True, is_deleted=False).order_by(User.username).all()
        if not users:
            click.echo("No accounts are marked paid.")
            return
        for user in users:
            click.echo(user.username)