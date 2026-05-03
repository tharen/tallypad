import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import pkg from './package.json';

export default defineConfig(() => {
  // Use root base locally and /tallypad/ for GitHub Pages deploys.
  const base = process.env.GITHUB_ACTIONS ? '/tallypad/' : '/';

  return {
    base,
    plugins: [vue()],
  };
});