import { writable } from 'svelte/store';
import type { GameMode } from './mode';

/**
 * Tracks which Phaser scene is currently active so the HTML touch-controls
 * overlay (which lives outside the canvas) knows what to render - movement
 * and jump buttons only make sense in Play mode; the mode-toggle button is
 * relevant in both.
 */
export const currentMode = writable<GameMode>('edit');