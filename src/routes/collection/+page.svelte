<script lang="ts">
    import { fade } from 'svelte/transition';
    import { onMount } from 'svelte';

    type TabId = 'portfolio' | 'library' | 'glossary';

    const navItems: { id: TabId; label: string }[] = [
        { id: 'portfolio', label: 'Portfolio' },
        { id: 'library', label: 'Library' },
        { id: 'glossary', label: 'Glossary' }
    ]

    let currentSection: TabId = 'portfolio';

	type PortfolioSection = {
        title: string;
        paragraphs: string[];
    };

    const portfolioSections: PortfolioSection[] = [
        {
            title: 'vector',
            paragraphs: [
                'An extracurricular for high school students to build real projects.',
                'Students use Vector to land internships and get into college.'
            ]
        },
        {
            title: 'founders zoo',
            paragraphs: [
                'You can watch every move we make as we build our startup.',
                'Peek into our minds and ith 30-minute granularity.'
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
            definition: 'utterly and extremely impassioned'
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

    let portfolioEl: HTMLElement | null = null;
    let libraryEl: HTMLElement | null = null;
    let glossaryEl: HTMLElement | null = null;

    function scrollToSection(id: TabId) {
        const el = id === 'portfolio' ? portfolioEl : id === 'library' ? libraryEl : glossaryEl;
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    onMount(() => {
        const sectionMap: { id: TabId; el: HTMLElement | null }[] = [
            { id: 'portfolio', el: portfolioEl },
            { id: 'library', el: libraryEl },
            { id: 'glossary', el: glossaryEl }
        ];

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
                        const id = (entry.target as HTMLElement).dataset.section as TabId;
                        if (id) {
                            currentSection = id;
                        }
                    }
                }
            },
            {
                root: null,
                threshold: 0.5
            }
        );

        for (const { id, el } of sectionMap) {
            if (!el) continue;
            el.dataset.section = id;
            observer.observe(el);
        }

        return () => observer.disconnect();
    });
</script>

<div in:fade={{ duration: 200, delay: 200 }}>
    <div class="min-h-dvh w-full flex justify-center overflow-y-auto">
        <div class="w-1/3 text-justify pt-[25vh] pb-[25vh] selection:bg-stone-600 selection:text-stone-100">
            <section class="mb-10">
                <h1
                    style="font-family: 'Cormorant Garamond', serif"
                    class="text-stone-500 text-3xl tracking-wide mb-8"
                >
                    Collection
                </h1>
                <p class="text-stone-600 text-sm">
                    Our works, readings, and lexicon.
                </p>
            </section>

            <div class="h-[1px] w-full rounded-full bg-stone-200 mb-16"></div>

            <section id="portfolio" bind:this={portfolioEl} class="mb-16">
                <h1
                    style="font-family: 'Cormorant Garamond', serif"
                    class="text-stone-500 text-2xl tracking-wide mb-6"
                >
                    Portfolio
                </h1>

                <div class="space-y-2">
                    {#each portfolioSections as section}
                        <div class="flex flex-col">
                            <h2
                                style="font-family: 'Cormorant Garamond', serif"
                                class="text-stone-700 text-md tracking-wide mb-1 italic"
                            >
                                {section.title}
                            </h2>

                            {#each section.paragraphs as paragraph}
                                <p class="text-stone-600 text-sm mb-2">
                                    {paragraph}
                                </p>
                            {/each}
                        </div>
                    {/each}
                </div>
            </section>

            <section id="library" bind:this={libraryEl} class="mb-16">
                <h1
                    style="font-family: 'Cormorant Garamond', serif"
                    class="text-stone-500 text-2xl tracking-wide mb-6"
                >
                    Library
                </h1>

                <div class="space-y-4">
                    {#each libraryItems as item}
                        <div class="flex flex-col">
                            <h2
                                style="font-family: 'Cormorant Garamond', serif"
                                class="text-stone-700 text-md tracking-wide mb-1 italic"
                            >
                                {item.title}
                            </h2>
                            <p class="text-stone-600 text-sm">
                                {item.description}
                            </p>
                        </div>
                    {/each}
                </div>
            </section>

            <section id="glossary" bind:this={glossaryEl}>
                <h1
                    style="font-family: 'Cormorant Garamond', serif"
                    class="text-stone-500 text-2xl tracking-wide mb-6"
                >
                    Glossary
                </h1>

                <div class="space-y-4">
                    {#each glossary as item}
                        <div>
                            <span
                                style="font-family: 'Cormorant Garamond', serif"
                                class="text-stone-700 text-md tracking-wide mb-1 italic"
                            >
                                {item.term}
                            </span>
                            <span class="text-stone-400 text-xs"> - </span>
                            <span class="text-stone-600 text-sm">
                                {item.definition}
                            </span>
                        </div>
                    {/each}
                </div>
            </section>
            
            <div class="fixed right-6 top-1/4 -translate-y-1/2 flex flex-col items-center">
                {#each navItems as item}
                    <button
                        type="button"
                        onclick={() => scrollToSection(item.id)}
                        class="group flex flex-col items-center"
                    >
                        <div class="relative h-4 w-20 overflow-hidden flex items-center justify-end">
                            <span
                                class={`absolute right-0 h-px w-4 rounded-full bg-stone-400 origin-right transition-transform duration-200 ${
                                    currentSection === item.id ? 'scale-x-0' : 'scale-x-100 group-hover:scale-x-0'
                                }`}
                            ></span>

                            <span 
                                style="font-family: 'Cormorant Garamond', serif"
                                class={`absolute right-0 text-[10px] tracking-wide uppercase whitespace-nowrap transition-all duration-200 ${
                                    currentSection === item.id
                                        ? 'translate-x-0 opacity-100 text-stone-800'
                                        : 'translate-x-4 opacity-0 text-stone-400 group-hover:opacity-100 group-hover:text-stone-800 group-hover:translate-x-0'
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
</div>

