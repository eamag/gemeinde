<script lang="ts">
	import MunicipalityMap from '$lib/components/MunicipalityMap.svelte';
	import type { MunicipalityCoordinates, SourceSnapshot, SourceType } from '$lib/types/sources';
	import type { PageData } from './$types';
	import { m } from '$paraglide/messages';

	let { data }: { data: PageData } = $props();

	type VisibleSource = {
		type: 'offers_page' | 'amtsblatt';
		url: string;
		label: string;
		status: 'ok' | 'error';
		statusCode?: number;
	};

	type MappedMunicipality = {
		id: string;
		name: string;
		district: string;
		state: string;
		lat: number;
		lon: number;
		offers: VisibleSource | undefined;
		amtsblatt: VisibleSource | undefined;
	};

	const formatDateTime = (value: string) =>
		new Date(value).toLocaleString('de-DE', {
			dateStyle: 'medium',
			timeStyle: 'short'
		});

	const visibleTypes = ['offers_page', 'amtsblatt'] as const;
	const isVisibleType = (type: SourceType): type is 'offers_page' | 'amtsblatt' =>
		visibleTypes.includes(type as (typeof visibleTypes)[number]);

	const toVisibleSources = (sources: SourceSnapshot[]) => {
		const filtered = sources.filter((source) => isVisibleType(source.source.type));
		const seen: Record<string, true> = {};
		return filtered.filter((source) => {
			const key = `${source.source.type}::${source.source.url}`;
			if (seen[key]) return false;
			seen[key] = true;
			return true;
		});
	};

	const toSourceByType = (
		sources: SourceSnapshot[]
	): Partial<Record<'offers_page' | 'amtsblatt', VisibleSource>> => {
		const visible = toVisibleSources(sources);
		const lookup: Partial<Record<'offers_page' | 'amtsblatt', VisibleSource>> = {};
		for (const source of visible) {
			if (source.source.type === 'offers_page' || source.source.type === 'amtsblatt') {
				if (!lookup[source.source.type]) {
					lookup[source.source.type] = {
						type: source.source.type,
						url: source.source.url,
						label: source.source.label,
						status: source.status,
						statusCode: source.statusCode
					};
				}
			}
		}
		return lookup;
	};

	const coordinates = $derived((data.municipalityCoordinates ?? {}) as MunicipalityCoordinates);

	const mappedMunicipalities = $derived.by<MappedMunicipality[]>(() => {
		if (!data.sourcesIndex) return [];
		const municipalities: MappedMunicipality[] = [];
		for (const municipality of data.sourcesIndex.municipalities) {
			const coordinate = coordinates[municipality.id];
			if (!coordinate) continue;
			const lookup = toSourceByType(municipality.sources);
			municipalities.push({
				id: municipality.id,
				name: municipality.name,
				district: municipality.district,
				state: municipality.state,
				lat: coordinate.lat,
				lon: coordinate.lon,
				offers: lookup.offers_page,
				amtsblatt: lookup.amtsblatt
			});
		}
		return municipalities.sort((a, b) => a.name.localeCompare(b.name, 'de'));
	});

	let selectedId = $state('');

	$effect(() => {
		if (!mappedMunicipalities.length) {
			selectedId = '';
			return;
		}
		const hasSelection = mappedMunicipalities.some(
			(municipality) => municipality.id === selectedId
		);
		if (!hasSelection) {
			selectedId = mappedMunicipalities[0].id;
		}
	});

	const selectedMunicipality = $derived(
		mappedMunicipalities.find((municipality) => municipality.id === selectedId)
	);
</script>

<main class="w-full px-4 py-8 md:px-6">
	<header class="space-y-2">
		<h1 class="text-3xl font-bold tracking-tight">{m.page_title()}</h1>
		<p class="text-sm text-neutral-600">
			{m.page_description()}
		</p>
		{#if data.sourcesIndex}
			<p class="text-xs text-neutral-500">
				{m.last_update({ date: formatDateTime(data.sourcesIndex.generatedAt) })}
			</p>
		{/if}
	</header>

	{#if !data.sourcesIndex}
		<section class="mt-8 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
			<p class="font-medium">{m.no_data_title()}</p>
			<p class="mt-1">
				{m.no_data_description({
					command: 'bun run sources:update',
					file: 'data/generated/sources-index.json'
				})}
			</p>
		</section>
	{:else if mappedMunicipalities.length === 0}
		<section class="mt-8 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
			<p class="font-medium">{m.no_coordinates_title()}</p>
			<p class="mt-1">{m.no_coordinates_description()}</p>
		</section>
	{:else}
		<section class="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
			<div class="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
				<div class="rounded-lg border border-neutral-200">
					<MunicipalityMap
						municipalities={mappedMunicipalities}
						{selectedId}
						onSelect={(id) => (selectedId = id)}
					/>
				</div>
				<p class="mt-3 text-xs text-neutral-500">
					{m.municipalities_on_map({ count: mappedMunicipalities.length })} · {m.map_attribution()}
				</p>
			</div>

			<aside class="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
				{#if selectedMunicipality}
					<div class="space-y-1">
						<h2 class="text-xl font-semibold">{selectedMunicipality.name}</h2>
						<p class="text-xs text-neutral-500">
							{selectedMunicipality.district}, {selectedMunicipality.state}
						</p>
					</div>

					<div class="mt-5 space-y-3">
						<section class="rounded-lg border border-neutral-200 p-3">
							<p class="text-sm font-medium">{m.official_gazette()}</p>
							{#if selectedMunicipality.amtsblatt}
								<a
									class="mt-2 inline-block text-sm text-blue-700 underline decoration-blue-300 underline-offset-4 hover:text-blue-900"
									href={selectedMunicipality.amtsblatt.url}
									target="_blank"
									rel="noreferrer"
								>
									{m.open_link()}
								</a>
							{:else}
								<p class="mt-1 text-xs text-neutral-500">{m.no_gazette_link()}</p>
							{/if}
						</section>

						<section class="rounded-lg border border-neutral-200 p-3">
							<p class="text-sm font-medium">{m.property_offers()}</p>
							{#if selectedMunicipality.offers}
								<a
									class="mt-2 inline-block text-sm text-blue-700 underline decoration-blue-300 underline-offset-4 hover:text-blue-900"
									href={selectedMunicipality.offers.url}
									target="_blank"
									rel="noreferrer"
								>
									{m.open_link()}
								</a>
							{:else}
								<p class="mt-1 text-xs text-neutral-500">{m.no_property_link()}</p>
							{/if}
						</section>
					</div>
				{/if}
			</aside>
		</section>
	{/if}
</main>
