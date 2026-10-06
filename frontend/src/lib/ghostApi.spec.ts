import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLevelGhost, submitLevelGhost } from './ghostApi';

function mockFetch(status: number, body: unknown) {
	const fetchMock = vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		json: async () => body
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('getLevelGhost', () => {
	it('maps a ghost from snake_case to the frontend shape', async () => {
		mockFetch(200, {
			ghost: {
				username: 'speedy',
				duration_ms: 2000,
				sample_interval_ms: 50,
				frames: [[1, 2, 0]]
			}
		});

		const result = await getLevelGhost('abc');
		expect(result).toEqual({
			success: true,
			ghost: {
				username: 'speedy',
				durationMs: 2000,
				sampleIntervalMs: 50,
				frames: [[1, 2, 0]]
			}
		});
	});

	it('returns a null ghost when nobody has cleared the level', async () => {
		mockFetch(200, { ghost: null });
		expect(await getLevelGhost('abc')).toEqual({ success: true, ghost: null });
	});

	it('reports a missing level without throwing', async () => {
		mockFetch(404, { error: 'level not found' });
		const result = await getLevelGhost('nope');
		expect(result.success).toBe(false);
		expect(result.error).toBe('level not found');
	});

	it('reports a network failure without throwing', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
		expect((await getLevelGhost('abc')).success).toBe(false);
	});
});

describe('submitLevelGhost', () => {
	const run = { durationMs: 1500, frames: [[1, 2, 0]] as [number, number, number][] };

	it('sends the run as snake_case with the bearer token', async () => {
		const fetchMock = mockFetch(200, { is_record: true, record: { username: 'me', duration_ms: 1500 } });

		const result = await submitLevelGhost('abc', 'tok', run);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toMatch(/\/api\/levels\/abc\/ghost$/);
		expect(init.method).toBe('POST');
		expect(init.headers.Authorization).toBe('Bearer tok');
		expect(JSON.parse(init.body)).toEqual({ duration_ms: 1500, frames: [[1, 2, 0]] });
		expect(result).toEqual({
			success: true,
			isRecord: true,
			record: { username: 'me', durationMs: 1500 }
		});
	});

	it('reports a slower run along with the standing record', async () => {
		mockFetch(200, { is_record: false, record: { username: 'speedy', duration_ms: 900 } });
		const result = await submitLevelGhost('abc', 'tok', run);
		expect(result.isRecord).toBe(false);
		expect(result.record).toEqual({ username: 'speedy', durationMs: 900 });
	});

	it('surfaces the error code for a rejected run', async () => {
		mockFetch(400, { error: 'the run moves faster than the game allows', code: 'invalid_ghost' });
		const result = await submitLevelGhost('abc', 'tok', run);
		expect(result.success).toBe(false);
		expect(result.code).toBe('invalid_ghost');
	});

	it('flags an expired session on a 401', async () => {
		mockFetch(401, { error: 'token has expired' });
		expect((await submitLevelGhost('abc', 'tok', run)).sessionExpired).toBe(true);
	});
});