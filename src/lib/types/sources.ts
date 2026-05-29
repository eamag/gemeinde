export type SourceType = 'offers_page' | 'amtsblatt' | 'news' | 'documents';

export type SourceSeed = {
	id: string;
	type: SourceType;
	label: string;
	url: string;
};

export type DiscoveredLink = {
	url: string;
	text: string;
	kind: 'pdf' | 'html';
};

export type SourceSnapshot = {
	municipalityId: string;
	source: SourceSeed;
	fetchedAt: string;
	status: 'ok' | 'error';
	statusCode?: number;
	error?: string;
	discoveredLinks: DiscoveredLink[];
};

export type MunicipalitySources = {
	id: string;
	name: string;
	district: string;
	state: string;
	sources: SourceSnapshot[];
};

export type SourcesIndex = {
	generatedAt: string;
	municipalities: MunicipalitySources[];
};

export type MunicipalityCoordinates = Record<
	string,
	{
		lat: number;
		lon: number;
		displayName: string;
	}
>;
