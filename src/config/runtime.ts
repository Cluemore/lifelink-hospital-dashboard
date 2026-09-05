import type { DataMode } from '../types';

function dataMode(value: string | undefined): DataMode {
  return value?.toLowerCase() === 'api' ? 'api' : 'mock';
}

export const runtimeConfig = Object.freeze({
  dataMode: dataMode(import.meta.env.VITE_DATA_MODE),
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1').replace(/\/$/, ''),
});

export const isMockMode = runtimeConfig.dataMode === 'mock';
