import type { RequestHandler } from './$types';
import { loadSourcesIndex } from '$lib/server/sources';
import { SITE_URL } from '$lib/site';

/**
 * Served rather than committed to `static/` so `lastmod` always tracks the actual
 * data refresh instead of going stale the moment the file is written.
 */
export const GET: RequestHandler = () => {
	const { generatedAt } = loadSourcesIndex();

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
	<url>
		<loc>${SITE_URL}/</loc>
		<lastmod>${generatedAt.slice(0, 10)}</lastmod>
		<changefreq>daily</changefreq>
		<priority>1.0</priority>
	</url>
</urlset>
`;

	return new Response(body, {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
			'cache-control': 'public, max-age=3600'
		}
	});
};
