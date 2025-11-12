<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { supabase } from '$lib/supabaseClient';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
