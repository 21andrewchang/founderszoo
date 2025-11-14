<script lang="ts">
    import { fade } from 'svelte/transition';


	type Section = {
		id: string;
		title: string;
		paragraphs: string[];
	};

	const sections: Section[] = [
		{
			id: 'synergy',
			title: 'synergy',
			paragraphs: [
				'Duoing multiplies output. The right cofounder makes it easier to start and harder to quit. One person can hold conviction while the other provides alternate perspectives. One can focus on the product, the other on the business.',
				"Over time, the distinction between who does what becomes blurred, and what's left is one unified vision and a shared drive to reach a north star. That's synergy."
			]
		},
		{
			id: 'one-trick',
			title: 'one-trick',
			paragraphs: [
				'Mastery comes from hyperfixation on one thing and one thing only. Pick a niche and get so obsessed with it that you become the best.'
			]
		},
		{
			id: 'fundamentals',
			title: 'fundamentals',
			paragraphs: [
				"Build the fundamentals first. You can't win a game without first learning how to farm gold. The same is true for building a company and life in general."
			]
		},
		// {
		// 	id: 'minimap',
		// 	title: 'minimap',
		// 	paragraphs: ['Ignoring the minimap is how days are wasted.']
		// },
		{
			id: 'pathing',
			title: 'pathing',
			paragraphs: [
				'You fall behind not by doing too little, but by trying to do everything at once. Do things sequentially and with intent; you can only clear one camp at a time.'
			]
		}
	];
</script>

<div in:fade={{ duration: 200, delay: 200 }}>
    <div class="w-1/3 mx-auto flex flex-col items-center justify-center h-dvh text-justify selection:bg-stone-600 selection:text-stone-100">
        <div class="flex flex-col">
            {#each sections as section}
                <h1 style="font-family: 'Cormorant Garamond', serif" class="text-stone-700 text-lg tracking-wide mb-1 italic">
                    {section.title}
                </h1>

                {#each section.paragraphs as paragraph, i}
                    <p
                        class={`text-stone-600 text-sm ${
                            i < section.paragraphs.length - 1 ? 'mb-2' : 'mb-5'
                        }`}
                    >
                        {paragraph}
                    </p>
                {/each}
            {/each}
        </div>
    </div>
</div>
