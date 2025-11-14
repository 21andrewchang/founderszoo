<script lang="ts">
    import { fade } from 'svelte/transition';

    type SectionId = 'portfolio' | 'library' | 'anthology';

    const navItems: { id: SectionId; label: string }[] = [
        { id: 'portfolio', label: 'Portfolio' },
        { id: 'library', label: 'Library' },
        { id: 'anthology', label: 'Anthology' }
    ]

    let currentSection: SectionId = 'portfolio';
    let hoveredNav: SectionId | null = null;

	type PortfolioItem = {
        title: string;
        description: string;
    };

    const portfolioItems: PortfolioItem[] = [
        {
            title: 'vector',
            description: 'An extracurricular for high school students to build real projects. Students use Vector to land internships and get into college.'
        },
        {
            title: 'founders zoo',
            description: 'A high-granularity peek into our minds. Watch every move we make as we build our startup.'
        },
        {
            title: 'vimgod',
            description: 'A vim motions game, just you against the editor.'
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
        // {
        //     title: 'The Mom Test',
        //     description: 'How to validate your startup idea. Not for moms.'
        // },
    ];

    type AnthologyItem = {
        title: string;
        author: string;
        description: string;
    };

    const anthologyItems: AnthologyItem[] = [
        {
            title: 'focus',
            author: 'a',
            description: 'The double-edged sword of man.'
        },
        {
            title: 'optics',
            author: 'n',
            description: 'Scuplt your image. Every choice is deliberate.'
            // Shape how you let others perceive you.
        },
        {
            title: 'concision',
            author: 'a',
            description: 'Less is more.'
        },
    ];

    // type GlossaryItem = {
    //     term: string;
    //     definition: string;
    // };

    // const glossary: GlossaryItem[] = [
    //     {
    //         term: 'coruscate',
    //         definition: 'to flash or sparkle'
    //     },
    //     {
    //         term: 'euphonious',
    //         definition: 'pleasing to the ear'
    //     },
    //     {
    //         term: 'expatiate',
    //         definition: 'to speak or write at length'
    //     },
    //     {
    //         term: 'perfervid',
    //         definition: 'utterly and extremely impassioned'
    //     },
    //     {
    //         term: 'quaternion',
    //         definition: 'a number that represents a rotation in 3D space'
    //     },
    //     {
    //         term: 'quotidian',
    //         definition: 'the everyday'
    //     },
    //     {
    //         term: 'sanguine',
    //         definition: 'optimistic, especially facing adversity'
    //     },
    //     {
    //         term: 'sapience',
    //         definition: 'wisdom, or the ability to make good decisions'
    //     },
    //     {
    //         term: 'sesquipedalian',
    //         definition: 'verbose, but in a pretentious way'
    //     },
    // ];

    let portfolioEl: HTMLElement | null = null;
    let libraryEl: HTMLElement | null = null;
    let anthologyEl: HTMLElement | null = null;

    let scrollContainer: HTMLDivElement | null = null;

    function handleScroll() {
        if (!scrollContainer) return;

        const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
        const maxScroll = scrollHeight - clientHeight;

        if (maxScroll <= 0) {
            currentSection = 'portfolio';
            return;
        }

        const progress = scrollTop / maxScroll;

        // change thresholds if you add/remove sections
        if (progress < 0.45) {
            currentSection = 'portfolio';
        } else if (progress < 0.9) {
            currentSection = 'library';
        } else {
            currentSection = 'anthology';
        }
    }

    function scrollToSection(id: SectionId) {
        const map: Record<SectionId, HTMLElement | null> = {
            portfolio: portfolioEl,
            library: libraryEl,
            anthology: anthologyEl
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
</script>

<div in:fade={{ duration: 200, delay: 200 }}>
    <div class="h-dvh w-full flex justify-center overflow-y-auto scrollbar-hide" style="font-family: 'Cormorant Garamond', serif" bind:this={scrollContainer} onscroll={handleScroll}>
        <div class="w-1/3 text-justify pt-[25vh] selection:bg-stone-600 selection:text-stone-100">
            <section class="mb-4">
                <h1
                    class="text-stone-500 text-4xl tracking-wide mb-3"
                >
                    Collection
                </h1>
                <p class="text-stone-600 text-md">
                    Our works, readings, and convictions.
                </p>
            </section>

            <div class="h-[1px] w-full rounded-full bg-stone-200 mb-16"></div>

            <section id="portfolio" bind:this={portfolioEl} class="mb-16">
                <h1
                    class="text-stone-500 text-3xl tracking-wide mb-6"
                >
                    Portfolio
                </h1>

                <div class="space-y-4">
                    {#each portfolioItems as item}
                        <div class="flex flex-col">
                            <h2
                                class="text-stone-700 text-lg tracking-wide mb-1 italic"
                            >
                                {item.title}
                            </h2>
                            <p class="text-stone-600 text-md">
                                {item.description}
                            </p>
                        </div>
                    {/each}
                </div>
            </section>

            <section id="library" bind:this={libraryEl} class="mb-16">
                <h1
                    class="text-stone-500 text-3xl tracking-wide mb-6"
                >
                    Library
                </h1>

                <div class="space-y-4">
                    {#each libraryItems as item}
                        <div class="flex flex-col">
                            <h2
                                class="text-stone-700 text-lg tracking-wide mb-1 italic"
                            >
                                {item.title}
                            </h2>
                            <p class="text-stone-600 text-md">
                                {item.description}
                            </p>
                        </div>
                    {/each}
                </div>
            </section>

            <section id="anthology" bind:this={anthologyEl} class="pb-[25vh]">
                <h1
                    class="text-stone-500 text-3xl tracking-wide mb-6"
                >
                    Anthology
                </h1>

                <div class="space-y-4">
                    {#each anthologyItems as item}
                        <div class="flex flex-col">
                            <h2
                                class="text-stone-700 text-lg tracking-wide mb-1 italic"
                            >
                                {item.title}.{item.author}
                            </h2>
                            <p class="text-stone-600 text-md">
                                {item.description}
                            </p>
                        </div>
                    {/each}
                </div>
            </section>

            <!-- <section id="glossary" bind:this={glossaryEl} class="pb-[25vh]">
                <h1
                    class="text-stone-500 text-3xl tracking-wide mb-6"
                >
                    Glossary
                </h1>

                <div class="space-y-4">
                    {#each glossary as item}
                        <div>
                            <span
                                class="text-stone-700 text-lg tracking-wide mb-1 italic"
                            >
                                {item.term}
                            </span>
                            <span class="text-stone-400 text-xs" style="font-family: 'Inter', sans-serif"> - </span>
                            <span class="text-stone-600 text-md">
                                {item.definition}
                            </span>
                        </div>
                    {/each}
                </div>
            </section> -->
            
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
                                class={`absolute right-0 h-px w-4 rounded-full bg-stone-400 origin-right transition-transform transition-colors duration-150
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
</div>