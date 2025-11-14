<script lang="ts">
    import { fade } from 'svelte/transition';

	type Section = {
		id: string;
		title: string;
		paragraphs: string[];
	};

    type TabId = 'portfolio' | 'library' | 'glossary';

    const tabs: { id: TabId; label: string }[] = [
        { id: 'portfolio', label: 'Portfolio' },
        { id: 'library', label: 'Library' },
        { id: 'glossary', label: 'Glossary' },
    ]

    let activeTab: TabId = 'portfolio';

	type PortfolioSection = {
        title: string;
        paragraphs: string[];
    };

    const portfolioSections: PortfolioSection[] = [
        {
            title: 'vector',
            paragraphs: [
                'An extracurricular for building real projects to get into college.',
                'Students use Vector to ship things that actually matter.'
            ]
        },
        {
            title: 'vimgod',
            paragraphs: [
                'A vim motions game. Just you against the editor.',
                'gg your way to the top.'
            ]
        }
    ];

    type LibraryItem = {
        title: string;
        description: string;
    };

    const libraryItems: LibraryItem[] = [
        {
            title: 'The Scaling Era',
            description: 'Everything about the AI revolution.'
        },
        {
            title: 'The Art of Doing Science and Engineering',
            description: 'How to build something great. Learn from the greatest minds.'
        },
        {
            title: 'The Courage to Be Disliked',
            description: 'Life can be happy and meaningful. Enemies are comrades in disguise.'
        },
        {
            title: 'Steve Jobs',
            description: 'The man who changed the world with a bunch of assholery and a lot of hippie.'
        },
        {
            title: 'Zero to One',
            description: 'The classic startup book.'
        },
        {
            title: 'The Dip',
            description: 'How to get unstuck. And how to know when to quit.'
        },

        {
            title: 'The Mom Test',
            description: 'How to validate your startup idea. Not for moms.'
        },
    ];

    type GlossaryItem = {
        term: string;
        definition: string;
    };

    const glossary: GlossaryItem[] = [
        {
            term: 'coruscate',
            definition: 'to flash or sparkle'
        },
        {
            term: 'euphonious',
            definition: 'pleasing to the ear'
        },
        {
            term: 'expatiate',
            definition: 'to speak or write at length'
        },
        {
            term: 'perfervid',
            definition: 'intense and passionate'
        },
        {
            term: 'quaternion',
            definition: 'a number that represents a rotation in 3D space'
        },
        {
            term: 'quotidian',
            definition: 'the everyday'
        },
        {
            term: 'sanguine',
            definition: 'optimistic, especially facing adversity'
        },
        {
            term: 'sapience',
            definition: 'wisdom, or the ability to make good decisions'
        },
        {
            term: 'sesquipedalian',
            definition: 'verbose, but in a pretentious way'
        },
    ];
</script>

<div in:fade={{ duration: 200, delay: 200 }}>
    <div class="h-dvh w-full flex justify-center">
        <div class="w-1/3 mt-[20vh] text-justify selection:bg-stone-600 selection:text-stone-100">
            <div class="flex flex-col selection:text-stone-800">
                <div class="mb-6 flex gap-4">
                    {#each tabs as tab}
                        <button
                            type="button"
                            class={`italic text-[14px] tracking-wide transition-colors duration-200 ease-out
                                selection:bg-stone-800 selection:text-stone-100
                                ${
                                    activeTab === tab.id
                                        ? 'text-stone-800'
                                        : 'text-stone-400 hover:text-stone-800'
                                }
                            `}
                            onclick={() => (activeTab = tab.id)}
                            style="font-family: 'Cormorant Garamond', serif"
                        >
                            {tab.label}
                        </button>
                    {/each}
                </div>

                <div class="max-h-[60vh] overflow-y-auto">
                    {#if activeTab === 'portfolio'}
                        <div in:fade={{ duration: 200, delay: 200 }}>
                            {#each portfolioSections as section}
                                <h2
                                    style="font-family: 'Cormorant Garamond', serif"
                                    class="text-stone-700 text-[16px] tracking-wide mb-1 italic"
                                >
                                    {section.title}
                                </h2>

                                {#each section.paragraphs as paragraph, i}
                                    <p
                                        class={
                                            `text-stone-600 text-[14px] ${
                                                i < section.paragraphs.length - 1 ? 'mb-2' : 'mb-5'
                                        }`}
                                    >
                                        {paragraph}
                                    </p>
                                {/each}
                            {/each}
                        </div>
                    {:else if activeTab === 'library'}
                        <div class="space-y-4" in:fade={{ duration: 200, delay: 200 }}>
                            {#each libraryItems as item}
                                <div class="flex flex-col">
                                    <h2
                                        style="font-family: 'Cormorant Garamond', serif"
                                        class="text-stone-700 text-[15px] tracking-wide mb-1 italic"
                                    >
                                        {item.title}
                                    </h2>
                                    <p class="text-stone-600 text-[14px]">
                                        {item.description}
                                    </p>
                                </div>
                            {/each}
                        </div>
                    {:else if activeTab === 'glossary'}
                        <div class="space-y-3" in:fade={{ duration: 200, delay: 200 }}>
                            {#each glossary as item}
                                <div>
                                    <span
                                        style="font-family: 'Cormorant Garamond', serif"
                                        class="text-stone-700 text-[15px] tracking-wide mb-1 italic"
                                    >
                                        {item.term}
                                    </span>
                                    <span class="text-stone-500 text-[13px]"> - </span>
                                    <span class="text-stone-600 text-[14px]">
                                        {item.definition}
                                    </span>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            </div>
        </div>
    </div>
</div>