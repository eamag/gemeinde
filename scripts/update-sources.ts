import { mkdir, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fetchTextWithRetry } from './lib/async';
import { writeFileAtomic } from './lib/io';
import {
	canonicalizeUrl,
	decodeHtmlEntities,
	hasAnyKeyword,
	isIgnorableHref,
	normalizeWhitespace
} from './lib/urls';

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

// `import.meta.dir` is Bun-only and untyped; `dirname` is the standard equivalent
// and is understood by both Bun and Node's type definitions.
const PROJECT_ROOT = resolve(import.meta.dirname, '..');
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

const FETCH_TIMEOUT_MS = 15000;
const FETCH_RETRIES = 2;
const FETCH_RETRY_DELAY_MS = 1000;
const USER_AGENT = 'gemeinde-links-bot/0.1 (+https://example.local; purpose=public-link-indexing)';

/**
 * Keyword set that makes a link relevant for a source type. `news` and
 * `documents` have no keyword set, so links are never collected for them.
 */
function relevantKeywords(sourceType: SourceType): string[] {
	if (sourceType === 'amtsblatt') return AMTSBLATT_KEYWORDS;
	if (sourceType === 'offers_page') return OFFERS_KEYWORDS;
	return [];
}

/**
 * A link is relevant when its href or anchor text matches the source type's
 * keyword set. The keyword match is required for every link — being a PDF is
 * never sufficient on its own. Matching normalizes HTML entities and German
 * umlauts on both sides, so `Baugrundst&uuml;cke` matches `Baugrundstücke`.
 */
function isRelevantLink(sourceType: SourceType, href: string, text: string): boolean {
	const combined = `${href} ${text}`;
	if (hasAnyKeyword(combined, EMPLOYMENT_KEYWORDS)) return false;

	return hasAnyKeyword(combined, relevantKeywords(sourceType));
}

function extractLinks(html: string, baseUrl: string, sourceType: SourceType): DiscoveredLink[] {
	const links: DiscoveredLink[] = [];
	const seen = new Set<string>();
	const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

	let match: RegExpExecArray | null;
	while ((match = anchorRegex.exec(html)) !== null) {
		const rawHref = normalizeWhitespace(match[1] ?? '');
		if (isIgnorableHref(rawHref)) continue;

		let absoluteUrl: string | null;
		try {
			absoluteUrl = canonicalizeUrl(new URL(rawHref, baseUrl).toString());
		} catch {
			continue;
		}
		if (!absoluteUrl) continue;

		const anchorText = normalizeWhitespace(
			decodeHtmlEntities((match[2] ?? '').replace(/<[^>]+>/g, ' '))
		);
		const lowerText = anchorText.toLowerCase();
		const lowerHref = absoluteUrl.toLowerCase();

		const isPdf = lowerHref.endsWith('.pdf') || lowerText.includes('pdf');
		if (!isRelevantLink(sourceType, lowerHref, lowerText)) {
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
	const result = await fetchTextWithRetry(source.url, {
		userAgent: USER_AGENT,
		timeoutMs: FETCH_TIMEOUT_MS,
		retries: FETCH_RETRIES,
		retryDelayMs: FETCH_RETRY_DELAY_MS
	});

	if (!result.ok) {
		return {
			municipalityId,
			source,
			fetchedAt: new Date().toISOString(),
			status: 'error',
			statusCode: result.status,
			error: result.error,
			discoveredLinks: []
		};
	}

	// Resolve relative links against the post-redirect URL: a redirect to another
	// host or directory would otherwise break every relative link.
	const baseUrl = result.url || source.url;

	return {
		municipalityId,
		source,
		fetchedAt: new Date().toISOString(),
		status: 'ok',
		statusCode: result.status,
		discoveredLinks: extractLinks(result.text, baseUrl, source.type)
	};
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
		await writeFileAtomic(
			municipalityRawPath,
			JSON.stringify(
				{
					municipality,
					fetchedAt: generatedAt,
					sources: sourceSnapshots
				},
				null,
				2
			) + '\n'
		);
	}

	const generatedIndex: GeneratedIndex = {
		generatedAt,
		municipalities
	};

	await writeFileAtomic(GENERATED_INDEX_PATH, JSON.stringify(generatedIndex, null, 2) + '\n');

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
