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

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const routeLineRef = useRef<L.Polyline | null>(null);
  const routeMarkersRef = useRef<L.Marker[]>([]);
  const sliderMarkerRef = useRef<L.Marker | null>(null);

  // Calculate past 5 days
  const pastDates = Array.from({ length: 5 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return d.toISOString().split('T')[0];
  });

  useEffect(() => {
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

      const markerColor = (Date.now() - new Date(loc.timestamp).getTime() < 300000) ? '#22c55e' : '#64748b';
      const lastSeenStr = new Date(loc.timestamp).toLocaleTimeString();

      // Today hours & last punch calculation
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
          ? `${t('Punched Out', 'बाहर निकले')} @ ${lastSession.out}`
          : `${t('Punched In', 'अंदर आये')} @ ${lastSession.in}`;
      }

      // GeoFence Distance Calculation
      const assignedFence = db.geofences?.find(g => g.assignedStaff && g.assignedStaff.includes(emp.id));
      let fenceDistStr = t('No assigned GeoFence', 'कोई असाइन किया हुआ जियोफेंस नहीं');
      if (assignedFence) {
        const distance = getDistanceMeters(assignedFence.lat, assignedFence.lng, loc.lat, loc.lng);
        fenceDistStr = `${Math.round(distance)}m from ${assignedFence.name}`;
      }

      const isWorking = attRecord && attRecord.sessions?.some(s => !s.out);

      const popupHtml = `
        <div class="font-sans text-xs space-y-1.5 p-1 w-56">
          <div class="flex items-center gap-2 border-b pb-1.5 border-slate-100">
            ${emp.pic ? `<img src="${emp.pic}" class="w-8 h-8 rounded-full object-cover" />` : `<div class="w-8 h-8 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center font-bold">${emp.name.charAt(0)}</div>`}
            <div>
              <div class="font-black text-slate-800 text-[12px] leading-tight">${emp.name}</div>
              <div class="text-[9px] text-slate-400 font-bold uppercase">${emp.id} · ${emp.baseHours} ${t('hrs Shift', 'घंटे पाली')}</div>
            </div>
          </div>
          <div class="space-y-1 text-slate-650">
            <div class="flex items-center justify-between">
              <span><strong>${t('Status', 'स्थिति')}:</strong></span>
              <span class="px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${isWorking ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-slate-50 text-slate-600 border border-slate-200'}">
                ${isWorking ? t('Working', 'कार्यरत') : t('Offline', 'ऑफलाइन')}
              </span>
            </div>
            <div><strong>${t('Last Punch', 'अंतिम पंच')}:</strong> ${lastPunchStr}</div>
            <div><strong>${t('Hours Today', 'आज के घंटे')}:</strong> ${todayHours.toFixed(2)} ${t('hrs', 'घंटे')}</div>
            <div><strong>${t('Battery', 'बैटरी')}:</strong> ${loc.battery}% (${loc.network === 'online' ? 'Online' : 'Offline'})</div>
            <div><strong>${t('Accuracy', 'सटीकता')}:</strong> ${loc.accuracy.toFixed(1)}m · ${loc.speed > 0 ? (loc.speed * 3.6).toFixed(1) + ' km/h' : t('Stationary', 'स्थिर')}</div>
            <div><strong>${t('Fence Distance', 'जियोफेंस दूरी')}:</strong> ${fenceDistStr}</div>
            <div class="text-[9.5px] border-t pt-1 border-slate-100 mt-1 leading-normal">
              <strong>${t('Address', 'पता')}:</strong> <span class="font-sans text-slate-500">${loc.address || t('No address cache', 'कोई पता नहीं')}</span>
            </div>
            <div class="text-[8.5px] text-slate-400 text-right mt-1">${t('Last Seen', 'अंतिम देखा गया')}: ${lastSeenStr}</div>
          </div>
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
  }, [db.liveLocations, db.employees, lang]);

  // Handle Route Replay Drawing
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear old route components
    if (routeLineRef.current) {
      routeLineRef.current.remove();
      routeLineRef.current = null;
    }
    routeMarkersRef.current.forEach(m => m.remove());
    routeMarkersRef.current = [];
    if (sliderMarkerRef.current) {
      sliderMarkerRef.current.remove();
      sliderMarkerRef.current = null;
    }

    setSliderIndex(0);

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

    // Draw route path polyline
    const coords: [number, number][] = route.path.map(p => [p.lat, p.lng]);
    routeLineRef.current = L.polyline(coords, {
      color: '#4f46e5',
      weight: 5,
      opacity: 0.8
    }).addTo(mapRef.current);

    // Focus map on bounds
    const bounds = L.latLngBounds(coords);
    mapRef.current.fitBounds(bounds, { padding: [40, 40] });

    // Draw start marker
    const startPoint = route.path[0];
    const startMarker = L.circleMarker([startPoint.lat, startPoint.lng], {
      radius: 8,
      fillColor: '#10b981',
      color: '#ffffff',
      weight: 2,
      fillOpacity: 0.9
    }).addTo(mapRef.current);
    startMarker.bindPopup(`<strong>Start Replay:</strong> ${new Date(startPoint.timestamp).toLocaleTimeString()}`);
    routeMarkersRef.current.push(startMarker);

    // Draw end marker
    if (coords.length > 1) {
      const endPoint = route.path[route.path.length - 1];
      const endMarker = L.circleMarker([endPoint.lat, endPoint.lng], {
        radius: 8,
        fillColor: '#ef4444',
        color: '#ffffff',
        weight: 2,
        fillOpacity: 0.9
      }).addTo(mapRef.current);
      endMarker.bindPopup(`<strong>Last Track Node:</strong> ${new Date(endPoint.timestamp).toLocaleTimeString()}`);
      routeMarkersRef.current.push(endMarker);
    }

    // Detect and draw route stops
    const stopsList = detectRouteStops(route.path);
    stopsList.forEach(stop => {
      const stopMarker = L.circleMarker([stop.lat, stop.lng], {
        radius: 7,
        fillColor: '#f59e0b', // Amber
        color: '#ffffff',
        weight: 1.5,
        fillOpacity: 0.9
      }).addTo(mapRef.current!);
      stopMarker.bindPopup(`<strong>Stop duration:</strong> ${stop.durationMin} mins<br/><strong>Arrival:</strong> ${new Date(stop.startTime).toLocaleTimeString()}<br/><strong>Departure:</strong> ${new Date(stop.endTime).toLocaleTimeString()}`);
      routeMarkersRef.current.push(stopMarker);
    });

  }, [selectedEmpId, replayDate, db.routeHistories]);

  // Handle slider marker movement
  useEffect(() => {
    if (!mapRef.current || !activeReplay || !activeReplay.path || activeReplay.path.length === 0) return;

    const idx = Math.min(sliderIndex, activeReplay.path.length - 1);
    const node = activeReplay.path[idx];

    if (sliderMarkerRef.current) {
      sliderMarkerRef.current.setLatLng([node.lat, node.lng]);
    } else {
      sliderMarkerRef.current = L.marker([node.lat, node.lng]).addTo(mapRef.current);
    }
    sliderMarkerRef.current.bindPopup(`<strong>Replay Node Index:</strong> ${idx + 1}<br/><strong>Time:</strong> ${new Date(node.timestamp).toLocaleTimeString()}`).openPopup();
  }, [sliderIndex, activeReplay]);

  // Calculations for total statistics
  let totalDistanceKm = '0.00';
  let totalTravelHrs = '0.00';
  let stopsCount = 0;

  if (activeReplay && activeReplay.path && activeReplay.path.length > 0) {
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
                      <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-655 flex items-center justify-center font-bold text-xs">
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
              <div className="space-y-3">
                <div className="text-[10px] text-slate-600 bg-blue-50/50 border border-blue-100 p-2.5 rounded-xl space-y-1.5">
                  <div className="font-bold border-b pb-1 border-blue-200 uppercase tracking-wider text-[8.5px]">{t('Replay Statistics', 'रिप्ले आंकड़े')}</div>
                  <div>🚶‍♂️ {t('Track Nodes', 'ट्रैक नोड्स')}: {activeReplay.path.length}</div>
                  <div>📏 {t('Distance', 'दूरी')}: {totalDistanceKm} km</div>
                  <div>⏳ {t('Travel Time', 'यात्रा समय')}: {totalTravelHrs} hrs</div>
                  <div>🛑 {t('Stops Detected', 'स्टॉप मिले')}: {stopsCount}</div>
                </div>

                {/* Timeline slider control */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[9px] font-black text-slate-450 uppercase">
                    <span>{t('Timeline Slider', 'टाइमलाइन स्लाइडर')}</span>
                    <span>{sliderIndex + 1} / {activeReplay.path.length}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max={activeReplay.path.length - 1}
                    value={sliderIndex}
                    onChange={e => setSliderIndex(parseInt(e.target.value))}
                    className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <div className="text-[8px] text-slate-400 font-bold text-center">
                    {new Date(activeReplay.path[sliderIndex]?.timestamp || '').toLocaleTimeString()}
                  </div>
                </div>
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
            <div className="text-xs font-semibold">
              <span className="font-black text-slate-800">{t('Viewing Replay', 'रिप्ले देखें')}</span>: {activeEmployee.name} ({replayDate})
            </div>
            <button
              onClick={() => setSelectedEmpId(null)}
              className="text-[10px] font-black text-rose-600 hover:underline cursor-pointer flex items-center gap-0.5 uppercase"
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
