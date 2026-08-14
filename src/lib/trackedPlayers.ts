export const TRACKED_PLAYERS = [
	{ key: 'andrew', fallbackLabel: 'Andrew', tokens: ['andrew', 'graves'] }
] as const;

export type TrackedPlayerKey = (typeof TRACKED_PLAYERS)[number]['key'];
