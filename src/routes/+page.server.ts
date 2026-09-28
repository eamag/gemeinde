import type { PageServerLoad } from './$types';
import { loadMunicipalityCoordinates, loadSourcesIndex } from '$lib/server/sources';

export const load: PageServerLoad = () => {
	return {
		sourcesIndex: loadSourcesIndex(),
		municipalityCoordinates: loadMunicipalityCoordinates()
	};
};
