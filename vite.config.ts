import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';

// MapLibre resolves its tile-parsing worker at runtime from its own bundle URL via
// `new URL('./maplibre-gl-worker.mjs', import.meta.url)`. Because that URL is computed
// rather than written literally, Vite sees no static `new Worker(new URL(...))` to
// analyse and emits no asset for it. The worker then 404s, the actor pool comes up
// empty ("No actors found"), and the vector basemap renders blank.
//
// The worker is an ES module that does `import './maplibre-gl-shared.mjs'`, so both
// files must land side by side at the site root or the worker fails to load and the map
// never fires its `load` event. The shared bundle has no imports of its own.
//
// MunicipalityMap.svelte points MapLibre at this path via `setWorkerUrl()`.
const MAPLIBRE_WORKER_FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'] as const;

function maplibreWorker(): Plugin {
	const require = createRequire(import.meta.url);
	const cache: Record<string, string> = {};

	const readWorkerFile = (name: string) => {
		cache[name] ??= readFileSync(require.resolve(`maplibre-gl/dist/${name}`), 'utf8');
		return cache[name];
	};

	return {
		name: 'maplibre-gl-worker',
		// The worker and its shared bundle are only ever fetched by the MapLibre worker
		// in the browser. Emitting them into the SSR bundle as well put 512 kB of dead
		// weight into the deployed Worker.
		applyToEnvironment: (environment) => environment.name === 'client',
		// Dev server: serve them from memory so `vite dev` matches the production build.
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				const name = MAPLIBRE_WORKER_FILES.find((file) => request.url?.endsWith(`/${file}`));
				if (!name) return next();
				response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
				response.end(readWorkerFile(name));
			});
		},
		// Production build: emit them as top-level client assets.
		generateBundle() {
			for (const name of MAPLIBRE_WORKER_FILES) {
				this.emitFile({ type: 'asset', fileName: name, source: readWorkerFile(name) });
			}
		}
	};
}

export default defineConfig({
	plugins: [
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/paraglide',
			strategy: ['cookie', 'preferredLanguage', 'baseLocale']
		}),
		tailwindcss(),
		maplibreWorker(),
		sveltekit()
	],
	build: {
		// The only chunk over the default 500 kB line is MapLibre GL JS (~1.06 MB
		// minified, ~286 kB gzipped). It is already a dynamic `import()` inside
		// MunicipalityMap.svelte's onMount, so it is not in the initial payload, and
		// maplibre-gl ships a single entry point with no lighter build to swap in.
		// The limit is raised to acknowledge a deliberate trade rather than to hide a
		// regression — Leaflet, which this replaced, was 148 kB.
		chunkSizeWarningLimit: 1200
	}
});
