import { writable } from 'svelte/store';

export const eventModalOpenDate = writable<string | null>(null);

export function requestEventModalOpen(dateStr: string) {
	console.log('event modal store set', dateStr);
	eventModalOpenDate.set(dateStr);
}

export function clearEventModalOpen() {
	eventModalOpenDate.set(null);
}
