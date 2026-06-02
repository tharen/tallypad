<template>
  <div id="app-inner" :class="{ 'dark-mode': store.isDarkMode.value }">
    <header class="p-2 border-b-2 flex justify-between items-center" :style="{ borderColor: 'var(--border-color)', backgroundColor: 'var(--header-bg)' }">
      <div @click="store.goToPlots()" class="m-0 p-0 cursor-pointer text-xl">◀</div>
      <div class="flex flex-col items-center">
        <h1 class="text-xs uppercase opacity-70 font-bold">ArcGIS Online</h1>
        <div class="text-sm font-black">SETUP & SYNC</div>
      </div>
      <div class="w-6"></div> <!-- Spacer -->
    </header>

    <div class="flex-1 p-6 space-y-6 overflow-y-auto">
      <section class="space-y-4">
        <h2 class="text-lg font-bold">Authentication</h2>
        
        <div v-if="!store.esriToken.value" class="p-4 rounded-lg bg-[var(--btn-bg)] border border-[var(--border-color)]">
          <p class="text-sm mb-4 opacity-80">Log in to ArcGIS Online to sync your plot data with feature services.</p>
          <button @click="login" class="w-full py-3 bg-blue-600 text-white rounded-md font-bold hover:bg-blue-700 transition-colors">
            Login with ArcGIS
          </button>
        </div>

        <div v-else class="p-4 rounded-lg bg-[var(--btn-bg)] border border-[var(--border-color)]">
          <div class="flex items-center justify-between mb-4">
            <div>
              <p class="text-xs uppercase opacity-60">Signed in as</p>
              <p class="font-bold text-lg">{{ store.userName.value }}</p>
            </div>
            <div class="h-10 w-10 bg-green-500/20 text-green-500 rounded-full flex items-center justify-center font-bold">
              {{ store.userName.value?.charAt(0).toUpperCase() }}
            </div>
          </div>
          <button @click="store.logoutEsri()" class="w-full py-2 border border-red-500 text-red-500 rounded-md font-bold hover:bg-red-500/10 transition-colors">
            Logout
          </button>
        </div>
      </section>

      <section class="space-y-4">
        <h2 class="text-lg font-bold">Profile Settings</h2>
        <div class="flex flex-col gap-2">
          <label class="text-xs uppercase opacity-60">Manual Display Name</label>
          <input 
            v-model="store.userName.value" 
            placeholder="Enter name..." 
            class="p-3 bg-[var(--cell-bg)] border border-[var(--border-color)] rounded-md focus:border-[var(--accent)] outline-none"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useAppStore } from '../stores/appStore';

  const store = useAppStore();

  // Replace with your ArcGIS Client ID or use a .env file
  const CLIENT_ID = import.meta.env.VITE_ESRI_CLIENT_ID; 

  // Ensures the URI always ends in a trailing slash to match the registered Portal URI exactly
  const REDIRECT_URI = window.location.origin + window.location.pathname.replace(/\/$/, '') + '/';

  const login = () => {
    const authUrl = `https://www.arcgis.com/sharing/rest/oauth2/authorize?client_id=${CLIENT_ID}&response_type=token&expiration=20160&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    window.location.href = authUrl;
  };
</script>