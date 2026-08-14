export const TRACKED_PLAYERS = [
	{ key: 'andrew', fallbackLabel: 'Andrew', tokens: ['andrew', 'graves'] },
	{ key: 'nico', fallbackLabel: 'Nico', tokens: ['nico', 'cho'] }
] as const;

export type TrackedPlayerKey = (typeof TRACKED_PLAYERS)[number]['key'];
