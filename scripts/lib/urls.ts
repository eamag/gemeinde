/**
 * Shared URL + text helpers for the offline source ETL scripts.
 *
 * Both scripts used to carry their own copy of these helpers, which had already
 * drifted (one canonicalized away the hash, the other did not). Keep a single
 * implementation here.
 */

const TRACKING_PARAMS = [
	'utm_source',
	'utm_medium',
	'utm_campaign',
	'utm_term',
	'utm_content',
	'gclid',
	'fbclid',
	'cid'
];

const HTML_ENTITIES: Record<string, string> = {
	amp: '&',
	apos: "'",
	gt: '>',
	lt: '<',
	nbsp: ' ',
	quot: '"',
	auml: 'ä',
	Auml: 'Ä',
	ouml: 'ö',
	Ouml: 'Ö',
	uuml: 'ü',
	Uuml: 'Ü',
	szlig: 'ß'
};

/** Schemes that are never a fetchable page and must not end up in the index. */
const IGNORED_SCHEMES = ['mailto:', 'tel:', 'javascript:', 'sms:', 'data:', 'file:', 'ftp:'];

export function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

/** Decodes named and numeric HTML entities, including German umlauts. */
export function decodeHtmlEntities(value: string): string {
	return value.replace(
		/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
		(match, entity: string) => {
			if (entity.startsWith('#')) {
				const code =
					entity.startsWith('#x') || entity.startsWith('#X')
						? Number.parseInt(entity.slice(2), 16)
						: Number.parseInt(entity.slice(1), 10);
				if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return match;
				try {
					return String.fromCodePoint(code);
				} catch {
					return match;
				}
			}
			return HTML_ENTITIES[entity] ?? match;
		}
	);
}

/**
 * Case-, entity- and umlaut-insensitive form used for keyword matching.
 *
 * `Baugrundst&uuml;cke`, `Baugrundstücke` and `Baugrundstuecke` all normalize to
 * `baugrundstuecke`, so a single keyword set matches every spelling variant.
 */
export function normalizeForKeywordMatch(value: string): string {
	return decodeHtmlEntities(value)
		.toLowerCase()
		.replace(/ä/g, 'ae')
		.replace(/ö/g, 'oe')
		.replace(/ü/g, 'ue')
		.replace(/ß/g, 'ss')
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '');
}

export function hasAnyKeyword(value: string, keywords: string[]): boolean {
	const haystack = normalizeForKeywordMatch(value);
	return keywords.some((keyword) => haystack.includes(normalizeForKeywordMatch(keyword)));
}

/** True for links that must never be collected (no target page, non-http scheme). */
export function isIgnorableHref(href: string): boolean {
	const lower = href.trim().toLowerCase();
	if (!lower || lower.startsWith('#')) return true;
	if (IGNORED_SCHEMES.some((scheme) => lower.startsWith(scheme))) return true;
	return false;
}

/**
 * Normalizes a URL for deduplication: drops the fragment and tracking params,
 * sorts the remaining query, and strips a trailing slash.
 *
 * Never throws — scraped input (sitemap `<loc>`s, Wikidata P856 values, robots.txt
 * `Sitemap:` lines) is untrusted, so invalid or non-http(s) input returns `null`
 * and callers skip it.
 */
export function canonicalizeUrl(url: string): string | null {
	const trimmed = url.trim();
	if (!trimmed) return null;

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return null;
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

	parsed.hash = '';
	for (const param of TRACKING_PARAMS) {
		parsed.searchParams.delete(param);
	}
	parsed.searchParams.sort();
	if (parsed.pathname.endsWith('/')) parsed.pathname = parsed.pathname.slice(0, -1);
	return parsed.toString();
}
