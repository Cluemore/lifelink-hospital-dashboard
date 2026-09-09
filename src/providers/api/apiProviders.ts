import type {
  AuthSession,
  Emergency,
  EmergencyStatus,
  Hospital,
  HospitalId,
  HospitalResourceSummary,
  HospitalRegistration,
  HospitalRegistrationInput,
  Doctor,
  Ambulance,
  BedUpdate,
  DoctorInput,
  AmbulanceInput,
} from '../../types';
import { httpClient } from '../../services/httpClient';
import { toApiHospitalStatus } from '../../services/statusMapper';
import { tokenStore } from '../../services/tokenStore';
import type { ProviderSet } from '../contracts';
import { endpoints } from '../../config/endpoints';

const API_SESSION_KEY = 'lifelink-api-session-hospital-v1';
const LOCAL_DOCTORS_KEY = 'lifelink-local-doctors-v1';
const LOCAL_AMBULANCES_KEY = 'lifelink-local-ambulances-v1';

// ── Backend response shapes ───────────────────────────────────────────────────

interface LoginResponse {
  access_token: string;
  token_type: string;
}

interface BackendHospital {
  hospital_id: number;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  total_beds?: number;
  icu_beds?: number;
  oxygen_beds?: number;
  general_occupied?: number;
  icu_occupied?: number;
  emergency_occupied?: number;
  phone_number?: string;
  rating?: number;
  created_at?: string;
}

interface BackendDoctor {
  doctor_id: number;
  hospital_id: number;
  name: string;
  department?: string;
  specialization?: string;
  phone?: string;
  status: string;
  current_cases?: number;
}

interface BackendAmbulance {
  ambulance_id: number;
  hospital_id: number;
  vehicle_number: string;
  driver_name?: string;
  driver_phone?: string;
  location_label?: string;
  status: string;
}

// ── Demo hospital email → hospital name mapping ───────────────────────────────
const DEMO_EMAIL_MAP: Record<string, string> = {
  'citycare@lifelink.demo': 'CityCare Hospital',
  'metro@lifelink.demo': 'Metro General Hospital',
  'lifeline@lifelink.demo': 'Lifeline Medical Centre',
  'harbourview@lifelink.demo': 'Harbourview Emergency Hospital',
};

// ── Local storage helpers for doctors/ambulances fallback ─────────────────────

function getLocalStore<T>(key: string): Record<string, T[]> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? '{}');
  } catch {
    return {};
  }
}

function setLocalStore<T>(key: string, data: Record<string, T[]>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(data));
  } catch { /* ignore */ }
}

function getLocalHospitalItems<T>(key: string, hospitalId: string): T[] {
  const store = getLocalStore<T>(key);
  return store[hospitalId] ?? [];
}

function saveLocalHospitalItems<T>(key: string, hospitalId: string, items: T[]) {
  const store = getLocalStore<T>(key);
  store[hospitalId] = items;
  setLocalStore(key, store);
}

// ── Mapper: backend hospital row → dashboard Hospital type ────────────────────

function toHospital(h: BackendHospital): Hospital {
  const generalTotal = h.total_beds ?? 100;
  const generalOcc = h.general_occupied ?? 0;
  const icuTotal = h.icu_beds ?? 20;
  const icuOcc = h.icu_occupied ?? 0;

  return {
    id: String(h.hospital_id),
    name: h.name,
    shortName: h.name.split(' ').slice(0, 2).join(' '),
    networkRegion: 'India',
    department: 'Emergency',
    address: h.address ?? 'Medical District',
    latitude: h.latitude ?? 19.7,
    longitude: h.longitude ?? 72.77,
    emergencyBeds: {
      available: Math.max(0, generalTotal - generalOcc),
      total: generalTotal,
    },
    icuBeds: {
      available: Math.max(0, icuTotal - icuOcc),
      total: icuTotal,
    },
    averageResponseTimeMinutes: 8,
    completedToday: 0,
    acceptanceRate: 0.95,
    status: 'CONNECTED',
  };
}

const FALLBACK_HOSPITAL: Hospital = {
  id: '5',
  name: 'CityCare Hospital',
  shortName: 'CityCare',
  networkRegion: 'India',
  department: 'Emergency',
  address: '123 City Centre, Mumbai, MH 400001',
  latitude: 19.076,
  longitude: 72.8777,
  emergencyBeds: { available: 130, total: 200 },
  icuBeds: { available: 30, total: 40 },
  averageResponseTimeMinutes: 8,
  completedToday: 0,
  acceptanceRate: 0.95,
  status: 'CONNECTED',
};

// ── Session helpers ───────────────────────────────────────────────────────────

function storedApiSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const hospital = JSON.parse(
      window.sessionStorage.getItem(API_SESSION_KEY) ?? 'null'
    ) as Hospital | null;
    const accessToken = tokenStore.get();
    return hospital && accessToken ? { hospital, accessToken } : null;
  } catch {
    return null;
  }
}

function rememberHospital(hospital: Hospital) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(API_SESSION_KEY, JSON.stringify(hospital));
  } catch { /* ignore */ }
}

function forgetHospital() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(API_SESSION_KEY);
  } catch { /* ignore */ }
}

// ── Hospital fetch helpers ────────────────────────────────────────────────────

async function fetchAllHospitals(): Promise<BackendHospital[]> {
  try {
    const list = await httpClient.get<BackendHospital[]>(endpoints.hospitals);
    if (Array.isArray(list)) return list;
  } catch { /* ignore */ }
  return [];
}

async function fetchHospitalById(id: string): Promise<BackendHospital | null> {
  try {
    const res = await httpClient.get<BackendHospital>(`/hospitals/${encodeURIComponent(id)}`);
    if (res && res.hospital_id) return res;
  } catch { /* fall back to searching list */ }

  const all = await fetchAllHospitals();
  return all.find((h) => String(h.hospital_id) === String(id)) ?? null;
}

async function fetchHospitalForEmail(email: string): Promise<Hospital> {
  const all = await fetchAllHospitals();
  if (all.length === 0) return FALLBACK_HOSPITAL;

  const expectedName = DEMO_EMAIL_MAP[email.toLowerCase()];
  if (expectedName) {
    const match = all.find(
      (h) => h.name.toLowerCase() === expectedName.toLowerCase()
    );
    if (match) return toHospital(match);
  }

  return toHospital(all[0]);
}

// ── Doctors & Ambulances API with graceful sync ───────────────────────────────

async function fetchDoctorsFromBackend(hospitalId: string): Promise<Doctor[]> {
  try {
    const res = await httpClient.get<BackendDoctor[]>(`/hospitals/${encodeURIComponent(hospitalId)}/doctors/`);
    if (Array.isArray(res)) {
      const docs: Doctor[] = res.map((d) => ({
        id: String(d.doctor_id),
        hospitalId,
        name: d.name,
        department: d.department ?? 'Emergency',
        specialization: d.specialization ?? 'General Physician',
        phone: d.phone,
        status: (d.status as any) ?? 'AVAILABLE',
        currentCases: d.current_cases ?? 0,
      }));
      saveLocalHospitalItems(LOCAL_DOCTORS_KEY, hospitalId, docs);
      return docs;
    }
  } catch {
    // Backend endpoint not deployed yet on remote, use local store
  }
  return getLocalHospitalItems<Doctor>(LOCAL_DOCTORS_KEY, hospitalId);
}

async function fetchAmbulancesFromBackend(hospitalId: string): Promise<Ambulance[]> {
  try {
    const res = await httpClient.get<BackendAmbulance[]>(`/hospitals/${encodeURIComponent(hospitalId)}/ambulances/`);
    if (Array.isArray(res)) {
      const ambs: Ambulance[] = res.map((a) => ({
        id: String(a.ambulance_id),
        hospitalId,
        vehicleNumber: a.vehicle_number,
        driverName: a.driver_name ?? '',
        driverPhone: a.driver_phone ?? '',
        locationLabel: a.location_label ?? 'Hospital Fleet',
        status: (a.status as any) ?? 'AVAILABLE',
      }));
      saveLocalHospitalItems(LOCAL_AMBULANCES_KEY, hospitalId, ambs);
      return ambs;
    }
  } catch {
    // Backend endpoint not deployed yet on remote, use local store
  }
  return getLocalHospitalItems<Ambulance>(LOCAL_AMBULANCES_KEY, hospitalId);
}

// ── Provider set ──────────────────────────────────────────────────────────────

export const apiProviders: ProviderSet = {
  auth: {
    async register(payload: HospitalRegistrationInput): Promise<HospitalRegistration> {
      // 1. Create Admin User account in database
      await httpClient.post('/users/', {
        full_name: payload.adminName,
        email: payload.adminEmail,
        phone_number: payload.adminPhone,
        password: payload.password,
      });

      // 2. Create Hospital record in database
      const fullAddress = [payload.address, payload.city, payload.state, payload.pinCode]
        .filter(Boolean)
        .join(', ');

      const createdHospital = await httpClient.post<BackendHospital>('/hospitals/', {
        name: payload.hospitalName,
        address: fullAddress,
        latitude: payload.latitude ?? 19.7,
        longitude: payload.longitude ?? 72.77,
        total_beds: payload.generalBeds,
        icu_beds: payload.icuBeds,
        oxygen_beds: payload.emergencyBeds,
        phone_number: payload.emergencyPhone,
        rating: 5.0,
      });

      const hospitalId = String(createdHospital.hospital_id ?? Date.now());

      // 3. Initialize ambulances if requested
      if (payload.ambulanceCount > 0) {
        const initialAmbs: Ambulance[] = [];
        for (let i = 1; i <= payload.ambulanceCount; i++) {
          const vehNum = `AMB-${payload.city.slice(0, 3).toUpperCase()}-${String(i).padStart(2, '0')}`;
          try {
            await httpClient.post(`/hospitals/${encodeURIComponent(hospitalId)}/ambulances/`, {
              vehicle_number: vehNum,
              driver_name: `Driver ${i}`,
              driver_phone: payload.emergencyPhone,
              status: 'AVAILABLE',
            });
          } catch {
            initialAmbs.push({
              id: `amb-${i}`,
              hospitalId,
              vehicleNumber: vehNum,
              driverName: `Driver ${i}`,
              driverPhone: payload.emergencyPhone,
              locationLabel: 'Hospital Fleet',
              status: 'AVAILABLE',
            });
          }
        }
        if (initialAmbs.length > 0) {
          saveLocalHospitalItems(LOCAL_AMBULANCES_KEY, hospitalId, initialAmbs);
        }
      }

      return {
        id: hospitalId,
        hospitalName: payload.hospitalName,
        licenseNumber: payload.licenseNumber,
        hospitalType: payload.hospitalType,
        address: payload.address,
        city: payload.city,
        state: payload.state,
        pinCode: payload.pinCode,
        emergencyPhone: payload.emergencyPhone,
        hospitalEmail: payload.hospitalEmail,
        website: payload.website,
        latitude: payload.latitude,
        longitude: payload.longitude,
        adminName: payload.adminName,
        designation: payload.designation,
        adminEmail: payload.adminEmail,
        adminPhone: payload.adminPhone,
        generalBeds: payload.generalBeds,
        icuBeds: payload.icuBeds,
        emergencyBeds: payload.emergencyBeds,
        ambulanceCount: payload.ambulanceCount,
        status: 'APPROVED',
        submittedAt: new Date().toISOString(),
      };
    },

    getSession: storedApiSession,

    async login(email, password) {
      // Step 1: Authenticate → JWT
      const tokenResp = await httpClient.post<LoginResponse>(endpoints.login, { email, password });
      tokenStore.set(tokenResp.access_token);

      // Step 2: Fetch the hospital tied to this email
      const hospital = await fetchHospitalForEmail(email);
      rememberHospital(hospital);
      return { hospital, accessToken: tokenResp.access_token };
    },

    logout() {
      tokenStore.clear();
      forgetHospital();
    },
  },

  hospital: {
    async getById(hospitalId) {
      const h = await fetchHospitalById(hospitalId);
      return h ? toHospital(h) : FALLBACK_HOSPITAL;
    },

    async getStats(hospitalId) {
      const [h, doctors, ambulances] = await Promise.all([
        fetchHospitalById(hospitalId),
        fetchDoctorsFromBackend(hospitalId),
        fetchAmbulancesFromBackend(hospitalId),
      ]);

      const genTotal = h?.total_beds ?? 100;
      const genOcc = h?.general_occupied ?? 0;
      const genAvail = Math.max(0, genTotal - genOcc);

      const icuTotal = h?.icu_beds ?? 20;
      const icuOcc = h?.icu_occupied ?? 0;
      const icuAvail = Math.max(0, icuTotal - icuOcc);

      const emTotal = h?.oxygen_beds ?? 15;
      const emOcc = h?.emergency_occupied ?? 0;
      const emAvail = Math.max(0, emTotal - emOcc);

      const availAmbulances = ambulances.filter((a) => a.status === 'AVAILABLE').length;
      const availDoctors = doctors.filter((d) => d.status === 'AVAILABLE').length;

      return {
        newEmergencies: 0,
        ongoingCases: 0,
        activeEmergencies: 0,
        criticalCases: 0,
        availableAmbulances: availAmbulances,
        totalAmbulances: ambulances.length,
        availableDoctors: availDoctors,
        totalDoctors: doctors.length,
        availableBeds: genAvail + icuAvail + emAvail,
        totalBeds: genTotal + icuTotal + emTotal,
        availableIcuBeds: icuAvail,
        totalIcuBeds: icuTotal,
        availableGeneralBeds: genAvail,
        totalGeneralBeds: genTotal,
        availableEmergencyDoctors: availDoctors,
        averageResponseTimeMinutes: 8,
        completedToday: 0,
        acceptanceRate: 0.95,
      };
    },

    async getActivity(_hospitalId) {
      return [];
    },
  },

  emergency: {
    async getNew(_hospitalId) {
      try {
        const sos = await httpClient.get<any[]>('/sos');
        if (!Array.isArray(sos)) return [];
        return sos
          .filter((s) => s.status !== 'RESOLVED')
          .map((s) => ({
            id: String(s.sos_id),
            sosId: String(s.sos_id),
            hospitalId: _hospitalId,
            requestStatus: 'PENDING' as const,
            type: 'SOS Emergency',
            status: 'RECEIVED' as const,
            priority: { score: 90, level: 'HIGH' as const, reasons: ['SOS triggered'] },
            patient: { id: String(s.user_id), name: `User #${s.user_id}` },
            location: {
              latitude: s.latitude ?? 19.7,
              longitude: s.longitude ?? 72.77,
              address: s.description ?? 'Location from app',
            },
            createdAt: s.created_at ?? new Date().toISOString(),
            timeline: [],
          }));
      } catch {
        return [];
      }
    },

    async getOngoing(_hospitalId) { return []; },

    async getById(id, _hospitalId) {
      try {
        return await httpClient.get<Emergency>(`/sos/${encodeURIComponent(id)}`);
      } catch {
        return null;
      }
    },

    async accept(id, _hospitalId) {
      return httpClient.post<Emergency>(`/sos/${encodeURIComponent(id)}/accept`);
    },

    async reject(id, _hospitalId, reason) {
      return httpClient.post<Emergency>(`/sos/${encodeURIComponent(id)}/reject`, { reason });
    },

    async updateStatus(id, _hospitalId, status: EmergencyStatus) {
      return httpClient.patch<Emergency>(
        `/sos/${encodeURIComponent(id)}/status`,
        { status: toApiHospitalStatus(status) }
      );
    },
  },

  resource: {
    async getResources(hospitalId: HospitalId): Promise<HospitalResourceSummary> {
      const [h, doctors, ambulances] = await Promise.all([
        fetchHospitalById(hospitalId),
        fetchDoctorsFromBackend(hospitalId),
        fetchAmbulancesFromBackend(hospitalId),
      ]);

      const genTotal = h?.total_beds ?? 100;
      const genOcc = h?.general_occupied ?? 0;

      const icuTotal = h?.icu_beds ?? 20;
      const icuOcc = h?.icu_occupied ?? 0;

      const emTotal = h?.oxygen_beds ?? 15;
      const emOcc = h?.emergency_occupied ?? 0;

      return {
        hospitalId,
        beds: {
          general: {
            total: genTotal,
            occupied: genOcc,
            available: Math.max(0, genTotal - genOcc),
          },
          icu: {
            total: icuTotal,
            occupied: icuOcc,
            available: Math.max(0, icuTotal - icuOcc),
          },
          emergency: {
            total: emTotal,
            occupied: emOcc,
            available: Math.max(0, emTotal - emOcc),
          },
        },
        doctors,
        ambulances,
        updatedAt: new Date().toISOString(),
      };
    },

    async updateBeds(hospitalId: HospitalId, payload: BedUpdate): Promise<HospitalResourceSummary> {
      const updatePayload: Record<string, any> = {
        total_beds: payload.general.total,
        icu_beds: payload.icu.total,
        oxygen_beds: payload.emergency.total,
        general_occupied: payload.general.occupied,
        icu_occupied: payload.icu.occupied,
        emergency_occupied: payload.emergency.occupied,
      };

      try {
        await httpClient.request(`/hospitals/${encodeURIComponent(hospitalId)}`, {
          method: 'PUT',
          body: JSON.stringify(updatePayload),
        });
      } catch (err) {
        console.warn('Backend bed update warning:', err);
      }

      return this.getResources(hospitalId);
    },

    async getDoctors(hospitalId: HospitalId): Promise<Doctor[]> {
      return fetchDoctorsFromBackend(hospitalId);
    },

    async createDoctor(hospitalId: HospitalId, payload: DoctorInput): Promise<HospitalResourceSummary> {
      try {
        const res = await httpClient.post<BackendDoctor>(`/hospitals/${encodeURIComponent(hospitalId)}/doctors/`, {
          name: payload.name,
          department: payload.department ?? 'Emergency',
          specialization: payload.specialization ?? 'General Physician',
          phone: payload.phone ?? '',
          status: payload.status ?? 'AVAILABLE',
        });
        if (res && res.doctor_id) {
          return this.getResources(hospitalId);
        }
      } catch {
        // Fallback to local storage if remote route pending deployment
      }

      const existing = getLocalHospitalItems<Doctor>(LOCAL_DOCTORS_KEY, hospitalId);
      const newDoc: Doctor = {
        id: `doc-${Date.now()}`,
        hospitalId,
        name: payload.name,
        department: payload.department ?? 'Emergency',
        specialization: payload.specialization ?? 'General Physician',
        phone: payload.phone,
        status: payload.status ?? 'AVAILABLE',
        currentCases: 0,
      };
      saveLocalHospitalItems(LOCAL_DOCTORS_KEY, hospitalId, [...existing, newDoc]);
      return this.getResources(hospitalId);
    },

    async updateDoctor(hospitalId: HospitalId, id: string, payload: DoctorInput): Promise<HospitalResourceSummary> {
      try {
        await httpClient.request(`/hospitals/${encodeURIComponent(hospitalId)}/doctors/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: payload.name,
            department: payload.department,
            specialization: payload.specialization,
            phone: payload.phone,
            status: payload.status,
          }),
        });
        return this.getResources(hospitalId);
      } catch {
        // Fallback to local storage
      }

      const existing = getLocalHospitalItems<Doctor>(LOCAL_DOCTORS_KEY, hospitalId);
      const updated = existing.map((d) => (d.id === id ? { ...d, ...payload } : d));
      saveLocalHospitalItems(LOCAL_DOCTORS_KEY, hospitalId, updated);
      return this.getResources(hospitalId);
    },

    async deleteDoctor(hospitalId: HospitalId, id: string): Promise<HospitalResourceSummary> {
      try {
        await httpClient.request(`/hospitals/${encodeURIComponent(hospitalId)}/doctors/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        return this.getResources(hospitalId);
      } catch {
        // Fallback to local storage
      }

      const existing = getLocalHospitalItems<Doctor>(LOCAL_DOCTORS_KEY, hospitalId);
      saveLocalHospitalItems(LOCAL_DOCTORS_KEY, hospitalId, existing.filter((d) => d.id !== id));
      return this.getResources(hospitalId);
    },

    async getAmbulances(hospitalId: HospitalId): Promise<Ambulance[]> {
      return fetchAmbulancesFromBackend(hospitalId);
    },

    async createAmbulance(hospitalId: HospitalId, payload: AmbulanceInput): Promise<HospitalResourceSummary> {
      try {
        const res = await httpClient.post<BackendAmbulance>(`/hospitals/${encodeURIComponent(hospitalId)}/ambulances/`, {
          vehicle_number: payload.vehicleNumber,
          driver_name: payload.driverName ?? '',
          driver_phone: payload.driverPhone ?? '',
          status: payload.status ?? 'AVAILABLE',
        });
        if (res && res.ambulance_id) {
          return this.getResources(hospitalId);
        }
      } catch {
        // Fallback to local storage
      }

      const existing = getLocalHospitalItems<Ambulance>(LOCAL_AMBULANCES_KEY, hospitalId);
      const newAmb: Ambulance = {
        id: `amb-${Date.now()}`,
        hospitalId,
        vehicleNumber: payload.vehicleNumber,
        driverName: payload.driverName ?? '',
        driverPhone: payload.driverPhone ?? '',
        locationLabel: 'Hospital Fleet',
        status: payload.status ?? 'AVAILABLE',
      };
      saveLocalHospitalItems(LOCAL_AMBULANCES_KEY, hospitalId, [...existing, newAmb]);
      return this.getResources(hospitalId);
    },

    async updateAmbulance(hospitalId: HospitalId, id: string, payload: AmbulanceInput): Promise<HospitalResourceSummary> {
      try {
        await httpClient.request(`/hospitals/${encodeURIComponent(hospitalId)}/ambulances/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify({
            vehicle_number: payload.vehicleNumber,
            driver_name: payload.driverName,
            driver_phone: payload.driverPhone,
            status: payload.status,
          }),
        });
        return this.getResources(hospitalId);
      } catch {
        // Fallback to local storage
      }

      const existing = getLocalHospitalItems<Ambulance>(LOCAL_AMBULANCES_KEY, hospitalId);
      const updated = existing.map((a) => (a.id === id ? { ...a, ...payload } : a));
      saveLocalHospitalItems(LOCAL_AMBULANCES_KEY, hospitalId, updated);
      return this.getResources(hospitalId);
    },

    async deleteAmbulance(hospitalId: HospitalId, id: string): Promise<HospitalResourceSummary> {
      try {
        await httpClient.request(`/hospitals/${encodeURIComponent(hospitalId)}/ambulances/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        return this.getResources(hospitalId);
      } catch {
        // Fallback to local storage
      }

      const existing = getLocalHospitalItems<Ambulance>(LOCAL_AMBULANCES_KEY, hospitalId);
      saveLocalHospitalItems(LOCAL_AMBULANCES_KEY, hospitalId, existing.filter((a) => a.id !== id));
      return this.getResources(hospitalId);
    },

    async assignAmbulance(id, _hospitalId, ambulanceId) {
      return httpClient.post<Emergency>(`/sos/${encodeURIComponent(id)}/ambulance-assignment`, { ambulance_id: ambulanceId });
    },

    async assignDoctor(id, _hospitalId, doctorId) {
      return httpClient.post<Emergency>(`/sos/${encodeURIComponent(id)}/doctor-assignment`, { doctor_id: doctorId });
    },
  },

  demo: {
    async reset() {
      throw new Error('Demo reset is available only when VITE_DATA_MODE=mock.');
    },
  },
};
