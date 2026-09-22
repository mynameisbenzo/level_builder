import { describe, expect, it, vi } from 'vitest';
import { checkBackendHealth, verifyEmail } from './api';

describe('checkBackendHealth', () => {
	it('returns true when the backend responds with status ok', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ status: 'ok' })
		}) as unknown as typeof fetch;

		const result = await checkBackendHealth();

		expect(result).toBe(true);
		expect(fetch).toHaveBeenCalledWith('http://localhost:5000/health');
	});

	it('returns false when the backend request fails', async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

		const result = await checkBackendHealth();

		expect(result).toBe(false);
	});
});

describe('verifyEmail', () => {
	it('returns success when the backend confirms the token', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ email_verified_at: '2026-01-01T00:00:00Z' })
		}) as unknown as typeof fetch;

		const result = await verifyEmail('a-real-token');

		expect(result.success).toBe(true);
		expect(fetch).toHaveBeenCalledWith(
			'http://localhost:5000/api/users/verify-email',
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