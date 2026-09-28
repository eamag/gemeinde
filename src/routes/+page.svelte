<script lang="ts">
	import MunicipalityMap from '$lib/components/MunicipalityMap.svelte';
	import type { VisibleSource, VisibleSourceType } from '$lib/server/sources';
	import type { PageData } from './$types';
	import { m } from '$paraglide/messages';
	import { getLocale } from '$paraglide/runtime';
	import { SITE_NAME, SITE_URL } from '$lib/site';

	// The page rendered a page_title message as an <h1> but never emitted a <title>,
	// so the document had no title at all. These are the document-level equivalents.
	const canonicalUrl = `${SITE_URL}/`;
	const description = $derived(m.page_description());
	const documentTitle = $derived(`${m.page_title()} – ${SITE_NAME}`);

	let { data }: { data: PageData } = $props();

	type MappedMunicipality = {
		id: string;
		name: string;
		district: string;
		state: string;
		lat: number;
		lon: number;
		offers_page: VisibleSource | null;
		amtsblatt: VisibleSource | null;
	};

	const formatDateTime = (value: string) =>
		new Date(value).toLocaleString('de-DE', {
			dateStyle: 'medium',
			timeStyle: 'short'
		});

	const coordinates = $derived(data.municipalityCoordinates);

	const mappedMunicipalities = $derived.by<MappedMunicipality[]>(() => {
		const municipalities: MappedMunicipality[] = [];
		for (const municipality of data.sourcesIndex.municipalities) {
			const coordinate = coordinates[municipality.id];
			if (!coordinate) continue;
			municipalities.push({
				id: municipality.id,
				name: municipality.name,
				district: municipality.district,
				state: municipality.state,
				lat: coordinate.lat,
				lon: coordinate.lon,
				offers_page: municipality.offers,
				amtsblatt: municipality.amtsblatt
			});
		}
		return municipalities.sort((a, b) => a.name.localeCompare(b.name, 'de'));
	});

	const unmappedCount = $derived(
		data.sourcesIndex.municipalities.length - mappedMunicipalities.length
	);

	// Serialised as an ItemList of the municipalities this page links to, which is the
	// site's actual value proposition. Coordinates are already on the page as markers.
	// `<` is escaped so a URL can never close the script element.
	const jsonLd = $derived(
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'WebSite',
			name: SITE_NAME,
			url: canonicalUrl,
			description,
			inLanguage: ['de', 'en'],
			dateModified: data.sourcesIndex.generatedAt,
			mainEntity: {
				'@type': 'ItemList',
				numberOfItems: mappedMunicipalities.length,
				itemListElement: mappedMunicipalities.map((municipality, index) => ({
					'@type': 'ListItem',
					position: index + 1,
					name: municipality.name,
					item: {
						'@type': 'WebPage',
						name: `${municipality.name} – ${SITE_NAME}`,
						url: (municipality.amtsblatt ?? municipality.offers_page)?.url ?? canonicalUrl
					}
				}))
			}
		}).replace(/</g, '\\u003c')
	);

	// A raw <script> inside <svelte:head> would be parsed by Svelte as a component
	// script, so the whole tag is emitted as inert markup. `jsonLd` has every `<`
	// escaped, so the payload cannot break out of the element.
	// Svelte's parser treats a literal `<script` anywhere in the file as a component
	// script, so both tags are assembled from fragments instead of written out.
	const jsonLdScript = $derived(`<${'script'} type="application/ld+json">${jsonLd}<${'/'}script>`);
	// Distinguishes "this municipality publishes no such page" from "the crawler could
	// not reach the page it had recorded", which both previously rendered identically.
	const sourceError = (source: VisibleSource): string | null => {
		if (source.status !== 'error') return null;
		return source.statusCode ? `HTTP ${source.statusCode}` : (source.error ?? '');
	};

	const sourceLinkClass = (failure: string | null) =>
		failure
			? 'text-neutral-400 line-through decoration-neutral-300 hover:text-neutral-500 dark:text-neutral-500 dark:decoration-neutral-600 dark:hover:text-neutral-400'
			: 'text-blue-700 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300';

	const sourceSlots: { key: VisibleSourceType; title: typeof m.official_gazette }[] = [
		{ key: 'amtsblatt', title: m.official_gazette },
		{ key: 'offers_page', title: m.property_offers }
	];

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

<svelte:head>
	<title>{documentTitle}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={canonicalUrl} />

	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={SITE_NAME} />
	<meta property="og:locale" content={getLocale() === 'de' ? 'de_DE' : 'en_US'} />
	<meta property="og:title" content={documentTitle} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={canonicalUrl} />
	<meta property="og:image" content={`${SITE_URL}/og-image.png`} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content={documentTitle} />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={documentTitle} />
	<meta name="twitter:description" content={description} />
	<meta name="twitter:image" content={`${SITE_URL}/og-image.png`} />

	<!-- JSON-LD is the one thing Svelte has no declarative syntax for. `jsonLd` is
	     JSON.stringify output with every `<` escaped, so it cannot introduce markup. -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html jsonLdScript}
</svelte:head>

<main class="w-full px-4 py-8 md:px-6">
	<header class="space-y-2">
		<h1 class="text-3xl font-bold tracking-tight">{m.page_title()}</h1>
		<p class="text-sm text-neutral-600 dark:text-neutral-400">
			{m.page_description()}
		</p>
		<p class="text-xs text-neutral-500 dark:text-neutral-400">
			{m.last_update({ date: formatDateTime(data.sourcesIndex.generatedAt) })}
		</p>
	</header>

	{#if mappedMunicipalities.length === 0}
		<section
			class="mt-8 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-400/30 dark:bg-amber-400/10"
		>
			<p class="font-medium">{m.no_coordinates_title()}</p>
			<p class="mt-1">{m.no_coordinates_description()}</p>
		</section>
	{:else}
		<section class="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
			<div
				class="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
			>
				<div class="rounded-lg border-neutral-200 dark:border-neutral-800">
					<MunicipalityMap
						municipalities={mappedMunicipalities}
						{selectedId}
						onSelect={(id: string) => (selectedId = id)}
					/>
				</div>
				<p class="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
					{m.municipalities_on_map({ count: mappedMunicipalities.length })} · {m.map_attribution()}
				</p>
			</div>

			<aside
				class="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
			>
				{#if selectedMunicipality}
					<div class="space-y-1">
						<h2 class="text-xl font-semibold">{selectedMunicipality.name}</h2>
						<p class="text-xs text-neutral-500 dark:text-neutral-400">
							{selectedMunicipality.district}, {selectedMunicipality.state}
						</p>
					</div>

					<div class="mt-5 space-y-3">
						{#each sourceSlots as slot (slot.key)}
							{@const source = selectedMunicipality[slot.key]}
							{@const failure = source ? sourceError(source) : null}
							<section class="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
								<p class="text-sm font-medium">{slot.title()}</p>
								{#if !source}
									<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
										{slot.key === 'amtsblatt' ? m.no_gazette_link() : m.no_property_link()}
									</p>
								{:else}
									<a
										class="mt-2 inline-block text-sm underline underline-offset-4
											{sourceLinkClass(failure)}"
										href={source.url}
										target="_blank"
										rel="noreferrer"
									>
										{m.open_link()}
									</a>
									{#if failure}
										<p class="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
											{m.source_unavailable({ reason: failure })}
										</p>
									{/if}
								{/if}
							</section>
						{/each}
					</div>
				{/if}
			</aside>
		</section>

		{#if unmappedCount > 0}
			<p class="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
				{m.municipalities_without_coordinates({ count: unmappedCount })}
			</p>
		{/if}
	{/if}
</main>
