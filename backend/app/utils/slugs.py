import secrets
import string

# Uppercase letters + digits, no dashes in the alphabet itself - dashes
# are inserted structurally below, not drawn from this pool. Deliberately
# NOT Crockford's Base32 (which drops visually ambiguous characters like
# 0/O and 1/I) - a considered choice, not an oversight: these are meant
# to be copy-pasted (URLs, API responses) rather than read aloud or
# hand-transcribed, so the ambiguity that matters for spoken/handwritten
# codes doesn't really apply here.
SLUG_ALPHABET = string.ascii_uppercase + string.digits
SLUG_GROUP_LENGTH = 4
SLUG_GROUP_COUNT = 4


def generate_slug() -> str:
    """
    A public-facing identifier for any model where the real database
    primary key should never be exposed externally - 16 uppercase
    alphanumeric characters, displayed as four dash-separated groups of
    four (XXXX-XXXX-XXXX-XXXX). ~83 bits of entropy from secrets.choice,
    plenty for an identifier that only needs to be hard to guess/enumerate,
    not cryptographically secret.

    Used for User.public_id and Level.slug - genuinely public identifiers,
    meant to appear in URLs and API responses. Deliberately NOT used for
    LoginToken/EmailVerificationToken, which are secret, single-use
    credentials rather than identifiers, and keep their own much
    higher-entropy secrets.token_urlsafe(32) generation instead - using
    this format for those would be a real, meaningful weakening, not a
    stylistic difference.
    """
    raw = "".join(secrets.choice(SLUG_ALPHABET) for _ in range(SLUG_GROUP_LENGTH * SLUG_GROUP_COUNT))
    return "-".join(
        raw[i : i + SLUG_GROUP_LENGTH] for i in range(0, len(raw), SLUG_GROUP_LENGTH)
    )