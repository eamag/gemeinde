<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import type { CircleMarker, Map as LeafletMap } from 'leaflet';
	import 'leaflet/dist/leaflet.css';
	import { m } from '$paraglide/messages';

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

	let mapElement = $state<HTMLDivElement | null>(null);
	let markerById = new SvelteMap<string, CircleMarker>();
	let map: LeafletMap | null = null;

	const applyMarkerStyle = (id: string) => {
		const marker = markerById.get(id);
		if (!marker) return;
		const selected = id === selectedId;
		marker.setStyle({
			color: selected ? '#111827' : '#ffffff',
			fillColor: selected ? '#111827' : '#1d4ed8',
			fillOpacity: 1,
			weight: 2,
			radius: 7
		});
	};

	onMount(() => {
		let disposed = false;
		const cleanup = () => {
			markerById.clear();
			map?.remove();
			map = null;
		};

		const init = async () => {
			if (!mapElement || municipalities.length === 0 || disposed) return;

			const leaflet = await import('leaflet');
			if (disposed || !mapElement) return;

			map = leaflet.map(mapElement, {
				zoomControl: true,
				scrollWheelZoom: true
			});

			const osmBaseLayer = leaflet.tileLayer(
				'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
				{
					attribution:
						'&copy; OpenStreetMap-Mitwirkende, &copy; <a href="https://carto.com/attributions">CARTO</a>',
					maxZoom: 19,
					className: 'basemap-muted'
				}
			);
			osmBaseLayer.addTo(map);

			const baseLabelsLayer = leaflet.tileLayer(
				'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
				{
					attribution:
						'&copy; OpenStreetMap-Mitwirkende, &copy; <a href="https://carto.com/attributions">CARTO</a>',
					maxZoom: 19
				}
			);
			baseLabelsLayer.addTo(map);

			const railwayOverlayLayer = leaflet.tileLayer(
				'https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',
				{
					attribution: '&copy; OpenRailwayMap, &copy; OpenStreetMap-Mitwirkende',
					maxZoom: 19,
					opacity: 0.55,
					className: 'railway-muted'
				}
			);

			leaflet.control
				.layers(
					{
						OpenStreetMap: osmBaseLayer
					},
					{
						[m.railway_overlay()]: railwayOverlayLayer
					},
					{
						collapsed: true
					}
				)
				.addTo(map);

			const bounds = leaflet.latLngBounds(
				municipalities.map(
					(municipality) => [municipality.lat, municipality.lon] as [number, number]
				)
			);
			map.fitBounds(bounds.pad(0.12));

			for (const municipality of municipalities) {
				const marker = leaflet
					.circleMarker([municipality.lat, municipality.lon], {
						color: '#ffffff',
						fillColor: '#1d4ed8',
						fillOpacity: 1,
						weight: 2,
						radius: 7
					})
					.addTo(map);

				marker.bindTooltip(municipality.name, {
					permanent: true,
					direction: 'right',
					offset: [9, 0],
					className: 'municipality-label'
				});

				marker.on('click', () => onSelect(municipality.id));
				markerById.set(municipality.id, marker);
				applyMarkerStyle(municipality.id);
			}
		};

		void init();

		return () => {
			disposed = true;
			cleanup();
		};
	});

	$effect(() => {
		for (const municipality of municipalities) {
			applyMarkerStyle(municipality.id);
		}
	});
</script>

<div
	bind:this={mapElement}
	class="h-[78vh] min-h-[34rem] w-full overflow-hidden rounded-lg"
	aria-label={m.map_aria_label()}
></div>

<style>
	:global(.basemap-muted) {
		filter: grayscale(0.75) saturate(0.45) brightness(1.02);
	}

	:global(.railway-muted) {
		filter: grayscale(0.15) saturate(0.8) contrast(1.05);
	}

	:global(.municipality-label) {
		background: rgb(255 255 255 / 0.9);
		border: 0;
		border-radius: 4px;
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.16);
		color: #111827;
		font-size: 10px;
		font-weight: 600;
		line-height: 1.2;
		padding: 2px 5px;
	}

	:global(.municipality-label::before) {
		display: none;
	}
</style>
