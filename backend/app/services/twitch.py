import requests
from flask import current_app

TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token"
TWITCH_USERS_URL = "https://api.twitch.tv/helix/users"

REQUEST_TIMEOUT_SECONDS = 10


class TwitchAuthError(Exception):
    """
    Raised when the exchange with Twitch's own servers fails - a bad or
    expired code, a network error, or a response shape that doesn't
    match what's expected. Callers (the /api/auth/twitch/callback route)
    catch this and turn it into a clean 4xx for the frontend; it should
    never surface as a raw, unhandled 500.
    """


def exchange_code_for_token(code: str, redirect_uri: str) -> str:
    """
    Exchanges an OAuth authorization code for a Twitch user access
    token. This is the one call in the whole flow that needs the
    client secret - it must only ever happen here, server-side, never
    in the browser, which is the whole reason this backend round-trip
    exists at all rather than the frontend handling the exchange
    itself.
    """
    try:
        response = requests.post(
            TWITCH_TOKEN_URL,
            data={
                "client_id": current_app.config["TWITCH_CLIENT_ID"],
                "client_secret": current_app.config["TWITCH_CLIENT_SECRET"],
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
            },
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise TwitchAuthError("could not reach Twitch") from exc

    if not response.ok:
        # Most commonly an expired/already-used/invalid code - Twitch
        # doesn't distinguish these in a way worth relaying verbatim to
        # the frontend, so this collapses to one clear failure instead.
        raise TwitchAuthError(f"Twitch token exchange failed with status {response.status_code}")

    access_token = response.json().get("access_token")
    if not access_token:
        raise TwitchAuthError("Twitch token exchange response had no access_token")

    return access_token


def get_twitch_identity(access_token: str) -> tuple[str, str | None]:
    """
    Given a Twitch user access token, fetches the real, verified
    twitch_id and display_name for whoever that token actually belongs
    to - straight from Twitch's own API, never anything the client
    itself claims. Returns (twitch_id, display_name).
    """
    try:
        response = requests.get(
            TWITCH_USERS_URL,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Client-Id": current_app.config["TWITCH_CLIENT_ID"],
            },
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise TwitchAuthError("could not reach Twitch") from exc

    if not response.ok:
        raise TwitchAuthError(f"Twitch user lookup failed with status {response.status_code}")

    users = response.json().get("data") or []
    if not users:
        raise TwitchAuthError("Twitch user lookup returned no user data")

    twitch_user = users[0]
    twitch_id = twitch_user.get("id")
    if not twitch_id:
        raise TwitchAuthError("Twitch user lookup response had no id")

    return twitch_id, twitch_user.get("display_name")