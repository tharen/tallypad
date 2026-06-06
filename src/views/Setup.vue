<template>
  <div id="app-inner" :class="{ 'dark-mode': store.isDarkMode.value }">
    <header class="p-2 border-b-2 flex justify-between items-center" :style="{ borderColor: 'var(--border-color)', backgroundColor: 'var(--header-bg)' }">
      <div @click="store.goToPlots()" class="m-0 p-0 cursor-pointer text-xl">◀</div>
      <div class="flex flex-col items-center">
        <h1 class="text-xs uppercase opacity-70 font-bold">Setup</h1>
      </div>
      <div class="w-6"></div> <!-- Spacer -->
    </header>

    <div class="flex-1 p-6 space-y-6 overflow-y-auto">
      <section class="space-y-4">
        <div class="flex flex-col gap-2">
          <label class="text-xs uppercase opacity-60">User Name</label>
          <input 
            v-model="store.userName.value" 
            placeholder="Enter name..." 
            class="p-3 bg-[var(--cell-bg)] border border-[var(--border-color)] rounded-md focus:border-[var(--accent)] outline-none"
            :disabled="store.esriToken.value !== null"
          />
        </div>
      </section>

      <section class="space-y-4">
        <h2 class="text-lg font-bold">Syncronization</h2>
        
        <div v-if="!store.esriToken.value" class="p-4 rounded-lg bg-[var(--btn-bg)] border border-[var(--border-color)]">
          <p class="text-sm mb-4 opacity-80">Log in using your ESRI ArcGIS Online credentials.</p>
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
        <button v-if="store.esriToken.value" @click="syncWithEsri()" class="w-full py-2 border border-red-500 text-red-500 rounded-md font-bold">
          Sync Plots
        </button>
      </section>

      <section class="space-y-4">
        <h2 class="text-lg font-bold">Database</h2>
        <button @click="exportDB()" class="w-full py-2 border rounded-md font-bold">
          Export JSON
        </button>
        <button @click="importDB()" class="w-full py-2 border rounded-md font-bold">
          Import JSON
        </button>
        <button @click="wipeDB()" class="w-full py-2 border border-red-500 text-red-500 rounded-md font-bold">
          Wipe Database
        </button>
      </section>

    </div>
  </div>
</template>

<script setup lang="ts">
  import { useAppStore } from '../stores/appStore';
  import { syncAll } from '../sync_agol';
  import { renewDatabase, exportDatabase, importDatabase} from '../db';

  const store = useAppStore();

  // Replace with your ArcGIS Client ID or use a .env file
  const CLIENT_ID = import.meta.env.VITE_ESRI_CLIENT_ID; 

  // Ensures the URI always ends in a trailing slash to match the registered Portal URI exactly
  const REDIRECT_URI = window.location.origin + window.location.pathname.replace(/\/$/, '') + '/';

  const login = () => {
    // Generate a cryptographically strong verifier for PKCE.
    // RFC 7636 requires a minimum length of 43 characters. 
    // Two UUIDs combined provide ~72 characters, well within the 43-128 range.
    const verifier = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
    localStorage.setItem('esri_code_verifier', verifier);

    // response_type=code is required for refresh tokens
    const authUrl = `https://www.arcgis.com/sharing/rest/oauth2/authorize?client_id=${CLIENT_ID}&response_type=code&expiration=20160&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code_challenge=${verifier}&code_challenge_method=plain`;
    window.location.href = authUrl;
  };

  const syncWithEsri = async () => {
    syncAll(store);
    window.location.reload();
  };

  const exportDB = async () => {
    exportDatabase();
  };

  const importDB = async () => {
    if (confirm('Importing will replace all existing data. Are you sure you want to import?')) {
      if (confirm('Click OK to confirm import.')) {
        importDatabase();
      } else {
        alert('Import canceled.');
      }
    }
    
  }

  const wipeDB = async () => {
    // prompt user to confirm
    if (confirm('This will erase any unsaved, unsynced data. Are you sure you want to wipe the database?')) {
      if (confirm('Click OK to wipe the database.')) {
        renewDatabase();
        // await loadPlots();
        alert('Database wiped successfully!');
      } else {
        alert('Database wipe canceled.');
      }
    }
  };

</script>