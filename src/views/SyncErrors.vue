<template>
  <div id="app-inner" :class="{ 'dark-mode': store.isDarkMode.value }">
    <!-- Header -->
    <header class="p-4 border-b-2 flex items-center justify-between" :style="{ borderColor: 'var(--border-color)', backgroundColor: 'var(--header-bg)' }">
      <div class="flex items-center">
        <div @click="store.goToPreviousView()" class="m-0 pr-4 cursor-pointer text-xl" title="Back to Setup">◀</div>
        <h1 class="text-md font-bold">Sync Errors Log</h1>
      </div>
      <button 
        v-if="errors.length > 0" 
        @click="clearErrors" 
        class="px-3 py-1.5 bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white border border-red-500/20 rounded font-semibold transition-all cursor-pointer text-xs"
      >
        Clear Log
      </button>
    </header>

    <!-- Filters Panel -->
    <div class="p-4 bg-[var(--cell-bg)] border-b-2 flex flex-col sm:flex-row gap-4 items-center justify-between" :style="{ borderColor: 'var(--border-color)' }">
      <div class="flex items-center gap-2 w-full sm:w-auto">
        <span class="text-sm font-bold opacity-75">Filter Table:</span>
        <select
          v-model="selectedTable"
          class="p-2 border rounded bg-[var(--bg-primary)] text-[var(--text-primary)] border-[var(--border-color)] outline-none min-w-[150px] cursor-pointer"
        >
          <option value="">-- All Tables --</option>
          <option v-for="t in uniqueTables" :key="t" :value="t">{{ t }}</option>
        </select>
      </div>
      <div class="w-full sm:w-64">
        <input 
          v-model="searchQuery" 
          type="text" 
          placeholder="Search errors..." 
          class="w-full p-2 border rounded bg-[var(--bg-primary)] text-[var(--text-primary)] border-[var(--border-color)] outline-none text-sm"
        />
      </div>
    </div>

    <!-- Table Section -->
    <div class="flex-1 p-6 overflow-y-auto">
      <div class="border border-[var(--border-color)] rounded-lg overflow-hidden bg-[var(--cell-bg)]">
        <div class="overflow-x-auto w-full">
          <table class="w-full border-collapse text-sm text-left">
            <thead>
              <tr class="bg-[var(--btn-bg)] border-b border-[var(--border-color)]">
                <th class="p-3 w-32 font-bold">Table Name</th>
                <th class="p-3 w-48 font-bold">Record GUID</th>
                <th class="p-3 font-bold">Error Message</th>
                <th class="p-3 w-40 font-bold">Time</th>
                <th class="p-3 w-16 text-center font-bold">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="filteredErrors.length === 0">
                <td colspan="5" class="p-8 text-center opacity-60 italic">No sync errors found. Your database is healthy!</td>
              </tr>
              <tr v-for="error in filteredErrors" :key="error.id" class="border-b border-[var(--border-color)] hover:bg-[var(--btn-bg)]/20">
                <td class="p-3 font-semibold capitalize text-red-500">{{ error.table_name }}</td>
                <td class="p-3 font-mono text-xs select-all">{{ error.record_guid }}</td>
                <td class="p-3 text-red-500/90 font-medium">{{ error.error_message }}</td>
                <td class="p-3 text-xs opacity-75 font-normal">
                  {{ new Date(error.timestamp).toLocaleString() }}
                </td>
                <td class="p-3 text-center">
                  <button
                    @click="deleteError(error.id)"
                    class="text-red-500 hover:text-red-700 font-bold transition-colors cursor-pointer text-sm p-1"
                    title="Delete error entry"
                  >
                    🗑️
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useAppStore } from '../stores/appStore';
import { db, ISyncError } from '../db';

const store = useAppStore();
const errors = ref<ISyncError[]>([]);
const selectedTable = ref('');
const searchQuery = ref('');

const loadErrors = async () => {
  if (db.syncErrors) {
    errors.value = await db.syncErrors.orderBy('timestamp').reverse().toArray();
  }
};

const uniqueTables = computed(() => {
  const tables = errors.value.map(e => e.table_name);
  return [...new Set(tables)];
});

const filteredErrors = computed(() => {
  let result = errors.value;

  if (selectedTable.value) {
    result = result.filter(e => e.table_name === selectedTable.value);
  }

  const query = searchQuery.value.trim().toLowerCase();
  if (query) {
    result = result.filter(e => 
      e.record_guid.toLowerCase().includes(query) || 
      e.error_message.toLowerCase().includes(query) ||
      e.table_name.toLowerCase().includes(query)
    );
  }

  return result;
});

const deleteError = async (id: number | undefined) => {
  if (id === undefined) return;
  await db.syncErrors.delete(id);
  await loadErrors();
  await store.checkSyncErrors();
};

const clearErrors = async () => {
  if (!confirm('Are you sure you want to clear all sync errors?')) return;
  await db.syncErrors.clear();
  await loadErrors();
  await store.checkSyncErrors();
};

onMounted(() => {
  loadErrors();
});
</script>
