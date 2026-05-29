import type { PageServerLoad } from './$types';
import { loadMunicipalityCoordinates, loadSourcesIndex } from '$lib/server/sources';

export const load: PageServerLoad = async () => {
	const [sourcesIndex, municipalityCoordinates] = await Promise.all([
		loadSourcesIndex(),
		loadMunicipalityCoordinates()
	]);
	return { sourcesIndex, municipalityCoordinates };
};
