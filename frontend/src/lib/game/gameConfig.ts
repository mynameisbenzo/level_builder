import Phaser from 'phaser';
import { PlatformerScene } from './PlatformerScene';
import { LevelEditorScene } from './LevelEditorScene';

export function createGameConfig(parent: HTMLElement): Phaser.Types.Core.GameConfig {
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
		scene: [LevelEditorScene, PlatformerScene]
	};
}