// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	interface DesktopShortcutResponse {
		ok: boolean;
		shortcut: string;
		message?: string;
	}

	interface DesktopApi {
		isDesktop?: boolean;
		hidePanel?: () => void;
		getShortcut?: () => Promise<string>;
		setShortcut?: (shortcut: string) => Promise<DesktopShortcutResponse>;
	}

	interface Window {
		desktop?: DesktopApi;
	}

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
