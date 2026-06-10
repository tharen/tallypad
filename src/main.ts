import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

// Import the virtual module to handle PWA service worker registration
import 'virtual:pwa-register';

createApp(App).mount('#app');
