<template>
  <div class="space-y-4">
    <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <h2 class="text-2xl font-bold">Trees</h2>
        <p class="text-sm text-slate-600">Enter and persist tally data at the plot level.</p>
      </div>
      <div class="grid gap-2 sm:grid-cols-3">
        <label class="flex flex-col gap-1 text-sm text-slate-700">
          Unit
          <select v-model="selectedUnitId" class="rounded border border-slate-300 px-3 py-2">
            <option disabled value="">Choose unit</option>
            <option v-for="unit in units" :key="unit.globalid" :value="unit.globalid">{{ unit.name || unit.project_name }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-sm text-slate-700">
          Plot
          <select v-model="selectedPlotId" class="rounded border border-slate-300 px-3 py-2">
            <option disabled value="">Choose plot</option>
            <option v-for="plot in plotOptions" :key="plot.globalid" :value="plot.globalid">{{ plot.plot_number || plot.globalid.slice(0, 6) }}</option>
          </select>
        </label>
        <button @click="addTree" class="rounded bg-slate-900 px-4 py-2 text-white transition hover:bg-slate-700">Add Tree</button>
      </div>
    </div>

    <div class="overflow-x-auto rounded border border-slate-200 bg-white shadow-sm">
      <table class="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead class="bg-slate-50">
          <tr>
            <th class="px-3 py-3 font-semibold">Tr</th>
            <th class="px-3 py-3 font-semibold">PF</th>
            <th class="px-3 py-3 font-semibold">SP</th>
            <th class="px-3 py-3 font-semibold">S</th>
            <th class="px-3 py-3 font-semibold">N</th>
            <th class="px-3 py-3 font-semibold">D</th>
            <th class="px-3 py-3 font-semibold">FP</th>
            <th class="px-3 py-3 font-semibold">FF</th>
            <th class="px-3 py-3 font-semibold">TD</th>
            <th class="px-3 py-3 font-semibold">BH</th>
            <th class="px-3 py-3 font-semibold">TH</th>
            <th class="px-3 py-3 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="(row, index) in rows" :key="row.globalid" :class="index === activeRow ? 'bg-slate-50' : ''">
            <td class="px-2 py-2"><input v-model="row.tree_number" @blur="saveTree(row)" class="w-full rounded border border-slate-300 px-2 py-1" /></td>
            <td class="px-2 py-2"><input v-model="row.plot_factor" @blur="saveTree(row)" class="w-full rounded border border-slate-300 px-2 py-1" /></td>
            <td class="px-2 py-2"><input v-model="row.species" @blur="saveTree(row)" class="w-full rounded border border-slate-300 px-2 py-1" /></td>
            <td class="px-2 py-2">
              <select v-model="row.status" @change="saveTree(row)" class="w-full rounded border border-slate-300 px-2 py-1">
                <option value="L">L</option>
                <option value="D">D</option>
                <option value="C">C</option>
                <option value="G">G</option>
              </select>
            </td>
            <td class="px-2 py-2"><input v-model="row.tally" @blur="saveTree(row)" class="w-full rounded border border-slate-300 px-2 py-1" /></td>
            <td class="px-2 py-2"><input v-model="row.diameter" @blur="saveTree(row)" class="w-full rounded border border-slate-300 px-2 py-1" /></td>
            <td class="px-2 py-2"><input v-model="row.form_point" @blur="saveTree(row)" class="w-full rounded border border-slate-300 px-2 py-1" /></td>
            <td class="px-2 py-2"><input v-model="row.form_factor" @blur="saveTree(row)" class="w-full rounded border border-slate-300 px-2 py-1" /></td>
            <td class="px-2 py-2"><input v-model="row.top_diameter" @blur="saveTree(row)" class="w-full rounded border border-slate-300 px-2 py-1" /></td>
            <td class="px-2 py-2"><input v-model="row.bole_height" @blur="saveTree(row)" class="w-full rounded border border-slate-300 px-2 py-1" /></td>
            <td class="px-2 py-2"><input v-model="row.top_height" @blur="saveTree(row)" class="w-full rounded border border-slate-300 px-2 py-1" /></td>
            <td class="px-2 py-2">
              <button @click="removeTree(row.globalid)" class="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-500">Delete</button>
            </td>
          </tr>
          <tr v-if="rows.length === 0">
            <td colspan="12" class="px-4 py-8 text-center text-slate-500">Select a unit and plot to view trees, or add a tree after selecting a plot.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { db, Tree, Unit, Plot, createGlobalId } from '../db';

const units = ref<Unit[]>([]);
const plots = ref<Plot[]>([]);
const rows = ref<Tree[]>([]);
const selectedUnitId = ref('');
const selectedPlotId = ref('');
const activeRow = ref(0);

const loadUnitsAndPlots = async () => {
  units.value = await db.units.toArray();
  plots.value = await db.plots.toArray();
  if (!selectedUnitId.value && units.value.length > 0) {
    selectedUnitId.value = units.value[0].globalid;
  }
  if (selectedUnitId.value && !plotOptions.value.length && plots.value.length > 0) {
    selectedPlotId.value = plots.value[0].globalid;
  }
};

const loadTrees = async () => {
  if (selectedPlotId.value) {
    rows.value = await db.trees.where('plot_globalid').equals(selectedPlotId.value).toArray();
  } else {
    rows.value = [];
  }
};

const plotOptions = computed(() => plots.value.filter((plot) => plot.unit_globalid === selectedUnitId.value));

watch(selectedUnitId, async () => {
  if (!plotOptions.value.some((plot) => plot.globalid === selectedPlotId.value)) {
    selectedPlotId.value = plotOptions.value[0]?.globalid ?? '';
  }
});

watch(selectedPlotId, loadTrees);

const addTree = async () => {
  if (!selectedPlotId.value) {
    return;
  }
  const plot = plots.value.find((item) => item.globalid === selectedPlotId.value);
  if (!plot) {
    return;
  }
  const unit = units.value.find((item) => item.globalid === plot.unit_globalid);
  const newTree: Tree = {
    globalid: createGlobalId(),
    plot_globalid: selectedPlotId.value,
    tree_number: String(rows.value.length + 1),
    plot_factor: '1',
    species: '',
    status: 'L',
    tally: '1',
    diameter: '',
    form_point: '',
    form_factor: '',
    top_diameter: '',
    bole_height: '',
    top_height: '',
    plot_number: plot.plot_number,
    unit_name: unit?.name ?? '',
  };
  await db.trees.add(newTree);
  await loadTrees();
  activeRow.value = rows.value.length - 1;
};

const saveTree = async (tree: Tree) => {
  await db.trees.put(tree);
};

const removeTree = async (globalid: string) => {
  if (!confirm('Delete this tree?')) {
    return;
  }
  await db.trees.delete(globalid);
  await loadTrees();
};

onMounted(async () => {
  await loadUnitsAndPlots();
  await loadTrees();
});
</script>

<style scoped>
input,
select {
  min-width: 64px;
}
</style>
