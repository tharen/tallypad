import { ref, computed } from 'vue';
import { ITree, IPlot, IPlotVisit, ITreeMeasurement, ISyncError, db } from '../db';

export interface AppState {
  isMobile: boolean;
  currentView: 'plots' | 'trees' | 'setup' | 'plot_detail' | 'lookups' | 'sync_errors';
  previousViews: ('plots' | 'trees' | 'setup' | 'plot_detail' | 'lookups' | 'sync_errors')[];
  selectedPlot: IPlot | null;
  selectedVisit: IPlotVisit | null;
  priorVisit: IPlotVisit | null;
  trees: ITree[];
  measurements: ITreeMeasurement[];
  isDarkMode: boolean;
  allowAddPlots: boolean;
  allowAddVisits: boolean;
  userName: string;
  esriToken: string | null;
  esriRefreshToken: string | null;
  tokenExpiration: number | null;
  plotServiceUrl: string;
  hasSyncErrors: boolean;
}

const STORAGE_KEY_USER = 'tallypad_user';
const STORAGE_KEY_TOKEN = 'tallypad_token';
const STORAGE_KEY_REFRESH_TOKEN = 'tallypad_refresh_token';
const STORAGE_KEY_EXPIRY = 'tallypad_expiry';
const STORAGE_KEY_DARK_MODE = 'tallypad_dark_mode';
const STORAGE_KEY_ADD_PLOTS = 'tallypad_add_plots';
const STORAGE_KEY_ADD_VISITS = 'tallypad_add_visits';
const STORAGE_KEY_PLOT_SERVICE_URL = 'tallypad_plot_service_url';

const getStoredExpiry = (): number | null => {
  const item = localStorage.getItem(STORAGE_KEY_EXPIRY);
  if (!item || item === 'null' || item === 'undefined') return null;
  const num = Number(item);
  return isNaN(num) ? null : num;
};

const state = ref<AppState>({
  isMobile: true,
  currentView: 'plots',
  previousViews: [],
  selectedPlot: null,
  selectedVisit: null,
  priorVisit: null,
  trees: [],
  measurements: [],
  isDarkMode: localStorage.getItem(STORAGE_KEY_DARK_MODE) === 'true',
  allowAddPlots: localStorage.getItem(STORAGE_KEY_ADD_PLOTS) !== 'false',
  allowAddVisits: localStorage.getItem(STORAGE_KEY_ADD_VISITS) !== 'false',
  userName: localStorage.getItem(STORAGE_KEY_USER) || '',
  esriToken: localStorage.getItem(STORAGE_KEY_TOKEN),
  esriRefreshToken: localStorage.getItem(STORAGE_KEY_REFRESH_TOKEN),
  tokenExpiration: getStoredExpiry(),
  plotServiceUrl: localStorage.getItem(STORAGE_KEY_PLOT_SERVICE_URL) || import.meta.env.VITE_PLOT_SERVICE_URL,
  hasSyncErrors: false,
});

export const useAppStore = () => {
  const goToTrees = (plot: IPlot, visit: IPlotVisit, trees: ITree[], measurements: ITreeMeasurement[]) => {
    state.value.selectedPlot = plot;
    state.value.selectedVisit = visit;
    state.value.trees = trees;
    state.value.measurements = measurements;
    state.value.currentView = 'trees';
  };

  const pushCurrentView = () => {
    if (state.value.currentView) {
      state.value.previousViews.push(state.value.currentView);
    }
  };

  const goToPreviousView = () => {
    if (state.value.previousViews.length > 0) {
      const previousView = state.value.previousViews.pop();
      if (previousView) {
        state.value.currentView = previousView;
      }
    } else {
      goToPlots();
    }
  };

  const goToPlots = () => {
    pushCurrentView();
    state.value.currentView = 'plots';
  };
  
  const goToSetup = () => {
    pushCurrentView();
    state.value.currentView = 'setup';
  };

  const goToLookups = () => {
    pushCurrentView();
    state.value.currentView = 'lookups';
  };

  const goToSyncErrors = () => {
    pushCurrentView();
    state.value.currentView = 'sync_errors';
  };

  const goToPlotDetail = (plot: IPlot) => {
    pushCurrentView();
    state.value.selectedPlot = plot;
    state.value.currentView = 'plot_detail';
  };

  const toggleDarkMode = () => {
    state.value.isDarkMode = !state.value.isDarkMode;
    localStorage.setItem(STORAGE_KEY_DARK_MODE, String(state.value.isDarkMode));
  };

  const toggleAllowAddPlots = () => {
    state.value.allowAddPlots = !state.value.allowAddPlots;
    localStorage.setItem(STORAGE_KEY_ADD_PLOTS, String(state.value.allowAddPlots));
  };

  const toggleAllowAddVisits = () => {
    state.value.allowAddVisits = !state.value.allowAddVisits;
    localStorage.setItem(STORAGE_KEY_ADD_VISITS, String(state.value.allowAddVisits));
  };

  const checkDeviceType = () => {
    if (typeof window === "undefined") {
      console.log('checkDeviceType: No window object')
      state.value.isMobile = false;
      
    } else {
      const ua = window.navigator.userAgent;

      console.log('checkDeviceType: User Agent:', ua);
      console.log('checkDeviceType: maxTouchPoints:', window.navigator.maxTouchPoints);
  
      // Tablets (like Samsung Tab Active) often omit "Mobi" from the User Agent.
      // We check for mobile platforms and touch support to classify them as "mobile" (field) devices.
      const isMobilePlatform = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
      const isIPadOS = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;

      state.value.isMobile = isMobilePlatform || isIPadOS;
    }
  };

  const currentView = computed(() => state.value.currentView);
  const selectedPlot = computed(() => state.value.selectedPlot);
  const selectedVisit = computed(() => state.value.selectedVisit);
  const trees = computed(() => state.value.trees);
  const measurements = computed(() => state.value.measurements);
  const isMobile = computed(() => state.value.isMobile);
  const isDarkMode = computed(() => state.value.isDarkMode);
  const esriToken = computed(() => state.value.esriToken);
  const esriRefreshToken = computed(() => state.value.esriRefreshToken);
  const plotServiceUrl = computed(() => state.value.plotServiceUrl);
  const allowAddPlots = computed(() => state.value.allowAddPlots);
  const allowAddVisits = computed(() => state.value.allowAddVisits);
  
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

  const refreshEsriToken = async (): Promise<boolean | 'PERMANENT_FAILURE'> => {
    if (!state.value.esriRefreshToken) return false;

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

      const data = await response.json() as { 
        access_token?: string; 
        expires_in?: number; 
        username?: string; 
        refresh_token?: string; 
        error?: { code?: number; message?: string } 
      };

      if (data.access_token) {
        const expiration = Date.now() + (data.expires_in! * 1000);
        setEsriAuth(data.access_token, data.username || state.value.userName, expiration, data.refresh_token || state.value.esriRefreshToken);
        return true;
      }

      if (data.error) {
        console.error('ESRI token refresh error:', data.error.code, data.error.message);
        // Standard ESRI error codes for expired/invalid token is 400 or message contents
        return 'PERMANENT_FAILURE';
      }
    } catch (error) {
      console.error('Failed to refresh token:', error);
    }
    return false;
  };

  const hasSyncErrors = computed(() => state.value.hasSyncErrors);
  const checkSyncErrors = async () => {
    if (db.syncErrors) {
      state.value.hasSyncErrors = (await db.syncErrors.count()) > 0;
    } else {
      state.value.hasSyncErrors = false;
    }
  };

  // Run initial check
  checkSyncErrors();

  return {
    goToTrees,
    goToPlots,
    goToSetup,
    goToPlotDetail,
    goToLookups,
    goToSyncErrors,
    toggleDarkMode,
    checkDeviceType,
    isMobile,
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
    plotServiceUrl,
    allowAddPlots,
    allowAddVisits,
    toggleAllowAddPlots,
    toggleAllowAddVisits,
    setEsriAuth,
    logoutEsri,
    refreshEsriToken,
    hasSyncErrors,
    checkSyncErrors,
    pushCurrentView,
    goToPreviousView,
  };
};
