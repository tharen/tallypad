import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(() => {
  // Use root base locally and /tallypad/ for GitHub Pages deploys.
  // const base = process.env.GITHUB_ACTIONS ? '/tallypad/' : '/';
  const app = 'dev';
  if (process.env.GITHUB_REF_NAME) {
    const app = process.env.GITHUB_REF_NAME === 'main' ? 'app' : process.env.GITHUB_REF_NAME;
  }
  const root = '/tallypad';

  return {
    base: root,
    plugins: [
      vue(),
      tailwindcss()
    ],
  };
});
