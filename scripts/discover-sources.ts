import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function formatElapsed(startMs: number): string {
	const seconds = Math.round((Date.now() - startMs) / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remaining = seconds % 60;
	return `${minutes}m ${remaining}s`;
}

function logPhase(phase: string, detail?: string): void {
	const timestamp = new Date().toLocaleTimeString('de-DE', { hour12: false });
	const suffix = detail ? ` — ${detail}` : '';
	console.log(`[${timestamp}] ▸ ${phase}${suffix}`);
}

function logProgress(current: number, total: number, name: string, detail: string): void {
	const pct = Math.round((current / total) * 100);
	const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
	process.stdout.write(`\r  [${current}/${total}] ${bar} ${pct}%  ${name.padEnd(28)} ${detail}`);
	if (current === total) process.stdout.write('\n');
}

type Municipality = {
	id: string;
	name: string;
	district: string;
	state: string;
	website: string;
	wikiTitle: string;
	wikidataId?: string;
};

type SourceType = 'offers_page' | 'amtsblatt' | 'news' | 'documents';

type DiscoveryMethod = 'manual' | 'sitemap' | 'homepage' | 'search';

type SeedSource = {
	id: string;
	type: SourceType;
	label: string;
	url: string;
	discoveryMethod: DiscoveryMethod;
};

type SeedMunicipality = {
	id: string;
	name: string;
	district: string;
	state: string;
	sources: SeedSource[];
};

type DiscoveryReport = {
	generatedAt: string;
	sourceListUrl: string;
	municipalityCount: number;
	coverage: {
		withOffersSource: number;
		withAmtsblattSource: number;
		withAnySource: number;
	};
	municipalities: Array<{
		id: string;
		name: string;
		website: string;
		sourcesFound: number;
		sources: SeedSource[];
	}>;
};

type WikipediaPageResponse = {
	query?: {
		pages?: Record<
			string,
			{
				title?: string;
				pageprops?: {
					wikibase_item?: string;
				};
			}
		>;
	};
};

type WikidataEntityResponse = {
	entities?: Record<
		string,
		{
			claims?: {
				P856?: Array<{
					mainsnak?: {
						datavalue?: {
							value?: unknown;
						};
					};
				}>;
			};
		}
	>;
};

const PROJECT_ROOT = resolve(import.meta.dir, '..');
const DATA_DIR = resolve(PROJECT_ROOT, 'data');
const GENERATED_DIR = resolve(DATA_DIR, 'generated');
const WIKI_SOURCE_URL = 'https://de.wikipedia.org/wiki/Liste_von_Orten_im_Berliner_Umland';
const WEBSITE_OVERRIDES: Record<string, string> = {
	werneuchen: 'https://www.werneuchen-barnim.de/'
};
const MANUAL_SOURCES: Record<string, SeedSource[]> = {
	berlin: [
		{
			id: 'berlin-amtsblatt-manual',
			type: 'amtsblatt',
			label: 'Amtsblatt / Bekanntmachungen',
			url: 'https://www.berlin.de/landesverwaltungsamt/logistikservice/amtsblatt-fuer-berlin/',
			discoveryMethod: 'manual'
		}
	],
	'muhlenbecker-land': [
		{
			id: 'muhlenbecker-land-amtsblatt-manual',
			type: 'amtsblatt',
			label: 'Amtsblatt / Bekanntmachungen',
			url: 'https://www.muehlenbecker-land.de/de/politik-satzungen/aktuelles-aus-politischen-gremien-und-behoerden',
			discoveryMethod: 'manual'
		}
	],
	teltow: [
		{
			id: 'teltow-amtsblatt-manual',
			type: 'amtsblatt',
			label: 'Amtsblatt / Bekanntmachungen',
			url: 'https://www.teltow.de/amtsblatt/index.php',
			discoveryMethod: 'manual'
		}
	]
};

const OFFERS_TOPIC_KEYWORDS = [
	'grundst',
	'grundstück',
	'grundstueck',
	'baugrund',
	'liegenschaft',
	'immobilie',
	'grundbesitz'
];

const URL_KEYWORDS_AMTSBLATT = ['amtsblatt', 'bekanntmachung'];

const TITLE_KEYWORDS_OFFERS = OFFERS_TOPIC_KEYWORDS;
const TITLE_KEYWORDS_AMTSBLATT = ['amtsblatt', 'bekanntmachung'];
const EMPLOYMENT_KEYWORDS = [
	'stellen',
	'stellenausschreibung',
	'karriere',
	'job',
	'jobs',
	'bewerb',
	'ausbildung'
];
const OFFERS_COLLECTION_KEYWORDS = [
	'grundstücksangebote',
	'grundstuecksangebote',
	'grundstücksausschreibungen',
	'grundstuecksausschreibungen',
	'immobilienangebote',
	'liegenschaftsangebote',
	'ausschreibung-liegenschaften',
	'liegenschaften',
	'baugrundstücke',
	'baugrundstuecke',
	'grundstuecke'
];
const OFFERS_ACTION_KEYWORDS = [
	'angebot',
	'angebote',
	'ausschreibung',
	'verkauf',
	'veräußer',
	'veraeusser'
];
const OFFERS_NEGATIVE_KEYWORDS = [
	'grundsteuer',
	'straße',
	'strasse',
	'verkehr',
	'baustelle',
	'grundsteinlegung',
	'messe',
	'event'
];
const AMTSBLATT_PAGE_KEYWORDS = ['amtsblatt', 'bekanntmachung', 'bekanntmachungen'];

const FETCH_TIMEOUT_MS = 15000;
const FETCH_RETRIES = 2;
const FETCH_RETRY_DELAY_MS = 1000;
const CONCURRENCY = 5;
const HTML_SAMPLE_SIZE = 50000;

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function stripTags(value: string): string {
	return normalizeWhitespace(value.replace(/<[^>]+>/g, ' '));
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function uniqueBy<T>(items: T[], keyFn: (item: T) => string): T[] {
	const seen = new Set<string>();
	const out: T[] = [];
	for (const item of items) {
		const key = keyFn(item);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(item);
	}
	return out;
}

function hasAnyKeyword(value: string, keywords: string[]): boolean {
	const lower = value.toLowerCase();
	return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

function canonicalizeUrl(url: string): string {
	const parsed = new URL(url);
	parsed.hash = '';
	for (const param of [
		'utm_source',
		'utm_medium',
		'utm_campaign',
		'utm_term',
		'utm_content',
		'gclid',
		'fbclid',
		'cid'
	]) {
		parsed.searchParams.delete(param);
	}
	parsed.searchParams.sort();
	if (parsed.pathname.endsWith('/')) parsed.pathname = parsed.pathname.slice(0, -1);
	return parsed.toString();
}

function extractTagText(html: string, tag: string): string {
	const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
	return stripTags(match?.[1] ?? '');
}

function isLikelyDetailUrl(url: string): boolean {
	const lower = url.toLowerCase();
	return (
		/(\/portal\/bekanntmachungen\/.+-\d{5,}-\d+\.html)/i.test(lower) ||
		/(\/portal\/meldungen\/.+-\d{5,}-\d+\.html)/i.test(lower) ||
		/(\/aktuelles\/.+\/\d{4}\/\d{2}\/\d{2})/i.test(lower) ||
		/(\/news\/\d{4}\/\d{2}\/\d{2})/i.test(lower) ||
		lower.includes('bekanntmachung-') ||
		lower.includes('meldung-')
	);
}

function looksLikeCollectionUrl(url: string, type: SourceType): boolean {
	const lower = url.toLowerCase();
	if (isLikelyDetailUrl(lower)) return false;
	if (hasAnyKeyword(lower, EMPLOYMENT_KEYWORDS)) return false;

	if (type === 'offers_page') {
		if (hasAnyKeyword(lower, OFFERS_NEGATIVE_KEYWORDS)) return false;
		return (
			hasAnyKeyword(lower, OFFERS_COLLECTION_KEYWORDS) ||
			(hasAnyKeyword(lower, OFFERS_TOPIC_KEYWORDS) && hasAnyKeyword(lower, OFFERS_ACTION_KEYWORDS))
		);
	}

	if (type === 'amtsblatt') {
		return hasAnyKeyword(lower, ['amtsblatt', 'bekanntmachungen', 'oeffentliche-bekanntmachungen']);
	}

	return false;
}

function isCollectionPageContent(html: string, type: SourceType): boolean {
	const title = extractTagText(html, 'title').toLowerCase();
	const h1 = extractTagText(html, 'h1').toLowerCase();
	const h2 = extractTagText(html, 'h2').toLowerCase();
	const heading = `${title} ${h1} ${h2}`.trim();
	const bodySample = stripTags(html.slice(0, HTML_SAMPLE_SIZE)).toLowerCase();
	if (hasAnyKeyword(`${heading} ${bodySample}`, EMPLOYMENT_KEYWORDS)) return false;

	if (type === 'offers_page') {
		const combined = `${heading} ${bodySample}`;
		return (
			(hasAnyKeyword(heading, OFFERS_COLLECTION_KEYWORDS) ||
				(hasAnyKeyword(combined, OFFERS_TOPIC_KEYWORDS) &&
					hasAnyKeyword(combined, OFFERS_ACTION_KEYWORDS))) &&
			!hasAnyKeyword(combined, OFFERS_NEGATIVE_KEYWORDS)
		);
	}
	if (type === 'amtsblatt') {
		return (
			hasAnyKeyword(heading, AMTSBLATT_PAGE_KEYWORDS) ||
			hasAnyKeyword(bodySample, ['amtsblatt-archiv', 'amtsblatt'])
		);
	}

	return false;
}

function classifySource(url: string, label: string): SourceType | null {
	const combined = `${url} ${label}`.toLowerCase();
	if (hasAnyKeyword(combined, EMPLOYMENT_KEYWORDS)) return null;

	if (
		hasAnyKeyword(url, URL_KEYWORDS_AMTSBLATT) ||
		hasAnyKeyword(label, TITLE_KEYWORDS_AMTSBLATT)
	) {
		return 'amtsblatt';
	}
	if (
		hasAnyKeyword(url, OFFERS_TOPIC_KEYWORDS) ||
		hasAnyKeyword(label, TITLE_KEYWORDS_OFFERS) ||
		(combined.includes('ausschreibung') && hasAnyKeyword(combined, OFFERS_TOPIC_KEYWORDS))
	) {
		return 'offers_page';
	}
	return null;
}

function sourceLabel(type: SourceType): string {
	if (type === 'amtsblatt') return 'Amtsblatt / Bekanntmachungen';
	if (type === 'offers_page') return 'Grundstücksangebote / Ausschreibungen';
	if (type === 'news') return 'Meldungen';
	return 'Dokumente';
}

async function fetchText(url: string): Promise<string | null> {
	async function attempt(targetUrl: string): Promise<string | null> {
		for (let retry = 0; retry <= FETCH_RETRIES; retry++) {
			try {
				const response = await fetch(targetUrl, {
					headers: {
						'user-agent': 'gemeinde-discovery-bot/0.1 (+https://example.local)'
					},
					redirect: 'follow',
					signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
				});
				if (response.ok) return await response.text();
				if (response.status >= 500 && retry < FETCH_RETRIES) {
					await new Promise((r) => setTimeout(r, FETCH_RETRY_DELAY_MS * (retry + 1)));
					continue;
				}
				return null;
			} catch {
				if (retry < FETCH_RETRIES) {
					await new Promise((r) => setTimeout(r, FETCH_RETRY_DELAY_MS * (retry + 1)));
					continue;
				}
				return null;
			}
		}
		return null;
	}

	const direct = await attempt(url);
	if (direct) return direct;

	if (url.startsWith('http://')) {
		return await attempt(url.replace('http://', 'https://'));
	}

	return null;
}

async function searchDuckDuckGo(query: string): Promise<string[]> {
	try {
		const response = await fetch(
			`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=de-de`,
			{
				headers: {
					'user-agent': 'Mozilla/5.0 (compatible; gemeinde-discovery-bot/0.1)'
				},
				redirect: 'follow',
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
			}
		);
		if (!response.ok) return [];
		const html = await response.text();
		const matches = [...html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"/gi)];
		const urls = matches
			.map((match) => match[1])
			.map((href) => {
				try {
					const url = new URL(href, 'https://duckduckgo.com');
					const redirect = url.searchParams.get('uddg');
					return redirect ? decodeURIComponent(redirect) : href;
				} catch {
					return href;
				}
			});
		return uniqueBy(urls, (item) => item);
	} catch {
		return [];
	}
}

function extractMainTableRows(html: string): string[] {
	const tables = [...html.matchAll(/<table class="wikitable[\s\S]*?<\/table>/gi)];
	if (tables.length === 0) return [];
	const largest = tables.reduce(
		(best, match) => {
			const rowCount = (match[0].match(/<tr/gi) ?? []).length;
			return rowCount > best.count ? { text: match[0], count: rowCount } : best;
		},
		{ text: '', count: 0 }
	);
	if (!largest.text) return [];
	return [...largest.text.matchAll(/<tr[\s\S]*?<\/tr>/gi)].slice(1).map((row) => row[0]);
}

async function getWikidataIds(wikiTitles: string[]): Promise<Record<string, string>> {
	const wikidataIds: Record<string, string> = {};
	const chunkSize = 20;

	for (let i = 0; i < wikiTitles.length; i += chunkSize) {
		const chunk = wikiTitles.slice(i, i + chunkSize);
		const apiUrl =
			'https://de.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=pageprops&ppprop=wikibase_item&titles=' +
			encodeURIComponent(chunk.join('|'));

		const payload = (await fetch(apiUrl).then((r) => r.json())) as WikipediaPageResponse;
		for (const page of Object.values(payload?.query?.pages ?? {})) {
			if (page.title && page.pageprops?.wikibase_item) {
				wikidataIds[page.title] = page.pageprops.wikibase_item;
			}
		}
	}

	return wikidataIds;
}

async function getOfficialWebsites(wikidataIds: string[]): Promise<Record<string, string>> {
	const websites: Record<string, string> = {};
	const chunkSize = 40;

	for (let i = 0; i < wikidataIds.length; i += chunkSize) {
		const chunk = wikidataIds.slice(i, i + chunkSize);
		if (chunk.length === 0) continue;

		const apiUrl =
			'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=' +
			encodeURIComponent(chunk.join('|'));
		const payload = (await fetch(apiUrl).then((r) => r.json())) as WikidataEntityResponse;
		for (const [id, entity] of Object.entries(payload?.entities ?? {})) {
			const value = entity.claims?.P856?.[0]?.mainsnak?.datavalue?.value;
			if (typeof value === 'string') websites[id] = value;
		}
	}

	return websites;
}

async function loadMunicipalities(): Promise<Municipality[]> {
	async function loadFromCache(): Promise<Municipality[]> {
		const reportPath = resolve(GENERATED_DIR, 'source-discovery-report.json');
		const seedPath = resolve(DATA_DIR, 'sources.seed.json');
		const [reportRaw, seedRaw] = await Promise.all([
			readFile(reportPath, 'utf8').catch(() => null),
			readFile(seedPath, 'utf8').catch(() => null)
		]);
		if (!reportRaw || !seedRaw) return [];

		const report = JSON.parse(reportRaw) as {
			municipalities: Array<{ id: string; name: string; website: string }>;
		};
		const seed = JSON.parse(seedRaw) as Array<{ id: string; district: string; state: string }>;
		const byId = new Map(seed.map((item) => [item.id, item]));
		return report.municipalities
			.filter((item) => item.website)
			.map((item) => ({
				id: item.id,
				name: item.name,
				district: byId.get(item.id)?.district ?? 'Unbekannt',
				state: byId.get(item.id)?.state ?? 'Brandenburg',
				website: item.website.endsWith('/') ? item.website : `${item.website}/`,
				wikiTitle: item.name
			}));
	}

	logPhase('Fetching Wikipedia page');
	const wikiResponse = await fetch(WIKI_SOURCE_URL, {
		headers: {
			'user-agent':
				'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36'
		},
		redirect: 'follow',
		signal: AbortSignal.timeout(20000)
	});
	const html = wikiResponse.ok ? await wikiResponse.text() : null;
	if (!html) throw new Error('Could not fetch the Berliner Umland source list.');

	const rows = extractMainTableRows(html);
	logPhase('Parsing municipality table', `${rows.length} rows found`);
	const extracted = rows
		.map((row) => {
			const municipalityMatch = row.match(
				/<td>\s*<a href="([^"]+)" title="([^"]+)">[\s\S]*?<\/a>\s*<\/td>/i
			);
			if (!municipalityMatch) return null;
			const districtCells = [...row.matchAll(/<td>([\s\S]*?)<\/td>/gi)];
			if (districtCells.length < 2) return null;

			const district = stripTags(districtCells[1][1]);
			const wikiTitle = municipalityMatch[2];
			const name = stripTags(municipalityMatch[0].replace(/^<td>|<\/td>$/g, ''));

			return {
				id: slugify(wikiTitle),
				name: stripTags(name),
				district,
				state: 'Brandenburg',
				wikiTitle
			};
		})
		.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
	if (extracted.length < 40) {
		const cached = await loadFromCache();
		if (cached.length >= 40) return cached;
		throw new Error(
			`Unexpected municipality extraction count (${extracted.length}) from ${WIKI_SOURCE_URL}.`
		);
	}

	const wikiTitles = extracted.map((entry) => entry.wikiTitle);
	logPhase('Resolving Wikidata IDs', `${wikiTitles.length} titles`);
	const wikidataByTitle = await getWikidataIds(wikiTitles);
	logPhase('Fetching official websites', `${Object.keys(wikidataByTitle).length} Wikidata entries`);
	const websiteByWikidataId = await getOfficialWebsites(Object.values(wikidataByTitle));

	const municipalities: Municipality[] = [];
	for (const entry of extracted) {
		const wikidataId = wikidataByTitle[entry.wikiTitle];
		const website =
			WEBSITE_OVERRIDES[entry.id] ?? (wikidataId ? websiteByWikidataId[wikidataId] : undefined);
		if (!website) continue;
		municipalities.push({
			id: entry.id,
			name: entry.name,
			district: entry.district,
			state: 'Brandenburg',
			website: website.endsWith('/') ? website : `${website}/`,
			wikiTitle: entry.wikiTitle,
			wikidataId
		});
	}

	const berlin: Municipality = {
		id: 'berlin',
		name: 'Berlin',
		district: 'Land Berlin',
		state: 'Berlin',
		website: 'https://www.berlin.de/',
		wikiTitle: 'Berlin'
	};

	return [berlin, ...municipalities];
}

async function fetchSitemapUrls(baseWebsite: string): Promise<string[]> {
	const sitemapsToTry = new Set<string>([new URL('/sitemap.xml', baseWebsite).toString()]);
	const robotsTxt = await fetchText(new URL('/robots.txt', baseWebsite).toString());
	if (robotsTxt) {
		for (const line of robotsTxt.split('\n')) {
			const match = line.match(/^\s*Sitemap:\s*(\S+)/i);
			if (match) sitemapsToTry.add(match[1].trim());
		}
	}

	const visitedSitemaps = new Set<string>();
	const discoveredUrls = new Set<string>();
	const queue = [...sitemapsToTry];
	const maxSitemaps = 10;

	while (queue.length > 0 && visitedSitemaps.size < maxSitemaps) {
		const sitemapUrl = queue.shift();
		if (!sitemapUrl || visitedSitemaps.has(sitemapUrl)) continue;
		visitedSitemaps.add(sitemapUrl);

		const xml = await fetchText(sitemapUrl);
		if (!xml) continue;
		const locs = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)].map((match) => stripTags(match[1]));
		if (locs.length === 0) continue;

		const isIndex = /<sitemapindex/i.test(xml);
		if (isIndex) {
			for (const loc of locs) {
				if (!visitedSitemaps.has(loc)) queue.push(loc);
			}
		} else {
			for (const loc of locs) discoveredUrls.add(loc);
		}
	}

	return [...discoveredUrls];
}

function extractLinksFromHtml(html: string, baseUrl: string): Array<{ url: string; text: string }> {
	const links: Array<{ url: string; text: string }> = [];
	const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

	let match: RegExpExecArray | null;
	while ((match = anchorRegex.exec(html)) !== null) {
		const href = normalizeWhitespace(match[1] ?? '');
		if (!href || href.startsWith('#') || href.toLowerCase().startsWith('javascript:')) continue;

		try {
			const url = new URL(href, baseUrl).toString();
			const text = stripTags(match[2] ?? '');
			links.push({ url, text });
		} catch {
			// Ignore malformed links.
		}
	}

	return links;
}

function keepDomainUrls(
	urls: Array<{ url: string; text: string }>,
	website: string
): Array<{ url: string; text: string }> {
	const domain = new URL(website).hostname.replace(/^www\./, '');
	return urls.filter(({ url }) => {
		try {
			return new URL(url).hostname.replace(/^www\./, '') === domain;
		} catch {
			return false;
		}
	});
}

async function discoverSourcesForMunicipality(
	municipality: Municipality,
	existingUrls: Set<string>
): Promise<SeedSource[]> {
	const candidates: SeedSource[] = [];
	const sitemapUrls = await fetchSitemapUrls(municipality.website);

	for (const url of sitemapUrls) {
		const sourceType = classifySource(url, '');
		if (!sourceType) continue;
		if (!looksLikeCollectionUrl(url, sourceType)) continue;
		candidates.push({
			id: `${municipality.id}-${slugify(url).slice(0, 40)}`,
			type: sourceType,
			label: sourceLabel(sourceType),
			url,
			discoveryMethod: 'sitemap'
		});
	}

	const homepage = await fetchText(municipality.website);
	if (homepage) {
		const homepageLinks = keepDomainUrls(
			extractLinksFromHtml(homepage, municipality.website),
			municipality.website
		);
		for (const link of homepageLinks) {
			const sourceType = classifySource(link.url, link.text);
			if (!sourceType) continue;
			if (!looksLikeCollectionUrl(link.url, sourceType)) continue;
			candidates.push({
				id: `${municipality.id}-${slugify(link.url).slice(0, 40)}`,
				type: sourceType,
				label: sourceLabel(sourceType),
				url: link.url,
				discoveryMethod: 'homepage'
			});
		}
	}

	if (candidates.length === 0) {
		const domain = new URL(municipality.website).hostname.replace(/^www\./, '');
		const fallbackResults = await searchDuckDuckGo(
			`site:${domain} (grundstücksangebote OR grundstücksausschreibung OR amtsblatt)`
		);
		for (const url of fallbackResults.slice(0, 8)) {
			let host: string;
			try {
				host = new URL(url).hostname.replace(/^www\./, '');
			} catch {
				continue;
			}
			if (host !== domain) continue;

			const canonical = canonicalizeUrl(url);
			if (existingUrls.has(canonical)) continue;

			const sourceType = classifySource(url, '');
			if (!sourceType) continue;
			if (!looksLikeCollectionUrl(url, sourceType)) continue;
			candidates.push({
				id: `${municipality.id}-${slugify(url).slice(0, 40)}`,
				type: sourceType,
				label: sourceLabel(sourceType),
				url,
				discoveryMethod: 'search'
			});
		}
	}

	const uniqueSources = uniqueBy(candidates, (source) => source.url);
	const uniqueCanonicalSources = uniqueBy(
		uniqueSources.map((source) => ({ ...source, url: canonicalizeUrl(source.url) })),
		(source) => source.url
	);
	const ordered = uniqueCanonicalSources.sort((a, b) => {
		if (a.discoveryMethod !== b.discoveryMethod)
			return a.discoveryMethod.localeCompare(b.discoveryMethod);
		if (a.type !== b.type) return a.type.localeCompare(b.type);
		if (a.url.length !== b.url.length) return a.url.length - b.url.length;
		return a.url.localeCompare(b.url);
	});
	const limitedCandidates = ordered.filter((candidate, index, arr) => {
		const sameTypeBefore = arr
			.slice(0, index)
			.filter((source) => source.type === candidate.type).length;
		return sameTypeBefore < 5;
	});
	const maxPerType = 1;
	const validated: SeedSource[] = [];
	const counts: Partial<Record<SourceType, number>> = {};
	for (const source of limitedCandidates) {
		if ((counts.offers_page ?? 0) >= maxPerType && (counts.amtsblatt ?? 0) >= maxPerType) break;
		const current = counts[source.type] ?? 0;
		if (current >= maxPerType) continue;

		const html = await fetchText(source.url);
		if (!html) continue;
		if (!isCollectionPageContent(html, source.type)) continue;

		validated.push(source);
		counts[source.type] = current + 1;
	}

	const fallbackByType = (type: SourceType): SeedSource | null => {
		if ((counts[type] ?? 0) > 0) return null;
		return limitedCandidates.find((candidate) => candidate.type === type) ?? null;
	};

	const amtsblattFallback = fallbackByType('amtsblatt');
	if (amtsblattFallback) validated.push(amtsblattFallback);
	const offersFallback = fallbackByType('offers_page');
	if (offersFallback) validated.push(offersFallback);

	return uniqueBy(validated, (source) => `${source.type}::${source.url}`);
}

async function runWithConcurrency<T>(
	items: T[],
	concurrency: number,
	fn: (item: T) => Promise<void>
): Promise<void> {
	let index = 0;
	const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (index < items.length) {
			const current = index++;
			await fn(items[current]);
		}
	});
	await Promise.all(workers);
}

async function writeSeedOutput(
	seedMunicipalities: SeedMunicipality[],
	municipalities: Municipality[]
): Promise<void> {
	await writeFile(
		resolve(DATA_DIR, 'sources.seed.json'),
		JSON.stringify(seedMunicipalities, null, 2) + '\n',
		'utf8'
	);

	const coverage = {
		withOffersSource: seedMunicipalities.filter((m) =>
			m.sources.some((s) => s.type === 'offers_page')
		).length,
		withAmtsblattSource: seedMunicipalities.filter((m) =>
			m.sources.some((s) => s.type === 'amtsblatt')
		).length,
		withAnySource: seedMunicipalities.filter((m) => m.sources.length > 0).length
	};

	const report: DiscoveryReport = {
		generatedAt: new Date().toISOString(),
		sourceListUrl: WIKI_SOURCE_URL,
		municipalityCount: seedMunicipalities.length,
		coverage,
		municipalities: seedMunicipalities.map((m) => ({
			id: m.id,
			name: m.name,
			website: municipalities.find((item) => item.id === m.id)?.website ?? '',
			sourcesFound: m.sources.length,
			sources: m.sources
		}))
	};

	await writeFile(
		resolve(GENERATED_DIR, 'source-discovery-report.json'),
		JSON.stringify(report, null, 2) + '\n',
		'utf8'
	);
}

async function main(): Promise<void> {
	const scriptStart = Date.now();
	console.log('\n  gemeinde — source discovery\n');

	await mkdir(DATA_DIR, { recursive: true });
	await mkdir(GENERATED_DIR, { recursive: true });

	logPhase('Loading municipalities');
	const municipalitiesStart = Date.now();
	const municipalities = await loadMunicipalities();
	logPhase(
		'Municipalities loaded',
		`${municipalities.length} found (${formatElapsed(municipalitiesStart)})`
	);

	const results = new Map<string, SeedMunicipality>();
	const total = municipalities.length;
	let completed = 0;

	logPhase('Discovering sources', `${total} municipalities, concurrency ${CONCURRENCY}`);
	const discoveryStart = Date.now();

	const existingUrls = new Set<string>();

	await runWithConcurrency(municipalities, CONCURRENCY, async (municipality) => {
		const discoveredSources = await discoverSourcesForMunicipality(municipality, existingUrls);
		const combinedSources = uniqueBy(
			[...discoveredSources, ...(MANUAL_SOURCES[municipality.id] ?? [])].map((source) => ({
				...source,
				url: canonicalizeUrl(source.url)
			})),
			(source) => `${source.type}::${source.url}`
		);

		for (const source of combinedSources) {
			existingUrls.add(source.url);
		}

		const seedMunicipality: SeedMunicipality = {
			id: municipality.id,
			name: municipality.name,
			district: municipality.district,
			state: municipality.state,
			sources: combinedSources.map((source) => ({
				id: source.id,
				type: source.type,
				label: source.label,
				url: source.url,
				discoveryMethod: source.discoveryMethod
			}))
		};

		results.set(municipality.id, seedMunicipality);

		completed++;
		const sourceCount = combinedSources.length;
		const types = combinedSources.map((s) => s.type).join(', ') || 'none';
		logProgress(completed, total, municipality.name, `${sourceCount} source(s): ${types}`);

		if (completed % 10 === 0 || completed === total) {
			const sorted = [...results.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
			await writeSeedOutput(sorted, municipalities);
		}
	});

	logPhase('Discovery complete', formatElapsed(discoveryStart));

	const seedMunicipalities = [...results.values()].sort((a, b) =>
		a.name.localeCompare(b.name, 'de')
	);

	const coverage = {
		withOffersSource: seedMunicipalities.filter((m) =>
			m.sources.some((s) => s.type === 'offers_page')
		).length,
		withAmtsblattSource: seedMunicipalities.filter((m) =>
			m.sources.some((s) => s.type === 'amtsblatt')
		).length,
		withAnySource: seedMunicipalities.filter((m) => m.sources.length > 0).length
	};

	const noSources = seedMunicipalities.filter((m) => m.sources.length === 0);

	const report: DiscoveryReport = {
		generatedAt: new Date().toISOString(),
		sourceListUrl: WIKI_SOURCE_URL,
		municipalityCount: seedMunicipalities.length,
		coverage,
		municipalities: seedMunicipalities.map((m) => ({
			id: m.id,
			name: m.name,
			website: municipalities.find((item) => item.id === m.id)?.website ?? '',
			sourcesFound: m.sources.length,
			sources: m.sources
		}))
	};

	logPhase('Writing output files');
	await writeFile(
		resolve(DATA_DIR, 'sources.seed.json'),
		JSON.stringify(seedMunicipalities, null, 2) + '\n',
		'utf8'
	);
	await writeFile(
		resolve(GENERATED_DIR, 'source-discovery-report.json'),
		JSON.stringify(report, null, 2) + '\n',
		'utf8'
	);

	console.log('');
	console.log('  ┌─────────────────────────────────────────────┐');
	console.log(`  │  Total municipalities     ${String(seedMunicipalities.length).padStart(18)} │`);
	console.log(`  │  With any source          ${String(coverage.withAnySource).padStart(18)} │`);
	console.log(`  │  With offers page         ${String(coverage.withOffersSource).padStart(18)} │`);
	console.log(
		`  │  With Amtsblatt           ${String(coverage.withAmtsblattSource).padStart(18)} │`
	);
	console.log(`  │  No sources found         ${String(noSources.length).padStart(18)} │`);
	console.log(`  │  Total elapsed            ${formatElapsed(scriptStart).padStart(18)} │`);
	console.log('  └─────────────────────────────────────────────┘');

	if (noSources.length > 0) {
		console.log(`\n  Municipalities without sources:`);
		for (const m of noSources) {
			console.log(`    - ${m.name} (${m.district})`);
		}
	}

	console.log('');
}

await main();
