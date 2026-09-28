import { describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, checkBackendHealth, publishLevel, verifyEmail } from './api';

describe('checkBackendHealth', () => {
	it('returns true when the backend responds with status ok', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ status: 'ok' })
		}) as unknown as typeof fetch;

		const result = await checkBackendHealth();

		expect(result).toBe(true);
		expect(fetch).toHaveBeenCalledWith(`${API_BASE_URL}/health`);
	});

	it('returns false when the backend request fails', async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

		const result = await checkBackendHealth();

		expect(result).toBe(false);
	});
});

describe('verifyEmail', () => {
	it('returns success, tokens, and the user when the backend confirms the token', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				access_token: 'a-real-access-token',
				refresh_token: 'a-real-refresh-token',
				user: { id: 'user-slug', username: 'verifieduser', email_verified_at: '2026-01-01T00:00:00Z' }
			})
		}) as unknown as typeof fetch;

		const result = await verifyEmail('a-real-token');

		expect(result.success).toBe(true);
		expect(result.accessToken).toBe('a-real-access-token');
		expect(result.refreshToken).toBe('a-real-refresh-token');
		expect(result.user?.username).toBe('verifieduser');
		expect(fetch).toHaveBeenCalledWith(
			`${API_BASE_URL}/api/users/verify-email`,
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({ token: 'a-real-token' })
			})
		);
	});

	it('returns the backend error message when the token is rejected', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			json: async () => ({ error: 'token has expired or already been used' })
		}) as unknown as typeof fetch;

		const result = await verifyEmail('an-expired-token');

		expect(result.success).toBe(false);
		expect(result.error).toBe('token has expired or already been used');
	});

	it('returns a fallback error when the backend is unreachable', async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

		const result = await verifyEmail('any-token');

		expect(result.success).toBe(false);
		expect(result.error).toBe('Could not reach the server. Please try again.');
	});
});


describe('publishLevel', () => {
	it('sends the chosen title in the request body, alongside the auth header', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ id: 'AAAA-BBBB-CCCC-DDDD', title: 'Sky Castle', visibility_state: 'published' })
		}) as unknown as typeof fetch;

		const result = await publishLevel('AAAA-BBBB-CCCC-DDDD', 'an-access-token', 'Sky Castle');

		expect(result.success).toBe(true);
		expect(result.level?.title).toBe('Sky Castle');
		expect(fetch).toHaveBeenCalledWith(
			`${API_BASE_URL}/api/levels/AAAA-BBBB-CCCC-DDDD/publish`,
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({ title: 'Sky Castle' }),
				headers: expect.objectContaining({ Authorization: 'Bearer an-access-token' })
			})
		);
	});

	it('surfaces the backend error message when publishing is rejected', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 409,
			json: async () => ({ error: 'level must be beaten before it can be published' })
		}) as unknown as typeof fetch;

		const result = await publishLevel('AAAA-BBBB-CCCC-DDDD', 'an-access-token', 'Sky Castle');

		expect(result.success).toBe(false);
		expect(result.error).toBe('level must be beaten before it can be published');
	});
});