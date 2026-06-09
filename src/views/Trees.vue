// TODO: Add a maximum time setting for the wakelock to prevent accidental battery drain
// TODO: Add n-trees to header
// TODO: Add local edit time tracking so the database import routine can handle device-device merges cleanly

<template>
  <div id="app-inner" :class="{ 'dark-mode': store.isDarkMode.value }">
    <div v-if="isLocked" class="lock-overlay" @touchmove.prevent>
      <div class="lock-content">
        <!-- <p>Screen Locked</p> -->
        <!-- Swipe/Slide to Unlock gesture -->
        <div 
          class="swipe-area" 
          @touchstart="onTouchStart" 
          @touchmove="onTouchMove" 
          @touchend="onTouchEnd"
        >
          <div class="swipe-track">
            <div class="swipe-thumb" :style="{ transform: `translateX(${swipeX}px)` }">
              →
            </div>
            <span>Swipe to unlock</span>
          </div>
        </div>
      </div>
    </div>
    <header class="p-2 border-b-2 flex justify-between items-center" :style="{ borderColor: 'var(--border-color)', backgroundColor: 'var(--header-bg)' }">
      <div @click="backToPlots" class="m-0 p-0">&#9664</div>
      <div>
        <!-- <h1 class="text-xs uppercase opacity-70 font-bold">Forest Inventory</h1> -->
        <div class="font-mono text-sm font-black">
          <div>PLOT: {{ store.selectedPlot.value?.plotid }}</div>
          <!-- <span class="opacity-40">|</span> -->
          <div class="flex gap-3">
            <span>VISIT: {{ store.selectedVisit.value?.visit_number }}</span>
            <span class="opacity-60 font-normal text-sm">
              ({{ new Date(store.selectedVisit.value?.measurement_date || 0).toLocaleDateString() }})
            </span>
          </div>
        </div>
      </div>
      <div class="relative">
        <button v-if="store.isMobile.value && !isLocked" @click="requestWakeLock" class="mr-2 text-xl">
          <span class="menu-icon">🔒</span>
        </button>
        <button @click="store.toggleDarkMode()" class="mr-4 text-xl">
          <span class="menu-icon">{{ store.isDarkMode.value ? '☀️' : '🌙' }}</span>
        </button>
        <button @click.stop="toggleMenu" class="p-1 rounded text-xl font-bold min-w-7" :style="{ color: 'var(--text-primary)' }">
          ⁝
        </button>

        <div v-if="isMenuOpen" class="kebab-menu" @click.stop>
          <button @click="backToPlots" class="menu-item">
            <span class="menu-icon">←</span>
            <span>Back to plots</span>
          </button>
          <button @click="toggleFullscreen" class="menu-item">
            <span class="menu-icon">⛶</span>
            <span>{{ isFullscreen ? 'Exit fullscreen' : 'Fullscreen' }}</span>
          </button>
          <button @click="store.toggleDarkMode()" class="menu-item">
            <span class="menu-icon">{{ store.isDarkMode.value ? '☀️' : '🌙' }}</span>
            <span>{{ store.isDarkMode.value ? 'Light mode' : 'Dark mode' }}</span>
          </button>
        </div>
      </div>
    </header>

    <div class="table-container" ref="tableBox">
      <table>
        <thead>
          <tr>
            <!-- <th v-for="col in columns" :key="col.key">{{ col.label }}</th> -->
            <template v-for="col in columns" :key="col.key">
              <th v-if="col.visible"
                
                :class="{ 'freeze-col': col.freeze }"
                :style="col.freeze ? { left: frozenLeftOffsets[col.key] } : {}">
                {{ col.label }}
              </th>
            </template>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rIdx) in rows" :key="rIdx">
            <template v-for="(col, cIdx) in columns" :key="col.key">
              <td v-if="col.visible"
                :key="col.key"
                :class="{
                  'min-w-[17rem]': col.key === 'remarks'
                  , '!min-w-10': col.type === 'select'
                  , 'active-cell': activeRow === rIdx && activeCol === cIdx
                  , 'prior-val': row.isPrior
                  , 'freeze-col': col.freeze 
                  , '!p-0': !store.isMobile.value && col.type === 'select' && activeRow === rIdx && activeCol === cIdx && !row.isPrior
                  }"
                :style="[
                  row.isPrior ? { backgroundColor: 'var(--btn-bg)' } : {},
                  col.freeze ? { left: frozenLeftOffsets[col.key] } : {}
                ]"
                @click="setActive(rIdx, cIdx)">
                <template v-if="!store.isMobile.value && col.type === 'select' && activeRow === rIdx && activeCol === cIdx && !row.isPrior">
                  <select
                    ref="activeSelectRef"
                    v-focus
                    v-model="row[col.key]"
                    @change="saveRow(row)"
                    class="bg-transparent border-0 outline-none text-inherit font-inherit cursor-pointer select-dropdown w-full h-full"
                  >
                    <option value=""></option>
                    <option v-for="opt in col.options" :key="opt" :value="opt">{{ opt }}</option>
                  </select>
                </template>
                <template v-else>
                  <span :style="row.isPrior ? { opacity: 0.65 } : {}">
                    {{ row[col.key] }}
                  </span>
                </template>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Navigation bar -->
    <div class="p-2 flex justify-between items-center border-b-2" :style="{ borderColor: 'var(--border-color)', backgroundColor: 'var(--keypad-bg)' }">
      <div class="flex gap-2">
        <button @click="addRow" class="nav-btn !text-green-600">＋</button>
        <button @click="removeRow" class="nav-btn !text-red-600">－</button>
      </div>
      <div v-if="store.isMobile.value" class="grid grid-cols-4 gap-0">
        <button @click="move('up')" class="nav-btn !border-0 !text-4xl" :style="{backgroundColor: 'var(--keypad-bg)'}">⬆️</button>
        <button @click="move('down')" class="nav-btn !border-0 !text-4xl":style="{backgroundColor: 'var(--keypad-bg)'}">⬇️</button>
        <button @click="move('left')" class="nav-btn !border-0 !text-4xl" :style="{backgroundColor: 'var(--keypad-bg)'}">⬅️</button>
        <button @click="move('right')" class="nav-btn !border-0 !text-4xl" :style="{backgroundColor: 'var(--keypad-bg)'}">➡️</button>
      </div>
    </div>

    <!-- Entry Pad -->
    <div v-if="store.isMobile.value" class="p-2 h-[33dvh]" :style="{ backgroundColor: 'var(--keypad-bg)' }">
      <div v-if="activeColConfig?.type === 'number'" class="grid grid-cols-4 gap-2 h-full">
        <button v-for="n in [7, 8, 9]" :key="n" @click="pressKey(n)" class="keypad-btn">{{ n }}</button>
        <button @click="pressKey('back')" class="keypad-btn !bg-orange-500 !text-white">⌫</button>

        <button v-for="n in [4, 5, 6]" :key="n" @click="pressKey(n)" class="keypad-btn">{{ n }}</button>
        <button @click="move('right')" class="keypad-btn row-span-2 !bg-blue-600 !text-white">ENT</button>

        <button v-for="n in [1, 2, 3]" :key="n" @click="pressKey(n)" class="keypad-btn">{{ n }}</button>

        <button @click="pressKey(0)" class="keypad-btn col-span-2">0</button>
        <button @click="pressKey('.')" class="keypad-btn">.</button>
        <button @click="undoEdit" class="keypad-btn !bg-gray-500 !text-white text-sm">UNDO</button>
      </div>

      <div v-else-if="activeColConfig?.type === 'select'" class="grid grid-cols-3 gap-3 overflow-y-auto h-full p-1">
        <button
          v-for="opt in activeColConfig.options"
          :key="opt"
          @click="setVal(opt)"
          class="chip"
          :class="{ 'active-chip': rows[activeRow][activeColConfig.key] === opt }">
          {{ opt }}
        </button>
      </div>
      <div v-else-if="activeColConfig?.type === 'string'" class="flex flex-col gap-2 h-full p-1">
        <input
          type="text"
          v-model="rows[activeRow][activeColConfig.key]"
          @change="saveRow(rows[activeRow])"
          @keyup.enter="move('right')"
          class="w-full flex-1 p-3 border border-gray-300 rounded text-lg text-black bg-white"
          placeholder="Enter text..."
        />
        <button @click="move('right')" class="keypad-btn !bg-blue-600 !text-white min-h-[3.5rem]">
          ENT
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUnmounted, ref } from 'vue';
import { useAppStore } from '../stores/appStore';
import { db, ITree, ITreeMeasurement } from '../db';

const vFocus = {
  mounted: (el: HTMLElement) => {
    el.focus();
  }
};

const activeSelectRef = ref<HTMLSelectElement | null>(null);

type Column = {
  label: string;
  key: RowKey;
  type: 'string' | 'number' | 'select';
  visible: boolean;
  freeze?: boolean;
  options?: string[];
};

type RowKey =
  | 'visit_guid'
  | 'plot_guid'
  | 'tree_guid'
  | 'measurement_guid'
  | 'visit_number'
  | 'tree_num'
  | 'az'
  | 'hd'
  | 'sp'
  | 'dbh'
  | 'gp'
  | 'gt'
  | 's'
  | 'fc'
  | 'ht'
  | 'upstd'
  | 'upstht'
  | 'cr'
  | 'cc'
  | 'd1'
  | 's1'
  | 'd2'
  | 's2'
  | 'd3'
  | 's3'
  | 'def1'
  | 'def2'
  | 'def3'
  | 'c'
  | 'age'
  | 'bt'
  | 'fiveyr'
  | 'tenyr'
  | 'ref'
  | 'sd'
  | 'remarks';

interface Row extends Record<RowKey, any> {
  isPrior: boolean;
  isNew: boolean;
}

const store = useAppStore();
const isFullscreen = ref(false);
const activeRow = ref(0);
const activeCol = ref(2); // Start at Tree Num or Species
const isMenuOpen = ref(false);
const tableBox = ref<HTMLDivElement | null>(null);
const lastCellValue = ref<any>(null);
const lastCellRef = ref<{ r: number, c: number } | null>(null);
const cellNeedsOverwrite = ref(false);

const spOptions = ref<string[]>([]);
const stOptions = ref<string[]>([]);
const ccOptions = ref<string[]>([]);
const cOptions = ref<string[]>([]);

const frozenLeftOffsets = ref<Record<string, string>>({});
const currentLeft = ref(0);
let resizeObserver: ResizeObserver | null = null;

const updateFrozenOffsets = () => {
  if (!tableBox.value) return;
  const ths = tableBox.value.querySelectorAll('thead th');
  if (!ths.length) return;
  
  currentLeft.value = 0;
  let visibleColIdx = 0;
  
  columns.value.forEach((col) => {
    if (!col.visible) return;
    if (col.freeze) {
      frozenLeftOffsets.value[col.key] = `${currentLeft.value}px`;
      const th = ths[visibleColIdx] as HTMLElement;
      currentLeft.value += th.offsetWidth || 0;
    }
    visibleColIdx++;
  });
};

const columns = computed<Column[]>((): Column[] => [
  // { label: 'MSMT ID', key: 'measurement_guid', type: 'string', visible: false , freeze: false },
  // { label: 'Plot ID', key: 'plot_guid', type: 'string', visible: false, freeze: false},
  { label: 'TR', key: 'tree_num', type: 'number', visible: true, freeze: false},
  { label: 'V', key: 'visit_number', type: 'number', visible: true, freeze: false},
  { label: 'AZ', key: 'az', type: 'number', visible: true, freeze: true},
  { label: 'HD', key: 'hd', type: 'number', visible: true, freeze: false},
  { label: 'SP', key: 'sp', type: 'select', options: spOptions.value, visible: true, freeze: true},
  { label: 'GP', key: 'gp', type: 'select', visible: true, options: ['..','SN','DD']},
  { label: 'DBH', key: 'dbh', type: 'number', visible: true, freeze: true },
  { label: 'GT', key: 'gt', type: 'number', visible: true },
  { label: 'ST', key: 's', type: 'select', options: stOptions.value, visible: true },
  { label: 'FC', key: 'fc', type: 'number', visible: true },
  { label: 'HT', key: 'ht', type: 'number', visible: true },
  { label: 'BD', key: 'upstd', type: 'number', visible: true },
  { label: 'BHT', key: 'upstht', type: 'number', visible: true },
  { label: 'CR', key: 'cr', type: 'number', visible: true },
  { label: 'CC', key: 'cc', type: 'select', visible: true, options: ccOptions.value },
  { label: 'D1', key: 'd1', type: 'number', visible: true },
  { label: 'S1', key: 's1', type: 'number', visible: true },
  { label: 'D2', key: 'd2', type: 'number', visible: true },
  { label: 'S2', key: 's2', type: 'number', visible: true },
  { label: 'D3', key: 'd3', type: 'number', visible: true },
  { label: 'S3', key: 's3', type: 'number', visible: true },
  { label: 'Def1', key: 'def1', type: 'number', visible: true },
  { label: 'Def2', key: 'def2', type: 'number', visible: true },
  { label: 'Def3', key: 'def3', type: 'number', visible: true },
  { label: 'CND', key: 'c', type: 'select', options: cOptions.value, visible: true },
  { label: 'Age', key: 'age', type: 'number', visible: true },
  { label: 'BT', key: 'bt', type: 'number', visible: true },
  { label: '5yr', key: 'fiveyr', type: 'number', visible: true },
  { label: '10yr', key: 'tenyr', type: 'number', visible: true },
  { label: 'Ref', key: 'ref', type: 'number', visible: true },
  { label: 'SD', key: 'sd', type: 'number', visible: true },
  { label: 'Remarks', key: 'remarks', type: 'string', visible: true },
]);

const rows = ref<Row[]>([]);

const treeAndMeasToRow = (tree: ITree, meas: ITreeMeasurement | undefined, visitNum: number, isPrior: boolean, isNew: boolean): Row => ({
  visit_guid: meas?.visit_guid,
  plot_guid: tree.plot_guid,
  tree_guid: tree.guid,
  measurement_guid: meas?.guid || crypto.randomUUID(),
  visit_number: visitNum,
  tree_num: tree.tree_num,
  az: tree.az || 0,
  hd: tree.hd || 0,
  sp: tree.sp,
  gp: meas?.gp || '',
  gt: meas?.gt || '',
  dbh: meas?.dbh || '',
  s: meas?.s || '',
  upstd: meas?.upstd || '',
  upstht: meas?.upstht || '',
  cr: meas?.cr || '',
  cc: meas?.cc || '',
  ht: meas?.ht || '',
  fc: meas?.fc || '',
  d1: meas?.d1 || '',
  s1: meas?.s1 || '',
  d2: meas?.d2 || '',
  s2: meas?.s2 || '',
  d3: meas?.d3 || '',
  s3: meas?.s3 || '',
  def1: meas?.def1 || '',
  def2: meas?.def2 || '',
  def3: meas?.def3 || '',
  c: meas?.c || '',
  age: meas?.age || '',
  bt: meas?.bt || '',
  fiveyr: meas?.fiveyr || '',
  tenyr: meas?.tenyr || '',
  ref: tree?.ref || '',
  sd: tree?.sd || '',
  remarks: meas?.remarks || '',
  isPrior,
  isNew
});

const captureSnapshot = () => {
  if (rows.value.length === 0) return;
  lastCellRef.value = { r: activeRow.value, c: activeCol.value };
  const colKey = columns.value[activeCol.value].key;
  lastCellValue.value = rows.value[activeRow.value][colKey];
};

// Log edits to static tree attribute
const commitEditCheck = async () => {
  if (!lastCellRef.value || rows.value.length === 0) return true;
  
  const { r, c } = lastCellRef.value;
  const row = rows.value[r];
  if (!row || row.isPrior) return true;

  const col = columns.value[c];
  const colKey = col.key;
  const currentVal = row[colKey];
  const oldVal = lastCellValue.value;

  // Define which attributes are considered "static" tree attributes
  const staticFields = ['tree_num', 'az', 'hd', 'sp'];
  
  if (!row.isNew && staticFields.includes(colKey) && String(currentVal) !== String(oldVal)) {
    const reason = prompt(`Reason for changing static attribute "${col.label}" from "${oldVal}" to "${currentVal}"?`);
    
    if (reason === null || reason.trim() === '') {
      // Discard/Revert
      row[colKey] = oldVal;
      await saveRow(row);
      return false; 
    } else {
      // Log Edit
      await db.edits.add({
        guid: crypto.randomUUID(),
        table_name: 'tree',
        record_guid: row.tree_guid,
        field_name: colKey,
        old_value: String(oldVal),
        new_value: String(currentVal),
        reason: reason,
        edit_date: Date.now()
      });
    }
  }
  return true;
};

// Load tree records from database
const loadRows = async () => {
  if (!store.selectedPlot.value || !store.selectedVisit.value) return;

  const plotGUID = store.selectedPlot.value.guid;
  const currentVisit = store.selectedVisit.value;

  // Find prior visit as most recent prior to current visit
  const priorVisit = await db.plotVisits
    .where('plot_guid')
    .equals(plotGUID)
    .filter(v => v.measurement_date < currentVisit.measurement_date)
    .reverse()
    .sortBy('measurement_date')
    .then(list => list[0]);

  const [trees, currentMeas, priorMeas] = await Promise.all([
    db.plotTrees.where('plot_guid').equals(plotGUID).sortBy('az'),
    db.treeMeasurements.where('visit_guid').equals(currentVisit.guid).toArray(),
    priorVisit ? db.treeMeasurements.where('visit_guid').equals(priorVisit.guid).toArray() : Promise.resolve([])
  ]);

  // Rows to display include prior measurements interleaved with current measurements or empty rows
  const allRows: Row[] = [];
  trees.forEach(tree => {
    const pm = priorVisit ? priorMeas.find(m => m.tree_guid === tree.guid) : undefined;
    if (priorVisit && pm) {
      allRows.push(treeAndMeasToRow(tree, pm, priorVisit.visit_number, true, false));
    }
    const cm = currentMeas.find(m => m.tree_guid === tree.guid);
    allRows.push(treeAndMeasToRow(tree, cm, currentVisit.visit_number, false, !pm));
  });

  rows.value = allRows;
  
  // Set initial active row to first editable row
  activeRow.value = allRows.findIndex(r => !r.isPrior);
  if (activeRow.value === -1) activeRow.value = 0;

  // If no records exist, add some default rows
  if (rows.value.length === 0) {
    await addRow();
  }
  captureSnapshot();
  cellNeedsOverwrite.value = true;
};

// Save a row to database
const saveRow = async (row: Row) => {
  if (row.isPrior) return;

  const tree: ITree = {
    guid: row.tree_guid,
    plot_guid: row.plot_guid,
    tree_num: Number(row.tree_num),
    az: Number(row.az),
    hd: Number(row.hd),
    sp: row.sp,
    ref: row.ref,
    sd: Number(row.sd),
    remarks: row.remarks
  };

  const measurement: ITreeMeasurement = {
    guid: row.measurement_guid,
    tree_guid: row.tree_guid,
    visit_guid: store.selectedVisit.value!.guid,
    dbh: Number(row.dbh),
    gp: row.gp,
    gt: Number(row.gt),
    s: row.s,
    fc: Number(row.fc),
    ht: Number(row.ht),
    upstd: Number(row.upstd),
    upstht: Number(row.upstht),
    cr: Number(row.cr),
    cc: row.cc,
    d1: Number(row.d1),
    s1: Number(row.s1),
    d2: Number(row.d2),
    s2: Number(row.s2),
    d3: Number(row.d3),
    s3: Number(row.s3),
    def1: Number(row.def1),
    def2: Number(row.def2),
    def3: Number(row.def3),
    c: row.c,
    age: Number(row.age),
    bt: Number(row.bt),
    fiveyr: Number(row.fiveyr),
    tenyr: Number(row.tenyr),
    remarks: row.remarks
  };

  await Promise.all([
    db.plotTrees.put(tree),
    db.treeMeasurements.put(measurement)
  ]);
};

// Delete a row from database
// TODO: Ensure deleting trees is not allowed for incomplete visits
const deleteRow = async (row: Row) => {
  if (row.tree_guid) {
    await Promise.all([
      db.plotTrees.delete(row.tree_guid),
      db.treeMeasurements.where('tree_globalid').equals(row.tree_guid).delete()
    ]);
  }
};

const activeColConfig = computed(() => columns.value[activeCol.value]);

const scrollActiveIntoView = async () => {
  await Promise.resolve();
  const wrapper = tableBox.value;
  const activeCell = wrapper?.querySelector('.active-cell');
  if (!wrapper || !activeCell) return;

  const table = activeCell.closest('table');
  const header = table?.querySelector('thead');
  const headerHeight = header?.offsetHeight || 0;

  const wrapperRect = wrapper.getBoundingClientRect();
  const cellRect = activeCell.getBoundingClientRect();
  const cellTop = cellRect.top - wrapperRect.top + wrapper.scrollTop;
  const cellBottom = cellTop + cellRect.height;
  const cellLeft = cellRect.left - wrapperRect.left + wrapper.scrollLeft;
  const cellRight = cellLeft + cellRect.width;
  const visibleTop = wrapper.scrollTop + headerHeight;
  const visibleBottom = wrapper.scrollTop + wrapper.clientHeight;
  const visibleLeft = wrapper.scrollLeft + currentLeft.value;
  const visibleRight = wrapper.scrollLeft + wrapper.clientWidth;

  if (cellTop < visibleTop) {
    wrapper.scrollTop = Math.max(cellTop - headerHeight, 0);
  } else if (cellBottom > visibleBottom) {
    wrapper.scrollTop = Math.min(cellBottom - wrapper.clientHeight, wrapper.scrollHeight - wrapper.clientHeight);
  }
  
  if (!activeColConfig.value.freeze) {
    if (cellLeft < visibleLeft) {
      wrapper.scrollLeft = Math.max(cellLeft - currentLeft.value, 0);
    } else if (cellRight > visibleRight) {
      wrapper.scrollLeft = Math.min(cellRight - wrapper.clientWidth, wrapper.scrollWidth - wrapper.clientWidth);
    }
  }
};

const setActive = async (r: number, c: number) => {
  if (rows.value[r].isPrior) return;
  await commitEditCheck();
  activeRow.value = r;
  activeCol.value = c;
  captureSnapshot();
  cellNeedsOverwrite.value = true;
  scrollActiveIntoView();
};

const move = async (dir: 'up' | 'down' | 'left' | 'right') => {
  await commitEditCheck();

  let r = activeRow.value;
  let c = activeCol.value;

  if (dir === 'up') {
    do { r--; } while (r >= 0 && rows.value[r].isPrior);
    if (r >= 0) activeRow.value = r;
  }
  if (dir === 'down') {
    do { r++; } while (r < rows.value.length && rows.value[r].isPrior);
    if (r < rows.value.length) activeRow.value = r;
  }
  if (dir === 'left') {
    const visibleIndices = columns.value.map((col, i) => col.visible ? i : -1).filter(i => i !== -1);
    const currentIdx = visibleIndices.indexOf(c);
    if (currentIdx > 0) activeCol.value = visibleIndices[currentIdx - 1];
  }
  if (dir === 'right') {
    const visibleIndices = columns.value.map((col, i) => col.visible ? i : -1).filter(i => i !== -1);
    const currentIdx = visibleIndices.indexOf(c);
    if (currentIdx < visibleIndices.length - 1) activeCol.value = visibleIndices[currentIdx + 1];
  }
  captureSnapshot();
  cellNeedsOverwrite.value = true;
  scrollActiveIntoView();
};

const pressKey = (key: number | 'back' | '.') => {
  const row = rows.value[activeRow.value];
  const colKey = activeColConfig.value.key;
  const current = String(row[colKey] ?? '');

  // lastCellValue.value = current;
  console.log(lastCellValue.value);


  if (key === 'back') {
    if (cellNeedsOverwrite.value) {
      row[colKey] = '';
      cellNeedsOverwrite.value = false;
    } else {
      row[colKey] = current.slice(0, -1);
    }
  } else {
    if (cellNeedsOverwrite.value) {
      row[colKey] = String(key);
      cellNeedsOverwrite.value = false;
    } else {
      if (key === '.' && current.includes('.')) return;
      row[colKey] = current + String(key);
    }
  }

  // Save the updated row to database
  saveRow(row);
};

const undoEdit = () => {
  if (rows.value.length === 0) return;
  const row = rows.value[activeRow.value];
  const colKey = activeColConfig.value.key;
  
  row[colKey] = lastCellValue.value;
  cellNeedsOverwrite.value = true;
  // Save the updated row to database
  saveRow(row);
};

const setVal = (val: string) => {
  rows.value[activeRow.value][activeColConfig.value.key] = val;
  // Save the updated row to database
  saveRow(rows.value[activeRow.value]);
  move('right');
};

const addRow = async () => {
  if (!store.selectedPlot.value) return;
  
  const nextTreeNum = rows.value.length > 0 
    ? Math.max(...rows.value.map(r => Number(r.tree_num))) + 1 
    : 1;

  const newTree: ITree = {
    guid: crypto.randomUUID(),
    plot_guid: store.selectedPlot.value.guid,
    tree_num: nextTreeNum,
    sp: '',
    az: 0,
    hd: 0
  };

  const newRow = treeAndMeasToRow(
    newTree, 
    undefined, 
    store.selectedVisit.value?.visit_number || 1, 
    false,
    true
  );

  rows.value.push(newRow);
  activeRow.value = rows.value.length - 1;
  activeCol.value = 3; // Focus Tr
  captureSnapshot();
  cellNeedsOverwrite.value = true;
  scrollActiveIntoView();
  
  saveRow(newRow);
};

// TODO: Use visit status not complete to ensure allowed deletion rather than row status
const removeRow = async () => {
  if (rows.value.length > 1) {
    const rowToDelete = rows.value[activeRow.value];

    if (!rowToDelete.isNew) {
      alert("Only new tree records can be deleted. Records from prior visits cannot be removed.");
      return;
    }

    const rowIndex = activeRow.value + 1;
    const message = `Delete row ${rowIndex}? This cannot be undone.`;
    if (!confirm(message)) return;
    rows.value.splice(activeRow.value, 1);

    if (activeRow.value >= rows.value.length) {
      activeRow.value = rows.value.length - 1;
    }

    // Delete the row from database
    await deleteRow(rowToDelete);
  }
};

const updateFullscreenState = () => {
  isFullscreen.value = !!document.fullscreenElement;
};

const toggleMenu = () => {
  isMenuOpen.value = !isMenuOpen.value;
};

const closeMenu = () => {
  isMenuOpen.value = false;
};

const toggleFullscreen = async () => {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await document.documentElement.requestFullscreen();
  }
};

const backToPlots = () => {
  closeMenu();
  store.goToPlots();
};

const handleGlobalKeydown = async (event: KeyboardEvent) => {
  if (store.isMobile.value) return;

  const target = event.target as HTMLElement;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    await move('up');
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    await move('down');
    return;
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    await move('left');
    return;
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    await move('right');
    return;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    if (event.shiftKey) {
      await move('left');
    } else {
      await move('right');
    }
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    await move('right');
    return;
  }

  if (event.key === ' ' || event.code === 'Space') {
    if (colConfig && colConfig.type === 'select') {
      event.preventDefault();
      if (activeSelectRef.value && typeof activeSelectRef.value.showPicker === 'function') {
        try {
          activeSelectRef.value.showPicker();
        } catch (err) {
          console.error('Failed to show select picker:', err);
        }
      }
      return;
    }
  }

  if (rows.value.length === 0) return;
  const row = rows.value[activeRow.value];
  if (!row || row.isPrior) return;

  const colConfig = activeColConfig.value;
  if (!colConfig) return;
  const colKey = colConfig.key;

  if (event.key === 'Backspace') {
    event.preventDefault();
    const current = String(row[colKey] ?? '');
    if (cellNeedsOverwrite.value) {
      row[colKey] = '';
      cellNeedsOverwrite.value = false;
    } else {
      row[colKey] = current.slice(0, -1);
    }
    await saveRow(row);
    return;
  }

  if (event.key === 'Delete') {
    event.preventDefault();
    row[colKey] = '';
    cellNeedsOverwrite.value = true;
    await saveRow(row);
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    undoEdit();
    return;
  }

  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (colConfig.type === 'number') {
      if (/[\d\.]/.test(event.key)) {
        event.preventDefault();
        const current = String(row[colKey] ?? '');
        if (cellNeedsOverwrite.value) {
          row[colKey] = event.key;
          cellNeedsOverwrite.value = false;
        } else {
          if (event.key === '.' && current.includes('.')) return;
          row[colKey] = current + event.key;
        }
        await saveRow(row);
      }
    } else if (colConfig.type === 'select') {
      event.preventDefault();
      const options = colConfig.options || [];
      const current = String(row[colKey] ?? '');
      const typed = event.key;
      const candidate = (cellNeedsOverwrite.value ? typed : current + typed).toLowerCase();
      
      const exactMatch = options.find(opt => String(opt).toLowerCase() === candidate);
      if (exactMatch !== undefined) {
        row[colKey] = exactMatch;
        cellNeedsOverwrite.value = false;
        await saveRow(row);
        await move('right');
        return;
      }
      
      const prefixMatches = options.filter(opt => String(opt).toLowerCase().startsWith(candidate));
      if (prefixMatches.length === 1) {
        row[colKey] = prefixMatches[0];
        cellNeedsOverwrite.value = false;
        await saveRow(row);
        await move('right');
        return;
      } else if (prefixMatches.length > 1) {
        row[colKey] = cellNeedsOverwrite.value ? typed.toUpperCase() : current + typed.toUpperCase();
        cellNeedsOverwrite.value = false;
        await saveRow(row);
      }
    } else if (colConfig.type === 'string') {
      event.preventDefault();
      const current = String(row[colKey] ?? '');
      if (cellNeedsOverwrite.value) {
        row[colKey] = event.key;
        cellNeedsOverwrite.value = false;
      } else {
        row[colKey] = current + event.key;
      }
      await saveRow(row);
    }
  }
};

onMounted(async () => {
  if ('virtualKeyboard' in navigator) {
    (navigator as any).virtualKeyboard.overlaysContent = true;
  }

  updateFullscreenState();
  document.addEventListener('fullscreenchange', updateFullscreenState);
  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', handleGlobalKeydown);

  if (tableBox.value) {
    resizeObserver = new ResizeObserver(() => {
      updateFrozenOffsets();
    });
    resizeObserver.observe(tableBox.value);
    const table = tableBox.value.querySelector('table');
    if (table) resizeObserver.observe(table);
  }

  // Load lookups
  const loadLookup = async (feature: string) => (await db.lookups.where('feature').equals(feature).sortBy('code')).map(item => item.code);
  spOptions.value = await loadLookup('sp');
  stOptions.value = await loadLookup('s');
  ccOptions.value = await loadLookup('cc');
  cOptions.value = await loadLookup('c');

  await loadRows();
});

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', updateFullscreenState);
  document.removeEventListener('click', closeMenu);
  document.removeEventListener('keydown', handleGlobalKeydown);
  if (resizeObserver) resizeObserver.disconnect();
});

// Screen Lock
const isLocked = ref(false)
let wakeLock: WakeLockSentinel | null = null

// Swipe variables
const startX = ref(0)
const currentX = ref(0)
const swipeX = ref(0)
const threshold = 150 // Minimum swipe distance in px

// Request Wake Lock
const requestWakeLock = async () => {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen')
      swipeX.value = 0
      isLocked.value = true
    } catch (err) {
      console.error('Wake lock failed:', err)
    }
  }
}

// Release Wake Lock
const releaseWakeLock = async () => {
  if (wakeLock) {
    await wakeLock.release()
    wakeLock = null
  }
}

// Swipe Handlers
const onTouchStart = (e: TouchEvent) => {
  startX.value = e.touches[0].clientX
  currentX.value = startX.value
}

const onTouchMove = (e: TouchEvent) => {
  currentX.value = e.touches[0].clientX
  const deltaX = currentX.value - startX.value
  
  // Constrain swipe within track (0 to 200px)
  if (deltaX > 0) {
    swipeX.value = Math.min(deltaX, 200)
  }
}

const onTouchEnd = () => {
  if (swipeX.value >= threshold) {
    unlockScreen()
    swipeX.value = 0
  } else {
    // Snap back if released too early
    swipeX.value = 0
  }
}

const unlockScreen = async () => {
  isLocked.value = false
  await releaseWakeLock()
}

// onMounted(async () => {
//   await requestWakeLock()
//   // Re-acquire wake lock if tab becomes visible again
//   document.addEventListener('visibilitychange', async () => {
//     if (isLocked.value && document.visibilityState === 'visible') {
//       await requestWakeLock()
//     }
//   })
// })

onUnmounted(async () => {
  await releaseWakeLock()
})

</script>

<style>
#app-inner {
  background-color: var(--bg-primary);
  color: var(--text-primary);
  font-family: system-ui, -apple-system, sans-serif;
  margin: 0;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  touch-action: manipulation;
}

.table-container {
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
  overflow-y: auto;
  overflow-x: auto;
  border-bottom: 2px solid var(--border-color);
}

table {
  border-collapse: separate;
  border-spacing: 0;
  font-size: 13px;
  border-top: 1px solid var(--border-color);
  border-left: 1px solid var(--border-color);
}

th {
  position: sticky;
  top: 0;
  background: var(--btn-bg);
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-color);
  border-right: 1px solid var(--border-color);
  padding: 8px 6px;
  font-weight: 800;
  z-index: 10;
}

td {
  border-bottom: 1px solid var(--border-color);
  border-right: 1px solid var(--border-color);
  padding: 6px 4px;
  text-align: center;
  /* height: 40px; */
  background: var(--cell-bg);
  color: var(--text-primary);
}

.freeze-col {
    position: sticky;
    z-index: 1; /* Keeps the column on top of regular scrolling data */
}
th.freeze-col {
    z-index: 20; /* Keeps frozen headers above normal headers */
  }

.active-cell {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  background: var(--active-cell-bg) !important;
  z-index: 99
}

.keypad-btn {
  background: var(--btn-bg);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  /* height: 48px; */
  padding: 0px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 1.25rem;
  /* height: 2.5rem; */
  box-shadow: 0 2px 0 var(--border-color);
}

.keypad-btn:active {
  transform: translateY(2px);
  box-shadow: none;
  background: var(--accent);
  color: white;
}

.nav-btn {
  background: var(--btn-bg);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  padding: 0px;
  min-width: 44px;
  min-height: 44px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.75rem;
}

.chip {
  background: var(--btn-bg);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  padding: 10px 15px;
  font-weight: 600;
  text-align: center;
  min-height: 44px;
  max-height: 40px;
}

.active-chip {
  background: var(--accent) !important;
  color: white !important;
}

.kebab-menu {
  position: absolute;
  right: -4px;
  top: calc(100% + 0px);
  width: 180px;
  border: 1px solid var(--border-color);
  border-radius: 0px;
  background: var(--btn-bg);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
  z-index: 20;
}

.menu-item {
  width: 100%;
  border: none;
  background: transparent;
  color: inherit;
  padding: 0.75rem 1rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.95rem;
  text-align: left;
  cursor: pointer;
}

.menu-item:hover {
  background: rgba(59, 130, 246, 0.12);
}

.menu-icon {
  width: 1.25rem;
  text-align: center;
}

.lock-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0, 0, 0, 0.4);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-family: sans-serif;
}

.lock-content {
  text-align: center;
}

.swipe-area {
  margin-top: 2rem;
  width: 300px;
  height: 60px;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 30px;
  position: relative;
  overflow: hidden;
  touch-action: none; /* Disables default browser scrolling/pinching during swipe */
}

.swipe-track {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  position: relative;
}

.swipe-thumb {
  width: 50px;
  height: 50px;
  background-color: #fff;
  border-radius: 50%;
  position: absolute;
  left: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #000;
  font-weight: bold;
  cursor: pointer;
}

.select-dropdown {
  width: 100%;
  height: 100%;
  background: transparent;
  color: var(--text-primary);
  border: none;
  outline: none;
  font-family: inherit;
  font-size: inherit;
  text-align: center;
  text-align-last: center;
  /* padding: 6px 20px 6px 4px; /* Add right padding to prevent dropdown arrow from obscuring values */
  cursor: pointer;
}
.select-dropdown option {
  background-color: var(--cell-bg);
  color: var(--text-primary);
}
</style>
