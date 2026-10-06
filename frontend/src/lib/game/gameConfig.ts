import Phaser from 'phaser';
import { PlatformerScene } from './PlatformerScene';
import { LevelEditorScene } from './LevelEditorScene';
import { deserializeLevelContent, type LevelContent } from './levelContent';
import { GHOST_REGISTRY_KEY, type GhostRun } from './ghost';

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
	/** The level's fastest recorded clear, replayed as a ghost in 'play'
	 * mode. Can also be (re)seeded later via game.registry.set(
	 * GHOST_REGISTRY_KEY, ghost) before a restart. */
	ghost?: GhostRun;
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
				if (options.ghost) {
					game.registry.set(GHOST_REGISTRY_KEY, options.ghost);
				}
			}
		}
	};
}