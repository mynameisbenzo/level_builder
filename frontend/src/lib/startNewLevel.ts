import { goto } from '$app/navigation';
import { auth } from './auth.svelte';
import { createLevel } from './api';

export interface StartNewLevelResult {
	success: boolean;
	error?: string;
}

/**
 * Shared by the homepage and profile page's "Build Now"/"New Level"
 * actions for an already-logged-in person - creates a level with a
 * placeholder title (renameable right there in the editor's own title
 * field, so there's no separate "name your level first" step before
 * someone's even started) and navigates straight into editing it.
 */
export async function startNewLevel(): Promise<StartNewLevelResult> {
	const token = auth.accessToken;
	if (!token) {
		return { success: false, error: 'You need to be logged in to do that.' };
	}

	let result = await createLevel('Untitled Level', token);
	if (result.sessionExpired) {
		const refreshed = await auth.tryRefresh();
		const refreshedToken = auth.accessToken;
		if (refreshed && refreshedToken) {
			result = await createLevel('Untitled Level', refreshedToken);
		}
	}

	if (result.success && result.level) {
		await goto(`/edit/${result.level.id}`);
		return { success: true };
	}

	if (result.sessionExpired) {
		await goto('/login');
		return { success: false };
	}

	return {
		success: false,
		error: result.error ?? 'Could not create a new level. Please try again.'
	};
}