<template>
  <div class="space-y-4">
    <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div>
        <h2 class="text-2xl font-bold">Plots</h2>
        <p class="text-sm text-slate-600">Create and manage sampling locations anchored to units.</p>
      </div>
      <button @click="createPlot" class="rounded bg-slate-900 px-4 py-2 text-white transition hover:bg-slate-700">Add Plot</button>
    </div>

    <div class="flex flex-wrap gap-3">
      <label class="flex flex-col gap-1 text-sm text-slate-700">
        Unit
        <select v-model="selectedUnitId" class="rounded border border-slate-300 px-3 py-2">
          <option disabled value="">Choose unit</option>
          <option v-for="unit in units" :key="unit.globalid" :value="unit.globalid">{{ unit.name || unit.project_name }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-sm text-slate-700">
        Status
        <select v-model="defaultStatus" class="rounded border border-slate-300 px-3 py-2">
          <option value="active">active</option>
          <option value="inactive">inactive</option>
          <option value="closed">closed</option>
        </select>
      </label>
    </div>

    <div class="overflow-x-auto rounded border border-slate-200 bg-white shadow-sm">
      <table class="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead class="bg-slate-50">
          <tr>
            <th class="px-4 py-3 font-semibold">Plot</th>
            <th class="px-4 py-3 font-semibold">Unit</th>
            <th class="px-4 py-3 font-semibold">Cruiser</th>
            <th class="px-4 py-3 font-semibold">Status</th>
            <th class="px-4 py-3 font-semibold">Slope</th>
            <th class="px-4 py-3 font-semibold">Aspect</th>
            <th class="px-4 py-3 font-semibold">Elevation</th>
            <th class="px-4 py-3 font-semibold">GPS</th>
            <th class="px-4 py-3 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="plot in filteredPlots" :key="plot.globalid">
            <td class="px-4 py-3"><input v-model="plot.plot_number" @blur="savePlot(plot)" class="w-full rounded border border-slate-300 px-2 py-1" /></td>
            <td class="px-4 py-3">{{ plotUnit(plot.unit_globalid)?.name || 'Unknown' }}</td>
            <td class="px-4 py-3"><input v-model="plot.cruiser" @blur="savePlot(plot)" class="w-full rounded border border-slate-300 px-2 py-1" /></td>
            <td class="px-4 py-3">
              <select v-model="plot.status" @change="savePlot(plot)" class="w-full rounded border border-slate-300 px-2 py-1">
                <option value="active">active</option>
                <option value="inactive">inactive</option>
                <option value="closed">closed</option>
              </select>
            </td>
            <td class="px-4 py-3"><input v-model="plot.slope" @blur="savePlot(plot)" class="w-full rounded border border-slate-300 px-2 py-1" /></td>
            <td class="px-4 py-3"><input v-model="plot.aspect" @blur="savePlot(plot)" class="w-full rounded border border-slate-300 px-2 py-1" /></td>
            <td class="px-4 py-3"><input v-model="plot.elevation" @blur="savePlot(plot)" class="w-full rounded border border-slate-300 px-2 py-1" /></td>
            <td class="px-4 py-3">
              <div class="grid gap-1">
                <input v-model="plot.planned_latitude" @blur="savePlot(plot)" placeholder="planned lat" class="rounded border border-slate-300 px-2 py-1" />
                <input v-model="plot.planned_longitude" @blur="savePlot(plot)" placeholder="planned lng" class="rounded border border-slate-300 px-2 py-1" />
                <input v-model="plot.gps_latitude" @blur="savePlot(plot)" placeholder="gps lat" class="rounded border border-slate-300 px-2 py-1" />
                <input v-model="plot.gps_longitude" @blur="savePlot(plot)" placeholder="gps lng" class="rounded border border-slate-300 px-2 py-1" />
                <input v-model="plot.gps_error" @blur="savePlot(plot)" placeholder="gps error" class="rounded border border-slate-300 px-2 py-1" />
                <input v-model="plot.gps_time" @blur="savePlot(plot)" placeholder="gps time" class="rounded border border-slate-300 px-2 py-1" />
              </div>
            </td>
            <td class="px-4 py-3">
              <button @click="removePlot(plot.globalid)" class="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-500">Delete</button>
            </td>
          </tr>
          <tr v-if="filteredPlots.length === 0">
            <td colspan="9" class="px-4 py-8 text-center text-slate-500">No plots found. Add a unit first, then create a plot.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { addPlot, db, deletePlotAndChildren, Unit } from '../db';
import type { Plot } from '../db';

const units = ref<Unit[]>([]);
const plots = ref<Plot[]>([]);
const selectedUnitId = ref('');
const defaultStatus = ref('active');

const loadData = async () => {
  units.value = await db.units.toArray();
  plots.value = await db.plots.toArray();
  if (!selectedUnitId.value && units.value.length > 0) {
    selectedUnitId.value = units.value[0].globalid;
  }
};

const createPlot = async () => {
  if (!selectedUnitId.value) {
    return;
  }
  await addPlot({
    unit_globalid: selectedUnitId.value,
    plot_number: `P-${plots.value.length + 1}`,
    status: defaultStatus.value,
  });
  await loadData();
};

const savePlot = async (plot: Plot) => {
  await db.plots.put(plot);
};

const removePlot = async (globalid: string) => {
  if (!confirm('Delete this plot and its associated trees?')) {
    return;
  }
  await deletePlotAndChildren(globalid);
  await loadData();
};

const plotUnit = (unitGlobalId: string) => units.value.find((unit) => unit.globalid === unitGlobalId) ?? null;

const filteredPlots = computed(() => {
  if (!selectedUnitId.value) {
    return plots.value;
  }
  return plots.value.filter((plot) => plot.unit_globalid === selectedUnitId.value);
});

onMounted(loadData);
</script>

<style scoped>
input,
select {
  min-width: 100px;
}
</style>
