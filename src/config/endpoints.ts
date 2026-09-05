// Provisional paths: backend token determines the hospital; no form-supplied owner.
export const endpoints = {
 register: '/auth/hospital/register',
 resources: '/hospital/resources',
 doctors: '/hospital/resources/doctors',
 ambulances: '/hospital/resources/ambulances',
};
export const resourceItemPath = (base: string, id: string) => `${base}/${encodeURIComponent(id)}`;
