import { browser } from '$app/environment';

/**
 * "Launching the installed app" only happens once per app session: the
 * very first page it loads is "/" (the manifest's start_url). Every later
 * visit to "/" - the navbar wordmark, a link - is a normal navigation and
 * must show the homepage, even in the installed app.
 *
 * The root layout calls captureLaunchPath() on first load, so the path
 * recorded is the app's true first page, not whichever page happened to
 * import this module first.
 */
let openedAtHome: boolean | null = null;
let launchChecked = false;

export function captureLaunchPath(): void {
	if (openedAtHome !== null || !browser) return;
	openedAtHome = window.location.pathname === '/';
}

/**
 * Pure decision, split out so it can be unit tested: skip the pitch and
 * go straight to the account only on the first look at "/", only when the
 * app was opened at "/", only when installed, and only when logged in.
 */
export function shouldSkipToProfile(opts: {
	openedAtHome: boolean;
	alreadyChecked: boolean;
	isStandalone: boolean;
	isLoggedIn: boolean;
}): boolean {
	return opts.openedAtHome && !opts.alreadyChecked && opts.isStandalone && opts.isLoggedIn;
}

/**
 * Called by the homepage on mount. Always marks the launch check as used,
 * so a later trip back to "/" (e.g. after logging in from a logged-out
 * launch) is never mistaken for a fresh launch.
 */
export function consumeLaunchRedirect(isStandalone: boolean, isLoggedIn: boolean): boolean {
	const result = shouldSkipToProfile({
		openedAtHome: openedAtHome === true,
		alreadyChecked: launchChecked,
		isStandalone,
		isLoggedIn
	});
	launchChecked = true;
	return result;
}