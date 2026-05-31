import { ref, computed } from 'vue';
import { ITree, IPlot, IPlotVisit, ITreeMeasurement} from '../db';

export interface AppState {
  currentView: 'plots' | 'trees';
  selectedPlot: IPlot | null;
  selectedVisit: IPlotVisit | null;
  priorVisit: IPlotVisit | null;
  trees: ITree[];
  measurements: ITreeMeasurement[];
  isDarkMode: boolean;
}

const state = ref<AppState>({
  currentView: 'plots',
  selectedPlot: null,
  selectedVisit: null,
  priorVisit: null,
  trees: [],
  measurements: [],
  isDarkMode: false,
});

export const useAppStore = () => {
  const goToTrees = (plot: IPlot, visit: IPlotVisit, trees: ITree[], measurements: ITreeMeasurement[]) => {
    state.value.selectedPlot = plot;
    state.value.selectedVisit = visit;
    state.value.trees = trees;
    state.value.measurements = measurements;
    state.value.currentView = 'trees';
  };

  const goToPlots = () => {
    state.value.currentView = 'plots';
  };
  
  const toggleDarkMode = () => {
    state.value.isDarkMode = !state.value.isDarkMode;
  };

  const currentView = computed(() => state.value.currentView);
  const selectedPlot = computed(() => state.value.selectedPlot);
  const selectedVisit = computed(() => state.value.selectedVisit);
  const trees = computed(() => state.value.trees);
  const measurements = computed(() => state.value.measurements);
  const isDarkMode = computed(() => state.value.isDarkMode);

  return {
    goToTrees,
    goToPlots,
    toggleDarkMode,
    currentView,
    selectedPlot,
    selectedVisit,
    trees,
    measurements,
    isDarkMode,
  };
};
