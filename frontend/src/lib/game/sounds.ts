import type Phaser from 'phaser';

/**
 * Every sound this game currently knows how to play, one key per game
 * event. Enemy sounds aren't listed yet - there's nothing to trigger one
 * from until enemies actually exist. Background music isn't listed
 * either - the bundled Kenney pack has no looping track, and music needs
 * different handling than one-shot SFX anyway (a playMusic/stopMusic
 * pair that checks whether a track is already playing before starting a
 * new instance, so a scene reload doesn't restart or double it up) -
 * that's worth building once there's an actual track to plug into it,
 * not speculatively now.
 */
export const SOUND_ASSETS = {
	jump: '/assets/kenney/platformer-pack/Sounds/sfx_jump.ogg',
	characterSwap: '/assets/kenney/platformer-pack/Sounds/sfx_magic.ogg',
	death: '/assets/kenney/platformer-pack/Sounds/sfx_disappear.ogg',
	win: '/assets/kenney/platformer-pack/Sounds/sfx_gem.ogg',
	key: '/assets/kenney/platformer-pack/Sounds/sfx_coin.ogg'
} as const;

export type SoundKey = keyof typeof SOUND_ASSETS;

/**
 * Queues every declared sound for loading, skipping any already
 * registered. Same guarded pattern as the ensure* texture/atlas loaders
 * in textures.ts - safe to call from multiple scenes' preload().
 */
export function ensureSounds(scene: Phaser.Scene) {
	for (const key of Object.keys(SOUND_ASSETS) as SoundKey[]) {
		if (scene.cache.audio.exists(key)) {
			continue;
		}
		scene.load.audio(key, SOUND_ASSETS[key]);
	}
}

const VOLUME_STORAGE_KEY = 'soundVolume';
const MUTED_STORAGE_KEY = 'soundMuted';
const DEFAULT_VOLUME = 0.5;

/**
 * Parses a raw stored volume value into a valid [0, 1] number, falling
 * back to DEFAULT_VOLUME for anything missing, non-numeric, or out of
 * range. Takes the raw value as a parameter rather than reading
 * localStorage internally, so the parsing logic itself is pure and
 * testable independent of the browser API.
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function parseStoredVolume(raw: string | null): number {
	if (raw === null) {
		return DEFAULT_VOLUME;
	}
	const parsed = Number(raw);
	if (Number.isNaN(parsed)) {
		return DEFAULT_VOLUME;
	}
	return Math.min(1, Math.max(0, parsed));
}

/**
 * Parses a raw stored mute flag into a boolean, defaulting to unmuted
 * for anything missing or not exactly "true".
 * Pure function, no Phaser dependency, safe to unit test directly.
 */
export function parseStoredMuted(raw: string | null): boolean {
	return raw === 'true';
}

/**
 * Volume and mute persist via localStorage rather than the registry,
 * deliberately unlike every other setting in this project so far
 * (editor tool, style picker mode, player color are all registry-only
 * and reset on a hard refresh - a known, noted limitation). Nobody
 * expects to have to re-mute a game after every page reload, so this is
 * the first setting where surviving a refresh is the baseline
 * expectation, not a nice-to-have.
 */
export function getStoredVolume(): number {
	return parseStoredVolume(localStorage.getItem(VOLUME_STORAGE_KEY));
}

export function setStoredVolume(volume: number) {
	localStorage.setItem(VOLUME_STORAGE_KEY, String(Math.min(1, Math.max(0, volume))));
}

export function getStoredMuted(): boolean {
	return parseStoredMuted(localStorage.getItem(MUTED_STORAGE_KEY));
}

export function setStoredMuted(muted: boolean) {
	localStorage.setItem(MUTED_STORAGE_KEY, String(muted));
}

/**
 * Plays a one-shot sound effect, respecting the stored mute/volume
 * settings. Safe to call rapidly/repeatedly - Phaser's play() creates a
 * fresh instance each time rather than restarting a shared one, so
 * overlapping triggers (e.g. quick successive jumps) don't cut each
 * other off.
 */
export function playSfx(scene: Phaser.Scene, key: SoundKey) {
	if (getStoredMuted()) {
		return;
	}
	scene.sound.play(key, { volume: getStoredVolume() });
}