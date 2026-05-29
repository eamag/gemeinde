import type { Handle } from '@sveltejs/kit';
import { paraglideMiddleware } from '$paraglide/server';
import { getTextDirection } from '$paraglide/runtime';

const paraglideHandle: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request: localizedRequest, locale }) => {
		event.request = localizedRequest;
		return resolve(event, {
			transformPageChunk: ({ html }) => {
				return html.replace('%lang%', locale).replace('%dir%', getTextDirection(locale));
			}
		});
	});

export const handle: Handle = paraglideHandle;
