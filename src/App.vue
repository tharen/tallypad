<template>
  <div id="app-inner" class="min-h-screen bg-slate-50 text-slate-900">
    <header class="border-b border-slate-200 bg-white px-4 py-4 shadow-sm">
      <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p class="uppercase tracking-[0.3em] text-xs text-slate-500">Forest Inventory</p>
          <h1 class="mt-2 text-3xl font-bold">TallyPad</h1>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="view in views"
            :key="view.key"
            @click="currentView = view.key"
            :class="[
              'rounded px-4 py-2 text-sm font-semibold transition',
              currentView === view.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
            ]"
          >
            {{ view.label }}
          </button>
        </div>
      </div>
    </header>

    <main class="p-4">
      <component :is="currentComponent" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import TreesView from './views/Trees.vue';
import PlotsView from './views/Plots.vue';
import UnitsView from './views/Units.vue';

const currentView = ref<'trees' | 'plots' | 'units'>('trees');
const views = [
  { key: 'trees', label: 'Trees' },
  { key: 'plots', label: 'Plots' },
  { key: 'units', label: 'Units' },
];

const currentComponent = computed(() => {
  if (currentView.value === 'plots') return PlotsView;
  if (currentView.value === 'units') return UnitsView;
  return TreesView;
});
</script>

<style scoped>
#app-inner {
  min-height: 100vh;
}
</style>
