import { ref, computed } from 'vue';
import { TreeRecord, UnitPlot } from '../db';

export interface AppState {
  currentView: 'plots' | 'trees';
  selectedPlot: UnitPlot | null;
  treeRecords: TreeRecord[];
}

const state = ref<AppState>({
  currentView: 'plots',
  selectedPlot: null,
  treeRecords: [],
});

export const useAppStore = () => {
  const goToTrees = (plot: UnitPlot, records: TreeRecord[]) => {
    state.value.selectedPlot = plot;
    state.value.treeRecords = records;
    state.value.currentView = 'trees';
  };

  const goToPlots = () => {
    state.value.currentView = 'plots';
  };

  const currentView = computed(() => state.value.currentView);
  const selectedPlot = computed(() => state.value.selectedPlot);
  const treeRecords = computed(() => state.value.treeRecords);

  return {
    goToTrees,
    goToPlots,
    currentView,
    selectedPlot,
    treeRecords,
  };
};
