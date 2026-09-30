import { beforeEach, describe, expect, it } from 'vitest';
import {
	clearModeTogglePressed,
	requestModeToggle,
	setTouchDash,
	setTouchDirection,
	setTouchDuck,
	setTouchJump,
	touchInputState
} from './touchInput';

beforeEach(() => {
	touchInputState.left = false;
	touchInputState.right = false;
	touchInputState.jump = false;
	touchInputState.dash = false;
	touchInputState.duck = false;
	touchInputState.modeTogglePressed = false;
});

describe('setTouchDirection', () => {
	it('sets left pressed', () => {
		setTouchDirection('left', true);
		expect(touchInputState.left).toBe(true);
		expect(touchInputState.right).toBe(false);
	});

	it('sets right pressed', () => {
		setTouchDirection('right', true);
		expect(touchInputState.right).toBe(true);
		expect(touchInputState.left).toBe(false);
	});

	it('releases a direction', () => {
		setTouchDirection('left', true);
		setTouchDirection('left', false);
		expect(touchInputState.left).toBe(false);
	});
});

describe('setTouchJump', () => {
	it('sets jump pressed and released independently of direction state', () => {
		setTouchJump(true);
		expect(touchInputState.jump).toBe(true);
		setTouchJump(false);
		expect(touchInputState.jump).toBe(false);
	});
});

describe('setTouchDash', () => {
	it('sets dash pressed and released independently of other state', () => {
		setTouchDash(true);
		expect(touchInputState.dash).toBe(true);
		setTouchDash(false);
		expect(touchInputState.dash).toBe(false);
	});
});

describe('setTouchDuck', () => {
	it('sets duck pressed and released independently of other state', () => {
		setTouchDuck(true);
		expect(touchInputState.duck).toBe(true);
		setTouchDuck(false);
		expect(touchInputState.duck).toBe(false);
	});
});

describe('requestModeToggle / clearModeTogglePressed', () => {
	it('sets the flag on request', () => {
		requestModeToggle();
		expect(touchInputState.modeTogglePressed).toBe(true);
	});

	it('clears the flag on consume', () => {
		requestModeToggle();
		clearModeTogglePressed();
		expect(touchInputState.modeTogglePressed).toBe(false);
	});
});