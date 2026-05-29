<script lang="ts">
	import { getLocale, setLocale, locales } from '$paraglide/runtime';
	import { m } from '$paraglide/messages';

	const currentLocale = $derived(getLocale());

	const localeLabels: Record<string, string> = {
		de: m.language_de(),
		en: m.language_en()
	};

	const switchLocale = (locale: string) => {
		if (locale !== currentLocale) {
			setLocale(locale as 'de' | 'en');
		}
	};
</script>

<div class="flex items-center gap-1 text-sm">
	{#each locales as locale (locale)}
		<button
			type="button"
			class="rounded px-2 py-1 transition-colors {locale === currentLocale
				? 'bg-neutral-900 text-white'
				: 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'}"
			onclick={() => switchLocale(locale)}
			aria-current={locale === currentLocale ? 'true' : undefined}
		>
			{localeLabels[locale] ?? locale}
		</button>
	{/each}
</div>
