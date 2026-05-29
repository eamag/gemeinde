import type { MunicipalityCoordinates, SourcesIndex } from '$lib/types/sources';
import municipalityCoordinates from '../../../data/generated/municipality-coordinates.json';
import sourcesIndex from '../../../data/generated/sources-index.json';

const generatedSourcesIndex = sourcesIndex as SourcesIndex;
const generatedMunicipalityCoordinates = municipalityCoordinates as MunicipalityCoordinates;

export async function loadSourcesIndex(): Promise<SourcesIndex | null> {
	return generatedSourcesIndex;
}

export async function loadMunicipalityCoordinates(): Promise<MunicipalityCoordinates | null> {
	return generatedMunicipalityCoordinates;
}
