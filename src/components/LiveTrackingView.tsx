import React, { useState, useEffect, useRef } from 'react';
import { AppDatabase, Employee, LiveLocation, RouteHistory } from '../types';
import Icon from './Icon';
import L from 'leaflet';
import { getDistanceMeters } from '../db';

interface LiveTrackingViewProps {
  db: AppDatabase;
  lang: 'en' | 'hi';
}

export interface TrackedStop {
  lat: number;
  lng: number;
  durationMin: number;
  startTime: string;
  endTime: string;
}

export function detectRouteStops(path: { lat: number; lng: number; timestamp: string }[]): TrackedStop[] {
  const stops: TrackedStop[] = [];
  if (path.length < 2) return stops;

  let startNodeIdx = 0;
  for (let i = 1; i < path.length; i++) {
    const startNode = path[startNodeIdx];
    const currentNode = path[i];
    const distance = getDistanceMeters(startNode.lat, startNode.lng, currentNode.lat, currentNode.lng);
    if (distance > 15) {
      const durationMs = new Date(path[i-1].timestamp).getTime() - new Date(startNode.timestamp).getTime();
      const durationMin = durationMs / (1000 * 60);
      if (durationMin >= 5) {
        stops.push({
          lat: startNode.lat,
          lng: startNode.lng,
          durationMin: Math.round(durationMin),
          startTime: startNode.timestamp,
          endTime: path[i-1].timestamp
        });
      }
      startNodeIdx = i;
    }
  }

  const lastIdx = path.length - 1;
  const startNode = path[startNodeIdx];
  const lastNode = path[lastIdx];
  const durationMs = new Date(lastNode.timestamp).getTime() - new Date(startNode.timestamp).getTime();
  const durationMin = durationMs / (1000 * 60);
  if (durationMin >= 5) {
    stops.push({
      lat: startNode.lat,
      lng: startNode.lng,
      durationMin: Math.round(durationMin),
      startTime: startNode.timestamp,
      endTime: lastNode.timestamp
    });
  }

  return stops;
}

export default function LiveTrackingView({ db, lang }: LiveTrackingViewProps) {
  const t = (en: string, hi: string) => (lang === 'en' ? en : hi);

  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null);
  const [replayDate, setReplayDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [activeReplay, setActiveReplay] = useState<RouteHistory | null>(null);
  const [sliderIndex, setSliderIndex] = useState<number>(0);
  const [showSidebar, setShowSidebar] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const routeLineRef = useRef<L.Polyline | null>(null);
  const routeMarkersRef = useRef<L.Marker[]>([]);
  const sliderMarkerRef = useRef<L.Marker | null>(null);

  const pastDates = Array.from({ length: 5 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return d.toISOString().split('T')[0];
  });

  // Initialize map
  useEffect(() => {
    if (mapContainerRef.current && !mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([26.9124, 75.7873], 13);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(mapRef.current);
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Invalidate map size when sidebar toggles or fullscreen changes (critical for Leaflet!)
  useEffect(() => {
    setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 350);
  }, [showSidebar, isFullscreen]);

  // Sync Live Location markers
  useEffect(() => {
    if (!mapRef.current) return;

    const liveLocs = db.liveLocations || {};
    const employees = db.employees || [];

    markersRef.current.forEach((marker, empId) => {
      if (!liveLocs[empId]) {
        marker.remove();
        markersRef.current.delete(empId);
      }
    });

    Object.keys(liveLocs).forEach(empId => {
      const loc = liveLocs[empId];
      const emp = employees.find(e => e.id === empId);
      if (!emp) return;

      const isRecent = Date.now() - new Date(loc.timestamp).getTime() < 300000;
      const lastSeenStr = new Date(loc.timestamp).toLocaleTimeString();

      const todayDateStr = new Date().toISOString().split('T')[0];
      const attRecord = db.attendance[`${emp.id}_${todayDateStr}`];
      let todayHours = 0;
      let lastPunchStr = t('No punches today', 'आज कोई पंच नहीं');
      if (attRecord && attRecord.sessions) {
        attRecord.sessions.forEach(s => {
          const inTime = new Date(`${todayDateStr}T${s.in}`);
          const outTime = s.out ? new Date(`${todayDateStr}T${s.out}`) : new Date();
          const diffMs = outTime.getTime() - inTime.getTime();
          if (diffMs > 0) todayHours += diffMs / (1000 * 60 * 60);
        });
        const lastSession = attRecord.sessions[attRecord.sessions.length - 1];
        lastPunchStr = lastSession.out
          ? `${t('Out', 'बाहर')} @ ${lastSession.out}`
          : `${t('In', 'अंदर')} @ ${lastSession.in}`;
      }

      const assignedFence = db.geofences?.find(g => g.assignedStaff && g.assignedStaff.includes(emp.id));
      let fenceDistStr = t('No GeoFence', 'कोई जियोफेंस नहीं');
      if (assignedFence) {
        const distance = getDistanceMeters(assignedFence.lat, assignedFence.lng, loc.lat, loc.lng);
        const inside = distance <= assignedFence.radius;
        fenceDistStr = `${Math.round(distance)}m ${inside ? '✅' : '⚠️'}`;
      }

      const isWorking = attRecord && attRecord.sessions?.some(s => !s.out);

      const popupHtml = `
        <div style="font-family:system-ui,sans-serif;font-size:12px;min-width:200px;max-width:240px">
          <div style="display:flex;align-items:center;gap:8px;padding-bottom:8px;margin-bottom:8px;border-bottom:1px solid #e2e8f0">
            ${emp.pic ? `<img src="${emp.pic}" style="width:36px;height:36px;border-radius:50%;object-fit:cover" />` : `<div style="width:36px;height:36px;background:#eff6ff;color:#3b82f6;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px">${emp.name.charAt(0)}</div>`}
            <div>
              <div style="font-weight:800;color:#1e293b;font-size:13px">${emp.name}</div>
              <div style="font-size:9px;color:#94a3b8;font-weight:600;text-transform:uppercase">${emp.id}</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:10px;color:#475569">
            <div><strong style="color:#334155">${t('Status','स्थिति')}:</strong><br/><span style="background:${isWorking?'#f0fdf4':'#f8fafc'};color:${isWorking?'#16a34a':'#64748b'};padding:1px 6px;border-radius:4px;font-weight:700">${isWorking ? t('Working','कार्यरत') : t('Offline','ऑफलाइन')}</span></div>
            <div><strong style="color:#334155">${t('Battery','बैटरी')}:</strong><br/>${loc.battery ?? '—'}%</div>
            <div><strong style="color:#334155">${t('Hours','घंटे')}:</strong><br/>${todayHours.toFixed(1)} hrs</div>
            <div><strong style="color:#334155">${t('Accuracy','सटीकता')}:</strong><br/>${loc.accuracy?.toFixed(0)}m</div>
            <div style="grid-column:span 2"><strong style="color:#334155">${t('Last Punch','अंतिम पंच')}:</strong> ${lastPunchStr}</div>
            <div style="grid-column:span 2"><strong style="color:#334155">${t('Fence','जियोफेंस')}:</strong> ${fenceDistStr}</div>
            <div style="grid-column:span 2;font-size:9px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:4px;margin-top:2px">${loc.address || '—'} · ${lastSeenStr}</div>
          </div>
        </div>
      `;

      const iconHtml = `
        <div style="position:relative">
          <div style="width:36px;height:36px;border-radius:50%;border:3px solid ${isRecent ? '#22c55e' : '#64748b'};overflow:hidden;background:#e2e8f0;box-shadow:0 2px 8px rgba(0,0,0,0.2)">
            ${emp.pic ? `<img src="${emp.pic}" style="width:100%;height:100%;object-fit:cover"/>` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-weight:700;color:#475569;font-size:14px">${emp.name.charAt(0)}</div>`}
          </div>
          <div style="position:absolute;bottom:-2px;right:-2px;width:12px;height:12px;border-radius:50%;background:${isRecent ? '#22c55e' : '#64748b'};border:2px solid white"></div>
        </div>
      `;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: '',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -20],
      });

      const marker = markersRef.current.get(empId);
      if (marker) {
        marker.setLatLng([loc.lat, loc.lng]);
        marker.setIcon(customIcon);
        marker.setPopupContent(popupHtml);
      } else {
        const newMarker = L.marker([loc.lat, loc.lng], { icon: customIcon }).addTo(mapRef.current!);
        newMarker.bindPopup(popupHtml, { maxWidth: 260, minWidth: 200 });
        markersRef.current.set(empId, newMarker);
      }
    });

    if (Object.keys(liveLocs).length > 0 && !activeReplay) {
      let boundsToFit: L.LatLngBounds;
      
      if (selectedEmpId && liveLocs[selectedEmpId]) {
        // If an employee is selected, focus on them
        const loc = liveLocs[selectedEmpId];
        boundsToFit = L.latLngBounds([[loc.lat, loc.lng]]);
      } else {
        // Otherwise fit all live locations
        boundsToFit = L.latLngBounds(
          Object.values(liveLocs).map(loc => [loc.lat, loc.lng])
        );
      }
      
      if (boundsToFit.isValid()) {
        mapRef.current.fitBounds(boundsToFit, { padding: [50, 50], maxZoom: 16 });
      }
    }
  }, [db.liveLocations, db.employees, lang, selectedEmpId, activeReplay]);

  // Handle Route Replay Drawing
  useEffect(() => {
    if (!mapRef.current) return;

    if (routeLineRef.current) { routeLineRef.current.remove(); routeLineRef.current = null; }
    routeMarkersRef.current.forEach(m => m.remove());
    routeMarkersRef.current = [];
    if (sliderMarkerRef.current) { sliderMarkerRef.current.remove(); sliderMarkerRef.current = null; }
    setSliderIndex(0);

    if (!selectedEmpId || !replayDate) { setActiveReplay(null); return; }

    const route = (db.routeHistories || []).find(r => r.employeeId === selectedEmpId && r.date === replayDate);
    if (!route || !route.path || route.path.length === 0) { setActiveReplay(null); return; }

    setActiveReplay(route);

    const coords: [number, number][] = route.path.map(p => [p.lat, p.lng]);
    routeLineRef.current = L.polyline(coords, { color: '#4f46e5', weight: 5, opacity: 0.8 }).addTo(mapRef.current);
    mapRef.current.fitBounds(L.latLngBounds(coords), { padding: [40, 40] });

    const startMarker = L.circleMarker([route.path[0].lat, route.path[0].lng], { radius: 8, fillColor: '#10b981', color: '#fff', weight: 2, fillOpacity: 0.9 }).addTo(mapRef.current);
    startMarker.bindPopup(`<strong>Start:</strong> ${new Date(route.path[0].timestamp).toLocaleTimeString()}`);
    routeMarkersRef.current.push(startMarker);

    if (coords.length > 1) {
      const endPoint = route.path[route.path.length - 1];
      const endMarker = L.circleMarker([endPoint.lat, endPoint.lng], { radius: 8, fillColor: '#ef4444', color: '#fff', weight: 2, fillOpacity: 0.9 }).addTo(mapRef.current);
      endMarker.bindPopup(`<strong>End:</strong> ${new Date(endPoint.timestamp).toLocaleTimeString()}`);
      routeMarkersRef.current.push(endMarker);
    }

    detectRouteStops(route.path).forEach(stop => {
      const stopMarker = L.circleMarker([stop.lat, stop.lng], { radius: 7, fillColor: '#f59e0b', color: '#fff', weight: 1.5, fillOpacity: 0.9 }).addTo(mapRef.current!);
      stopMarker.bindPopup(`<strong>Stop:</strong> ${stop.durationMin} min<br/>${new Date(stop.startTime).toLocaleTimeString()} – ${new Date(stop.endTime).toLocaleTimeString()}`);
      routeMarkersRef.current.push(stopMarker);
    });
  }, [selectedEmpId, replayDate, db.routeHistories]);

  // Slider marker
  useEffect(() => {
    if (!mapRef.current || !activeReplay?.path?.length) return;
    const idx = Math.min(sliderIndex, activeReplay.path.length - 1);
    const node = activeReplay.path[idx];
    if (sliderMarkerRef.current) {
      sliderMarkerRef.current.setLatLng([node.lat, node.lng]);
    } else {
      sliderMarkerRef.current = L.marker([node.lat, node.lng]).addTo(mapRef.current);
    }
    sliderMarkerRef.current.bindPopup(`<strong>${idx + 1}/${activeReplay.path.length}</strong><br/>${new Date(node.timestamp).toLocaleTimeString()}`).openPopup();
  }, [sliderIndex, activeReplay]);

  // Stats
  let totalDistanceKm = '0.00';
  let totalTravelHrs = '0.00';
  let stopsCount = 0;
  if (activeReplay?.path?.length) {
    let dist = 0;
    for (let i = 1; i < activeReplay.path.length; i++) {
      dist += getDistanceMeters(activeReplay.path[i-1].lat, activeReplay.path[i-1].lng, activeReplay.path[i].lat, activeReplay.path[i].lng);
    }
    totalDistanceKm = (dist / 1000).toFixed(2);
    const st = new Date(activeReplay.path[0].timestamp).getTime();
    const et = new Date(activeReplay.path[activeReplay.path.length - 1].timestamp).getTime();
    totalTravelHrs = ((et - st) / (1000 * 60 * 60)).toFixed(2);
    stopsCount = detectRouteStops(activeReplay.path).length;
  }

  const activeEmployee = db.employees.find(e => e.id === selectedEmpId);

  return (
    <div className={`flex flex-col h-[calc(100vh-120px)] md:h-[78vh] gap-3 ${isFullscreen ? 'fixed inset-0 z-50 bg-white p-2 h-screen' : ''}`}>
      
      {/* Mobile toolbar */}
      <div className="flex items-center justify-between gap-2 md:hidden">
        <button
          onClick={() => setShowSidebar(!showSidebar)}
          className="flex items-center gap-1.5 px-3 h-9 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 cursor-pointer shadow-xs"
        >
          <Icon name={showSidebar ? 'close' : 'people'} size={16} />
          {showSidebar ? t('Hide List', 'सूची बंद') : t('Staff List', 'कर्मचारी')}
        </button>
        <span className="text-xs font-bold text-slate-500">
          {Object.keys(db.liveLocations || {}).length} {t('online', 'ऑनलाइन')}
        </span>
        <button
          onClick={() => setIsFullscreen(!isFullscreen)}
          className="flex items-center gap-1.5 px-3 h-9 bg-blue-600 text-white rounded-xl text-xs font-bold cursor-pointer shadow-xs"
        >
          <Icon name={isFullscreen ? 'fullscreen_exit' : 'fullscreen'} size={16} />
          {isFullscreen ? t('Exit', 'बाहर') : t('Full Map', 'पूरा मानचित्र')}
        </button>
      </div>

      <div className="flex flex-1 gap-3 overflow-hidden">
        {/* Sidebar */}
        {(showSidebar || window.innerWidth >= 768) && (
          <div className="w-full md:w-72 lg:w-64 bg-white border border-slate-150 p-3 rounded-2xl shadow-xs flex flex-col gap-3 overflow-y-auto shrink-0 md:block">
            <div>
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">{t('Live Staff', 'लाइव कर्मचारी')}</h3>
              <p className="text-[9px] font-semibold text-slate-400 mt-0.5">{t('Tap to view replay', 'रिप्ले के लिए टैप करें')}</p>
            </div>

            <div className="space-y-1.5 flex-1">
              {db.employees.map(emp => {
                const loc = db.liveLocations?.[emp.id];
                const isOnline = loc ? (Date.now() - new Date(loc.timestamp).getTime() < 300000) : false;
                const isSelected = selectedEmpId === emp.id;
                return (
                  <div
                    key={emp.id}
                    onClick={() => {
                      setSelectedEmpId(isSelected ? null : emp.id);
                      if (window.innerWidth < 768) setShowSidebar(false);
                    }}
                    className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                      isSelected ? 'border-blue-500 bg-blue-50' : 'border-slate-100 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="relative shrink-0">
                        {emp.pic ? (
                          <img src={emp.pic} alt={emp.name} className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-xs">
                            {emp.name.charAt(0)}
                          </div>
                        )}
                        <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${isOnline ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-black text-slate-800 truncate">{emp.name}</div>
                        <div className="text-[9px] text-slate-400 font-bold">{emp.type}</div>
                      </div>
                    </div>
                    <Icon name={isSelected ? 'radio_button_checked' : 'chevron_right'} size={14} className="text-slate-400 shrink-0" />
                  </div>
                );
              })}
            </div>

            {/* Replay controller */}
            {selectedEmpId && activeEmployee && (
              <div className="border-t border-slate-100 pt-3 space-y-2">
                <div className="text-[9px] font-black text-slate-500 uppercase tracking-wider">⏱ {t('Route Replay', 'रूट रिप्ले')}</div>
                <select
                  value={replayDate}
                  onChange={e => setReplayDate(e.target.value)}
                  className="w-full h-8 border border-slate-200 rounded-lg px-2 text-[10px] font-semibold bg-white outline-none"
                >
                  {pastDates.map(d => <option key={d} value={d}>{d}</option>)}
                </select>

                {activeReplay ? (
                  <div className="space-y-2">
                    <div className="text-[9px] text-slate-600 bg-blue-50 border border-blue-100 p-2 rounded-xl space-y-1">
                      <div className="font-bold border-b pb-1 border-blue-200 uppercase text-[8px]">{t('Stats', 'आंकड़े')}</div>
                      <div>📏 {totalDistanceKm} km · ⏳ {totalTravelHrs} hrs</div>
                      <div>🛑 {stopsCount} {t('stops', 'स्टॉप')} · 🗺 {activeReplay.path.length} {t('nodes', 'नोड्स')}</div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-[9px] font-black text-slate-400 uppercase">
                        <span>{t('Timeline', 'टाइमलाइन')}</span>
                        <span>{sliderIndex + 1}/{activeReplay.path.length}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max={activeReplay.path.length - 1}
                        value={sliderIndex}
                        onChange={e => setSliderIndex(parseInt(e.target.value))}
                        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        style={{ touchAction: 'none' }}
                      />
                      <div className="text-[8px] text-slate-400 font-bold text-center">
                        {new Date(activeReplay.path[sliderIndex]?.timestamp || '').toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-[9px] text-slate-400 italic">{t('No history for this date.', 'इस तारीख के लिए कोई इतिहास नहीं।')}</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Map Container */}
        <div className="flex-1 bg-white border border-slate-150 rounded-2xl shadow-xs relative overflow-hidden min-h-0">
          {selectedEmpId && activeEmployee && (
            <div className="absolute top-3 left-3 z-20 bg-white/95 backdrop-blur-xs border border-slate-200 px-3 py-2 rounded-xl shadow-md flex items-center gap-2 max-w-[90%]">
              <div className="text-[10px] font-semibold text-slate-700 truncate">
                <span className="font-black text-slate-800">{activeEmployee.name}</span> · {replayDate}
              </div>
              <button
                onClick={() => setSelectedEmpId(null)}
                className="text-[9px] font-black text-rose-600 cursor-pointer shrink-0"
              >
                ✕
              </button>
            </div>
          )}
          
          {/* Desktop fullscreen button */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="hidden md:flex absolute top-3 right-3 z-20 w-8 h-8 bg-white border border-slate-200 rounded-lg items-center justify-center cursor-pointer shadow-xs hover:bg-slate-50"
            title="Toggle fullscreen"
          >
            <Icon name={isFullscreen ? 'fullscreen_exit' : 'fullscreen'} size={16} className="text-slate-600" />
          </button>

          <div ref={mapContainerRef} className="w-full h-full" />
        </div>
      </div>
    </div>
  );
}
