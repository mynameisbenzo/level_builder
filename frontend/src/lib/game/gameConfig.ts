import Phaser from 'phaser';
import { PlatformerScene } from './PlatformerScene';
import { LevelEditorScene } from './LevelEditorScene';
import { deserializeLevelContent, type LevelContent } from './levelContent';
import { GHOSTS_REGISTRY_KEY, type GhostSet } from './ghost';
import {
	OpponentBuffer,
	RACE_LOCKED_KEY,
	RACE_MODE_KEY,
	RACE_OPPONENTS_KEY,
	RACE_ROSTER_KEY
} from './raceOpponents';
import { writeCheckpointCarry, type CheckpointCarry } from './checkpoints';

export interface CreateGameConfigOptions {
	/**
	 * 'edit' registers both scenes, same as always - the existing
	 * "test my level" flow (toggling between LevelEditorScene and
	 * PlatformerScene within one session) needs both present.
	 * 'play' registers ONLY PlatformerScene - deliberately no way to
	 * ever reach LevelEditorScene from here at all, since /play/[slug]
	 * is a public route anyone can load, and a stranger playing someone
	 * else's published level should never be able to toggle into
	 * editing it.
	 */
	startMode: 'edit' | 'play';
	/** The level's content to seed the game with, if resuming/loading
	 * an existing level rather than starting a brand-new, empty one. */
	content?: LevelContent;
	/** The level's ghosts (full / before / after), replayed in 'play'
	 * mode. Can also be (re)seeded later via game.registry.set(
	 * GHOSTS_REGISTRY_KEY, ghosts) before a restart. */
	ghosts?: GhostSet;
	/** Start the level with a checkpoint already reached - how an endless
	 * run, which boots a brand-new game after every death, keeps the
	 * player's checkpoint across the restart. */
	checkpoint?: CheckpointCarry;
	/** A live race: the player starts locked (until the page unlocks it at GO),
	 * the other racers are drawn from a position buffer the page fills, and the
	 * scene reports finishing instead of showing the result modal. */
	race?: boolean;
}

export function createGameConfig(
	parent: HTMLElement,
	options: CreateGameConfigOptions
): Phaser.Types.Core.GameConfig {
	return {
		type: Phaser.AUTO,
		parent,
		backgroundColor: '#1d1d2e',
		// Draws every texture-based game object at whole-integer screen
		// positions. The hairline gaps between adjacent background tiles
		// (see backgrounds.ts) aren't atlas/texture bleed - forcing that
		// atlas's filter to NEAREST didn't fix them - they're a
		// sub-pixel rounding seam between two separately positioned,
		// edge-to-edge Image game objects, which shows up specifically
		// because `scale.mode: FIT` below stretches the fixed 800x600
		// logical resolution to fill the browser window at whatever
		// (generally non-integer) factor the actual window size works
		// out to. roundPixels snaps every such object's final rendered
		// position to a whole pixel, which is what actually closes a
		// gap of this kind - see
		// https://docs.phaser.io/api-documentation/typedef/types-core#roundpixels.
		roundPixels: true,
		pixelArt: true,
		scale: {
			mode: Phaser.Scale.FIT,
			autoCenter: Phaser.Scale.CENTER_BOTH,
			width: 800,
			height: 600
		},
		physics: {
			default: 'arcade',
			arcade: {
				gravity: { x: 0, y: 0 },
				debug: false
			}
		},
		input: {
			gamepad: true
		},
		scene: options.startMode === 'play' ? [PlatformerScene] : [LevelEditorScene, PlatformerScene],
		callbacks: {
			// Fires once Phaser's own core systems are ready but before
			// the first scene's own create() runs - confirmed directly
			// against Phaser's type definitions ("A function to run at
			// the end of the boot sequence. At this point, all the game
			// systems have started..."). Seeding the registry here means
			// the first scene's create() - which already reads
			// placedObjects/spawnPosition/etc. straight out of the
			// registry, exactly as it always has - sees this content as
			// if it had always been there. No separate scene-init
			// data-passing needed, no assumption about JS-tick timing
			// between `new Phaser.Game()` returning and scenes actually
			// booting.
			postBoot: (game) => {
				if (options.content) {
					deserializeLevelContent(game.registry, options.content);
				}
				if (options.ghosts) {
					game.registry.set(GHOSTS_REGISTRY_KEY, options.ghosts);
				}
				if (options.checkpoint) {
					writeCheckpointCarry(game.registry, options.checkpoint);
				}
				if (options.race) {
					// The race page may already have set some of these (it runs
					// on its own timers, e.g. an unlock for a race already under
					// way), so only fill in what is missing.
					game.registry.set(RACE_MODE_KEY, true);
					if (!game.registry.has(RACE_LOCKED_KEY)) game.registry.set(RACE_LOCKED_KEY, true);
					if (!game.registry.has(RACE_OPPONENTS_KEY)) {
						game.registry.set(RACE_OPPONENTS_KEY, new OpponentBuffer());
					}
					if (!game.registry.has(RACE_ROSTER_KEY)) game.registry.set(RACE_ROSTER_KEY, []);
				}
			}
		}
	};
}