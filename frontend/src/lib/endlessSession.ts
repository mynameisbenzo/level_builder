import { auth } from './auth.svelte';

/**
 * Runs an authenticated API call with the current access token and, if
 * the backend says the session expired, silently refreshes once and
 * retries - the same pattern the result modal uses, in one place.
 * Returns null if nobody is logged in (or the refresh itself failed and
 * logged them out), so callers can treat that as "send them to log in".
 */
export async function withSession<T extends { sessionExpired?: boolean }>(
	fn: (accessToken: string) => Promise<T>
): Promise<T | null> {
	const token = auth.accessToken;
	if (!token) return null;

	const result = await fn(token);
	if (!result.sessionExpired) return result;

	const refreshed = await auth.tryRefresh();
	const refreshedToken = auth.accessToken;
	if (!refreshed || !refreshedToken) return null;

	return fn(refreshedToken);
}