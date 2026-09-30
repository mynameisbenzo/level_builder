export interface TouchInputState {
	left: boolean;
	right: boolean;
	jump: boolean;
	dash: boolean;
	duck: boolean;
	modeTogglePressed: boolean;
}

/**
 * Plain mutable state shared between the HTML touch-button overlay (which
 * writes to it on touch events) and the active Phaser scene (which polls it
 * every frame, the same way it polls keyboard/gamepad state). This isn't a
 * Svelte store because Phaser scenes read it imperatively inside update(),
 * not reactively.
 */
export const touchInputState: TouchInputState = {
	left: false,
	right: false,
	jump: false,
	dash: false,
	duck: false,
	modeTogglePressed: false
};

export function setTouchDirection(direction: 'left' | 'right', pressed: boolean) {
	touchInputState[direction] = pressed;
}

export function setTouchJump(pressed: boolean) {
	touchInputState.jump = pressed;
}

/**
 * Dash (held, mirrors the keyboard's Shift key - see dashKey in
 * PlatformerScene) and duck (held, mirrors S/Down) both just hold their
 * boolean the whole time the button is down, the same as jump/direction
 * above - neither is a one-shot action like the mode toggle.
 */
export function setTouchDash(pressed: boolean) {
	touchInputState.dash = pressed;
}

export function setTouchDuck(pressed: boolean) {
	touchInputState.duck = pressed;
}

/**
 * Mode toggle is a one-shot action, not a held state - the button tap sets
 * this flag, and whichever scene notices it on the next update() should
 * both act on it AND consume it via clearModeTogglePressed(), mirroring
 * how Phaser's own JustDown() only fires once per press.
 */
export function requestModeToggle() {
	touchInputState.modeTogglePressed = true;
}

export function clearModeTogglePressed() {
	touchInputState.modeTogglePressed = false;
}