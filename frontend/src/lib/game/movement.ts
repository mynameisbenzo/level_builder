export interface HorizontalInput {
	left: boolean;
	right: boolean;
}

/**
 * Determines horizontal velocity from directional input.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getHorizontalVelocity(input: HorizontalInput, speed: number): number {
	if (input.left && input.right) return 0;
	if (input.left) return -speed;
	if (input.right) return speed;
	return 0;
}

/**
 * Computes the next frame's horizontal velocity, ramping toward the
 * target speed (whichever direction is held, or zero if neither/both are)
 * by at most `acceleration * deltaSeconds`, rather than snapping to it
 * instantly. This is the core "build-up" feel from 2D Mario games'
 * running mechanic - hold a direction and speed ramps up over time; let
 * go (or reverse direction) and it ramps back down the same way, passing
 * through zero naturally rather than needing special-case braking logic.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getAcceleratedVelocity(
	input: HorizontalInput,
	currentVelocity: number,
	maxSpeed: number,
	acceleration: number,
	deltaSeconds: number
): number {
	const direction = input.left && input.right ? 0 : input.left ? -1 : input.right ? 1 : 0;
	const targetVelocity = direction * maxSpeed;
	const maxDelta = acceleration * deltaSeconds;

	if (targetVelocity > currentVelocity) {
		return Math.min(targetVelocity, currentVelocity + maxDelta);
	}
	if (targetVelocity < currentVelocity) {
		return Math.max(targetVelocity, currentVelocity - maxDelta);
	}
	return currentVelocity;
}

/**
 * The P-meter's new value after this frame. Fills only while both the
 * dash button AND a direction are held (matching SMW: holding the run
 * button alone, standing still, doesn't build the meter) - drains
 * otherwise, at the same rate, whenever either condition stops holding.
 * Deliberately continuous rather than a snap to 0/full, so briefly
 * letting go doesn't instantly discard progress the way a boolean flag
 * would. Independent of grounded/airborne state - the meter keeps
 * filling or draining the same way in the air as on the ground.
 * Clamped to [0, maxMeterMs]. deltaMs matches Phaser's update() delta
 * parameter (ms since last frame).
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getPMeterValue(
	currentMeterMs: number,
	isDashHeld: boolean,
	isMoving: boolean,
	deltaMs: number,
	maxMeterMs: number
): number {
	if (isDashHeld && isMoving) {
		return Math.min(maxMeterMs, currentMeterMs + deltaMs);
	}
	return Math.max(0, currentMeterMs - deltaMs);
}

/**
 * Whether the P-meter has filled all the way - true P-speed only
 * unlocks once the meter is completely full, not just from holding
 * dash. A meter that's partway full (e.g. still draining from a recent
 * release) does not count.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function isPMeterFull(meterMs: number, maxMeterMs: number): boolean {
	return meterMs >= maxMeterMs;
}

/**
 * The effective top speed for the current dash/P-speed state - three
 * tiers, matching SMW's walk/run/P-speed progression: walking (dash not
 * held), running (dash held, but the meter hasn't filled yet), or full
 * P-speed (meter full). Each tier is a progressively higher cap; which
 * one applies is a simple priority check, not a blend between them.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getMaxSpeedForDashState(
	isDashHeld: boolean,
	pMeterFull: boolean,
	walkSpeed: number,
	runSpeed: number,
	pSpeedTopSpeed: number
): number {
	if (pMeterFull) {
		return pSpeedTopSpeed;
	}
	if (isDashHeld) {
		return runSpeed;
	}
	return walkSpeed;
}

/**
 * EXPERIMENTAL (purple's phase ability, on its own branch). Whether
 * phasing (passing through platforms and other solid objects) should be
 * active this frame - requires the character to have the ability, the
 * dash button to currently be held, and for less than maxDurationMs to
 * have elapsed since dash was last pressed (dashHeldSinceTime is the
 * timestamp of that press, not of whenever phasing itself started).
 * Deliberately does NOT restart the window just because dash is still
 * held past the cap - dash has to be released and pressed again to
 * phase a second time. Without that, holding dash continuously would
 * let phasing simply resume every frame past the cap, making the "1
 * second max" limit meaningless - the same "no free indefinite renewal"
 * principle as the float ability's budget (hasFloatBudgetExpired),
 * adapted here to a directly-held ability rather than one triggered by
 * a release-then-repress gesture.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function isPhasingActive(
	hasPhaseAbility: boolean,
	isDashHeld: boolean,
	dashHeldSinceTime: number,
	currentTime: number,
	maxDurationMs: number
): boolean {
	return hasPhaseAbility && isDashHeld && currentTime - dashHeldSinceTime < maxDurationMs;
}

export interface JumpInput {
	jumpJustPressed: boolean;
	onGround: boolean;
}

/**
 * Determines whether a jump should trigger, and at what velocity.
 * Returns null when no jump should occur (e.g. airborne, or key not pressed).
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getJumpVelocity(input: JumpInput, jumpVelocity: number): number | null {
	if (input.jumpJustPressed && input.onGround) {
		return jumpVelocity;
	}
	return null;
}

/**
 * Implements variable jump height ("jump cut"): releasing the jump button
 * while still moving upward reduces the remaining upward velocity,
 * cutting the jump short instead of letting it continue to its full arc.
 * Holding the button through the whole ascent leaves gravity alone to
 * determine the peak height, uncut. Returns the velocity to apply, or
 * null if nothing should change this frame (button still held, or
 * already at/past the peak so there's nothing left to cut).
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getJumpCutVelocity(
	velocityY: number,
	isJumpHeld: boolean,
	cutMultiplier: number
): number | null {
	if (isJumpHeld) {
		return null;
	}
	if (velocityY >= 0) {
		return null;
	}
	return velocityY * cutMultiplier;
}

/**
 * Converts a jump apex-height multiplier into the velocity multiplier
 * that actually produces it. Jump height scales with the square of
 * initial velocity under constant gravity (h = v^2 / (2g)), so reaching
 * an apex that's N times higher requires velocity scaled by sqrt(N), not
 * N directly - a "50% higher jump" is not the same thing as "50% more
 * launch velocity", which would actually produce a 125% higher apex.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getJumpVelocityMultiplier(heightMultiplier: number): number {
	return Math.sqrt(heightMultiplier);
}

/**
 * Determines whether an analog stick axis value counts as "pressed" in a
 * direction, ignoring small values caused by stick drift/noise.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function exceedsDeadzone(axisValue: number, deadzone: number): boolean {
	return Math.abs(axisValue) > deadzone;
}

/**
 * Detects whether the player has fallen far enough below the bottom of the
 * screen to count as "fallen off" - with no ground currently in Play mode,
 * this is what sends the player back to the Level Editor rather than
 * letting them fall forever.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function hasFallenOffScreen(
	playerY: number,
	screenHeight: number,
	threshold: number
): boolean {
	return playerY > screenHeight + threshold;
}

/**
 * Detects a "just pressed" rising edge (was up last frame, is down this
 * frame) for input sources without a native JustDown helper - gamepad
 * buttons and touch buttons both need this same manual comparison.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function hasRisingEdge(isDownNow: boolean, wasDownLastFrame: boolean): boolean {
	return isDownNow && !wasDownLastFrame;
}

/**
 * Whether a jump-button press while airborne should engage floating -
 * requires the character to have the ability, be airborne already (a
 * grounded press is just a normal jump instead), not already floating,
 * and for this to be a fresh press specifically - not a continued hold
 * from the jump that got the character airborne in the first place.
 * That's what makes this a deliberate second action rather than "hold
 * jump the whole time to float", which would remove the meaning of the
 * existing jump-cut mechanic.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
/**
 * Whether a jump-button press while airborne should engage floating -
 * requires the character to have the ability, be airborne already (a
 * grounded press is just a normal jump instead), not already floating,
 * for this to be a fresh press specifically (not a continued hold from
 * the jump that got the character airborne in the first place), and for
 * the float time budget not to already be used up for this airborne
 * period (see hasFloatBudgetExpired) - otherwise letting the budget run
 * out, falling briefly, and immediately re-pressing jump would reset the
 * clock and let floating continue indefinitely. Landing and jumping
 * again is the only way to get a fresh budget.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function shouldStartFloating(
	hasFloatAbility: boolean,
	onGround: boolean,
	isFloating: boolean,
	jumpJustPressed: boolean,
	floatBudgetExpired: boolean
): boolean {
	return hasFloatAbility && !onGround && !isFloating && jumpJustPressed && !floatBudgetExpired;
}

/**
 * Whether floating should end this frame - releasing jump, or landing,
 * both stop it (combined with OR, so either alone is sufficient).
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function shouldStopFloating(
	isFloating: boolean,
	onGround: boolean,
	isJumpHeld: boolean
): boolean {
	return isFloating && (onGround || !isJumpHeld);
}

/**
 * The vertical velocity to apply while floating: a continuous sine-wave
 * oscillation rather than a flat, motionless hold - this is what gives
 * floating its "hover and gently bounce in place" feel, and doubles as
 * the visual bounce animation itself (no separate sprite animation
 * needed - the physical motion is the animation). Net velocity across
 * one full cycle is zero, so the character's average height stays put
 * rather than slowly sinking or climbing. time is in milliseconds
 * (matches Phaser's update() time parameter); periodMs is how long one
 * full up-down cycle takes; amplitudePxPerSec is the peak velocity
 * magnitude in each direction.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getFloatVelocity(
	time: number,
	amplitudePxPerSec: number,
	periodMs: number
): number {
	return Math.sin((time / periodMs) * Math.PI * 2) * amplitudePxPerSec;
}

/**
 * Whether the float time budget for the current airborne period has run
 * out - tracked from the moment the character left the ground (any
 * jump, not specifically when floating started), not from when floating
 * itself began. This is what closes an exploit where floating for the
 * full duration, falling briefly once it's cut off, and immediately
 * re-pressing jump would otherwise reset the clock and allow floating
 * indefinitely via repeated release-and-re-press. The budget only
 * resets on landing - the next jump from grounded overwrites the
 * tracked start time fresh (see PlatformerScene).
 * airborneStartTime and currentTime are both in milliseconds (matching
 * Phaser's update() time parameter) - currentTime is expected to be the
 * larger of the two.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function hasFloatBudgetExpired(
	airborneStartTime: number,
	currentTime: number,
	maxDurationMs: number
): boolean {
	return currentTime - airborneStartTime >= maxDurationMs;
}

export type PlayerPose = 'jump' | 'duck' | 'walk' | 'idle';

/**
 * Decides which pose the player should be in. Priority: airborne always
 * wins (you can't meaningfully duck or walk mid-air), then ducking
 * overrides walking, then walking overrides idle.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function getPlayerPose(
	onGround: boolean,
	isDucking: boolean,
	velocityX: number
): PlayerPose {
	if (!onGround) {
		return 'jump';
	}
	if (isDucking) {
		return 'duck';
	}
	if (velocityX !== 0) {
		return 'walk';
	}
	return 'idle';
}