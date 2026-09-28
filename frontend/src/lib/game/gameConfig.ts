import Phaser from 'phaser';
import { PlatformerScene } from './PlatformerScene';
import { LevelEditorScene } from './LevelEditorScene';
import { deserializeLevelContent, type LevelContent } from './levelContent';

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
}

export function createGameConfig(
	parent: HTMLElement,
	options: CreateGameConfigOptions
): Phaser.Types.Core.GameConfig {
	return {
		type: Phaser.AUTO,
		parent,
		backgroundColor: '#1d1d2e',
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
			}
		}
	};
}