import { describe, expect, it } from 'vitest';
import { getPlayerFrameForPose, getPlayerPoseConfig, PLAYER_WALK_FRAME_DURATION_MS } from './playerPose';

describe('getPlayerFrameForPose', () => {
	it('returns the static frame for non-walking poses', () => {
		expect(getPlayerFrameForPose('pink', 'idle', 0)).toBe(getPlayerPoseConfig('pink').idle.frame);
		expect(getPlayerFrameForPose('pink', 'jump', 999)).toBe(getPlayerPoseConfig('pink').jump.frame);
		expect(getPlayerFrameForPose('pink', 'duck', 5)).toBe(getPlayerPoseConfig('pink').duck.frame);
	});

	it('alternates the two walk frames over time', () => {
		const a = getPlayerFrameForPose('green', 'walk', 0);
		const b = getPlayerFrameForPose('green', 'walk', PLAYER_WALK_FRAME_DURATION_MS);
		expect(a).toBe('character_green_walk_a');
		expect(b).toBe('character_green_walk_b');
		expect(getPlayerFrameForPose('green', 'walk', PLAYER_WALK_FRAME_DURATION_MS * 2)).toBe(a);
	});

	it('uses the requested color', () => {
		expect(getPlayerFrameForPose('yellow', 'walk', 0)).toBe('character_yellow_walk_a');
	});

	it('treats negative time as the start of the cycle', () => {
		expect(getPlayerFrameForPose('green', 'walk', -50)).toBe('character_green_walk_a');
	});
});