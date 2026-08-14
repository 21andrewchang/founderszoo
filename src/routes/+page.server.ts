import { createServerClient } from '@supabase/ssr';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import { redirect } from '@sveltejs/kit';
import type { Cookies } from '@sveltejs/kit';

export const load = async ({ cookies }: { cookies: Cookies }) => {
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

	if (!user) return {};

	const { data: userRow } = await supabase
		.from('users')
		.select('username')
		.eq('id', user.id)
		.maybeSingle();

	if (userRow?.username) {
		throw redirect(302, `/${userRow.username}`);
	}

	return {};
};
