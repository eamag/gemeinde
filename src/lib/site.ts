/**
 * Public origin of the deployed site.
 *
 * Used for absolute URLs that must not follow the request host: `canonical`,
 * Open Graph, JSON-LD and the sitemap. Those are deliberately pinned to the
 * production origin rather than derived from `event.url`, because Wrangler
 * serves every build on its own `*.workers.dev` preview domain and per-commit
 * previews would otherwise each advertise themselves as the canonical page.
 */
export const SITE_URL = 'https://gemeinde.eamag.me';

/** Site name, used in the document title and as the Open Graph `site_name`. */
export const SITE_NAME = 'Gemeinde';
