<script lang="ts">
    // import { fade } from 'svelte/transition';
    import { onMount } from 'svelte';

	type Section = {
		title: string;
		paragraphs: string[];
	};

    const sectionDelay = 200;
    const paragraphDelay = 100;

	const sections: Section[] = [
		{
			title: 'synergy',
			paragraphs: [
				'Duoing multiplies output. The right cofounder makes it easier to start and harder to quit. One person can hold conviction while the other provides alternate perspectives. One can focus on the product, the other on the business.',
				"Over time, the distinction between who does what becomes blurred, and what's left is one unified vision and a shared drive to reach a north star. That's synergy."
			]
		},
		{
			title: 'one-trick',
			paragraphs: [
				'Mastery comes from hyperfixation on one thing and one thing only. Pick a niche and get so obsessed with it that you become the best.'
			]
		},
	];

    type Line =
        | { kind: 'title'; text: string }
        | { kind: 'paragraph'; text: string };

    const lines: Line[] = [];

    for (const section of sections) {
        lines.push({ kind: 'title', text: section.title });
        for (const paragraph of section.paragraphs) {
            lines.push({ kind: 'paragraph', text: paragraph });
        }
    }

    const lineDelay = 0.09;
</script>

<div class="z-0 w-1/3 mx-auto flex flex-col items-center justify-center h-dvh text-justify selection:bg-stone-600 selection:text-stone-100" style="font-family: 'Cormorant Garamond', serif">
    <div class="flex flex-col">
        {#each lines as line, idx}
            {#if line.kind === 'title'}
                <h1 
                    class="line text-stone-700 text-lg tracking-wide mb-1 italic"
                    style={`animation-delay: ${idx * lineDelay}s;`}
                >
                    {line.text}
                </h1>
            {:else}
                <p
                    class="line text-stone-600 text-md mb-2"
                    style={`animation-delay: ${idx * lineDelay}s;`}
                >
                    {line.text}
                </p>
            {/if}
        {/each}
    </div>
</div>

<style>
	.line {
		opacity: 0;
		transform: translateY(0.5rem);
		animation-name: fadeUp;
		animation-duration: 0.600s;
		animation-timing-function: cubic-bezier(0.235, 0.51, 0.355, 1);
		animation-fill-mode: forwards;
	}

	@keyframes fadeUp {
		from {
			opacity: 0;
			transform: translateY(0.5rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>