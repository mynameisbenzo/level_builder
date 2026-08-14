import { describe, expect, it, vi } from 'vitest';
import { checkBackendHealth } from './api';

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