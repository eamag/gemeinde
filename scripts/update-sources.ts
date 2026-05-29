import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

type SourceType = 'offers_page' | 'amtsblatt' | 'news' | 'documents';

type MunicipalitySeed = {
	id: string;
	name: string;
	district: string;
	state: string;
	sources: SourceSeed[];
};

type SourceSeed = {
	id: string;
	type: SourceType;
	label: string;
	url: string;
	discoveryMethod?: 'manual' | 'sitemap' | 'homepage';
};

type DiscoveredLink = {
	url: string;
	text: string;
	kind: 'pdf' | 'html';
};

type SourceSnapshot = {
	municipalityId: string;
	source: SourceSeed;
	fetchedAt: string;
	status: 'ok' | 'error';
	statusCode?: number;
	error?: string;
	discoveredLinks: DiscoveredLink[];
};

type GeneratedIndex = {
	generatedAt: string;
	municipalities: Array<{
		id: string;
		name: string;
		district: string;
		state: string;
		sources: SourceSnapshot[];
	}>;
};

const PROJECT_ROOT = resolve(import.meta.dir, '..');
const SEED_PATH = resolve(PROJECT_ROOT, 'data/sources.seed.json');
const RAW_DIR = resolve(PROJECT_ROOT, 'data/raw');
const GENERATED_DIR = resolve(PROJECT_ROOT, 'data/generated');
const GENERATED_INDEX_PATH = resolve(GENERATED_DIR, 'sources-index.json');
const EMPLOYMENT_KEYWORDS = [
	'stellen',
	'stellenausschreibung',
	'karriere',
	'job',
	'jobs',
	'bewerb',
	'ausbildung'
];
const OFFERS_KEYWORDS = [
	'grundst',
	'grundstück',
	'grundstueck',
	'baugrund',
	'liegenschaft',
	'immobilie',
	'verkauf'
];
const AMTSBLATT_KEYWORDS = ['amtsblatt', 'bekanntmachung', 'satzung', 'ortsrecht'];

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value: string): string {
	return value
		.replaceAll('&amp;', '&')
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>');
}

function containsAny(haystack: string, needles: string[]): boolean {
	return needles.some((needle) => haystack.includes(needle));
}

function canonicalizeUrl(url: string): string {
	const parsed = new URL(url);
	parsed.hash = '';
	const paramsToDrop = [
		'utm_source',
		'utm_medium',
		'utm_campaign',
		'utm_term',
		'utm_content',
		'gclid',
		'fbclid',
		'cid'
	];
	for (const param of paramsToDrop) {
		parsed.searchParams.delete(param);
	}
	parsed.searchParams.sort();
	if (parsed.pathname.endsWith('/')) parsed.pathname = parsed.pathname.slice(0, -1);
	return parsed.toString();
}

function isRelevantLink(
	sourceType: SourceType,
	href: string,
	text: string,
	isPdf: boolean
): boolean {
	const combined = `${href} ${text}`.toLowerCase();
	if (containsAny(combined, EMPLOYMENT_KEYWORDS)) return false;

	if (sourceType === 'amtsblatt') {
		return isPdf || containsAny(combined, AMTSBLATT_KEYWORDS);
	}
	if (sourceType === 'offers_page') {
		return isPdf || containsAny(combined, OFFERS_KEYWORDS);
	}

	return false;
}

function extractLinks(html: string, baseUrl: string, sourceType: SourceType): DiscoveredLink[] {
	const links: DiscoveredLink[] = [];
	const seen = new Set<string>();
	const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

	let match: RegExpExecArray | null;
	while ((match = anchorRegex.exec(html)) !== null) {
		const rawHref = normalizeWhitespace(match[1] ?? '');
		if (!rawHref || rawHref.startsWith('#') || rawHref.toLowerCase().startsWith('javascript:')) {
			continue;
		}

		let absoluteUrl: string;
		try {
			absoluteUrl = canonicalizeUrl(new URL(rawHref, baseUrl).toString());
		} catch {
			continue;
		}

		const anchorText = normalizeWhitespace(
			decodeHtmlEntities((match[2] ?? '').replace(/<[^>]+>/g, ' '))
		);
		const lowerText = anchorText.toLowerCase();
		const lowerHref = absoluteUrl.toLowerCase();

		const isPdf = lowerHref.endsWith('.pdf') || lowerText.includes('pdf');
		if (!isRelevantLink(sourceType, lowerHref, lowerText, isPdf)) {
			continue;
		}

		if (seen.has(absoluteUrl)) {
			continue;
		}
		seen.add(absoluteUrl);

		links.push({
			url: absoluteUrl,
			text: anchorText || basename(absoluteUrl),
			kind: isPdf ? 'pdf' : 'html'
		});
	}

	return links.slice(0, 80);
}

async function fetchSource(municipalityId: string, source: SourceSeed): Promise<SourceSnapshot> {
	const fetchedAt = new Date().toISOString();

	try {
		const response = await fetch(source.url, {
			headers: {
				'user-agent':
					'gemeinde-links-bot/0.1 (+https://example.local; purpose=public-link-indexing)'
			}
		});

		if (!response.ok) {
			return {
				municipalityId,
				source,
				fetchedAt,
				status: 'error',
				statusCode: response.status,
				error: `HTTP ${response.status}`,
				discoveredLinks: []
			};
		}

		const html = await response.text();
		const discoveredLinks = extractLinks(html, source.url, source.type);

		return {
			municipalityId,
			source,
			fetchedAt,
			status: 'ok',
			statusCode: response.status,
			discoveredLinks
		};
	} catch (error) {
		return {
			municipalityId,
			source,
			fetchedAt,
			status: 'error',
			error: error instanceof Error ? error.message : String(error),
			discoveredLinks: []
		};
	}
}

async function main(): Promise<void> {
	await mkdir(RAW_DIR, { recursive: true });
	await mkdir(GENERATED_DIR, { recursive: true });

	const seedContent = await readFile(SEED_PATH, 'utf8');
	const seeds = JSON.parse(seedContent) as MunicipalitySeed[];

	const generatedAt = new Date().toISOString();
	const municipalities: GeneratedIndex['municipalities'] = [];

	for (const municipality of seeds) {
		const sourceSnapshots = await Promise.all(
			municipality.sources.map((source) => fetchSource(municipality.id, source))
		);

		municipalities.push({
			id: municipality.id,
			name: municipality.name,
			district: municipality.district,
			state: municipality.state,
			sources: sourceSnapshots
		});

		const municipalityRawPath = resolve(RAW_DIR, `${municipality.id}.json`);
		await writeFile(
			municipalityRawPath,
			JSON.stringify(
				{
					municipality,
					fetchedAt: generatedAt,
					sources: sourceSnapshots
				},
				null,
				2
			) + '\n',
			'utf8'
		);
	}

	const generatedIndex: GeneratedIndex = {
		generatedAt,
		municipalities
	};

	await writeFile(GENERATED_INDEX_PATH, JSON.stringify(generatedIndex, null, 2) + '\n', 'utf8');

	const sourceCount = municipalities.reduce(
		(sum, municipality) => sum + municipality.sources.length,
		0
	);
	const discoveredLinkCount = municipalities.reduce(
		(sum, municipality) =>
			sum +
			municipality.sources.reduce(
				(sourceSum, source) => sourceSum + source.discoveredLinks.length,
				0
			),
		0
	);

	console.log(
		`Generated ${GENERATED_INDEX_PATH} for ${municipalities.length} municipalities, ${sourceCount} sources, ${discoveredLinkCount} discovered links.`
	);
}

await main();
