import { Ambulance as AmbulanceIcon, Stethoscope, UserRound } from 'lucide-react';
import type { Ambulance, Doctor, Emergency } from '../../types';

export function AssignmentPanel({ emergency, ambulances, doctors, ambulanceId, doctorId, onAmbulanceChange, onDoctorChange, onAssignAmbulance, onAssignDoctor, busy }: {
  emergency: Emergency;
  ambulances: Ambulance[];
  doctors: Doctor[];
  ambulanceId: string;
  doctorId: string;
  onAmbulanceChange: (id: string) => void;
  onDoctorChange: (id: string) => void;
  onAssignAmbulance: () => void;
  onAssignDoctor: () => void;
  busy: boolean;
}) {
  return <section className="assignment-grid">
    <article className="assignment-card assignment-card--ambulance">
      <div className="assignment-icon"><AmbulanceIcon size={20} /></div>
      <div><span className="eyebrow">Transport</span><h3>{emergency.assignedAmbulance ? emergency.assignedAmbulance.vehicleNumber : 'Assign ambulance'}</h3></div>
      {emergency.assignedAmbulance ? <div className="assignment-summary"><strong>{emergency.assignedAmbulance.driverName}</strong><span>{emergency.assignedAmbulance.registrationNumber} · {emergency.assignedAmbulance.locationLabel}</span><span className="status-dot">{emergency.assignedAmbulance.status.replaceAll('_', ' ')}</span></div> : <><select aria-label="Available ambulances" value={ambulanceId} onChange={(e) => onAmbulanceChange(e.target.value)}><option value="">Choose available ambulance</option>{ambulances.filter((item) => item.status === 'AVAILABLE').map((item) => <option key={item.id} value={item.id}>{item.vehicleNumber} · {item.driverName}</option>)}</select><button className="button button--primary" disabled={!ambulanceId || busy} onClick={onAssignAmbulance}>Assign ambulance</button></>}
    </article>

    <article className="assignment-card assignment-card--doctor">
      <div className="assignment-icon"><Stethoscope size={20} /></div>
      <div><span className="eyebrow">Clinical handoff</span><h3>{emergency.assignedDoctor ? emergency.assignedDoctor.name : 'Assign doctor'}</h3></div>
      {emergency.assignedDoctor ? <div className="assignment-summary"><strong>{emergency.assignedDoctor.specialization}</strong><span>Preparing for patient arrival</span><span className="status-dot">Assigned</span></div> : <><select aria-label="Available doctors" value={doctorId} onChange={(e) => onDoctorChange(e.target.value)}><option value="">Choose available doctor</option>{doctors.filter((item) => item.status === 'AVAILABLE').map((item) => <option key={item.id} value={item.id}>{item.name} · {item.specialization}</option>)}</select><button className="button button--soft" disabled={!doctorId || busy} onClick={onAssignDoctor}><UserRound size={16} /> Assign doctor</button></>}
    </article>
  </section>;
}
