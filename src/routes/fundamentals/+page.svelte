<script lang="ts">
    import { fade } from 'svelte/transition';

	type Section = {
		id: string;
		title: string;
		paragraphs: string[];
	};

	const sections: Section[] = [
		{
			id: 'exercise',
			title: 'exercise',
			paragraphs: [
				'Exercise is the foundation of all physical and mental health. It releases endorphins to boost mood, reduces stress, and improves blood flow to the brain. It allows you to clear your mind and let your subconscious processes run. And you also get to look good.'
			]
		},
		{
			id: 'reading',
			title: 'reading',
			paragraphs: [
				'Reading is exercise for your mind. It improves your ability to focus deeply on a single thread of thought. Reading sharpens your critical thinking, learning how to question assumptions and connect ideas. Consistent reading in a field compounds into expertise. Reading changes the way you think.'
			]
		},
		{
			id: 'boredom',
			title: 'boredom',
			paragraphs: [
				'Boredom is unsettling. It forces you to be alone with your thoughts, emotions, desires. Allowing yourself to be bored will train you to face discomfort and alter your brain to seek fulfillment from unfamiliar sources. You will learn to appreciate the things you previously deemed mundane.'
			]
		}
        // {
		// 	id: 'dopamine',
		// 	title: 'dopamine',
		// 	paragraphs: [
		// 		'Dopamine spikes when you anticipate a reward, and these spikes create a baseline level of enjoyment. If this baseline is high from social media, gambling, or other addictive or reward-seeking behaviors, everything else seems dull. Your brain becomes fried.'
		// 	]
		// }
	];
</script>

<div in:fade={{ duration: 200, delay: 200 }}>
    <div class="w-1/3 mx-auto flex flex-col items-center justify-center h-dvh text-justify selection:bg-stone-600 selection:text-stone-100">
        <div class="flex flex-col">
            {#each sections as section}
                <h1 style="font-family: 'Cormorant Garamond', serif" class="text-stone-700 text-[16px] tracking-wide mb-1 italic">
                    {section.title}
                </h1>

                {#each section.paragraphs as paragraph, i}
                    <p
                        class={`text-stone-600 text-[14px] ${
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