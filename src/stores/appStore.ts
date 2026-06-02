import { ref, computed } from 'vue';
import { ITree, IPlot, IPlotVisit, ITreeMeasurement} from '../db';

export interface AppState {
  currentView: 'plots' | 'trees' | 'setup';
  userName: string;
  selectedPlot: IPlot | null;
  selectedVisit: IPlotVisit | null;
  priorVisit: IPlotVisit | null;
  trees: ITree[];
  measurements: ITreeMeasurement[];
  isDarkMode: boolean;
  esriToken: string | null;
}

const state = ref<AppState>({
  currentView: 'plots',
  userName: '',
  selectedPlot: null,
  selectedVisit: null,
  priorVisit: null,
  trees: [],
  measurements: [],
  isDarkMode: false,
  esriToken: null,
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
  
  const goToSetup = () => {
    state.value.currentView = 'setup';
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
  const esriToken = computed(() => state.value.esriToken);
  const userName = computed({
    get: () => state.value.userName,
    set: (val) => { state.value.userName = val; }
  });

  const setEsriAuth = (token: string, user: string) => {
    state.value.esriToken = token;
    state.value.userName = user;
  };

  const logoutEsri = () => {
    state.value.esriToken = null;
    state.value.userName = '';
  };

  return {
    goToTrees,
    goToPlots,
    goToSetup,
    toggleDarkMode,
    currentView,
    selectedPlot,
    selectedVisit,
    trees,
    measurements,
    isDarkMode,
    esriToken,
    userName,
    setEsriAuth,
    logoutEsri,
  };
};
