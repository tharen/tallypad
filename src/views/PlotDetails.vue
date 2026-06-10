<template>
  <div id="app-inner" :class="{ 'dark-mode': store.isDarkMode.value }">
    <!-- Header -->
    <header class="p-4 border-b-2 flex justify-between items-center" :style="{ borderColor: 'var(--border-color)', backgroundColor: 'var(--header-bg)' }">
      <div @click="store.goToPreviousView()" class="m-0 p-0 cursor-pointer text-xl" title="Back">◀</div>
      <div class="flex flex-col items-center">
        <h1 class="text-xs uppercase opacity-70 font-bold">Plot Detail</h1>
        <div class="font-mono text-base font-black">PLOT: {{ plot?.plotid }}</div>
      </div>
      <div class="w-6"></div> <!-- Spacer -->
    </header>

    <!-- Plot Info Summary -->
    <div class="p-6 bg-[var(--cell-bg)] border-b-2 space-y-4" :style="{ borderColor: 'var(--border-color)' }">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <span class="opacity-60 block text-xs uppercase font-bold tracking-wider">Established Date</span>
          <span class="font-mono">{{ plot?.established ? new Date(plot.established).toLocaleDateString() : 'N/A' }}</span>
        </div>
        <div>
          <span class="opacity-60 block text-xs uppercase font-bold tracking-wider">Planned Coordinate</span>
          <span class="font-mono">{{ plot?.planned_latitude ?? 'N/A' }}, {{ plot?.planned_longitude ?? 'N/A' }}</span>
        </div>
      </div>
      <div>
        <span class="opacity-60 block text-xs uppercase font-bold tracking-wider">Remarks</span>
        <span class="italic block">{{ plot?.remarks || 'No remarks available.' }}</span>
      </div>
    </div>

    <!-- Visits Section -->
    <div class="flex-1 p-6 space-y-4 overflow-y-auto">
      <div class="flex justify-between items-center">
        <h2 class="text-lg font-bold">Visits List</h2>
        <button v-show="store.allowAddVisits.value" @click="addVisit" class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded font-bold transition-colors cursor-pointer text-sm">
          ＋ Add Visit
        </button>
      </div>

      <div class="border border-[var(--border-color)] rounded-lg overflow-hidden bg-[var(--cell-bg)]">
        <div class="overflow-x-auto w-full">
          <table class="w-full border-collapse text-sm text-left">
            <thead>
              <tr class="bg-[var(--btn-bg)] border-b border-[var(--border-color)]">
                <th class="p-3 text-center w-24">Visit #</th>
                <th class="p-3 text-center">Measurement Date</th>
                <th class="p-3 text-center">Status</th>
                <th class="p-3">Crew</th>
                <th class="p-3">Remarks</th>
                <th class="p-3 text-center w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="visits.length === 0">
                <td colspan="6" class="p-6 text-center opacity-60 italic">No visits recorded for this plot.</td>
              </tr>
              <tr v-for="visit in visits" :key="visit.guid" class="border-b border-[var(--border-color)] hover:bg-[var(--btn-bg)]/20">
                <td class="p-3 text-center">
                  <input
                    type="number"
                    v-model.number="visit.visit_number"
                    @change="saveVisit(visit)"
                    class="w-full bg-transparent border-b border-transparent focus:border-[var(--accent)] outline-none text-center font-semibold"
                  />
                </td>
                <td class="p-3 text-center">
                  <input
                    type="date"
                    :value="formatDateForInput(visit.measurement_date)"
                    @change="updateMeasurementDate(visit, $event)"
                    class="bg-transparent border-b border-transparent focus:border-[var(--accent)] outline-none text-center font-mono"
                  />
                </td>
                <td class="p-3 text-center">
                  <select
                    v-model="visit.status"
                    @change="saveVisit(visit)"
                    class="bg-transparent border-b border-transparent focus:border-[var(--accent)] outline-none text-center font-semibold text-[var(--text-primary)] cursor-pointer"
                  >
                    <option value="Planned">Planned</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Dropped">Dropped</option>
                    <option value="Completed">Completed</option>
                  </select>
                </td>
                <td class="p-3">
                  <input
                    type="text"
                    v-model="visit.crew"
                    @change="saveVisit(visit)"
                    placeholder="Crew name(s)..."
                    class="w-full bg-transparent border-b border-transparent focus:border-[var(--accent)] outline-none"
                  />
                </td>
                <td class="p-3">
                  <input
                    type="text"
                    v-model="visit.remarks"
                    @change="saveVisit(visit)"
                    placeholder="Enter remarks..."
                    class="w-full bg-transparent border-b border-transparent focus:border-[var(--accent)] outline-none"
                  />
                </td>
                <td class="p-3 text-center">
                  <button
                    @click="deleteVisitRecord(visit)"
                    class="text-red-500 hover:text-red-700 font-bold transition-colors cursor-pointer text-lg p-1"
                    title="Delete Visit"
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
import { ref, onMounted, computed } from 'vue';
import { useAppStore } from '../stores/appStore';
import { db, IPlotVisit } from '../db';

const store = useAppStore();
const plot = computed(() => store.selectedPlot.value);
const visits = ref<IPlotVisit[]>([]);

const loadVisits = async () => {
  if (plot.value) {
    visits.value = await db.plotVisits
      .where('plot_guid')
      .equals(plot.value.guid)
      .sortBy('measurement_date');
  }
};

const formatDateForInput = (timestamp: number) => {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const updateMeasurementDate = (visit: IPlotVisit, event: Event) => {
  const dateStr = (event.target as HTMLInputElement).value;
  if (dateStr) {
    const parts = dateStr.split('-');
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    visit.measurement_date = d.getTime();
  } else {
    visit.measurement_date = Date.now();
  }
  saveVisit(visit);
};

const saveVisit = async (visit: IPlotVisit) => {
  const oldVisit = await db.plotVisits.get(visit.guid);
  if (oldVisit) {
    // Audit check: If it was already marked Completed, prompt for changes
    if (oldVisit.status === 'Completed') {
      const fieldsToCheck: (keyof IPlotVisit)[] = ['visit_number', 'measurement_date', 'status', 'remarks', 'crew'];
      for (const field of fieldsToCheck) {
        const oldVal = oldVisit[field];
        const newVal = visit[field];
        
        let hasChanged = false;
        let friendlyOld = String(oldVal ?? '');
        let friendlyNew = String(newVal ?? '');

        if (field === 'measurement_date') {
          const oldDateStr = formatDateForInput(oldVal as number);
          const newDateStr = formatDateForInput(newVal as number);
          if (oldDateStr !== newDateStr) {
            hasChanged = true;
            friendlyOld = new Date(oldVal as number).toLocaleDateString();
            friendlyNew = new Date(newVal as number).toLocaleDateString();
          }
        } else {
          if (String(oldVal ?? '') !== String(newVal ?? '')) {
            hasChanged = true;
          }
        }

        if (hasChanged) {
          const reason = prompt(`Reason for changing completed visit "${field}" from "${friendlyOld}" to "${friendlyNew}"?`);
          if (reason === null || reason.trim() === '') {
            // Revert changes and reload
            (visit as any)[field] = oldVal;
            await loadVisits();
            return;
          }

          // Add audit log
          await db.edits.add({
            guid: crypto.randomUUID(),
            table_name: 'visit',
            record_guid: visit.guid,
            field_name: field,
            old_value: friendlyOld,
            new_value: friendlyNew,
            reason: reason,
            edit_date: Date.now()
          });
        }
      }
    }
  }

  // Save the updated visit record
  await db.plotVisits.put(JSON.parse(JSON.stringify(visit)));
  await loadVisits();
};

const addVisit = async () => {
  if (!plot.value) return;

  const nextNumber = visits.value.length === 0 
    ? 1 
    : Math.max(...visits.value.map(v => v.visit_number)) + 1;

  const newVisit: IPlotVisit = {
    guid: crypto.randomUUID(),
    plot_guid: plot.value.guid,
    measurement_date: Date.now(),
    visit_number: nextNumber,
    status: 'Planned',
    crew: '',
    remarks: ''
  };

  await db.plotVisits.add(newVisit);
  await loadVisits();
};

const deleteVisitRecord = async (visit: IPlotVisit) => {
  const confirmed = confirm(`Are you sure you want to delete Visit V${visit.visit_number}? This will delete all tree measurements associated with this visit.`);
  if (!confirmed) return;

  await db.transaction('rw', [db.plotVisits, db.treeMeasurements], async () => {
    await db.plotVisits.delete(visit.guid);
    await db.treeMeasurements.where('visit_guid').equals(visit.guid).delete();
  });
  await loadVisits();
};

onMounted(() => {
  loadVisits();
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
input[type="number"]::-webkit-inner-spin-button,
input[type="number"]::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type="number"] {
  -moz-appearance: textfield;
}
</style>
