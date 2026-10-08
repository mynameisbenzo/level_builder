import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLevelRecord, postLevelPlaytime, submitLevelWin } from './playtimeApi';

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

describe('postLevelPlaytime', () => {
	it('posts the elapsed time with the bearer token and maps the total', async () => {
		const fetchMock = mockFetch(200, { total_ms: 12_000, at_ceiling: false });

		const result = await postLevelPlaytime('abc', 'tok', 4800);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/api/levels/abc/playtime');
		expect(init.method).toBe('POST');
		expect(init.headers.Authorization).toBe('Bearer tok');
		expect(JSON.parse(init.body)).toEqual({ elapsed_ms: 4800 });
		expect(result).toEqual({ success: true, totalMs: 12_000, atCeiling: false });
	});

	it('reports the ceiling', async () => {
		mockFetch(200, { total_ms: 5_999_999, at_ceiling: true });
		expect((await postLevelPlaytime('abc', 'tok', 1)).atCeiling).toBe(true);
	});

	it('flags an expired session on a 401', async () => {
		mockFetch(401, { error: 'expired' });
		const result = await postLevelPlaytime('abc', 'tok', 1);
		expect(result.success).toBe(false);
		expect(result.sessionExpired).toBe(true);
	});

	it('surfaces a backend error code', async () => {
		mockFetch(400, { error: 'bad', code: 'invalid_playtime' });
		const result = await postLevelPlaytime('abc', 'tok', 1);
		expect(result).toMatchObject({ success: false, code: 'invalid_playtime', error: 'bad' });
	});

	it('survives a network failure', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
		const result = await postLevelPlaytime('abc', 'tok', 1);
		expect(result.success).toBe(false);
	});
});

describe('getLevelRecord', () => {
	it('maps the standing record', async () => {
		mockFetch(200, { record: { username: 'ann', total_ms: 9_500 } });
		expect(await getLevelRecord('abc')).toEqual({
			success: true,
			record: { username: 'ann', totalMs: 9_500 }
		});
	});

	it('returns null when nobody has cleared the level', async () => {
		mockFetch(200, { record: null });
		expect(await getLevelRecord('abc')).toEqual({ success: true, record: null });
	});

	it('fails on a 404', async () => {
		mockFetch(404, { error: 'no such level' });
		const result = await getLevelRecord('abc');
		expect(result.success).toBe(false);
		expect(result.error).toBe('no such level');
	});
});

describe('submitLevelWin', () => {
	it('posts the last stretch and maps total, flag and record', async () => {
		const fetchMock = mockFetch(200, {
			total_ms: 14_000,
			is_record: true,
			record: { username: 'bob', total_ms: 14_000 }
		});

		const result = await submitLevelWin('abc', 'tok', 6000);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain('/api/levels/abc/record');
		expect(init.method).toBe('POST');
		expect(init.headers.Authorization).toBe('Bearer tok');
		expect(JSON.parse(init.body)).toEqual({ elapsed_ms: 6000 });
		expect(result).toEqual({
			success: true,
			totalMs: 14_000,
			isRecord: true,
			record: { username: 'bob', totalMs: 14_000 }
		});
	});

	it('flags an expired session on a 401', async () => {
		mockFetch(401, { error: 'expired' });
		const result = await submitLevelWin('abc', 'tok', 1);
		expect(result.success).toBe(false);
		expect(result.sessionExpired).toBe(true);
	});
});