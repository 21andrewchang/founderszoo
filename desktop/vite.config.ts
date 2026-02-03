import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';

const rootDir = path.resolve(__dirname, '..');

export default defineConfig({
	root: path.resolve(__dirname, 'renderer'),
	envDir: __dirname,
	publicDir: path.resolve(rootDir, 'static'),
	base: './',
	plugins: [tailwindcss(), svelte({ preprocess: vitePreprocess() })],
	resolve: {
		alias: [
			{
				find: '$lib/supabaseClient',
				replacement: path.resolve(__dirname, 'renderer/src/supabaseClient.ts')
			},
			{ find: '$lib', replacement: path.resolve(rootDir, 'src/lib') },
			{ find: '$routes', replacement: path.resolve(rootDir, 'src/routes') },
			{
				find: '$app/environment',
				replacement: path.resolve(__dirname, 'renderer/src/stubs/app-environment.ts')
			},
			{
				find: '$app/navigation',
				replacement: path.resolve(__dirname, 'renderer/src/stubs/app-navigation.ts')
			},
			{
				find: '$app/stores',
				replacement: path.resolve(__dirname, 'renderer/src/stubs/app-stores.ts')
			},
			{
				find: '$env/static/public',
				replacement: path.resolve(__dirname, 'renderer/src/stubs/env-public.ts')
			}
		]
	},
	build: {
		outDir: path.resolve(__dirname, 'dist/renderer'),
		emptyOutDir: true
	},
	server: {
		port: 5174,
		strictPort: true,
		fs: {
			allow: [rootDir]
		}
	}
});
