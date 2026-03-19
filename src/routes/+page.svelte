<script lang="ts">
	import WorkspacePage from '$lib/pages/WorkspacePage.svelte';
	import OnlineCount from '$lib/components/OnlineCount.svelte';
	import { fly } from 'svelte/transition';
	import { useGlobalPresence } from '$lib/presence';
	import { page } from '$app/stores';

	const links = [
		{ href: '/manifesto', label: 'Manifesto' },
		{ href: '/fundamentals', label: 'Fundamentals' },
		{ href: '/collection', label: 'Collection' }
	];

	const isActive = (href: string, pathname: string) => {
		if (href === '/') return pathname === '/';
		return pathname === href || pathname.startsWith(href + '/');
	};

	const presenceStore = useGlobalPresence(null);
</script>

<div in:fly={{ y: 2, duration: 400 }}>
	<OnlineCount dedupe={false} counts={$presenceStore} />
	<nav
		class="fixed left-0 z-67 flex h-15 w-full items-center justify-center bg-white pt-5 pb-5 select-none selection:bg-stone-600 selection:text-stone-100"
		style="font-family: 'Cormorant Garamond', serif"
	>
		<a href="/" class="absolute left-5 text-xl tracking-wide text-stone-700"> founders zoo. </a>

		<div class="flex gap-6 text-sm text-stone-400">
			{#each links as link}
				<a
					href={link.href}
					class={`transition-colors duration-200 ease-out ${
						isActive(link.href, $page.url.pathname)
							? 'text-stone-800'
							: 'text-stone-400 hover:text-stone-800'
					}`}
				>
					{link.label}
				</a>
			{/each}
		</div>
	</nav>
</div>

<WorkspacePage showSettings={false} showMultiGrid={true} />
