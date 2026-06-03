import { ref, computed } from 'vue';
import { ITree, IPlot, IPlotVisit, ITreeMeasurement } from '../db';

export interface AppState {
  currentView: 'plots' | 'trees' | 'setup';
  selectedPlot: IPlot | null;
  selectedVisit: IPlotVisit | null;
  priorVisit: IPlotVisit | null;
  trees: ITree[];
  measurements: ITreeMeasurement[];
  isDarkMode: boolean;
  userName: string;
  esriToken: string | null;
  esriRefreshToken: string | null;
  tokenExpiration: number | null;
}

const STORAGE_KEY_USER = 'tallypad_user';
const STORAGE_KEY_TOKEN = 'tallypad_token';
const STORAGE_KEY_REFRESH_TOKEN = 'tallypad_refresh_token';
const STORAGE_KEY_EXPIRY = 'tallypad_expiry';
const STORAGE_KEY_DARK_MODE = 'tallypad_dark_mode';

const state = ref<AppState>({
  currentView: 'plots',
  selectedPlot: null,
  selectedVisit: null,
  priorVisit: null,
  trees: [],
  measurements: [],
  isDarkMode: localStorage.getItem(STORAGE_KEY_DARK_MODE) === 'true',
  userName: localStorage.getItem(STORAGE_KEY_USER) || '',
  esriToken: localStorage.getItem(STORAGE_KEY_TOKEN),
  esriRefreshToken: localStorage.getItem(STORAGE_KEY_REFRESH_TOKEN),
  tokenExpiration: Number(localStorage.getItem(STORAGE_KEY_EXPIRY)) || null,
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
  const esriRefreshToken = computed(() => state.value.esriRefreshToken);
  
  const isTokenExpired = computed(() => {
    if (!state.value.tokenExpiration) return false;
    // Consider expired if within 5 minutes of actual expiration
    return Date.now() > (state.value.tokenExpiration - 300000);
  });

  const userName = computed({
    get: () => state.value.userName,
    set: (val) => { 
      state.value.userName = val;
      localStorage.setItem(STORAGE_KEY_USER, val);
    }
  });

  const setEsriAuth = (token: string, user: string, expiration: number | null = null, refreshToken: string | null = null) => {
    state.value.esriToken = token;
    state.value.userName = user;
    state.value.tokenExpiration = expiration;
    state.value.esriRefreshToken = refreshToken;
    localStorage.setItem(STORAGE_KEY_TOKEN, token);
    localStorage.setItem(STORAGE_KEY_USER, user);
    if (expiration) localStorage.setItem(STORAGE_KEY_EXPIRY, String(expiration));
    if (refreshToken) localStorage.setItem(STORAGE_KEY_REFRESH_TOKEN, refreshToken);
  };

  const logoutEsri = () => {
    state.value.esriToken = null;
    state.value.userName = '';
    state.value.tokenExpiration = null;
    state.value.esriRefreshToken = null;
    localStorage.removeItem(STORAGE_KEY_TOKEN);
    localStorage.removeItem(STORAGE_KEY_USER);
    localStorage.removeItem(STORAGE_KEY_EXPIRY);
    localStorage.removeItem(STORAGE_KEY_REFRESH_TOKEN);
  };

  const refreshEsriToken = async () => {
    if (!state.value.esriRefreshToken) return;

    try {
      const clientId = import.meta.env.VITE_ESRI_CLIENT_ID;
      const params = new URLSearchParams({
        f: 'json',
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: state.value.esriRefreshToken
      });

      const response = await fetch('https://www.arcgis.com/sharing/rest/oauth2/token', {
        method: 'POST',
        body: params
      });

      const data = await response.json();
      if (data.access_token) {
        const expiration = Date.now() + (data.expires_in * 1000);
        setEsriAuth(data.access_token, data.username || state.value.userName, expiration, data.refresh_token || state.value.esriRefreshToken);
        return true;
      }
    } catch (error) {
      console.error('Failed to refresh token:', error);
    }
    return false;
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
    esriRefreshToken,
    isTokenExpired,
    userName,
    setEsriAuth,
    logoutEsri,
    refreshEsriToken
  };
};
