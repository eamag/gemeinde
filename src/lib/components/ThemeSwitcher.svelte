<script lang="ts">
	import { m } from '$paraglide/messages';
	import { setTheme, theme, type ThemePreference } from '$lib/theme.svelte';

	const options: { value: ThemePreference; label: () => string }[] = [
		{ value: 'auto', label: () => m.theme_auto() },
		{ value: 'light', label: () => m.theme_light() },
		{ value: 'dark', label: () => m.theme_dark() }
	];
</script>

<div class="flex items-center gap-1 text-sm" role="group" aria-label={m.theme_label()}>
	{#each options as option (option.value)}
		<button
			type="button"
			class="rounded px-2 py-1 transition-colors {theme.preference === option.value
				? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
				: 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'}"
			onclick={() => setTheme(option.value)}
			aria-pressed={theme.preference === option.value}
		>
			{option.label()}
		</button>
	{/each}
</div>
