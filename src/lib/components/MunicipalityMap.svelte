<script lang="ts">
	import { onMount } from 'svelte';
	import type {
		ExpressionSpecification,
		GeoJSONSource,
		MapLayerMouseEvent,
		Map as MapLibreMap
	} from 'maplibre-gl';
	import { m } from '$paraglide/messages';
	import { theme } from '$lib/theme.svelte';
	import type { FeatureCollection } from 'geojson';

	type MarkerMunicipality = {
		id: string;
		name: string;
		lat: number;
		lon: number;
	};

	let {
		municipalities,
		selectedId = '',
		onSelect
	}: {
		municipalities: MarkerMunicipality[];
		selectedId?: string;
		onSelect: (id: string) => void;
	} = $props();

	// Key-free vector basemaps. The previous CARTO basemap (basemaps.cartocdn.com) now
	// serves watermarked "API KEY REQUIRED" placeholder tiles and cannot be used.
	const BASEMAP_STYLES = {
		light: 'https://tiles.openfreemap.org/styles/positron',
		dark: 'https://tiles.openfreemap.org/styles/dark'
	} as const;

	// Marker and label colours are pulled from the active basemap, because a single
	// palette cannot stay legible on both a near-white and a near-black canvas.
	const THEMES = {
		light: {
			marker: '#1d4ed8',
			markerStroke: '#ffffff',
			selected: '#111827',
			label: '#111827',
			labelHalo: 'rgba(255,255,255,0.92)',
			transitRegional: '#0369a1',
			transitSbahn: '#b91c1c',
			transitCasing: '#ffffff'
		},
		dark: {
			marker: '#60a5fa',
			markerStroke: '#0b1120',
			selected: '#f9fafb',
			label: '#e5e7eb',
			labelHalo: 'rgba(3,7,18,0.9)',
			transitRegional: '#7dd3fc',
			transitSbahn: '#f87171',
			transitCasing: '#0b1120'
		}
	} as const;

	let mapElement = $state<HTMLDivElement | null>(null);
	let map = $state<MapLibreMap | null>(null);
	let mapReady = $state(false);
	let showRailway = $state(false);
	let lastStyle = '';
	/** Retained so a basemap swap can re-seed the source; setStyle() drops the data. */
	let transitData = $state<FeatureCollection | null>(null);
	let transitRequested = $state(false);
	const TRANSIT_EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
	const TRANSIT_LAYERS = ['transit-regional-casing', 'transit-regional', 'transit-sbahn'];
	const activeTheme = $derived(theme.resolved === 'dark' ? THEMES.dark : THEMES.light);

	const toFeatureCollection = (list: MarkerMunicipality[]) => ({
		type: 'FeatureCollection' as const,
		features: list.map((municipality) => ({
			type: 'Feature' as const,
			geometry: {
				type: 'Point' as const,
				coordinates: [municipality.lon, municipality.lat]
			},
			properties: { id: municipality.id, name: municipality.name }
		}))
	});

	// The selected marker is expressed as a data-driven paint expression rather than
	// feature-state, so selection survives every setData() call without bookkeeping.
	const applySelection = () => {
		if (!mapReady || !map) return;
		const isSelected: ExpressionSpecification = ['==', ['get', 'id'], selectedId ?? ''];
		map.setPaintProperty('municipality-circles', 'circle-color', [
			'case',
			isSelected,
			activeTheme.selected,
			activeTheme.marker
		]);
		map.setPaintProperty('municipality-circles', 'circle-stroke-color', [
			'case',
			isSelected,
			activeTheme.selected,
			activeTheme.markerStroke
		]);
		map.setPaintProperty('municipality-circles', 'circle-radius', ['case', isSelected, 9, 7]);
	};

	const applyRailwayVisibility = () => {
		if (!mapReady || !map) return;
		for (const id of TRANSIT_LAYERS) {
			if (map.getLayer(id))
				map.setLayoutProperty(id, 'visibility', showRailway ? 'visible' : 'none');
		}
	};

	// Fetches the line geometry on the first toggle rather than at mount, so a visitor
	// who never looks at transit never pays for it.
	$effect(() => {
		if (!showRailway || transitRequested || !mapReady) return;
		transitRequested = true;
		void fetch(`${import.meta.env.BASE_URL}transit-lines.json`)
			.then((response) => response.json())
			.then((data: FeatureCollection) => {
				transitData = data;
				(map?.getSource('transit') as GeoJSONSource | undefined)?.setData(data);
			})
			.catch(() => {
				// The overlay is a nicety; a failed fetch just leaves it empty.
			});
	});

	// Keeps markers in sync with the data for the whole component lifetime, not just
	// the initial mount. The Leaflet version only ever created markers inside onMount.
	$effect(() => {
		const collection = toFeatureCollection(municipalities);
		if (!mapReady || !map) return;
		(map.getSource('municipalities') as GeoJSONSource | undefined)?.setData(collection);
	});

	$effect(() => {
		void selectedId;
		applySelection();
	});

	// A basemap swap throws away every paint property, and `load` re-fires, which
	// re-adds the data layers. Guarded on the style that is actually showing so the
	// initial paint does not trigger a redundant reload.
	$effect(() => {
		const style = theme.resolved === 'dark' ? BASEMAP_STYLES.dark : BASEMAP_STYLES.light;
		if (!mapReady || !map || style === lastStyle) return;
		lastStyle = style;
		map.setStyle(style);
		applySelection();
	});

	$effect(() => {
		void showRailway;
		applyRailwayVisibility();
	});

	onMount(() => {
		let disposed = false;
		let didFitBounds = false;

		const init = async () => {
			if (!mapElement || municipalities.length === 0 || disposed) return;

			const maplibregl = await import('maplibre-gl');

			// MapLibre derives its tile-parsing worker URL at runtime from its own chunk
			// URL, so Vite never emits it as an asset and the default 404s, leaving the
			// vector basemap blank. The `maplibre-gl-worker` Vite plugin emits the worker at
			// a known path; point MapLibre at it.
			maplibregl.setWorkerUrl(
				new URL('maplibre-gl-worker.mjs', new URL(import.meta.env.BASE_URL, location.origin)).href
			);
			if (disposed || !mapElement) return;

			lastStyle = theme.resolved === 'dark' ? BASEMAP_STYLES.dark : BASEMAP_STYLES.light;

			const instance = new maplibregl.Map({
				container: mapElement,
				style: lastStyle,
				attributionControl: { compact: true }
			});
			instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

			// Rebuilt from scratch on every `style.load`. `load` only fires for the first
			// style, so a setStyle() basemap swap would otherwise leave the map with the
			// basemap's own layers and none of ours.
			const addDataLayers = () => {
				if (disposed || instance.getLayer('municipality-circles')) return;

				instance.addSource('municipalities', {
					type: 'geojson',
					data: toFeatureCollection(municipalities)
				});

				instance.addLayer({
					id: 'municipality-circles',
					type: 'circle',
					source: 'municipalities',
					paint: {
						'circle-color': activeTheme.marker,
						'circle-opacity': 1,
						'circle-stroke-color': activeTheme.markerStroke,
						'circle-stroke-width': 2,
						'circle-radius': 7
					}
				});

				// Labels are a real symbol layer, so MapLibre resolves collisions instead of
				// stacking every municipality name on top of the next one.
				instance.addLayer({
					id: 'municipality-labels',
					type: 'symbol',
					source: 'municipalities',
					layout: {
						'text-field': ['get', 'name'],
						'text-font': ['Noto Sans Regular'],
						'text-size': 11,
						'text-offset': [1.1, 0.35],
						'text-anchor': 'left',
						'text-allow-overlap': false,
						'text-optional': true
					},
					paint: {
						'text-color': activeTheme.label,
						'text-halo-color': activeTheme.labelHalo,
						'text-halo-width': 1.6
					}
				});

				// Two plain line layers instead of the previous OpenRailwayMap raster,
				// which drew every siding, freight branch and disused line. The GeoJSON is
				// fetched the first time the overlay is switched on, so none of it rides
				// along with the page itself.
				instance.addSource('transit', {
					type: 'geojson',
					data: transitData ?? TRANSIT_EMPTY
				});

				// Casing first so the regional lines stay legible where they cross the
				// S-Bahn network in the city.
				instance.addLayer({
					id: 'transit-regional-casing',
					type: 'line',
					source: 'transit',
					filter: ['==', ['get', 'cls'], 'regional'],
					layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
					paint: {
						'line-color': activeTheme.transitCasing,
						'line-width': 5,
						'line-opacity': 0.75
					}
				});
				instance.addLayer({
					id: 'transit-regional',
					type: 'line',
					source: 'transit',
					filter: ['==', ['get', 'cls'], 'regional'],
					layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
					paint: { 'line-color': activeTheme.transitRegional, 'line-width': 2.4 }
				});
				instance.addLayer({
					id: 'transit-sbahn',
					type: 'line',
					source: 'transit',
					filter: ['==', ['get', 'cls'], 'sbahn'],
					layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
					paint: { 'line-color': activeTheme.transitSbahn, 'line-width': 2.8 }
				});

				applyRailwayVisibility();

				if (!didFitBounds) {
					const bounds = municipalities.reduce(
						(accumulator, municipality) => accumulator.extend([municipality.lon, municipality.lat]),
						new maplibregl.LngLatBounds()
					);
					instance.fitBounds(bounds, { padding: 48, duration: 0 });
					didFitBounds = true;
				}
			};

			instance.on('style.load', addDataLayers);
			instance.on('load', () => {
				map = instance;
				mapReady = true;
				applySelection();
			});

			const onCircleClick = (event: MapLayerMouseEvent) => {
				const id = event.features?.[0]?.properties?.id;
				if (typeof id === 'string') onSelect(id);
			};
			instance.on('click', 'municipality-circles', onCircleClick);
			instance.on('mouseenter', 'municipality-circles', () => {
				instance.getCanvas().style.cursor = 'pointer';
			});
			instance.on('mouseleave', 'municipality-circles', () => {
				instance.getCanvas().style.cursor = '';
			});
		};

		void init();

		return () => {
			disposed = true;
			map?.remove();
			map = null;
			mapReady = false;
		};
	});
</script>

<div class="relative">
	<div
		bind:this={mapElement}
		class="h-[78vh] min-h-[34rem] w-full overflow-hidden rounded-lg"
		aria-label={m.map_aria_label()}
	></div>

	{#if mapReady}
		<label
			class="absolute top-3 right-3 flex cursor-pointer items-center gap-2 rounded-md bg-white/95 px-2.5 py-1.5 text-xs font-medium text-neutral-700 shadow-sm ring-1 ring-neutral-300 dark:bg-neutral-900/95 dark:text-neutral-200 dark:ring-neutral-600"
		>
			<input
				type="checkbox"
				bind:checked={showRailway}
				class="h-3.5 w-3.5 rounded border-neutral-400 text-neutral-900 focus:ring-neutral-400"
			/>
			{m.railway_overlay()}
		</label>
	{/if}
</div>

<style>
	:global(.maplibregl-ctrl-attrib) {
		font-size: 10px;
	}

	@media (prefers-color-scheme: dark) {
		:global(.maplibregl-ctrl-attrib) {
			background-color: rgb(23 23 23 / 0.9);
			color: rgb(229 231 235);
		}

		:global(.maplibregl-ctrl-attrib a) {
			color: rgb(147 197 253);
		}

		:global(.maplibregl-ctrl-group) {
			background: #171717;
		}

		:global(.maplibregl-ctrl-group button + button) {
			border-top-color: #404040;
		}

		:global(.maplibregl-ctrl-group button .maplibregl-ctrl-icon) {
			filter: invert(1);
		}
	}
</style>
