import React, { useState, useEffect, useRef } from 'react';
import { AppDatabase, Employee, LiveLocation, RouteHistory } from '../types';
import Icon from './Icon';
import L from 'leaflet';

interface LiveTrackingViewProps {
  db: AppDatabase;
  lang: 'en' | 'hi';
}

export default function LiveTrackingView({ db, lang }: LiveTrackingViewProps) {
  const t = (en: string, hi: string) => (lang === 'en' ? en : hi);

  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null);
  const [replayDate, setReplayDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [activeReplay, setActiveReplay] = useState<RouteHistory | null>(null);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const routeLineRef = useRef<L.Polyline | null>(null);
  const routeMarkersRef = useRef<L.Marker[]>([]);

  // Calculate past 5 days for replay selector dropdown
  const pastDates = Array.from({ length: 5 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return d.toISOString().split('T')[0];
  });

  useEffect(() => {
    // Initialize Map
    if (mapContainerRef.current && !mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current).setView([26.9124, 75.7873], 13); // Default Jaipur
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(mapRef.current);
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Sync Live Location markers
  useEffect(() => {
    if (!mapRef.current) return;

    const liveLocs = db.liveLocations || {};
    const employees = db.employees || [];

    // Clear removed markers
    markersRef.current.forEach((marker, empId) => {
      if (!liveLocs[empId]) {
        marker.remove();
        markersRef.current.delete(empId);
      }
    });

    // Draw/Update markers
    Object.keys(liveLocs).forEach(empId => {
      const loc = liveLocs[empId];
      const emp = employees.find(e => e.id === empId);
      if (!emp) return;

      const markerColor = (Date.now() - new Date(loc.timestamp).getTime() < 300000) ? '#22c55e' : '#64748b'; // Green if < 5m, grey otherwise
      const lastSeenStr = new Date(loc.timestamp).toLocaleTimeString();
      const popupHtml = `
        <div class="font-sans text-xs space-y-1 p-0.5">
          <div class="font-black text-slate-800 text-[13px]">${emp.name} (${emp.id})</div>
          <div class="flex items-center gap-1"><span class="w-2 h-2 rounded-full" style="background-color: ${markerColor}"></span> <strong>Last Seen:</strong> ${lastSeenStr}</div>
          <div><strong>Battery:</strong> ${loc.battery}% ${loc.speed > 0 ? '· ' + loc.speed.toFixed(1) + ' km/h' : ''}</div>
          <div><strong>GPS Accuracy:</strong> ${loc.accuracy.toFixed(1)}m</div>
          <div><strong>Status:</strong> ${loc.isMock ? '<span class="text-rose-600 font-bold">MOCK GPS</span>' : '<span class="text-emerald-600 font-semibold">Verified GPS</span>'}</div>
        </div>
      `;

      const marker = markersRef.current.get(empId);
      if (marker) {
        marker.setLatLng([loc.lat, loc.lng]);
        marker.setPopupContent(popupHtml);
      } else {
        const newMarker = L.marker([loc.lat, loc.lng]).addTo(mapRef.current!);
        newMarker.bindPopup(popupHtml);
        markersRef.current.set(empId, newMarker);
      }
    });
  }, [db.liveLocations, db.employees]);

  // Handle Route Replay Drawing
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear old route line and markers
    if (routeLineRef.current) {
      routeLineRef.current.remove();
      routeLineRef.current = null;
    }
    routeMarkersRef.current.forEach(m => m.remove());
    routeMarkersRef.current = [];

    if (!selectedEmpId || !replayDate) {
      setActiveReplay(null);
      return;
    }

    const histories = db.routeHistories || [];
    const route = histories.find(r => r.employeeId === selectedEmpId && r.date === replayDate);

    if (!route || !route.path || route.path.length === 0) {
      setActiveReplay(null);
      return;
    }

    setActiveReplay(route);

    // Draw route path
    const coords: [number, number][] = route.path.map(p => [p.lat, p.lng]);
    routeLineRef.current = L.polyline(coords, {
      color: '#4f46e5',
      weight: 5,
      opacity: 0.8
    }).addTo(mapRef.current);

    // Focus map on route bounds
    const bounds = L.latLngBounds(coords);
    mapRef.current.fitBounds(bounds, { padding: [40, 40] });

    // Draw start marker
    const startPoint = route.path[0];
    const startMarker = L.marker([startPoint.lat, startPoint.lng], {
      title: 'Start Location'
    }).addTo(mapRef.current);
    startMarker.bindPopup(`<strong>Start:</strong> ${new Date(startPoint.timestamp).toLocaleTimeString()}`);
    routeMarkersRef.current.push(startMarker);

    // Draw end marker
    if (route.path.length > 1) {
      const endPoint = route.path[route.path.length - 1];
      const endMarker = L.marker([endPoint.lat, endPoint.lng], {
        title: 'Last Location'
      }).addTo(mapRef.current);
      endMarker.bindPopup(`<strong>End:</strong> ${new Date(endPoint.timestamp).toLocaleTimeString()}`);
      routeMarkersRef.current.push(endMarker);
    }
  }, [selectedEmpId, replayDate, db.routeHistories]);

  const activeEmployee = db.employees.find(e => e.id === selectedEmpId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[78vh]">
      {/* Sidebar - Staff List & Replays Controls */}
      <div className="lg:col-span-1 bg-white border border-slate-150 p-4 rounded-2xl shadow-2xs flex flex-col space-y-4 overflow-y-auto">
        <div>
          <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">{t('Live Staff Directory', 'लाइव कर्मचारी सूची')}</h3>
          <p className="text-[9px] font-semibold text-slate-400 mt-1">{t('Select an employee to view tracking and route replays.', 'ट्रैकिंग और रूट रिप्ले देखने के लिए कर्मचारी चुनें।')}</p>
        </div>

        {/* Staff Directory Selector */}
        <div className="space-y-2 flex-1">
          {db.employees.map(emp => {
            const loc = db.liveLocations?.[emp.id];
            const isOnline = loc ? (Date.now() - new Date(loc.timestamp).getTime() < 300000) : false;
            const isSelected = selectedEmpId === emp.id;

            return (
              <div
                key={emp.id}
                onClick={() => setSelectedEmpId(isSelected ? null : emp.id)}
                className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all hover:bg-slate-50 ${
                  isSelected ? 'border-blue-500 bg-blue-50/20' : 'border-slate-100 bg-white'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="relative">
                    {emp.pic ? (
                      <img src={emp.pic} alt={emp.name} className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-650 flex items-center justify-center font-bold text-xs">
                        {emp.name.charAt(0)}
                      </div>
                    )}
                    <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                      isOnline ? 'bg-emerald-500' : 'bg-slate-400'
                    }`} />
                  </div>
                  <div>
                    <div className="text-xs font-black text-slate-800">{emp.name}</div>
                    <div className="text-[9px] text-slate-450 font-bold uppercase">{emp.type} · {emp.id}</div>
                  </div>
                </div>
                <Icon name={isSelected ? 'radio_button_checked' : 'chevron_right'} size={16} className="text-slate-400" />
              </div>
            );
          })}
        </div>

        {/* Replay controller */}
        {selectedEmpId && activeEmployee && (
          <div className="border-t border-slate-100 pt-3 space-y-3 animate-in fade-in duration-200">
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-wider">⏱ {t('Route Replay Settings', 'रूट रिप्ले सेटिंग्स')}</div>
            <div className="fld">
              <label>{t('Select Date (Past 5 Days)', 'तारीख चुनें')}</label>
              <select
                value={replayDate}
                onChange={e => setReplayDate(e.target.value)}
                className="fi text-xs h-9 px-2"
              >
                {pastDates.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>

            {activeReplay ? (
              <div className="text-[10px] text-slate-600 bg-blue-50/50 border border-blue-100 p-2.5 rounded-xl space-y-1">
                <div>🚶‍♂️ {t('Total Tracked Nodes', 'कुल ट्रैक नोड्स')}: {activeReplay.path.length}</div>
                <div>📍 {t('First Location', 'पहला समय')}: {new Date(activeReplay.path[0].timestamp).toLocaleTimeString()}</div>
                <div>🏁 {t('Last Location', 'अंतिम समय')}: {new Date(activeReplay.path[activeReplay.path.length - 1].timestamp).toLocaleTimeString()}</div>
              </div>
            ) : (
              <div className="text-[10px] text-slate-450 italic">{t('No route history found for this date.', 'इस तारीख के लिए कोई रूट इतिहास नहीं मिला।')}</div>
            )}
          </div>
        )}
      </div>

      {/* Map Container */}
      <div className="lg:col-span-3 bg-white border border-slate-150 p-4 rounded-2xl shadow-2xs relative flex flex-col">
        {selectedEmpId && activeEmployee && (
          <div className="absolute top-6 left-6 z-20 bg-white/95 backdrop-blur-xs border border-slate-200 p-3 rounded-xl shadow-md flex items-center gap-3">
            <div className="text-xs">
              <span className="font-black text-slate-800">{t('Viewing Replay', 'रिप्ले देखें')}</span>: {activeEmployee.name} ({replayDate})
            </div>
            <button
              onClick={() => setSelectedEmpId(null)}
              className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
            >
              ✕ {t('Exit Replay', 'बाहर निकलें')}
            </button>
          </div>
        )}
        <div ref={mapContainerRef} className="w-full flex-1 rounded-xl overflow-hidden border border-slate-100 z-10" />
      </div>
    </div>
  );
}
