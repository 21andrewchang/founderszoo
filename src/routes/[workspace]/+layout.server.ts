import { createServerClient } from '@supabase/ssr';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import type { Cookies } from '@sveltejs/kit';

type WorkspaceLoadData = {
	authorized: boolean;
	viewerEmail: string | null;
	workspaceUsername: string | null;
};

export const load = async ({
	cookies,
	params
}: {
	cookies: Cookies;
	params: { workspace: string };
}) => {
	const supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		cookies: {
			get: (key) => cookies.get(key),
			set: (key, value, options) => {
				cookies.set(key, value, options as any);
			},
			remove: (key, options) => {
				cookies.delete(key, options as any);
			}
		}
	});

	const {
		data: { user }
	} = await supabase.auth.getUser();

	const workspaceUsername = params.workspace ?? null;
	let authorized = false;

	if (workspaceUsername) {
		const { data: workspaceUser } = await supabase
			.from('users')
			.select('id, username')
			.eq('username', workspaceUsername)
			.maybeSingle();

		if (workspaceUser && user && workspaceUser.id === user.id) {
			authorized = true;
		}
	}

	const payload: WorkspaceLoadData = {
		authorized,
		viewerEmail: user?.email ?? null,
		workspaceUsername
	};

	return payload;
};
