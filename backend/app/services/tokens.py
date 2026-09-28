from flask_jwt_extended import create_access_token

from app.extensions import db
from app.models.refresh_token import RefreshToken
from app.models.user import User


def issue_token_pair(user: User) -> dict:
    """
    Issues a fresh access token + refresh token pair for the given
    user - the one thing every real "you are now logged in" moment in
    this app ends with, regardless of which path got there: a login
    link, a refresh, Twitch, or (see app/api/users.py's verify_email)
    clicking a genuine email verification link. All of these prove the
    same underlying thing - the caller controls this account's email
    or an already-linked identity - so they're treated as equally
    valid ways to establish a session, not ranked by mechanism.
    """
    refresh_token = RefreshToken(user_id=user.id)
    db.session.add(refresh_token)
    db.session.commit()

    # public_id, not the raw internal id - a JWT's payload is
    # base64-encoded, not encrypted, so anyone holding the token can
    # decode and read its claims even without the signing key. Using
    # the real PK here would leak it regardless of what API responses
    # do or don't expose. See User.public_id's docstring.
    access_token = create_access_token(identity=user.public_id)

    return {"access_token": access_token, "refresh_token": refresh_token.token}