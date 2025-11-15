<script lang="ts">
    import { fade } from 'svelte/transition';

    type SectionId = 'micro' | 'macro';

    const navItems: { id: SectionId; label: string }[] = [
        { id: 'micro', label: 'Micro' },
        { id: 'macro', label: 'Macro' }
    ]

    let currentSection: SectionId = 'micro';
    let hoveredNav: SectionId | null = null;

	type MicroSection = {
		title: string;
		description: string;
	};

	const microSections: MicroSection[] = [
		{
			title: 'exercise',
			description: 'Exercise is the foundation of all physical and mental health. It releases endorphins to boost mood, reduces stress, and improves blood flow to the brain. It allows you to clear your mind and let your subconscious processes run. And you also get to look good.'
		},
		{
			title: 'reading',
			description: 'Reading is exercise for the mind. It improves your ability to focus deeply on a single thread of thought. Reading sharpens your critical thinking, learning how to question assumptions and connect ideas. Consistent reading in a field compounds into expertise. Reading changes the way you think.'
		},
		{
			title: 'boredom',
			description: 'Boredom is unsettling. It forces you to be alone with your thoughts, emotions, desires. Allowing yourself to be bored will train you to face discomfort and alter your brain to seek fulfillment from unfamiliar sources. You will learn to appreciate the things you previously deemed mundane.'
		}
	];

    type MacroSection = {
        title: string;
        description: string;
    };

    const macroSections: MacroSection[] = [
        {
            title: 'pathing',
			description: 'You fall behind not by doing too little, but by trying to do everything at once. Do things sequentially and with intent; you can only clear one camp at a time.'
        },
        {
			title: 'dopamine',
			description: 'Dopamine spikes when you anticipate a reward, and these spikes create a baseline level of enjoyment. If this baseline is high from social media, gambling, or other addictive or reward-seeking behaviors, everything else seems dull. Your brain becomes fried.'
		}
    ];

    let microEl: HTMLElement | null = null;
    let macroEl: HTMLElement | null = null;

    let scrollContainer: HTMLDivElement | null = null;

    function handleScroll() {
        if (!scrollContainer) return;

        const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
        const maxScroll = scrollHeight - clientHeight;

        if (maxScroll <= 0) {
            currentSection = 'micro';
            return;
        }

        const progress = scrollTop / maxScroll;

        if (progress < 0.75) {
            currentSection = 'micro';
        } else {
            currentSection = 'macro';
        }
    }

    function scrollToSection(id: SectionId) {
        const map: Record<SectionId, HTMLElement | null> = {
            micro: microEl,
            macro: macroEl
        };

        const target = map[id];
        if (!target || !scrollContainer) return;

        const containerTop = scrollContainer.getBoundingClientRect().top;
        const elementTop = target.getBoundingClientRect().top;
        const offset = elementTop - containerTop;

        const gap = scrollContainer.clientHeight * 0.1;
        
        const targetTop = scrollContainer.scrollTop + offset - gap;

        scrollContainer.scrollTo({
            top: Math.max(0, targetTop),
            behavior: 'smooth'
        });
    }

    const lineDelay = 0.08;

    const nMicro = microSections.length;
    const nMacro = macroSections.length;

    const baseMicroItems = 4;
    const baseMacroTitle = baseMicroItems + 2 * nMicro;


</script>

<div class="z-0 h-dvh w-full flex justify-center overflow-y-auto scrollbar-hide" style="font-family: 'Cormorant Garamond', serif" bind:this={scrollContainer} onscroll={handleScroll}>
    <div class="w-1/3 text-justify pt-[25vh] selection:bg-stone-600 selection:text-stone-100">
        <section class="mb-4">
            <h1
                class="line text-stone-500 text-4xl tracking-wide mb-3"
                style={`animation-delay: ${0 * lineDelay}s;`}
            >
                Fundamentals
            </h1>
            <p 
                class="line text-stone-600 text-md" 
                style={`animation-delay: ${1 * lineDelay}s;`}
            >
                Build the fundamentals first. You can't win a game without first learning how to farm gold. The same is true for building a company and life in general.
            </p>
        </section>

        <div 
            class="line h-[1px] w-full rounded-full bg-stone-200 mb-16"
            style={`animation-delay: ${2 * lineDelay}s;`}
        ></div>

        <section id="micro" bind:this={microEl} class="mb-16">
            <h1
                class="line text-stone-500 text-3xl tracking-wide mb-6"
                style={`animation-delay: ${3 * lineDelay}s;`}
            >
                Micro
            </h1>

            <div class="space-y-4">
                {#each microSections as section, idx}
                    {@const titleIdx = baseMicroItems + 2 * idx}
                    {@const descriptionIdx = baseMicroItems + 2 * idx + 1}
                    <div class="flex flex-col">
                        <h2
                            class="line text-stone-700 text-lg tracking-wide mb-1 italic"
                            style={`animation-delay: ${titleIdx * lineDelay}s;`}
                        >
                            {section.title}
                        </h2>
                        <p 
                            class="line text-stone-600 text-md" 
                            style={`animation-delay: ${descriptionIdx * lineDelay}s;`}
                        >
                            {section.description}
                        </p>
                    </div>
                {/each}
            </div>
        </section>

        <section id="macro" bind:this={macroEl} class="pb-[25vh]">
            <h1
                class="line text-stone-500 text-3xl tracking-wide mb-6"
                style={`animation-delay: ${baseMacroTitle * lineDelay}s;`}
            >
                Macro
            </h1>

            <div class="space-y-4">
                {#each macroSections as section, idx}
                    {@const titleIdx = baseMacroTitle + 2 * idx}
                    {@const descriptionIdx = baseMacroTitle + 2 * idx + 1}
                    <div class="flex flex-col">
                        <h2
                            class="line text-stone-700 text-lg tracking-wide mb-1 italic"
                            style={`animation-delay: ${titleIdx * lineDelay}s;`}
                        >
                            {section.title}
                        </h2>
                        <p 
                            class="line text-stone-600 text-md" 
                            style={`animation-delay: ${descriptionIdx * lineDelay}s;`}
                        >
                            {section.description}
                        </p>
                    </div>
                {/each}
            </div>
        </section>

        <div class="fixed right-6 top-1/4 flex flex-col items-center">
            {#each navItems as item}
                <button
                    type="button"
                    onclick={() => scrollToSection(item.id)}
                    onmouseenter={() => hoveredNav = item.id}
                    onmouseleave={() => hoveredNav = null}
                    class="group flex flex-col items-center"
                >
                    <div class="relative h-4 w-28 overflow-hidden flex items-center justify-end">
                        <span
                            class={`absolute right-0 h-px w-3 rounded-full bg-stone-400 origin-right transition-transform transition-colors duration-150
                                ${
                                    hoveredNav === item.id
                                        ? 'scale-x-0'
                                        : 'scale-x-100'
                                }
                                ${
                                    currentSection === item.id
                                        ? 'bg-stone-800'
                                        : 'bg-stone-400'
                                }
                            }`}
                        ></span>

                        <span 
                            class={`absolute right-0 text-[14px] tracking-wide italic whitespace-nowrap transition-all duration-200 ${
                                hoveredNav === item.id 
                                    ? 'translate-x-0 opacity-100 text-stone-800' 
                                    : 'translate-x-4 opacity-0 text-stone-400' 
                            }`}
                        >
                            {item.label}
                        </span>
                    </div>
                </button>
            {/each}
        </div>
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