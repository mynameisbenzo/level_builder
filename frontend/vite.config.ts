import { existsSync, readFileSync } from 'fs';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

// Twitch OAuth requires HTTPS on every redirect URI, with no localhost
// exception - so local dev needs a real, locally-trusted certificate
// (via mkcert; see README) instead of plain HTTP. Conditional on the
// cert files actually existing, so `npm run build`/`test`/`check`
// still work anywhere that hasn't set mkcert up (CI, a fresh clone) -
// none of those commands ever touch the dev server's HTTPS config, so
// falling back to plain http here is harmless for them.
const certPath = '../certs/localhost+2.pem';
const keyPath = '../certs/localhost+2-key.pem';
const httpsConfig =
	existsSync(certPath) && existsSync(keyPath)
		? { cert: readFileSync(certPath), key: readFileSync(keyPath) }
		: undefined;

export default defineConfig({
	server: httpsConfig ? { https: httpsConfig } : undefined,
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Static adapter targets Render's static site hosting (and any CDN/static
			// host). fallback: 'index.html' enables SPA-style routing, needed because
			// the /play route disables SSR (Phaser needs a real browser).
			adapter: adapter({
				fallback: 'index.html'
			})
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});