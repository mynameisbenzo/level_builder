import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	beginEndlessAttempt,
	describeAnyPoints,
	formatTimeUntil,
	getEndlessStatus,
	getScoreboard,
	parseServerTime,
	startEndlessRun
} from './endlessApi';

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

describe('parseServerTime', () => {
	it('reads a zone-less backend timestamp as UTC', () => {
		expect(parseServerTime('2026-10-06T12:00:00').toISOString()).toBe('2026-10-06T12:00:00.000Z');
	});

	it('leaves a timestamp that already has a zone alone', () => {
		expect(parseServerTime('2026-10-06T12:00:00Z').toISOString()).toBe('2026-10-06T12:00:00.000Z');
		expect(parseServerTime('2026-10-06T14:00:00+02:00').toISOString()).toBe('2026-10-06T12:00:00.000Z');
	});
});

describe('formatTimeUntil', () => {
	const now = new Date('2026-10-06T00:00:00Z');

	it('formats hours and minutes', () => {
		expect(formatTimeUntil(new Date('2026-10-06T03:12:00Z'), now)).toBe('3h 12m');
	});

	it('formats under an hour as minutes only', () => {
		expect(formatTimeUntil(new Date('2026-10-06T00:12:00Z'), now)).toBe('12m');
	});

	it('rounds a partial minute up', () => {
		expect(formatTimeUntil(new Date('2026-10-06T00:00:10Z'), now)).toBe('1m');
	});

	it('says under a minute when the time has passed', () => {
		expect(formatTimeUntil(new Date('2026-10-05T23:00:00Z'), now)).toBe('under a minute');
	});
});

describe('endless API calls', () => {
	it('sends the bearer token to /status', async () => {
		const fetchMock = mockFetch(200, { is_paid: false });
		const result = await getEndlessStatus('tok');
		expect(result.success).toBe(true);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toMatch(/\/api\/endless\/status$/);
		expect(init.headers.Authorization).toBe('Bearer tok');
	});

	it('maps the start options onto the request body', async () => {
		const fetchMock = mockFetch(201, { run: { lives_remaining: 10 } });
		const result = await startEndlessRun('tok', { difficulty: 'hard', startingLives: 25, replace: true });
		expect(result.data?.lives_remaining).toBe(10);
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
			difficulty: 'hard',
			starting_lives: 25,
			replace: true
		});
	});

	it('sends the mode for a scoreboard run, and leaves it off for endless', async () => {
		const fetchMock = mockFetch(201, { run: {} });
		await startEndlessRun('tok', { mode: 'scoreboard', difficulty: 'tas' });
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ mode: 'scoreboard', difficulty: 'tas' });

		await startEndlessRun('tok', { difficulty: 'tas' });
		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ difficulty: 'tas' });
	});

	it('surfaces the pool on daily_pool_too_low', async () => {
		mockFetch(429, {
			error: 'needs 5',
			code: 'daily_pool_too_low',
			pool: { daily_limit: 50, remaining: 4, resets_at: '2026-10-06T00:00:00' }
		});
		const result = await startEndlessRun('tok', { mode: 'scoreboard' });
		expect(result.code).toBe('daily_pool_too_low');
		expect(result.pool?.remaining).toBe(4);
	});

	it('sends an empty body for a default start', async () => {
		const fetchMock = mockFetch(201, { run: {} });
		await startEndlessRun('tok');
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({});
	});

	it('surfaces the code and active run on active_run_exists', async () => {
		mockFetch(409, { error: 'already', code: 'active_run_exists', active_run: { lives_remaining: 4 } });
		const result = await startEndlessRun('tok');
		expect(result.success).toBe(false);
		expect(result.code).toBe('active_run_exists');
		expect(result.activeRun?.lives_remaining).toBe(4);
	});

	it('surfaces the pool on daily_pool_exhausted', async () => {
		mockFetch(429, {
			error: 'used up',
			code: 'daily_pool_exhausted',
			pool: { daily_limit: 50, remaining: 0, resets_at: '2026-10-06T00:00:00' }
		});
		const result = await startEndlessRun('tok');
		expect(result.code).toBe('daily_pool_exhausted');
		expect(result.pool?.remaining).toBe(0);
	});

	it('flags an expired session on a 401', async () => {
		mockFetch(401, { error: 'token has expired' });
		const result = await beginEndlessAttempt('tok');
		expect(result.sessionExpired).toBe(true);
	});

	it('reports a network failure without throwing', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
		const result = await beginEndlessAttempt('tok');
		expect(result.success).toBe(false);
		expect(result.error).toMatch(/could not reach the server/i);
	});
});


describe('getScoreboard', () => {
	const board = { difficulty: 'hard', total: 1, entries: [{ rank: 1, username: 'ann', score: 9 }] };

	it('asks for one difficulty and page, and works with no token', async () => {
		const fetchMock = mockFetch(200, board);
		const result = await getScoreboard('hard', { offset: 25, limit: 10 });
		expect(result.success).toBe(true);
		expect(result.board?.entries[0].username).toBe('ann');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toMatch(/\/api\/endless\/scoreboard\?difficulty=hard&limit=10&offset=25$/);
		expect(init).toBeUndefined();
	});

	it('sends the token when there is one', async () => {
		const fetchMock = mockFetch(200, board);
		await getScoreboard('any', { accessToken: 'tok' });
		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
	});

	it('falls back to an anonymous request when the token has expired', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'expired' }) })
			.mockResolvedValueOnce({ ok: true, status: 200, json: async () => board });
		vi.stubGlobal('fetch', fetchMock);

		const result = await getScoreboard('hard', { accessToken: 'stale' });

		expect(result.success).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[1][1]).toBeUndefined();
	});

	it('reports a server error and a network failure without throwing', async () => {
		mockFetch(400, { error: 'bad difficulty' });
		expect(await getScoreboard('hard')).toEqual({ success: false, error: 'bad difficulty' });

		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
		const result = await getScoreboard('hard');
		expect(result.success).toBe(false);
		expect(result.error).toMatch(/could not reach the server/i);
	});
});

describe('describeAnyPoints', () => {
	it('lists each difficulty with its points, easiest first', () => {
		expect(describeAnyPoints({ easy: 1, normal: 2, hard: 3, very_hard: 4, tas: 5 })).toBe(
			'Easy +1 · Normal +2 · Hard +3 · Very Hard +4 · TAS!?!? +5'
		);
	});

	it('skips a difficulty the server did not send', () => {
		expect(describeAnyPoints({ easy: 1 })).toBe('Easy +1');
	});
});