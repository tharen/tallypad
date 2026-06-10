<template>
  <div id="app-inner" :class="{ 'dark-mode': store.isDarkMode.value }">
    <header class="p-2 border-b-2 flex items-center" :style="{ borderColor: 'var(--border-color)', backgroundColor: 'var(--header-bg)' }">
      <div @click="store.goToPreviousView()" class="m-0 pr-4 cursor-pointer text-xl">◀</div>
      <div class="flex flex-col items-center">
        <h1 class="text-md font-bold">Setup</h1>
      </div>
      <div class="w-6"></div> <!-- Spacer -->
    </header>

    <div class="max-w-100 overflow-y-auto">
      <div class="flex-1 p-6 space-y-6 overflow-y-auto">
        <section class="space-y-4">
          <div class="flex flex-col gap-2">
            <label class="text-xs opacity-60">User Name</label>
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
          <div class="flex flex-col gap-2">
            <label class="text-xs opacity-60">Plot Service URL</label>
            <input 
              v-model="store.plotServiceUrl.value" 
              placeholder="Enter URL..." 
              class="p-3 bg-[var(--cell-bg)] border border-[var(--border-color)] rounded-md focus:border-[var(--accent)] outline-none"
            />
          </div>
          <div v-if="!store.esriToken.value" class="p-4 rounded-lg bg-[var(--btn-bg)] border border-[var(--border-color)]">
            <p class="text-sm mb-4 opacity-80">Log in using your ESRI ArcGIS Online credentials.</p>
            <button @click="login" class="w-full py-3 bg-blue-600 text-white rounded-md font-bold hover:bg-blue-700 transition-colors">
              Login with ArcGIS
            </button>
          </div>

          <div v-else class="p-4 rounded-lg bg-[var(--btn-bg)] border border-[var(--border-color)]">
            <div class="flex items-center justify-between mb-4">
              <div>
                <p class="text-xs opacity-60">Signed in as</p>
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
          <button v-if="store.esriToken.value" @click="syncWithEsri()" class="w-full py-2 border border-blue-500 text-blue-500 rounded-md font-bold cursor-pointer">
            Sync Plots
          </button>
          <button 
            v-show="syncErrorCount > 0"
            @click="store.goToSyncErrors()"
            class="w-full py-2 mt-2 border border-red-500/30 text-red-500 rounded-md font-bold hover:bg-red-500/10 transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
            ⚠️ View Sync Errors <span v-if="syncErrorCount > 0" class="px-2 py-0.5 text-xs bg-red-600 text-white rounded-full font-bold">{{ syncErrorCount }}</span>
          </button>
        </section>

        <section class="space-y-4">
          <h2 class="text-lg font-bold">Database</h2>
          <button @click="exportDB()" class="w-full py-2 border rounded-md font-bold">
            Export Plot Data
          </button>
          <button @click="importDB()" class="w-full py-2 border rounded-md font-bold">
            Import Plot Data
          </button>
          <hr class="border-red-500">
          <button @click="wipeDB()" class="w-full py-2 border border-red-500 text-red-500 rounded-md font-bold">
            Wipe Local Database
          </button>
        </section>

        <section class="p-6 space-y-4 border-t border-[var(--border-color)]">
          <h2 class="text-lg font-bold">Permissions & UI</h2>
          <div class="space-y-3">
            <label class="flex items-center gap-3 cursor-pointer p-3 bg-[var(--cell-bg)] rounded-md border border-[var(--border-color)]">
              <input 
                type="checkbox" 
                :checked="store.allowAddPlots.value" 
                class="h-5 w-5 rounded border-gray-300 text-[var(--accent)] focus:ring-[var(--accent)]"
                @change="store.toggleAllowAddPlots()"
              />
              <div class="flex flex-col">
                <span class="font-bold text-sm">Allow Adding Plots</span>
                <span class="text-xs opacity-60">Enable the "Add Plot" button on the main dashboard.</span>
              </div>
            </label>

            <label class="flex items-center gap-3 cursor-pointer p-3 bg-[var(--cell-bg)] rounded-md border border-[var(--border-color)]">
              <input 
                type="checkbox" 
                :checked="store.allowAddVisits.value" 
                class="h-5 w-5 rounded border-gray-300 text-[var(--accent)] focus:ring-[var(--accent)]"
                @change="store.toggleAllowAddVisits()"
              />
              <div class="flex flex-col">
                <span class="font-bold text-sm">Allow Adding Visits</span>
                <span class="text-xs opacity-60">Enable the "Add Visit" button on plot cards and details.</span>
              </div>
            </label>
          </div>
        </section>

      </div>

      <!-- Export Dialog Modal -->
      <div v-if="showExportDialog" class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div class="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg w-full max-w-md p-6 flex flex-col max-h-[80vh]">
          <h3 class="text-lg font-bold mb-4">Select Plots to Export</h3>
          
          <div class="flex items-center gap-2 pb-2 mb-3 border-b border-[var(--border-color)]">
            <input 
              type="checkbox" 
              id="selectAll" 
              :checked="isAllSelected" 
              @change="toggleSelectAll"
              class="h-4 w-4 rounded border-gray-300 text-[var(--accent)] focus:ring-[var(--accent)] cursor-pointer"
            />
            <label for="selectAll" class="font-semibold cursor-pointer select-none">Select All</label>
          </div>

          <div class="flex-1 overflow-y-auto space-y-2 pr-1">
            <div v-for="plot in availablePlots" :key="plot.guid" class="flex items-center gap-2 py-1">
              <input 
                type="checkbox" 
                :id="plot.guid" 
                :value="plot.guid"
                v-model="selectedPlots"
                class="h-4 w-4 rounded border-gray-300 text-[var(--accent)] focus:ring-[var(--accent)] cursor-pointer"
              />
              <label :for="plot.guid" class="cursor-pointer select-none">{{ plot.plotid }}</label>
            </div>
          </div>

          <div class="flex gap-3 mt-6">
            <button @click="showExportDialog = false" class="flex-1 py-2 border border-[var(--border-color)] rounded-md font-bold hover:bg-[var(--btn-bg)] transition-colors">
              Cancel
            </button>
            <button @click="confirmExport" :disabled="selectedPlots.length === 0" class="flex-1 py-2 bg-blue-600 text-white rounded-md font-bold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              Export ({{ selectedPlots.length }})
            </button>
          </div>
        </div>
      </div>

      <!-- Import Dialog Modal -->
      <div v-if="showImportDialog" class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div class="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg w-full max-w-md p-6 flex flex-col">
          <h3 class="text-lg font-bold mb-2">Import Database</h3>
          <p class="text-sm opacity-80 mb-6">Choose how you want to import the JSON file.</p>
          
          <div class="space-y-3">
            <button @click="triggerImport('update')" class="w-full py-3 bg-[var(--btn-bg)] hover:bg-[var(--accent)] hover:text-white border border-[var(--border-color)] rounded-md font-bold transition-all text-left px-4 flex flex-col cursor-pointer">
              <span class="text-base font-bold">Update (Merge)</span>
              <span class="text-xs opacity-75 font-normal mt-1">Updates existing plots and adds new ones without wiping current data.</span>
            </button>
            
            <button @click="triggerImport('replace')" class="w-full py-3 bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white border border-red-500/30 rounded-md font-bold transition-all text-left px-4 flex flex-col cursor-pointer">
              <span class="text-base font-bold">Replace (Wipe & Clean Import)</span>
              <span class="text-xs opacity-75 font-normal mt-1">Wipes the entire database first, then does a clean import of the file contents.</span>
            </button>
          </div>

          <div class="flex gap-3 mt-6">
            <button @click="showImportDialog = false" class="w-full py-2 border border-[var(--border-color)] rounded-md font-bold hover:bg-[var(--btn-bg)] transition-colors cursor-pointer">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Sync Progress Dialog Modal -->
    <div v-if="isSyncing" class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div class="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg w-full max-w-md p-6 flex flex-col max-h-[85vh]">
        <h3 class="text-lg font-bold mb-2 flex items-center gap-2">
          <span v-if="isSyncRunning" class="animate-spin inline-block text-blue-500">🔄</span>
          <span v-else-if="hasSyncErrors" class="text-red-500">⚠️</span>
          <span v-else class="text-green-500">✅</span>
          {{ syncTitle }}
        </h3>
        <p class="text-sm opacity-80 mb-6">{{ syncSubtitle }}</p>
        
        <div class="flex-1 overflow-y-auto space-y-3 pr-1">
          <div v-for="step in syncSteps" :key="step.key" class="flex items-start justify-between p-3 rounded-md border border-[var(--border-color)] bg-[var(--cell-bg)] border-collapse">
            <div class="flex flex-col">
              <span class="font-bold text-sm capitalize">{{ step.label }}</span>
              <span v-if="syncProgressMap[step.key].message" class="text-xs text-red-500 mt-1">
                {{ syncProgressMap[step.key].message }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <span v-if="syncProgressMap[step.key].status === 'pending'" class="text-xs px-2 py-1 bg-gray-500/10 text-gray-500 rounded border border-gray-500/20 font-semibold">Pending</span>
              <span v-else-if="syncProgressMap[step.key].status === 'syncing'" class="text-xs px-2 py-1 bg-blue-500/10 text-blue-500 rounded border border-blue-500/20 font-semibold animate-pulse">Syncing...</span>
              <span v-else-if="syncProgressMap[step.key].status === 'completed'" class="text-xs px-2 py-1 bg-green-500/10 text-green-500 rounded border border-green-500/20 font-semibold">✓ Done</span>
              <span v-else-if="syncProgressMap[step.key].status === 'failed'" class="text-xs px-2 py-1 bg-red-500/10 text-red-500 rounded border border-red-500/20 font-semibold">✗ Failed</span>
            </div>
          </div>
        </div>

        <div class="flex gap-3 mt-6">
          <button 
            @click="closeSyncDialog" 
            :disabled="isSyncRunning"
            class="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer text-sm"
          >
            {{ isSyncRunning ? 'Syncing...' : 'Close' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed, onMounted } from 'vue';
  import { useAppStore } from '../stores/appStore';
  import { syncAll, SyncStep, SyncStatus } from '../sync_agol';
  import { renewDatabase, exportDatabase, importDatabase, db } from '../db';

  const store = useAppStore();

  const isSyncing = ref(false);
  const isSyncRunning = ref(false);
  const syncErrorCount = ref(0);

  const syncProgressMap = ref<Record<SyncStep, { status: SyncStatus; message?: string }>>({
    plots: { status: 'pending' },
    gps_points: { status: 'pending' },
    visits: { status: 'pending' },
    trees: { status: 'pending' },
    measurements: { status: 'pending' },
    lookups: { status: 'pending' },
    edits: { status: 'pending' },
  });

  const syncSteps = [
    { key: 'plots', label: 'plots' },
    { key: 'gps_points', label: 'gps points' },
    { key: 'visits', label: 'visits' },
    { key: 'trees', label: 'trees' },
    { key: 'measurements', label: 'measurements' },
    { key: 'lookups', label: 'lookups' },
    { key: 'edits', label: 'edits' }
  ] as const;

  const hasSyncErrors = computed(() => {
    return Object.values(syncProgressMap.value).some(s => s.status === 'failed');
  });

  const syncTitle = computed(() => {
    if (isSyncRunning.value) return 'Syncing with ESRI ArcGIS';
    if (hasSyncErrors.value) return 'Sync Completed with Errors';
    return 'Sync Completed Successfully';
  });

  const syncSubtitle = computed(() => {
    if (isSyncRunning.value) return 'Please keep Tallypad open while we sync your records.';
    if (hasSyncErrors.value) return 'Some tables failed to sync. Review the details below.';
    return 'All local data is now synchronized with the feature service.';
  });

  const loadSyncErrorCount = async () => {
    if (db.syncErrors) {
      syncErrorCount.value = await db.syncErrors.count();
    }
  };

  const closeSyncDialog = () => {
    isSyncing.value = false;
  };

  onMounted(async () => {
    await loadSyncErrorCount();
  });

  const showExportDialog = ref(false);
  const showImportDialog = ref(false);
  const availablePlots = ref<{ guid: string; plotid: string }[]>([]);
  const selectedPlots = ref<string[]>([]);

  const isAllSelected = computed(() => {
    return availablePlots.value.length > 0 && selectedPlots.value.length === availablePlots.value.length;
  });

  const toggleSelectAll = (e: Event) => {
    const checked = (e.target as HTMLInputElement).checked;
    if (checked) {
      selectedPlots.value = availablePlots.value.map(p => p.guid);
    } else {
      selectedPlots.value = [];
    }
  };

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
    isSyncing.value = true;
    isSyncRunning.value = true;
    
    // Reset statuses
    for (const key of Object.keys(syncProgressMap.value) as SyncStep[]) {
      syncProgressMap.value[key] = { status: 'pending' };
    }

    try {
      await syncAll(store, (progress) => {
        syncProgressMap.value[progress.step] = {
          status: progress.status,
          message: progress.message
        };
      });
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      isSyncRunning.value = false;
      await loadSyncErrorCount();
    }
  };

  const exportDB = async () => {
    availablePlots.value = await db.plots.orderBy('plotid').toArray();
    selectedPlots.value = availablePlots.value.map(p => p.guid);
    showExportDialog.value = true;
  };

  const confirmExport = async () => {
    showExportDialog.value = false;
    await exportDatabase(selectedPlots.value);
  };

  const importDB = () => {
    showImportDialog.value = true;
  };

  const triggerImport = (mode: 'replace' | 'update') => {
    showImportDialog.value = false;
    if (mode === 'replace') {
      if (!confirm('Importing will replace all existing data. Are you sure you want to import?')) {
        return;
      }
      if (!confirm('Click OK to confirm database replacement (this will clear all tables first).')) {
        return;
      }
    }
    importDatabase(mode);
  };

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