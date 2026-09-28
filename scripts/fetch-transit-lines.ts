/**
 * Builds `data/generated/transit-lines.json` from OpenStreetMap via Overpass.
 *
 * Replaces the OpenRailwayMap raster overlay, which drew every siding, freight
 * branch and disused line on the map. This keeps only the two classes a visitor
 * actually cares about when judging a property's location:
 *
 *   - `sbahn`    - Berlin S-Bahn, tagged `route=light_rail` on the VBB network
 *   - `regional` - RegionalExpress/RegionalBahn, tagged `route=train` on VBB
 *
 * The raw relation geometry is ~10 MB. Segments are stitched into continuous
 * polylines and then simplified before serialising, which brings it to ~100 KB so
 * the layer can be fetched on demand instead of riding along with the page.
 */
import { resolve } from 'node:path';
import { fetchTextWithRetry } from './lib/async';
import { writeFileAtomic } from './lib/io';

const OUTPUT_PATH = resolve(process.cwd(), 'data/generated/transit-lines.json');
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'gemeinde-map/1.0 (+https://gemeinde.eamag.me; public transit overlay)';
const TIMEOUT_MS = 300_000;
const RETRIES = 4;

/** Covers every municipality in the seed plus a generous margin. */
const BBOX = '52.20,12.20,52.90,14.20';

/**
 * Douglas-Peucker tolerance in degrees. 0.0005 is roughly 35 m, which is below the
 * point where a regional line looks faceted at this map's zoom range.
 */
const SIMPLIFY_EPSILON = 0.0005;

type LineClass = 'sbahn' | 'regional';

const CLASS_QUERIES: { cls: LineClass; refPattern: string; route: string }[] = [
	{ cls: 'sbahn', route: 'light_rail', refPattern: '^S[0-9]+$' },
	{ cls: 'regional', route: 'train', refPattern: '^(RE|RB)[0-9]+$' }
];

type Coordinate = [number, number];

type OverpassElement = {
	tags?: { ref?: string };
	members?: { geometry?: { lat: number; lon: number }[] }[];
};

type TransitFeature = {
	type: 'Feature';
	properties: { cls: LineClass };
	geometry: { type: 'MultiLineString'; coordinates: Coordinate[][] };
};
function overpassQuery(route: string, refPattern: string): string {
	return `[out:json][timeout:180];
relation["type"="route"]["route"="${route}"]["network"="Verkehrsverbund Berlin-Brandenburg"]["ref"~"${refPattern}"](${BBOX});
out geom;`;
}

/** Rounds to ~1 m, which is far finer than the simplification tolerance. */
const round = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * Stitches individually-tagged OSM ways into continuous polylines. Simplifying
 * before this step barely helps, because each way is short and the payload is
 * dominated by per-segment structure rather than by coordinate detail.
 */
function stitch(segments: Coordinate[][]): Coordinate[][] {
	const key = (point: Coordinate): string => `${point[0].toFixed(5)},${point[1].toFixed(5)}`;

	const touching = new Map<string, number[]>();
	segments.forEach((segment, index) => {
		for (const endpoint of [segment[0], segment[segment.length - 1]]) {
			const id = key(endpoint);
			const existing = touching.get(id);
			if (existing) existing.push(index);
			else touching.set(id, [index]);
		}
	});

	const used = new Array<boolean>(segments.length).fill(false);
	const unvisitedAt = (point: Coordinate): number[] =>
		(touching.get(key(point)) ?? []).filter((index) => !used[index]);

	const polylines: Coordinate[][] = [];
	for (let start = 0; start < segments.length; start++) {
		if (used[start]) continue;
		used[start] = true;
		const chain = segments[start].slice();

		for (;;) {
			const next = unvisitedAt(chain[chain.length - 1])[0];
			if (next === undefined) break;
			used[next] = true;
			const segment = segments[next];
			const forward = key(segment[0]) === key(chain[chain.length - 1]);
			const ordered = forward ? segment : segment.slice().reverse();
			chain.pop();
			chain.push(...ordered);
		}

		for (;;) {
			const next = unvisitedAt(chain[0])[0];
			if (next === undefined) break;
			used[next] = true;
			const segment = segments[next];
			const reversed = key(segment[segment.length - 1]) === key(chain[0]);
			chain.shift();
			chain.unshift(...(reversed ? segment.slice().reverse() : segment));
		}

		if (chain.length > 1) polylines.push(chain);
	}
	return polylines;
}

function simplify(points: Coordinate[], epsilon: number): Coordinate[] {
	if (points.length < 3) return points;

	let furthest = 0;
	let furthestIndex = 0;
	const [startX, startY] = points[0];
	const [endX, endY] = points[points.length - 1];
	const span = Math.hypot(endX - startX, endY - startY);

	for (let index = 1; index < points.length - 1; index++) {
		const [x, y] = points[index];
		const distance =
			span === 0
				? Math.hypot(x - startX, y - startY)
				: Math.abs((endY - startY) * x - (endX - startX) * y + endX * startY - endY * startX) /
					span;
		if (distance > furthest) {
			furthest = distance;
			furthestIndex = index;
		}
	}

	if (furthest <= epsilon) return [points[0], points[points.length - 1]];
	return [
		...simplify(points.slice(0, furthestIndex + 1), epsilon).slice(0, -1),
		...simplify(points.slice(furthestIndex), epsilon)
	];
}

function dropRepeated(points: Coordinate[]): Coordinate[] {
	const kept = [points[0]];
	for (const point of points) {
		const last = kept[kept.length - 1];
		if (point[0] !== last[0] || point[1] !== last[1]) kept.push(point);
	}
	return kept;
}

async function fetchClass(cls: LineClass, route: string, refPattern: string) {
	const response = await fetchTextWithRetry(OVERPASS_URL, {
		userAgent: USER_AGENT,
		timeoutMs: TIMEOUT_MS,
		retries: RETRIES,
		retryDelayMs: 20000,
		body: overpassQuery(route, refPattern),
		contentType: 'text/plain'
	});

	// Overpass answers 429 when the shared public instance is busy. That is a rate
	// limit rather than a transport failure, so the retry loop is what has to absorb it.
	if (!response.ok && response.status === 429) {
		throw new Error(`Overpass rate limited (429) while fetching ${cls} lines`);
	}
	if (!response.ok) {
		throw new Error(`Overpass request for ${cls} lines failed: ${response.error}`);
	}

	const payload = JSON.parse(response.text) as { elements?: OverpassElement[] };
	const segments: Coordinate[][] = [];
	for (const element of payload.elements ?? []) {
		const ref = (element.tags?.ref ?? '').split(/[;,]/)[0].trim();
		if (!new RegExp(refPattern).test(ref)) continue;
		for (const member of element.members ?? []) {
			const geometry = member.geometry;
			if (!geometry || geometry.length < 2) continue;
			segments.push(geometry.map((point): Coordinate => [point.lon, point.lat]));
		}
	}
	return { cls, segments };
}

const classes: TransitFeature[] = [];
for (const { cls, route, refPattern } of CLASS_QUERIES) {
	const { segments } = await fetchClass(cls, route, refPattern);
	classes.push(...simplifyToFeature(cls, segments));
}

function simplifyToFeature(cls: LineClass, segments: Coordinate[][]): TransitFeature[] {
	const lines = stitch(segments)
		.map((chain) =>
			dropRepeated(
				simplify(chain, SIMPLIFY_EPSILON).map((p) => [round(p[0]), round(p[1])] as Coordinate)
			)
		)
		.filter((line) => line.length > 1);
	console.log(
		`${cls}: ${segments.length} ways -> ${lines.length} polylines, ${lines.reduce((sum, l) => sum + l.length, 0)} coordinates`
	);
	return [
		{
			type: 'Feature',
			properties: { cls },
			geometry: { type: 'MultiLineString', coordinates: lines }
		}
	];
}

const generatedAt = new Date().toISOString();
const featureCollection = {
	type: 'FeatureCollection' as const,
	generatedAt,
	features: classes
};

await writeFileAtomic(OUTPUT_PATH, `${JSON.stringify(featureCollection)}\n`);
console.log(
	`Wrote ${OUTPUT_PATH}: ${classes.length} line classes, ${(JSON.stringify(featureCollection).length / 1024).toFixed(0)} KB.`
);
