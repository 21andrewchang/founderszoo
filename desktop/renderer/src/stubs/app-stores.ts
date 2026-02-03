import { readable } from 'svelte/store';

const getUrl = () => {
	if (typeof window === 'undefined') {
		return new URL('app://founders-zoo');
	}
	return new URL(window.location.href);
};

export const page = readable({ url: getUrl() }, (set) => {
	if (typeof window === 'undefined') {
		return () => {};
	}

	const update = () => set({ url: getUrl() });
	window.addEventListener('popstate', update);
	window.addEventListener('hashchange', update);

	return () => {
		window.removeEventListener('popstate', update);
		window.removeEventListener('hashchange', update);
	};
});
