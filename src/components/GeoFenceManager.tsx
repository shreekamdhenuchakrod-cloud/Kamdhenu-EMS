import React, { useState, useEffect, useRef } from 'react';
import { AppDatabase, GeoFence, Employee } from '../types';
import Icon from './Icon';
import L from 'leaflet';

interface GeoFenceManagerProps {
  db: AppDatabase;
  onUpdateDb: (updatedDb: AppDatabase) => void;
  lang: 'en' | 'hi';
}

export default function GeoFenceManager({ db, onUpdateDb, lang }: GeoFenceManagerProps) {
  const t = (en: string, hi: string) => (lang === 'en' ? en : hi);

  const [geofences, setGeofences] = useState<GeoFence[]>(db.geofences || []);
  const [editingGeofence, setEditingGeofence] = useState<Partial<GeoFence> | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>([26.9124, 75.7873]); // Default Jaipur, Rajasthan

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    setGeofences(db.geofences || []);
  }, [db.geofences]);

  useEffect(() => {
    // If Map container is available, initialize Leaflet Map
    if (mapContainerRef.current && !mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current).setView(mapCenter, 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(mapRef.current);

      mapRef.current.on('click', (e: L.LeafletMouseEvent) => {
        if (editingGeofence) {
          const { lat, lng } = e.latlng;
          setEditingGeofence(prev => prev ? { ...prev, lat, lng } : null);
        }
      });
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [editingGeofence !== null]);

  // Update Map Marker and Circle whenever coordinates or radius change
  useEffect(() => {
    if (!mapRef.current || !editingGeofence || editingGeofence.lat === undefined || editingGeofence.lng === undefined) return;

    const lat = editingGeofence.lat;
    const lng = editingGeofence.lng;
    const radius = editingGeofence.radius || 100;

    mapRef.current.setView([lat, lng], 16);

    // Marker
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      markerRef.current = L.marker([lat, lng]).addTo(mapRef.current);
    }

    // Radius circle overlay
    if (circleRef.current) {
      circleRef.current.setLatLng([lat, lng]);
      circleRef.current.setRadius(radius);
    } else {
      circleRef.current = L.circle([lat, lng], {
        radius,
        color: '#2563eb',
        fillColor: '#93c5fd',
        fillOpacity: 0.3
      }).addTo(mapRef.current);
    }
  }, [editingGeofence?.lat, editingGeofence?.lng, editingGeofence?.radius]);

  const handleCreateNew = () => {
    setEditingGeofence({
      id: `GEOFENCE_${Date.now()}`,
      name: '',
      lat: mapCenter[0],
      lng: mapCenter[1],
      radius: 100,
      assignedStaff: [],
      activeHours: { start: '09:00', end: '18:00' },
      weekdays: [1, 2, 3, 4, 5, 6] // Mon-Sat
    });
  };

  const handleSave = () => {
    if (!editingGeofence || !editingGeofence.name?.trim()) {
      alert(t('Name is required!', 'नाम दर्ज करना आवश्यक है!'));
      return;
    }

    const updatedList = [...geofences];
    const index = updatedList.findIndex(g => g.id === editingGeofence.id);
    
    if (index > -1) {
      updatedList[index] = editingGeofence as GeoFence;
    } else {
      updatedList.push(editingGeofence as GeoFence);
    }

    onUpdateDb({ ...db, geofences: updatedList });
    setEditingGeofence(null);
    markerRef.current = null;
    circleRef.current = null;
  };

  const handleDelete = (id: string) => {
    if (!window.confirm(t('Are you sure you want to delete this GeoFence?', 'क्या आप इस जियोफेंस को हटाना चाहते हैं?'))) return;
    const updated = geofences.filter(g => g.id !== id);
    onUpdateDb({ ...db, geofences: updated });
  };

  const toggleStaffAssignment = (empId: string) => {
    if (!editingGeofence) return;
    const current = editingGeofence.assignedStaff || [];
    const updated = current.includes(empId)
      ? current.filter(id => id !== empId)
      : [...current, empId];
    
    setEditingGeofence({ ...editingGeofence, assignedStaff: updated });
  };

  return (
    <div className="w-full space-y-4">
      <div className="flex justify-between items-center bg-white border border-slate-100 p-4 rounded-2xl shadow-2xs">
        <div>
          <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">{t('GeoFence Management', 'जियोफेंस प्रबंधन')}</h2>
          <p className="text-[10px] text-slate-450 font-semibold">{t('Create geofences to restrict employee Punch In/Out options.', 'कर्मचारियों के पंच इन/आउट को सीमित करने के लिए जियोफेंस बनाएं।')}</p>
        </div>
        {!editingGeofence && (
          <button
            onClick={handleCreateNew}
            className="h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm shadow-blue-500/10 cursor-pointer"
          >
            <Icon name="add" size={14} />
            <span>{t('Add GeoFence', 'जियोफेंस जोड़ें')}</span>
          </button>
        )}
      </div>

      {editingGeofence ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Settings Side */}
          <div className="bg-white border border-slate-150 p-5 rounded-2xl shadow-2xs space-y-4">
            <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">{t('GeoFence Details', 'जियोफेंस विवरण')}</h3>

            <div className="fld">
              <label>{t('GeoFence Name', 'जियोफेंस का नाम')}</label>
              <input
                type="text"
                value={editingGeofence.name || ''}
                onChange={e => setEditingGeofence({ ...editingGeofence, name: e.target.value })}
                className="fi"
                placeholder={t('E.g. Head Office', 'जैसे: मुख्य कार्यालय')}
              />
            </div>

            {/* Coordinates Fields Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="fld">
                <label>{t('Latitude', 'अक्षांश (Latitude)')}</label>
                <input
                  type="number"
                  step="any"
                  value={editingGeofence.lat === undefined ? '' : editingGeofence.lat}
                  onChange={e => {
                    const val = parseFloat(e.target.value);
                    setEditingGeofence(prev => prev ? { ...prev, lat: isNaN(val) ? 0 : val } : null);
                  }}
                  className="fi"
                  placeholder="e.g. 26.9124"
                />
              </div>
              <div className="fld">
                <label>{t('Longitude', 'देशांतर (Longitude)')}</label>
                <input
                  type="number"
                  step="any"
                  value={editingGeofence.lng === undefined ? '' : editingGeofence.lng}
                  onChange={e => {
                    const val = parseFloat(e.target.value);
                    setEditingGeofence(prev => prev ? { ...prev, lng: isNaN(val) ? 0 : val } : null);
                  }}
                  className="fi"
                  placeholder="e.g. 75.7873"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="fld">
                <label>{t('Radius (Meters)', 'त्रिज्या (मीटर)')}</label>
                <input
                  type="number"
                  value={editingGeofence.radius || ''}
                  onChange={e => {
                    const val = parseInt(e.target.value, 10);
                    setEditingGeofence(prev => prev ? { ...prev, radius: isNaN(val) ? 0 : val } : null);
                  }}
                  className="fi"
                  min="1"
                  placeholder="e.g. 100"
                />
              </div>
              <div className="fld">
                <label>{t('Work Hours', 'कार्य समय')}</label>
                <div className="flex gap-1 items-center">
                  <input
                    type="time"
                    value={editingGeofence.activeHours?.start || '09:00'}
                    onChange={e => setEditingGeofence({
                      ...editingGeofence,
                      activeHours: { start: e.target.value, end: editingGeofence.activeHours?.end || '18:00' }
                    })}
                    className="fi text-xs h-9 px-2"
                  />
                  <span className="text-slate-400 font-bold">-</span>
                  <input
                    type="time"
                    value={editingGeofence.activeHours?.end || '18:00'}
                    onChange={e => setEditingGeofence({
                      ...editingGeofence,
                      activeHours: { start: editingGeofence.activeHours?.start || '09:00', end: e.target.value }
                    })}
                    className="fi text-xs h-9 px-2"
                  />
                </div>
              </div>
            </div>

            {/* Assigned Staff Checklist */}
            <div className="fld">
              <label>{t('Assign Employees', 'कर्मचारी सौंपें')}</label>
              <div className="max-h-[140px] overflow-y-auto border border-slate-100 rounded-xl p-3 space-y-2 bg-slate-50">
                {db.employees.map(emp => {
                  const isChecked = editingGeofence.assignedStaff?.includes(emp.id) || false;
                  return (
                    <div 
                      key={emp.id}
                      onClick={() => toggleStaffAssignment(emp.id)}
                      className="flex items-center gap-2.5 cursor-pointer py-0.5"
                    >
                      <div className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all ${
                        isChecked ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'
                      }`}>
                        {isChecked && <Icon name="check" size={10} className="text-white font-black" />}
                      </div>
                      <span className="text-xs font-semibold text-slate-700">{emp.name} ({emp.id})</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  setEditingGeofence(null);
                  markerRef.current = null;
                  circleRef.current = null;
                }}
                className="flex-1 h-11 border border-slate-250 bg-white text-slate-650 rounded-xl text-xs font-bold cursor-pointer hover:bg-slate-50"
              >
                {t('Cancel', 'रद्द करें')}
              </button>
              <button
                onClick={handleSave}
                className="flex-1 h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold cursor-pointer shadow-sm shadow-blue-500/10"
              >
                {t('Save GeoFence', 'सहेजें')}
              </button>
            </div>
          </div>

          {/* Map Side */}
          <div className="bg-white border border-slate-150 p-4 rounded-2xl shadow-2xs space-y-2 min-h-[360px] flex flex-col">
            <div className="flex justify-between items-center text-[10px] text-slate-450 font-bold uppercase tracking-wider">
              <span>{t('Click Map to Set Coordinates', 'समन्वय सेट करने के लिए मानचित्र पर क्लिक करें')}</span>
              <span className="font-mono text-slate-600">
                {editingGeofence.lat?.toFixed(5)}, {editingGeofence.lng?.toFixed(5)}
              </span>
            </div>
            <div 
              ref={mapContainerRef} 
              className="w-full flex-1 rounded-xl overflow-hidden border border-slate-100 z-10" 
              style={{ minHeight: '320px' }}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {geofences.map(g => (
            <div key={g.id} className="bg-white border border-slate-100 p-4 rounded-2xl shadow-3xs space-y-3 relative hover:border-slate-350 transition-all">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="text-xs font-black text-slate-800">{g.name}</h4>
                  <p className="text-[10px] text-slate-450 font-bold font-mono">{g.lat.toFixed(5)} · {g.lng.toFixed(5)}</p>
                </div>
                <span className="bg-blue-50 text-blue-700 border border-blue-100 text-[9px] font-black px-2 py-0.5 rounded-full">
                  {g.radius}m Radius
                </span>
              </div>

              <div className="text-[10px] text-slate-650 font-semibold space-y-1 bg-slate-50/50 p-2.5 rounded-xl border border-slate-100/50">
                <div>🕒 {t('Working Time', 'कार्य समय')}: {g.activeHours?.start} - {g.activeHours?.end}</div>
                <div>👥 {t('Assigned Staff', 'सौंपे गए कर्मचारी')}: {g.assignedStaff?.length || 0}</div>
              </div>

              <div className="flex gap-2 pt-1 border-t border-slate-50">
                <button
                  onClick={() => setEditingGeofence(g)}
                  className="flex-1 h-8 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-[10px] font-bold cursor-pointer hover:bg-slate-100 flex items-center justify-center gap-1"
                >
                  <Icon name="edit" size={12} />
                  <span>{t('Edit', 'संपादित करें')}</span>
                </button>
                <button
                  onClick={() => handleDelete(g.id)}
                  className="flex-1 h-8 rounded-lg bg-rose-50 border border-rose-100 text-rose-600 text-[10px] font-bold cursor-pointer hover:bg-rose-100 flex items-center justify-center gap-1"
                >
                  <Icon name="delete" size={12} />
                  <span>{t('Delete', 'हटाएं')}</span>
                </button>
              </div>
            </div>
          ))}

          {geofences.length === 0 && (
            <div className="col-span-full bg-white border border-dashed border-slate-250 py-12 rounded-2xl flex flex-col items-center justify-center text-slate-400 font-medium text-xs">
              <Icon name="map" size={32} className="text-slate-300 mb-2" />
              <span>{t('No geofences configured yet.', 'अभी तक कोई जियोफेंस कॉन्फ़िगर नहीं किया गया है।')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
