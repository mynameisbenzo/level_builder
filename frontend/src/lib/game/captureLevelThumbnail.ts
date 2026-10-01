import Phaser from 'phaser';
import { createGameConfig } from './gameConfig';
import type { LevelContent } from './levelContent';

// A small, fixed resolution - this is a list-view thumbnail, not a
// full playthrough, so there's no reason to capture at the editor's
// own 800x600 game resolution (see gameConfig.ts) and ship that much
// image data around for every publish.
const THUMBNAIL_WIDTH = 480;
const THUMBNAIL_HEIGHT = 360;

// Publishing must never hang indefinitely waiting on a capture that,
// for whatever reason (a WebGL context that fails to initialize, a
// scene that throws during create()), never actually renders a frame.
const CAPTURE_TIMEOUT_MS = 4000;

/**
 * Renders the level's content in a fresh, offscreen PlatformerScene
 * instance - the same scene /play/[slug] uses, with no grid overlay
 * and no editor chrome (those only ever exist in LevelEditorScene,
 * never instantiated here - see gameConfig.ts's startMode: 'play',
 * which registers PlatformerScene alone) - and grabs the very first
 * rendered frame as a downscaled PNG data URL: the player at its
 * spawn position, camera already settled on it (see PlatformerScene's
 * own create(), which sets up camera follow before the first frame),
 * before gravity or any input has had a chance to move anything. This
 * is deliberately "play mode" in the literal sense - a genuine
 * PlatformerScene instance - not a hand-drawn approximation of one.
 *
 * The instance never attaches to the visible page (positioned far
 * off-screen, never made visible) and is always destroyed before this
 * resolves, whether it succeeds or not.
 *
 * Best-effort: resolves to null (never rejects) on any failure or
 * timeout, so a broken capture can never block publishing itself -
 * see its caller in edit/[slug]/+page.svelte, which treats a null
 * result as simply "no thumbnail this time," not an error to surface.
 */
export function captureLevelThumbnail(content: LevelContent): Promise<string | null> {
	return new Promise((resolve) => {
		const container = document.createElement('div');
		// Off-screen via position, not display:none - some renderers
		// size or behave oddly inside a display:none ancestor, and this
		// way never causes so much as a flash on the real page either.
		container.style.position = 'fixed';
		container.style.left = '-99999px';
		container.style.top = '0';
		container.style.width = `${THUMBNAIL_WIDTH}px`;
		container.style.height = `${THUMBNAIL_HEIGHT}px`;
		document.body.appendChild(container);

		let settled = false;
		let game: Phaser.Game | undefined;

		function finish(result: string | null) {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			try {
				game?.destroy(true);
			} catch {
				// Best-effort cleanup - a teardown failure shouldn't
				// prevent resolving with whatever result was already
				// captured (or the null fallback).
			}
			container.remove();
			resolve(result);
		}

		const timeoutId = setTimeout(() => finish(null), CAPTURE_TIMEOUT_MS);

		try {
			const config = createGameConfig(container, { startMode: 'play', content });
			// Overrides gameConfig's default 800x600/Scale.FIT - this
			// instance is never shown to a person and never resized by a
			// real window, so it can just render at the exact resolution
			// the thumbnail itself needs.
			config.scale = {
				mode: Phaser.Scale.NONE,
				width: THUMBNAIL_WIDTH,
				height: THUMBNAIL_HEIGHT
			};

			// Attaching the CREATE listener here, inside postBoot,
			// rather than right after `new Phaser.Game()` returns, is
			// what actually guarantees it's registered before that
			// event can possibly fire - postBoot runs once the scene
			// manager has the scene added but strictly before that
			// scene's own create() runs (see gameConfig.ts's own
			// postBoot doc comment), whereas game.scene.getScene(...)
			// called right after construction returns is not
			// guaranteed to find it yet at all. PlatformerScene's own
			// preload() queues real, asynchronous network loads (the
			// character/tile spritesheet atlases - see atlases.ts), so
			// without this, a frame can easily render before any of
			// that has actually finished - capturing nothing but the
			// plain background color, which is exactly what an earlier
			// version of this function did wrong.
			const originalPostBoot = config.callbacks?.postBoot;
			config.callbacks = {
				...config.callbacks,
				postBoot: (bootedGame) => {
					originalPostBoot?.(bootedGame);

					const scene = bootedGame.scene.getScene('PlatformerScene');
					if (!scene) {
						finish(null);
						return;
					}

					scene.events.once(Phaser.Scenes.Events.CREATE, () => {
						// One more wait, for the render that actually
						// draws what create() just added - CREATE firing
						// doesn't by itself mean a frame with those
						// objects in it has been rendered yet.
						bootedGame.events.once(Phaser.Core.Events.POST_RENDER, () => {
							try {
								bootedGame.renderer.snapshot((image) => {
									if (image instanceof HTMLImageElement) {
										finish(image.src);
									} else {
										finish(null);
									}
								});
							} catch {
								finish(null);
							}
						});
					});
				}
			};

			game = new Phaser.Game(config);
		} catch {
			finish(null);
		}
	});
}