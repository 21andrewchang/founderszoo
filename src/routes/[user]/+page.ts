import { error } from '@sveltejs/kit';
import { TRACKED_PLAYERS } from '$lib/trackedPlayers';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	const user = params.user.toLowerCase();
	const match = TRACKED_PLAYERS.find(
		(player) => player.key === user || (player.tokens as readonly string[]).includes(user)
	);
	if (!match) error(404, 'user not found');
	return { playerKey: match.key };
};
