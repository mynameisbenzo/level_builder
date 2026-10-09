import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createRoom,
	decodeTicketClaims,
	fetchRaceTicket,
	formatResetTime,
	getBudget,
	getRoomInfo,
	parseRoomCode,
	roomSocketUrl
} from './raceApi';

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

const b64 = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fakeTicket = (claims: Record<string, unknown>) => `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;

describe('decodeTicketClaims', () => {
	it('reads the display claims', () => {
		expect(decodeTicketClaims(fakeTicket({ sub: 'u1', username: 'Lorenzo', paid: true }))).toEqual({
			userId: 'u1',
			username: 'Lorenzo',
			paid: true
		});
	});

	it('treats a missing paid flag as free, and junk as nothing', () => {
		expect(decodeTicketClaims(fakeTicket({ sub: 'u1', username: 'x' }))?.paid).toBe(false);
		expect(decodeTicketClaims('not-a-ticket')).toBeNull();
		expect(decodeTicketClaims(fakeTicket({ username: 'x' }))).toBeNull();
	});
});

describe('parseRoomCode', () => {
	it('accepts a bare code in any case', () => {
		expect(parseRoomCode(' abc234 ')).toBe('ABC234');
	});

	it('pulls the code out of a pasted invite link', () => {
		expect(parseRoomCode('https://level-builder-frontend.onrender.com/race/hjk789')).toBe('HJK789');
		expect(parseRoomCode('http://localhost:5173/race/HJK789?x=1')).toBe('HJK789');
	});

	it('rejects the wrong length and the look-alike characters', () => {
		expect(parseRoomCode('ABC23')).toBeNull();
		expect(parseRoomCode('ABC2345')).toBeNull();
		expect(parseRoomCode('ABC0O1')).toBeNull();
		expect(parseRoomCode('')).toBeNull();
	});
});

describe('fetchRaceTicket', () => {
	it('returns the ticket and its claims', async () => {
		const ticket = fakeTicket({ sub: 'u1', username: 'Lorenzo', paid: false });
		const fetchMock = mockFetch(200, { ticket, expires_in: 120 });
		const result = await fetchRaceTicket('access');
		expect(result.success).toBe(true);
		expect(result.data?.claims.username).toBe('Lorenzo');
		expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/race\/ticket$/);
		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer access');
	});

	it('flags an expired login so the caller can refresh', async () => {
		mockFetch(401, { msg: 'Token has expired' });
		expect(await fetchRaceTicket('old')).toMatchObject({ success: false, sessionExpired: true });
	});

	it('words the races-off case kindly', async () => {
		mockFetch(503, { error: 'races are not set up', code: 'races_unavailable' });
		expect((await fetchRaceTicket('a')).error).toBe('Races are not available right now.');
	});

	it('survives a network failure', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
		expect((await fetchRaceTicket('a')).success).toBe(false);
	});
});

describe('race server calls', () => {
	it('creates a room with the ticket', async () => {
		const fetchMock = mockFetch(201, { code: 'ABC234' });
		const result = await createRoom('tkt');
		expect(result.data?.code).toBe('ABC234');
		expect(fetchMock.mock.calls[0][1].method).toBe('POST');
		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tkt');
	});

	it('explains why a free account cannot host', async () => {
		mockFetch(403, { error: 'host_must_be_paid' });
		expect((await createRoom('tkt')).error).toBe('Hosting a race needs a paid account.');
	});

	it('loads the budget and room info', async () => {
		mockFetch(200, { racesToday: 2, atCapacity: false });
		expect((await getBudget()).data?.racesToday).toBe(2);
		const fetchMock = mockFetch(200, { exists: true, hostName: 'Hosty' });
		expect((await getRoomInfo('ABC234', 'tkt')).data?.hostName).toBe('Hosty');
		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tkt');
	});

	it('reports an unknown room', async () => {
		mockFetch(404, { exists: false });
		expect(await getRoomInfo('ABC234')).toMatchObject({ success: false, status: 404 });
	});
});

describe('helpers', () => {
	it('builds the socket url with an encoded ticket', () => {
		expect(roomSocketUrl('ABC234', 'a.b/c')).toMatch(/^wss?:\/\/.+\/api\/rooms\/ABC234\/ws\?ticket=a\.b%2Fc$/);
	});

	it('shows the reset time in Pacific time', () => {
		expect(formatResetTime('2026-10-10T00:00:00.000Z')).toBe('5:00 PM PDT');
		expect(formatResetTime('2026-12-10T00:00:00.000Z')).toBe('4:00 PM PST');
	});
});