<template>
  <div id="app-inner" :class="{ 'dark-mode': isDarkMode }">
    <template v-if="store.currentView.value === 'plots'">
      <!-- Plots List View -->
      <header class="p-4 border-b-2 flex justify-between items-center" :style="{ borderColor: 'var(--border-color)', backgroundColor: 'var(--header-bg)' }">
        <div>
          <h1 class="text-lg font-bold">Unit Plots</h1>
          <p class="text-sm opacity-70">Select a plot to begin inventory</p>
        </div>
        <div class="relative">
          <button @click.stop="toggleMenu" class="p-2 rounded text-xl font-bold" :style="{ color: 'var(--text-primary)' }">
            ⁝
          </button>
          <div v-if="isMenuOpen" class="kebab-menu" @click.stop>
            <button @click="isDarkMode = !isDarkMode" class="menu-item">
              <span class="menu-icon">{{ isDarkMode ? '☀️' : '🌙' }}</span>
              <span>{{ isDarkMode ? 'Light mode' : 'Dark mode' }}</span>
            </button>
          </div>
        </div>
      </header>

      <div class="flex-1 overflow-y-auto p-4">
        <div v-if="unitPlots.length === 0" class="flex items-center justify-center h-full text-center">
          <div>
            <p class="text-xl font-bold mb-2">No plots found</p>
            <p class="opacity-70 mb-4">Add a new unit plot to get started</p>
            <button @click="addNewPlot" class="px-6 py-3 rounded bg-blue-600 text-white font-bold hover:bg-blue-700">
              ＋ Add Plot
            </button>
          </div>
        </div>

        <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
          <div
            v-for="plot in unitPlots"
            :key="`${plot.unitName}-${plot.plotNumber}`"
            class="plot-card"
            :style="{ backgroundColor: 'var(--cell-bg)', borderColor: 'var(--border-color)' }">
            <div class="flex-1">
              <div class="text-sm opacity-70 uppercase tracking-wide">Unit</div>
              <h2 class="text-2xl font-bold mb-4">{{ plot.unitName }}</h2>
              <div class="text-sm opacity-70 uppercase tracking-wide">Plot</div>
              <p class="text-xl font-mono font-bold">{{ plot.plotNumber }}</p>
            </div>
            <button @click="selectPlot(plot)" class="plot-action-btn">
              <span class="text-2xl">→</span>
            </button>
          </div>
        </div>

        <div class="flex justify-center pt-4">
          <button @click="addNewPlot" class="nav-btn text-green-600 font-black text-2xl">
            ＋ Add Plot
          </button>
        </div>
      </div>
    </template>

    <template v-else-if="store.currentView.value === 'trees'">
      <!-- Trees View -->
      <Trees />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useAppStore } from './stores/appStore';
import { db, UnitPlot } from './db';
import Trees from './views/Trees.vue';

const store = useAppStore();
const isDarkMode = ref(false);
const isMenuOpen = ref(false);
const unitPlots = ref<UnitPlot[]>([]);

const toggleMenu = () => {
  isMenuOpen.value = !isMenuOpen.value;
};

const closeMenu = () => {
  isMenuOpen.value = false;
};

const selectPlot = async (plot: UnitPlot) => {
  closeMenu();
  // Fetch tree records for this plot from the database
  const records = await db.treeRecords
    .where('[unitName+plotNumber]')
    .equals([plot.unitName, plot.plotNumber])
    .toArray();

  store.goToTrees(plot, records);
};

const addNewPlot = () => {
  // Simple dialog to add a new plot (can be enhanced with a modal)
  const unitName = prompt('Enter unit name (e.g., TIMBER-A1):');
  if (!unitName?.trim()) return;

  const plotNumber = prompt('Enter plot number (e.g., 42):');
  if (!plotNumber?.trim()) return;

  const newPlot: UnitPlot = {
    unitName: unitName.trim(),
    plotNumber: plotNumber.trim(),
  };

  db.unitPlots.add(newPlot).then(() => {
    loadPlots();
  });
};

const loadPlots = async () => {
  unitPlots.value = await db.unitPlots.toArray();
};

onMounted(() => {
  loadPlots();
  // Add some sample data if the database is empty
  db.unitPlots.count().then((count) => {
    if (count === 0) {
      const samplePlots: UnitPlot[] = [
        { unitName: 'TIMBER-A1', plotNumber: '42' },
        { unitName: 'TIMBER-A1', plotNumber: '43' },
        { unitName: 'TIMBER-B2', plotNumber: '15' },
        { unitName: 'TIMBER-B2', plotNumber: '16' },
      ];
      db.unitPlots.bulkAdd(samplePlots).then(() => {
        loadPlots();
      });
    }
  });

  document.addEventListener('click', closeMenu);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', closeMenu);
});
</script>

<style scoped>
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

.plot-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 2px solid;
  border-radius: 12px;
  padding: 24px;
  gap: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.plot-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  border-color: var(--accent);
}

.plot-action-btn {
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background-color: var(--accent);
  color: white;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3);
}

.plot-action-btn:hover {
  background-color: #1d4ed8;
  transform: scale(1.1);
}

.plot-action-btn:active {
  transform: scale(0.95);
}

.nav-btn {
  background: var(--btn-bg);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  padding: 12px 24px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.nav-btn:hover {
  background-color: var(--accent);
  color: white;
}

.kebab-menu {
  position: absolute;
  right: -4px;
  top: calc(100% + 8px);
  width: 180px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--btn-bg);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
  z-index: 20;
  overflow: hidden;
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
  transition: background-color 0.2s ease;
}

.menu-item:hover {
  background: rgba(59, 130, 246, 0.12);
}

.menu-icon {
  width: 1.25rem;
  text-align: center;
}
</style>
