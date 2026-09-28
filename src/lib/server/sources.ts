import type { SourcesIndex } from '$lib/types/sources';
import rawSourcesIndex from '../../../data/generated/sources-index.json';
import rawMunicipalityCoordinates from '../../../data/generated/municipality-coordinates.json';

// The generated index carries every discovered link (text, kind, timestamps, per-link
// errors) — currently ~308 KB of `discoveredLinks` alone. The UI renders one link per
// source type per municipality, so projecting down to exactly the rendered fields
// before serialising cuts the page payload by roughly 95%.
const VISIBLE_SOURCE_TYPES = ['offers_page', 'amtsblatt'] as const;

export type VisibleSourceType = (typeof VISIBLE_SOURCE_TYPES)[number];

export type VisibleSource = {
	type: VisibleSourceType;
	url: string;
	label: string;
	status: 'ok' | 'error';
	statusCode?: number;
	error?: string;
};

export type VisibleMunicipality = {
	id: string;
	name: string;
	district: string;
	state: string;
	offers: VisibleSource | null;
	amtsblatt: VisibleSource | null;
};

export type VisibleSourcesIndex = {
	generatedAt: string;
	municipalities: VisibleMunicipality[];
};

export type VisibleCoordinates = Record<string, { lat: number; lon: number }>;

const isVisibleSourceType = (type: string): type is VisibleSourceType =>
	VISIBLE_SOURCE_TYPES.includes(type as VisibleSourceType);

const projectIndex = (index: SourcesIndex): VisibleSourcesIndex => ({
	generatedAt: index.generatedAt,
	municipalities: index.municipalities.map((municipality) => {
		const byType: Partial<Record<VisibleSourceType, VisibleSource>> = {};
		const seen: Record<string, true> = {};

		for (const snapshot of municipality.sources) {
			const { type, url, label } = snapshot.source;
			if (!isVisibleSourceType(type)) continue;
			// The generator can emit the same URL twice; keep the first occurrence so the
			// result matches what the page previously showed.
			const key = `${type}::${url}`;
			if (seen[key]) continue;
			seen[key] = true;
			if (byType[type]) continue;

			byType[type] = {
				type,
				url,
				label,
				status: snapshot.status,
				...(snapshot.statusCode === undefined ? {} : { statusCode: snapshot.statusCode }),
				...(snapshot.error === undefined ? {} : { error: snapshot.error })
			};
		}

		return {
			id: municipality.id,
			name: municipality.name,
			district: municipality.district,
			state: municipality.state,
			offers: byType.offers_page ?? null,
			amtsblatt: byType.amtsblatt ?? null
		};
	})
});

// Both files are imported statically, so a missing or malformed file fails the build
// rather than resolving to null at runtime. These are therefore synchronous and cannot
// return null.
export function loadSourcesIndex(): VisibleSourcesIndex {
	return projectIndex(rawSourcesIndex as SourcesIndex);
}

export function loadMunicipalityCoordinates(): VisibleCoordinates {
	// `displayName` is unused by the UI and is stripped for the same payload reason.
	return Object.fromEntries(
		Object.entries(
			rawMunicipalityCoordinates as Record<
				string,
				{ lat: number; lon: number; displayName: string }
			>
		).map(([id, { lat, lon }]) => [id, { lat, lon }])
	);
}
