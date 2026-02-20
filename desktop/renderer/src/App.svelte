<script lang="ts">
	import { onMount } from 'svelte';
	import Layout from '../../../src/routes/+layout.svelte';
	import MainPage from '../../../src/routes/+page.svelte';

	type DesktopShortcutResponse = {
		ok: boolean;
		shortcut: string;
		message?: string;
	};

	type DesktopApi = {
		isDesktop?: boolean;
		hidePanel?: () => void;
		getShortcut?: () => Promise<string>;
		setShortcut?: (shortcut: string) => Promise<DesktopShortcutResponse>;
	};

	const LayoutComponent: any = Layout;

	const view = new URLSearchParams(window.location.search).get('view');
	const isPanel = view === 'panel';
	const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
	const defaultShortcut = '';
	const modifierHint = isMac ? 'Ctrl, Alt, Shift, Command' : 'Ctrl, Alt, Shift, Super';

	let settingsOpen = false;
	let recording = false;
	let saving = false;
	let shortcut = defaultShortcut;
	let pendingShortcut = defaultShortcut;
	let errorMessage = '';
	let recordingModifiers: {
		meta: boolean;
		ctrl: boolean;
		alt: boolean;
		shift: boolean;
	} | null = null;

	const desktopApi = () => (window as Window & { desktop?: DesktopApi }).desktop;

	const formatDisplayShortcut = (accelerator: string) => {
		if (!accelerator) return '';
		return accelerator
			.split('+')
			.map((part) => {
				switch (part) {
					case 'Command':
						return 'Cmd';
					case 'Control':
						return 'Ctrl';
					case 'CommandOrControl':
						return 'Cmd/Ctrl';
					case 'Option':
					case 'Alt':
						return 'Alt';
					case 'Super':
						return 'Super';
					case 'Shift':
						return 'Shift';
					case 'Esc':
						return 'Esc';
					default:
						return part;
				}
			})
			.join('+');
	};

	const isAscii = (value: string) => /^[\x20-\x7E]+$/.test(value);

	const normalizeKey = (key: string) => {
		if (key.length === 1) return key.toUpperCase();
		const map: Record<string, string> = {
			' ': 'Space',
			Spacebar: 'Space',
			Escape: 'Esc',
			ArrowUp: 'Up',
			ArrowDown: 'Down',
			ArrowLeft: 'Left',
			ArrowRight: 'Right'
		};
		return map[key] ?? key;
	};

	const buildAccelerator = (
		key: string,
		mods?: { meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }
	) => {
		if (['Shift', 'Control', 'Alt', 'Meta', 'OS', 'Super'].includes(key)) return null;
		const modifiers: string[] = [];
		if (mods?.meta) modifiers.push(isMac ? 'Command' : 'Super');
		if (mods?.ctrl) modifiers.push('Control');
		if (mods?.alt) modifiers.push('Alt');
		if (mods?.shift) modifiers.push('Shift');
		const keyPart = normalizeKey(key);
		if (!keyPart || modifiers.length === 0) return null;
		if (!isAscii(keyPart)) return null;
		return [...modifiers, keyPart].join('+');
	};

	const openSettings = () => {
		settingsOpen = true;
		recording = false;
		saving = false;
		pendingShortcut = shortcut;
		errorMessage = '';
		recordingModifiers = null;
	};

	const closeSettings = () => {
		settingsOpen = false;
		recording = false;
		saving = false;
		errorMessage = '';
		recordingModifiers = null;
	};

	const handleRecordKeydown = (event: KeyboardEvent) => {
		if (!recording) return;
		event.preventDefault();
		event.stopPropagation();
		const isModifierKey = ['Shift', 'Control', 'Alt', 'Meta', 'OS', 'Super'].includes(event.key);
		if (isModifierKey) {
			recordingModifiers = {
				meta: event.metaKey,
				ctrl: event.ctrlKey,
				alt: event.altKey,
				shift: event.shiftKey
			};
			errorMessage = 'Now press a key to complete the shortcut.';
			return;
		}
		const mods =
			recordingModifiers ??
			({
				meta: event.metaKey,
				ctrl: event.ctrlKey,
				alt: event.altKey,
				shift: event.shiftKey
			} as const);
		const accel = buildAccelerator(event.key, mods);
		if (!accel) {
			if (mods.meta && mods.ctrl && mods.alt && mods.shift) {
				errorMessage = 'Press a key along with Hyper (e.g. Hyper+K).';
			} else {
				errorMessage = `Add at least one modifier key (${modifierHint}).`;
			}
			return;
		}
		pendingShortcut = accel;
		recording = false;
		errorMessage = '';
		recordingModifiers = null;
	};

	const saveShortcut = async () => {
		const nextShortcut = pendingShortcut.trim();
		if (!nextShortcut) return;
		if (saving) return;
		saving = true;
		errorMessage = '';
		const api = desktopApi();
		if (!api?.setShortcut) {
			shortcut = nextShortcut;
			closeSettings();
			saving = false;
			return;
		}
		const res = await api.setShortcut(nextShortcut);
		if (res?.ok) {
			shortcut = res.shortcut;
			closeSettings();
		} else {
			errorMessage = res?.message ?? 'Unable to save shortcut.';
		}
		saving = false;
	};

	const onKeydown = (event: KeyboardEvent) => {
		if (settingsOpen) {
			if (recording) {
				handleRecordKeydown(event);
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				closeSettings();
				return;
			}
		}
		if (!isPanel) return;
		if (event.key === 'Escape') {
			(window as { desktop?: { hidePanel?: () => void } }).desktop?.hidePanel?.();
		}
	};

	onMount(async () => {
		const api = desktopApi();
		if (!api?.getShortcut) return;
		try {
			const saved = await api.getShortcut();
			if (saved) {
				shortcut = saved;
				pendingShortcut = saved;
			}
		} catch {
			// ignore
		}
	});
</script>

<svelte:window on:keydown={onKeydown} />

<svelte:component this={LayoutComponent} suppressSpectator desktopMode>
	<MainPage />
</svelte:component>

{#if !isPanel}
	<button
		class="no-drag fixed bottom-4 left-4 z-40 flex h-6 w-6 items-center justify-center text-stone-200 transition hover:text-stone-500"
		on:click={openSettings}
		aria-label="Open settings"
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="14"
			height="14"
			fill="currentColor"
			class="bi bi-gear-fill"
			viewBox="0 0 16 16"
			aria-hidden="true"
		>
			<path
				d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"
			/>
		</svg>
	</button>
{/if}

{#if settingsOpen}
	<div
		class="fixed inset-0 z-[120] flex items-center justify-center bg-black/70"
		on:click={closeSettings}
	>
		<div
			class="w-full max-w-md rounded-xl border border-stone-200 bg-white text-stone-800 shadow-[0_20px_45px_rgba(36,35,32,0.15)]"
			role="dialog"
			aria-modal="true"
			on:click|stopPropagation
		>
			<div class="space-y-3 px-5 py-5 text-sm text-stone-600">
				<div class="text-base font-semibold text-stone-900">Desktop shortcut</div>
				<div class="text-xs text-stone-500">Toggle the desktop window</div>
				<div class="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-800">
					{formatDisplayShortcut(pendingShortcut)}
				</div>
				<div class="text-xs text-stone-500">
					{recording
						? 'Press the new shortcut now.'
						: `Use at least one modifier (${modifierHint}).`}
				</div>
				{#if errorMessage}
					<div class="text-xs text-red-600">{errorMessage}</div>
				{/if}
			</div>
			<div class="flex items-center justify-between border-t border-stone-100 px-5 py-4">
				<div class="flex items-center gap-2">
					<button
						type="button"
						class="inline-flex items-center justify-center rounded-lg border border-stone-200 px-2 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none"
						on:click={() => {
							recording = !recording;
							errorMessage = '';
							recordingModifiers = null;
						}}
					>
						{recording ? 'Recording...' : 'Record'}
					</button>
					<button
						type="button"
						class="inline-flex items-center justify-center rounded-lg border border-stone-200 px-2 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none"
						on:click={() => {
							pendingShortcut = isMac ? 'Command+Control+Alt+Shift+K' : 'Control+Alt+Shift+K';
							recording = false;
							errorMessage = '';
							recordingModifiers = null;
						}}
					>
						Hyper+K
					</button>
					<button
						type="button"
						class="inline-flex items-center justify-center rounded-lg border border-stone-200 px-2 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none"
						on:click={() => {
							pendingShortcut = shortcut;
							recording = false;
							errorMessage = '';
							recordingModifiers = null;
						}}
					>
						Reset
					</button>
				</div>
				<div class="flex items-center gap-2">
					<button
						type="button"
						class="inline-flex items-center justify-center rounded-lg border border-stone-200 px-2 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none"
						on:click={closeSettings}
					>
						Cancel
					</button>
					<button
						type="button"
						class="inline-flex items-center justify-center rounded-lg border border-stone-200 bg-stone-900 px-2 py-1.5 text-xs text-white transition hover:bg-stone-800 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
						disabled={saving || recording}
						on:click={saveShortcut}
					>
						Save
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
