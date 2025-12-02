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
				'Mastery comes from hyperfixation on one thing and one thing only. Become so obsessed that success is inevitable.'
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
        <section class="mb-4">
            <h1 
                class="line text-stone-700 text-lg tracking-wide mb-1 italic"
                style={`animation-delay: ${0 * lineDelay}s;`}
            >
                {sections[0].title}
            </h1>
            <p 
                class="line text-stone-600 text-md mb-2" 
                style={`animation-delay: ${1 * lineDelay}s;`}
            >
                {sections[0].paragraphs[0]}
            </p>
            <p 
                class="line text-stone-600 text-md" 
                style={`animation-delay: ${2 * lineDelay}s;`}
            >
                {sections[0].paragraphs[1]}
            </p>
        </section>

        <div 
            class="line w-full flex items-center justify-center gap-4 mb-4"
            style={`animation-delay: ${3 * lineDelay}s;`}
        >
            <span class="h-px w-1/5 rounded-full bg-stone-200"></span>

            <img
                src="/mastery.svg"
                alt="mastery"
                class="h-4 w-4 object-contain select-none pointer-events-none"
            />

            
            <span class="h-px w-1/5 rounded-full bg-stone-200"></span>
        </div>
        
        <section class="mb-4">
            <h1 
                class="line text-stone-700 text-lg tracking-wide mb-1 italic"
                style={`animation-delay: ${4 * lineDelay}s;`}
            >
                {sections[1].title}
            </h1>
            <p 
                class="line text-stone-600 text-md" 
                style={`animation-delay: ${5 * lineDelay}s;`}
            >
                {sections[1].paragraphs[0]}
            </p>
        </section>
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
