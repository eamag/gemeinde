/**
 * Colour-scheme preference: `auto` follows the OS, `light`/`dark` override it.
 *
 * The resolved value is mirrored onto a `.dark` class on `<html>`, which is what the
 * `@custom-variant dark` rule in layout.css keys off. The inline bootstrap in
 * app.html applies the same class before first paint; this module takes over once
 * the app is hydrated and keeps the two in sync from then on.
 */

export type ThemePreference = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

/** Read `theme.preference` / `theme.resolved` to react; mutate only via `setTheme`. */
export const theme = $state({
	preference: 'auto' as ThemePreference,
	resolved: 'light' as ResolvedTheme
});

const readStored = (): ThemePreference => {
	try {
		const value = localStorage.getItem(STORAGE_KEY);
		return value === 'light' || value === 'dark' ? value : 'auto';
	} catch {
		// Private browsing or a blocked storage partition; fall back to following the OS.
		return 'auto';
	}
};

const apply = (preference: ThemePreference) => {
	const resolved =
		preference === 'auto'
			? matchMedia('(prefers-color-scheme: dark)').matches
				? 'dark'
				: 'light'
			: preference;
	theme.resolved = resolved;
	document.documentElement.classList.toggle('dark', resolved === 'dark');
};

/**
 * Adopts the pre-paint decision and keeps following the OS while the preference is
 * `auto`. Returns a teardown function.
 */
export function initTheme(): () => void {
	theme.preference = readStored();
	apply(theme.preference);

	const query = matchMedia('(prefers-color-scheme: dark)');
	const onSystemChange = () => {
		// An explicit choice must not move when the OS does.
		if (theme.preference === 'auto') apply('auto');
	};
	query.addEventListener('change', onSystemChange);
	return () => query.removeEventListener('change', onSystemChange);
}

export function setTheme(preference: ThemePreference): void {
	theme.preference = preference;
	try {
		if (preference === 'auto') localStorage.removeItem(STORAGE_KEY);
		else localStorage.setItem(STORAGE_KEY, preference);
	} catch {
		// The preference still applies for this session even if it cannot be persisted.
	}
	apply(preference);
}
