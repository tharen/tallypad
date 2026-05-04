import { ref, computed } from 'vue';
import { Tree, Plot } from '../db';

export interface AppState {
  currentView: 'plots' | 'trees';
  selectedPlot: Plot | null;
  trees: Tree[];
}

const state = ref<AppState>({
  currentView: 'plots',
  selectedPlot: null,
  trees: [],
});

export const useAppStore = () => {
  const goToTrees = (plot: Plot, records: Tree[]) => {
    state.value.selectedPlot = plot;
    state.value.trees = records;
    state.value.currentView = 'trees';
  };

  const goToPlots = () => {
    state.value.currentView = 'plots';
  };

  const currentView = computed(() => state.value.currentView);
  const selectedPlot = computed(() => state.value.selectedPlot);
  const trees = computed(() => state.value.trees);

  return {
    goToTrees,
    goToPlots,
    currentView,
    selectedPlot,
    trees,
  };
};
