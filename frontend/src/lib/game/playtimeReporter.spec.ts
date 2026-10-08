import { describe, expect, it, vi } from 'vitest';
import { PlaytimeReporter, type PlaytimeTransport, type WinReport } from './playtimeReporter';

function transport(overrides: Partial<PlaytimeTransport> = {}) {
	const calls: string[] = [];
	const t: PlaytimeTransport = {
		heartbeat: vi.fn(async (slug, ms) => {
			calls.push(`beat:${slug}:${ms}`);
			return true;
		}),
		win: vi.fn(async (slug, ms) => {
			calls.push(`win:${slug}:${ms}`);
			return { success: true, totalMs: ms, isRecord: true } as WinReport;
		}),
		...overrides
	};
	return { t, calls };
}

describe('PlaytimeReporter', () => {
	it('sends heartbeats and wins in order', async () => {
		const { t, calls } = transport();
		const reporter = new PlaytimeReporter(t);

		void reporter.report('a', 3000);
		void reporter.report('a', 2000);
		const win = await reporter.win('a', 1500);

		expect(calls).toEqual(['beat:a:3000', 'beat:a:2000', 'win:a:1500']);
		expect(win).toMatchObject({ success: true, isRecord: true });
	});

	it('skips an empty report', async () => {
		const { t } = transport();
		const reporter = new PlaytimeReporter(t);

		await reporter.report('a', 0);

		expect(t.heartbeat).not.toHaveBeenCalled();
	});

	it('carries time a failed heartbeat could not deliver into the next one', async () => {
		let ok = false;
		const { t, calls } = transport({
			heartbeat: vi.fn(async (slug, ms) => {
				calls.push(`beat:${slug}:${ms}`);
				return ok;
			})
		});
		const reporter = new PlaytimeReporter(t);

		await reporter.report('a', 4000);
		expect(reporter.carriedMs('a')).toBe(4000);

		ok = true;
		await reporter.report('a', 1000);

		expect(calls).toEqual(['beat:a:4000', 'beat:a:5000']);
		expect(reporter.carriedMs('a')).toBe(0);
	});

	it('adds carried time to the win report', async () => {
		const { t, calls } = transport({ heartbeat: vi.fn(async () => false) });
		const reporter = new PlaytimeReporter(t);

		await reporter.report('a', 4000);
		await reporter.win('a', 2000);

		expect(calls).toEqual(['win:a:6000']);
	});

	it('keeps a failed win for later and keeps levels apart', async () => {
		const { t, calls } = transport({ win: vi.fn(async () => null) });
		const reporter = new PlaytimeReporter(t);

		expect(await reporter.win('a', 2500)).toBeNull();
		expect(reporter.carriedMs('a')).toBe(2500);
		expect(reporter.carriedMs('b')).toBe(0);

		await reporter.report('b', 1000);
		expect(calls).toEqual(['beat:b:1000']);
	});

	it('survives a transport that throws', async () => {
		const { t } = transport({
			heartbeat: vi.fn(async () => {
				throw new Error('boom');
			})
		});
		const reporter = new PlaytimeReporter(t);

		await expect(reporter.report('a', 1000)).resolves.toBeUndefined();
		expect(reporter.carriedMs('a')).toBe(1000);
	});
});