<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import LanguageSwitcher from '$lib/components/LanguageSwitcher.svelte';
	import ThemeSwitcher from '$lib/components/ThemeSwitcher.svelte';
	import { initTheme } from '$lib/theme.svelte';
	import { onMount } from 'svelte';

	let { children } = $props();

	onMount(initTheme);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<link rel="manifest" href="/site.webmanifest" />
	<meta name="theme-color" content="#1d4ed8" media="(prefers-color-scheme: light)" />
	<meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)" />
</svelte:head>
<div class="flex justify-end gap-3 px-4 pt-3 md:px-6">
	<ThemeSwitcher />
	<LanguageSwitcher />
</div>
{@render children()}
