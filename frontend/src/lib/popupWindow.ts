/**
 * Called from a login-completing page (verify-email, /auth/callback,
 * /auth/twitch/callback) right after a real session has been
 * established. If this window was opened by another page via
 * window.open - e.g. the /play sandbox's "Save while signed out"
 * popup, or Twitch's own redirect returning to that same popup - hands
 * focus back to whichever page opened it and closes this one, rather
 * than redirecting somewhere the person isn't looking at anymore.
 *
 * Returns true if it did this (the caller should skip its own normal
 * post-login redirect entirely); false if there's no opener to return
 * to, meaning this page was reached normally and should proceed with
 * its usual redirect.
 *
 * Deliberately does NOT attempt this for the specific case of a
 * verification/login email link opening in a fresh, unrelated window -
 * that window never had a JS-established opener relationship in the
 * first place (it was opened by the email client/OS, not by
 * window.open from this app), so window.opener is correctly null
 * there and this just falls through to a normal redirect, which is
 * the right behavior for that case.
 */
export function returnToOpenerIfPresent(): boolean {
	if (typeof window === 'undefined' || !window.opener) return false;
	try {
		(window.opener as Window).focus();
	} catch {
		// Cross-origin or otherwise inaccessible - still close this
		// window either way, just can't focus the other one.
	}
	window.close();
	return true;
}