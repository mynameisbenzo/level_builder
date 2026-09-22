import logging

import resend
from flask import current_app
from resend.exceptions import ResendError

logger = logging.getLogger(__name__)


def _send_email(to: str, subject: str, html: str) -> bool:
    """
    Shared send path for every transactional email this app sends.
    Returns True on success, False on failure - failures are logged,
    never raised, since a failed send shouldn't break whatever
    triggered it (account creation, a login attempt). The caller can
    always try again later.
    """
    resend.api_key = current_app.config["RESEND_API_KEY"]
    if not resend.api_key:
        logger.warning("RESEND_API_KEY is not set - email to %s was not sent: %s", to, subject)
        return False

    try:
        resend.Emails.send(
            {
                "from": current_app.config["EMAIL_FROM_ADDRESS"],
                "to": [to],
                "subject": subject,
                "html": html,
            }
        )
        logger.info("Email sent to %s: %s", to, subject)
        return True
    except ResendError:
        logger.exception("Failed to send email to %s: %s", to, subject)
        return False


def send_verification_email(email: str, token: str) -> bool:
    """Sends the account-verification email (signup with email)."""
    verify_url = f"{current_app.config['FRONTEND_ORIGIN']}/verify-email?token={token}"
    return _send_email(
        to=email,
        subject="Verify your Pixel Maker account",
        html=(
            "<p>Click the link below to verify your email address:</p>"
            f'<p><a href="{verify_url}">{verify_url}</a></p>'
            "<p>This link expires in 24 hours.</p>"
        ),
    )


def send_login_link_email(email: str, token: str) -> bool:
    """
    Sends the magic-login-link email. Deliberately short-lived (see
    LoginToken) - the link is meant to be used right away, not saved
    for later.
    """
    login_url = f"{current_app.config['FRONTEND_ORIGIN']}/auth/callback?token={token}"
    return _send_email(
        to=email,
        subject="Your Pixel Maker login link",
        html=(
            "<p>Click the link below to log in:</p>"
            f'<p><a href="{login_url}">{login_url}</a></p>'
            "<p>This link expires in 15 minutes. If you didn't request this, "
            "you can safely ignore it.</p>"
        ),
    )