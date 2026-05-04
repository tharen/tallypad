<template>
  <div id="app-inner" :class="{ 'dark-mode': isDarkMode }">
    <header class="p-2 border-b-2 flex justify-between items-center" :style="{ borderColor: 'var(--border-color)', backgroundColor: 'var(--header-bg)' }">
      <div>
        <h1 class="text-xs uppercase opacity-70 font-bold">Forest Inventory</h1>
        <div class="flex gap-4 font-mono text-lg font-black">
          <span>UNIT: {{ unitName }}</span>
          <span>PLOT: {{ plotNumber }}</span>
        </div>
      </div>
      <div class="relative">
        <button @click.stop="toggleMenu" class="p-1 rounded text-xl font-bold min-w-7" :style="{ color: 'var(--text-primary)' }">
          ⁝
        </button>

        <div v-if="isMenuOpen" class="kebab-menu" @click.stop>
          <button @click="toggleFullscreen" class="menu-item">
            <span class="menu-icon">⛶</span>
            <span>{{ isFullscreen ? 'Exit fullscreen' : 'Fullscreen' }}</span>
          </button>
          <button @click="isDarkMode = !isDarkMode" class="menu-item">
            <span class="menu-icon">{{ isDarkMode ? '☀️' : '🌙' }}</span>
            <span>{{ isDarkMode ? 'Light mode' : 'Dark mode' }}</span>
          </button>
        </div>
      </div>
    </header>

    <div class="table-container" ref="tableBox">
      <table>
        <thead>
          <tr>
            <th v-for="col in columns" :key="col.key">{{ col.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rIdx) in rows" :key="rIdx">
            <td
              v-for="(col, cIdx) in columns"
              :key="col.key"
              :class="{ 'active-cell': activeRow === rIdx && activeCol === cIdx }"
              @click="setActive(rIdx, cIdx)">
              {{ row[col.key] }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="p-2 flex justify-between items-center border-b-2" :style="{ borderColor: 'var(--border-color)', backgroundColor: 'var(--keypad-bg)' }">
      <div class="flex gap-2">
        <button @click="addRow" class="nav-btn text-green-600 font-black">＋</button>
        <button @click="removeRow" class="nav-btn text-red-600 font-black">－</button>
      </div>
      <div class="grid grid-cols-4 gap-2">
        <button @click="move('left')" class="nav-btn border-0 bg-gray-200 hover:bg-gray-300">⬅️</button>
        <button @click="move('right')" class="nav-btn border-0 bg-gray-200 hover:bg-gray-300">➡️</button>
        <button @click="move('up')" class="nav-btn border-0 bg-gray-200 hover:bg-gray-300">⬆️</button>
        <button @click="move('down')" class="nav-btn border-0 bg-gray-200 hover:bg-gray-300">⬇️</button>
      </div>
    </div>

    <div class="p-2 h-[240px]" :style="{ backgroundColor: 'var(--keypad-bg)' }">
      <div v-if="activeColConfig.type === 'number'" class="grid grid-cols-4 gap-2 h-full">
        <button v-for="n in [7, 8, 9]" :key="n" @click="pressKey(n)" class="keypad-btn">{{ n }}</button>
        <button @click="pressKey('back')" class="keypad-btn !bg-orange-500 text-white">⌫</button>

        <button v-for="n in [4, 5, 6]" :key="n" @click="pressKey(n)" class="keypad-btn">{{ n }}</button>
        <button @click="move('right')" class="keypad-btn row-span-2 !bg-blue-600 text-white shadow-none">ENT</button>

        <button v-for="n in [1, 2, 3]" :key="n" @click="pressKey(n)" class="keypad-btn">{{ n }}</button>

        <button @click="pressKey(0)" class="keypad-btn col-span-2">0</button>
        <button @click="pressKey('.')" class="keypad-btn">.</button>
      </div>

      <div v-else-if="activeColConfig.type === 'select'" class="grid grid-cols-3 gap-3 overflow-y-auto h-full p-1">
        <button
          v-for="opt in activeColConfig.options"
          :key="opt"
          @click="setVal(opt)"
          class="chip"
          :class="{ 'active-chip': rows[activeRow][activeColConfig.key] === opt }">
          {{ opt }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

type Column = {
  label: string;
  key: RowKey;
  type: 'number' | 'select';
  options?: string[];
};

type RowKey =
  | 'tree_number'
  | 'plot_factor'
  | 'species'
  | 'status'
  | 'tally'
  | 'diameter'
  | 'form_point'
  | 'form_factor'
  | 'top_diameter'
  | 'bole_height'
  | 'top_height'
  | 'plot_number'
  | 'unit_name';

type Row = Record<RowKey, string>;

const unitName = ref('TIMBER-A1');
const plotNumber = ref('42');
const isDarkMode = ref(false);
const isFullscreen = ref(false);
const activeRow = ref(0);
const activeCol = ref(0);
const isMenuOpen = ref(false);
const tableBox = ref<HTMLDivElement | null>(null);

const columns: Column[] = [
  { label: 'Tr', key: 'tree_number', type: 'number' },
  { label: 'PF', key: 'plot_factor', type: 'number' },
  { label: 'SP', key: 'species', type: 'select', options: ['DF', 'WH', 'RC', 'SS', 'RA', 'BM', 'NF', 'SF', 'WP', 'PP', 'SP', 'JP', 'GC', 'TO', 'CL', 'OC', 'OH', 'NA'] },
  { label: 'S', key: 'status', type: 'select', options: ['L', 'D', 'C', 'G'] },
  { label: 'N', key: 'tally', type: 'number' },
  { label: 'D', key: 'diameter', type: 'number' },
  { label: 'FP', key: 'form_point', type: 'number' },
  { label: 'FF', key: 'form_factor', type: 'number' },
  { label: 'TD', key: 'top_diameter', type: 'number' },
  { label: 'BH', key: 'bole_height', type: 'number' },
  { label: 'TH', key: 'top_height', type: 'number' },
];

const createNewRow = (num?: number): Row => ({
  tree_number: num ? String(num) : '',
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
  plot_number: plotNumber.value,
  unit_name: unitName.value,
});

const rows = ref<Row[]>([createNewRow(1), createNewRow(2), createNewRow(3)]);

const activeColConfig = computed(() => columns[activeCol.value]);

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
  const visibleTop = wrapper.scrollTop + headerHeight;
  const visibleBottom = wrapper.scrollTop + wrapper.clientHeight;

  if (cellTop < visibleTop) {
    wrapper.scrollTop = Math.max(cellTop - headerHeight, 0);
  } else if (cellBottom > visibleBottom) {
    wrapper.scrollTop = Math.min(cellBottom - wrapper.clientHeight, wrapper.scrollHeight - wrapper.clientHeight);
  }
};

const setActive = (r: number, c: number) => {
  activeRow.value = r;
  activeCol.value = c;
  scrollActiveIntoView();
};

const move = (dir: 'up' | 'down' | 'left' | 'right') => {
  if (dir === 'up' && activeRow.value > 0) activeRow.value--;
  if (dir === 'down' && activeRow.value < rows.value.length - 1) activeRow.value++;
  if (dir === 'left' && activeCol.value > 0) activeCol.value--;
  if (dir === 'right') {
    if (activeCol.value < columns.length - 1) {
      activeCol.value++;
    } else if (activeRow.value < rows.value.length - 1) {
      activeRow.value++;
      activeCol.value = 0;
    }
  }
  scrollActiveIntoView();
};

const pressKey = (key: number | 'back' | '.') => {
  const row = rows.value[activeRow.value];
  const colKey = activeColConfig.value.key;
  const current = String(row[colKey] || '');

  if (key === 'back') {
    row[colKey] = current.slice(0, -1);
  } else {
    if (key === '.' && current.includes('.')) return;
    row[colKey] = current + String(key);
  }
};

const setVal = (val: string) => {
  rows.value[activeRow.value][activeColConfig.value.key] = val;
  move('right');
};

const addRow = () => {
  const nextNum = rows.value.length + 1;
  rows.value.push(createNewRow(nextNum));
  activeRow.value = rows.value.length - 1;
  activeCol.value = 0;
  scrollActiveIntoView();
};

const removeRow = () => {
  if (rows.value.length > 1) {
    const rowIndex = activeRow.value + 1;
    const message = `Delete row ${rowIndex}? This cannot be undone.`;
    if (!confirm(message)) return;

    rows.value.pop();
    if (activeRow.value >= rows.value.length) {
      activeRow.value = rows.value.length - 1;
    }
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

onMounted(() => {
  updateFullscreenState();
  document.addEventListener('fullscreenchange', updateFullscreenState);
  document.addEventListener('click', closeMenu);
});

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', updateFullscreenState);
  document.removeEventListener('click', closeMenu);
});
</script>

<style>
:root {
  --bg-primary: #ffffff;
  --text-primary: #000000;
  --border-color: #333333;
  --accent: #2563eb;
  --cell-bg: #ffffff;
  --keypad-bg: #e5e7eb;
  --btn-bg: #f3f4f6;
  --header-bg: #ffffff;
}

.dark-mode {
  --bg-primary: #000000;
  --text-primary: #ffffff;
  --border-color: #444444;
  --accent: #3b82f6;
  --cell-bg: #1a1a1a;
  --keypad-bg: #111111;
  --btn-bg: #222222;
  --header-bg: #000000;
}

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
  overflow-y: auto;
  border-bottom: 2px solid var(--border-color);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th {
  position: sticky;
  top: 0;
  background: var(--btn-bg);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  padding: 8px 2px;
  font-weight: 800;
  z-index: 10;
}

td {
  border: 1px solid var(--border-color);
  padding: 0;
  text-align: center;
  height: 44px;
  background: var(--cell-bg);
  color: var(--text-primary);
}

.active-cell {
  outline: 3px solid var(--accent);
  outline-offset: -3px;
  background: rgba(59, 130, 246, 0.2) !important;
}

.keypad-btn {
  background: var(--btn-bg);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 1.25rem;
  height: 50px;
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
</style>
