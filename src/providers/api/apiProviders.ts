import type { AuthSession, Emergency, EmergencyStatus, Hospital } from '../../types';
import { httpClient } from '../../services/httpClient';
import { toApiHospitalStatus } from '../../services/statusMapper';
import { tokenStore } from '../../services/tokenStore';
import type { ProviderSet } from '../contracts';

import { endpoints, resourceItemPath } from '../../config/endpoints';
import type { HospitalResourceSummary, HospitalRegistration } from '../../types';
const API_SESSION_KEY = 'lifelink-api-session-hospital-v1';

interface LoginResponse {
  access_token: string;
  expires_at?: string;
  hospital: Hospital;
}

// TODO Phase 5: confirm endpoint paths and add explicit snake_case DTO-to-domain
// mappers here after the backend team publishes its OpenAPI contract.

function storedApiSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const hospital = JSON.parse(window.sessionStorage.getItem(API_SESSION_KEY) ?? 'null') as Hospital | null;
    const accessToken = tokenStore.get();
    return hospital && accessToken ? { hospital, accessToken } : null;
  } catch { return null; }
}

function rememberHospital(hospital: Hospital) {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.setItem(API_SESSION_KEY, JSON.stringify(hospital)); } catch { /* Phase 5 will finalize session persistence. */ }
}

function forgetHospital() {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(API_SESSION_KEY); } catch { /* Nothing else to clear. */ }
}

/**
 * Phase 5 adapter. Routes below are proposed integration seams, not claims about
 * an existing backend. The authenticated backend must scope every response to its
 * hospital principal; hospitalId is intentionally never placed in a query string.
 */
export const apiProviders: ProviderSet = {
  auth: {
    register: payload => httpClient.post<HospitalRegistration>(endpoints.register, payload),
    getSession: storedApiSession,
    async login(email, password) {
      const response = await httpClient.post<LoginResponse>('/auth/hospital/login', { email, password });
      tokenStore.set(response.access_token);
      rememberHospital(response.hospital);
      return { hospital: response.hospital, accessToken: response.access_token, expiresAt: response.expires_at };
    },
    logout() {
      void httpClient.post<void>('/auth/logout').catch(() => undefined);
      tokenStore.clear();
      forgetHospital();
    },
  },
  hospital: {
    async getById(hospitalId) {
      void hospitalId;
      return httpClient.get<Hospital>('/hospital');
    },
    async getStats(hospitalId) {
      void hospitalId;
      return httpClient.get('/hospital/metrics');
    },
    async getActivity(hospitalId) {
      void hospitalId;
      return httpClient.get('/hospital/activity');
    },
  },
  emergency: {
    async getNew(hospitalId) {
      void hospitalId;
      return httpClient.get<Emergency[]>('/hospital/emergencies/new');
    },
    async getOngoing(hospitalId) {
      void hospitalId;
      return httpClient.get<Emergency[]>('/hospital/emergencies/ongoing');
    },
    async getById(id, hospitalId) {
      void hospitalId;
      return httpClient.get<Emergency | null>(`/hospital/emergencies/${encodeURIComponent(id)}`);
    },
    async accept(id, hospitalId) {
      void hospitalId;
      return httpClient.post<Emergency>(`/hospital/emergencies/${encodeURIComponent(id)}/accept`);
    },
    async reject(id, hospitalId, reason) {
      void hospitalId;
      return httpClient.post<Emergency>(`/hospital/emergencies/${encodeURIComponent(id)}/reject`, { reason });
    },
    async updateStatus(id, hospitalId, status: EmergencyStatus) {
      void hospitalId;
      return httpClient.patch<Emergency>(`/hospital/emergencies/${encodeURIComponent(id)}/status`, { status: toApiHospitalStatus(status) });
    },
  },
  resource: {
    getResources: () => httpClient.get<HospitalResourceSummary>(endpoints.resources),
    updateBeds: (_, beds) => httpClient.patch<HospitalResourceSummary>(endpoints.resources, {beds}),
    createDoctor: (_, payload) => httpClient.post<HospitalResourceSummary>(endpoints.doctors, payload),
    updateDoctor: (_, id, payload) => httpClient.patch<HospitalResourceSummary>(resourceItemPath(endpoints.doctors, id), payload),
    deleteDoctor: (_, id) => httpClient.request<HospitalResourceSummary>(resourceItemPath(endpoints.doctors, id), {method: 'DELETE'}),
    createAmbulance: (_, payload) => httpClient.post<HospitalResourceSummary>(endpoints.ambulances, payload),
    updateAmbulance: (_, id, payload) => httpClient.patch<HospitalResourceSummary>(resourceItemPath(endpoints.ambulances, id), payload),
    deleteAmbulance: (_, id) => httpClient.request<HospitalResourceSummary>(resourceItemPath(endpoints.ambulances, id), {method: 'DELETE'}),
    async getAmbulances(hospitalId) {
      void hospitalId;
      return httpClient.get(endpoints.ambulances);
    },
    async getDoctors(hospitalId) {
      void hospitalId;
      return httpClient.get(endpoints.doctors);
    },
    async assignAmbulance(id, hospitalId, ambulanceId) {
      void hospitalId;
      return httpClient.post<Emergency>(`/hospital/emergencies/${encodeURIComponent(id)}/ambulance-assignment`, { ambulance_id: ambulanceId });
    },
    async assignDoctor(id, hospitalId, doctorId) {
      void hospitalId;
      return httpClient.post<Emergency>(`/hospital/emergencies/${encodeURIComponent(id)}/doctor-assignment`, { doctor_id: doctorId });
    },
  },
  demo: {
    async reset() { throw new Error('Demo reset is available only when VITE_DATA_MODE=mock.'); },
  },
};
