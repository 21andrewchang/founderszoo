import './desktop.css';
import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('app');

if (!target) {
	throw new Error('Desktop app root element not found.');
}

mount(App, { target });
