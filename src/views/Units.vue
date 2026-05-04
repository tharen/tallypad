<template>
  <div class="space-y-4">
    <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div>
        <h2 class="text-2xl font-bold">Units</h2>
        <p class="text-sm text-slate-600">Manage top-level inventory units and their project settings.</p>
      </div>
      <button @click="createUnit" class="rounded bg-slate-900 px-4 py-2 text-white transition hover:bg-slate-700">Add Unit</button>
    </div>

    <div class="overflow-x-auto rounded border border-slate-200 bg-white shadow-sm">
      <table class="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead class="bg-slate-50">
          <tr>
            <th class="px-4 py-3 font-semibold">Project</th>
            <th class="px-4 py-3 font-semibold">Unit Name</th>
            <th class="px-4 py-3 font-semibold">Area</th>
            <th class="px-4 py-3 font-semibold">Status</th>
            <th class="px-4 py-3 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="unit in units" :key="unit.globalid">
            <td class="px-4 py-3"><input v-model="unit.project_name" @blur="saveUnit(unit)" class="w-full rounded border border-slate-300 px-2 py-1" /></td>
            <td class="px-4 py-3"><input v-model="unit.name" @blur="saveUnit(unit)" class="w-full rounded border border-slate-300 px-2 py-1" /></td>
            <td class="px-4 py-3"><input v-model="unit.area" @blur="saveUnit(unit)" class="w-full rounded border border-slate-300 px-2 py-1" /></td>
            <td class="px-4 py-3">
              <select v-model="unit.status" @change="saveUnit(unit)" class="w-full rounded border border-slate-300 px-2 py-1">
                <option value="active">active</option>
                <option value="inactive">inactive</option>
                <option value="closed">closed</option>
              </select>
            </td>
            <td class="px-4 py-3">
              <button @click="removeUnit(unit.globalid)" class="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-500">Delete</button>
            </td>
          </tr>
          <tr v-if="units.length === 0">
            <td colspan="5" class="px-4 py-8 text-center text-slate-500">No units found. Add a new unit to begin.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { addUnit, db, deleteUnitAndChildren, Unit } from '../db';

const units = ref<Unit[]>([]);

const loadUnits = async () => {
  units.value = await db.units.toArray();
};

const createUnit = async () => {
  await addUnit();
  await loadUnits();
};

const saveUnit = async (unit: Unit) => {
  await db.units.put(unit);
};

const removeUnit = async (globalid: string) => {
  if (!confirm('Delete this unit and all associated plots and trees?')) {
    return;
  }
  await deleteUnitAndChildren(globalid);
  await loadUnits();
};

onMounted(loadUnits);
</script>

<style scoped>
input,
select {
  min-width: 120px;
}
</style>
