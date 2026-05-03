import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import pkg from './package.json';

export default defineConfig(({ }) => {
  // 'serve' is used for local dev, 'build' for production builds
  const major_ver = pkg.version.split('.')[0];
  const minor_ver = pkg.version.split('.')[1];
  const patch_ver = pkg.version.split('.')[2];
  // const app = command === 'build' ? 'app' : 'dev';
  // If this is GitHub pages CI build then the root needs to be adjusted
  const app = process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME === 'main' ? 'app' : 'dev';
  const root = process.env.GITHUB_ACTIONS ? `/tallypad/tallypad/v${major_ver}/${app}/` : `/${app}/`;
  
  return {
    base: root,
    plugins: [
      vue(),
    ]
  };
});