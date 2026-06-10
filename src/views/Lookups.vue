<template>
  <div id="app-inner" :class="{ 'dark-mode': store.isDarkMode.value }">
    <!-- Header -->
    <header class="p-4 border-b-2 flex items-center" :style="{ borderColor: 'var(--border-color)', backgroundColor: 'var(--header-bg)' }">
      <div @click="store.goToPreviousView()" class="m-0 pr-4 cursor-pointer text-xl" title="Back">◀</div>
      <div class="flex flex-col items-center">
        <h1 class="text-md font-bold">Manage Lookups</h1>
      </div>
      <div class="w-6"></div> <!-- Spacer -->
    </header>
    
    <!-- Filters Panel -->
    <div class="p-4 bg-[var(--cell-bg)] border-b-2 flex flex-col sm:flex-row gap-4 items-center justify-between" :style="{ borderColor: 'var(--border-color)' }">
      <div class="flex items-center gap-2 w-full sm:w-auto">
        <span class="text-sm font-bold opacity-75">Filter Feature:</span>
        <select
          v-model="selectedFeature"
          class="p-2 border rounded bg-transparent text-[var(--text-primary)] border-[var(--border-color)] outline-none min-w-[150px] cursor-pointer"
        >
          <option value="">-- All Features --</option>
          <option v-for="f in uniqueFeatures" :key="f" :value="f">{{ f }}</option>
        </select>
      </div>
    </div>

    <!-- Table Section -->
    <div class="flex-1 p-6 overflow-y-auto">
      <div class="border border-[var(--border-color)] rounded-lg overflow-hidden bg-[var(--cell-bg)]">
        <div class="overflow-x-auto w-full">
          <table class="w-full border-collapse text-sm text-left">
            <thead>
              <tr class="bg-[var(--btn-bg)] border-b border-[var(--border-color)]">
                <th class="p-3 w-16 text-center">Feature</th>
                <th class="p-3 w-16 text-center">Code</th>
                <th class="p-3 w-40">Value</th>
                <th class="p-3 w-auto">Description</th>
                <th class="p-3 w-20 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="filteredLookups.length === 0">
                <td colspan="5" class="p-6 text-center opacity-60 italic">No lookup records found.</td>
              </tr>
              <tr v-for="lookup in filteredLookups" :key="lookup.guid" class="border-b border-[var(--border-color)] hover:bg-[var(--btn-bg)]/20">
                <td class="p-3">
                  <input
                    type="text"
                    maxlength="20"
                    v-model="lookup.feature"
                    @change="saveLookup(lookup)"
                    placeholder="e.g. sp..."
                    class="w-full text-center bg-transparent border-b border-transparent focus:border-[var(--accent)] outline-none font-semibold"
                  />
                </td>
                <td class="p-3">
                  <input
                    type="text"
                    v-model="lookup.code"
                    maxlength="10"
                    @change="saveLookup(lookup)"
                    placeholder="e.g. DF..."
                    class="w-full text-center bg-transparent border-b border-transparent focus:border-[var(--accent)] outline-none font-mono"
                  />
                </td>
                <td class="p-3">
                  <input
                    type="text"
                    maxlength="20"
                    v-model="lookup.value"
                    @change="saveLookup(lookup)"
                    placeholder="e.g. Douglas-fir..."
                    class="w-full bg-transparent border-b border-transparent focus:border-[var(--accent)] outline-none"
                  />
                </td>
                <td class="p-3">
                  <input
                    type="text"
                    maxlength="40"
                    v-model="lookup.description"
                    @change="saveLookup(lookup)"
                    placeholder="Add description..."
                    class="w-full bg-transparent border-b border-transparent focus:border-[var(--accent)] outline-none"
                  />
                </td>
                <td class="p-3 text-center">
                  <button
                    @click="deleteLookup(lookup)"
                    class="text-red-500 hover:text-red-700 font-bold transition-colors cursor-pointer text-lg p-1"
                    title="Delete Lookup"
                  >
                    🗑️
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <button @click="addLookup" class="w-full sm:w-auto px-4 py-2 my-2 bg-green-600 hover:bg-green-700 text-white rounded font-bold transition-colors cursor-pointer text-sm">
        ＋ Add Lookup
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useAppStore } from '../stores/appStore';
import { db, ILookups } from '../db';

const store = useAppStore();

const lookups = ref<ILookups[]>([]);
const selectedFeature = ref<string>('');

const uniqueFeatures = computed(() => {
  const feats = lookups.value.map(l => l.feature).filter(Boolean);
  return Array.from(new Set(feats)).sort();
});

const loadLookups = async () => {
  lookups.value = await db.lookups.toArray();  // Sort by feature then code for better readability
  lookups.value.sort((a, b) => {
    if (a.feature !== b.feature) return a.feature.localeCompare(b.feature);
    return a.code.localeCompare(b.code);
  });
  
};

const filteredLookups = computed(() => {
  if (!selectedFeature.value) return lookups.value;
  return lookups.value.filter(l => l.feature === selectedFeature.value);
});

const saveLookup = async (lookup: ILookups) => {
  if (!lookup.feature.trim() || !lookup.code.trim()) {
    return;
  }
  await db.lookups.put(JSON.parse(JSON.stringify(lookup)));
  await loadLookups();
};

const addLookup = async () => {
  const newLookup: ILookups = {
    guid: crypto.randomUUID(),
    feature: selectedFeature.value || 'sp',
    code: '',
    value: '',
    description: ''
  };
  await db.lookups.put(newLookup);
  await loadLookups();
};

const deleteLookup = async (lookup: ILookups) => {
  const confirmed = confirm(`Are you sure you want to delete lookup "${lookup.code}" for feature "${lookup.feature}"?`);
  if (!confirmed) return;

  if (lookup.guid) {
    await db.lookups.delete(lookup.guid);
  }
  await loadLookups();
};

onMounted(() => {
  loadLookups();
});
</script>

<style scoped>
table {
  border: none;
}
th {
  background: var(--btn-bg);
  position: static;
}
td {
  background: transparent;
}
option {
  background-color: var(--cell-bg);
  color: var(--text-primary);
}
</style>
