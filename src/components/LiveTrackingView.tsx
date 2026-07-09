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

// Robust, high-fidelity stop detection
export function detectRouteStops(path: { lat: number; lng: number; timestamp: string }[]): TrackedStop[] {
  const stops: TrackedStop[] = [];
  if (path.length < 2) return stops;

  let startNodeIdx = 0;
  for (let i = 1; i < path.length; i++) {
    const startNode = path[startNodeIdx];
    const currentNode = path[i];
    const distance = getDistanceMeters(startNode.lat, startNode.lng, currentNode.lat, currentNode.lng);
    
    // If they moved more than 15 meters, check if they were stopped there
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

  // States
  const [sidebarTab, setSidebarTab] = useState<'live' | 'replay'>('live');
  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null);
  const [replayDate, setReplayDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [activeReplay, setActiveReplay] = useState<RouteHistory | null>(null);
  const [sliderIndex, setSliderIndex] = useState<number>(0);
  const [showSidebar, setShowSidebar] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Map Tile Layers & Overlays Style
  const [mapStyle, setMapStyle] = useState<'streets' | 'light' | 'dark'>('light');
  const [showGeofencesOverlay, setShowGeofencesOverlay] = useState<boolean>(true);
  const [showStopsOverlay, setShowStopsOverlay] = useState<boolean>(true);

  // Auto-play animation states
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playSpeed, setPlaySpeed] = useState<number>(2); // 1x, 2x, 5x, 10x, 20x

  // Leaflet references
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const routeLineRef = useRef<L.Polyline | null>(null);
  const routeMarkersRef = useRef<L.Marker[]>([]);
  const sliderMarkerRef = useRef<L.Marker | null>(null);
  const geofencesGroupRef = useRef<L.LayerGroup | null>(null);
  const playbackTimerRef = useRef<any>(null);

  const pastDates = Array.from({ length: 5 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return d.toISOString().split('T')[0];
  });

  // 1. Initialize Map
  useEffect(() => {
    if (mapContainerRef.current && !mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current, {
        zoomControl: false, // Custom placed zoom control below
        attributionControl: true,
      }).setView([26.9124, 75.7873], 13);

      // Default light tile layer
      tileLayerRef.current = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        maxZoom: 19,
      }).addTo(mapRef.current);

      // Layer group for geofences
      geofencesGroupRef.current = L.layerGroup().addTo(mapRef.current);

      // Add zoom control manually at bottom-right
      L.control.zoom({ position: 'bottomright' }).addTo(mapRef.current);
    }

    return () => {
      if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // 2. Handle map tile switching
  useEffect(() => {
    if (!mapRef.current || !tileLayerRef.current) return;
    mapRef.current.removeLayer(tileLayerRef.current);

    let url = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    let attrib = '&copy; OpenStreetMap contributors';

    if (mapStyle === 'light') {
      url = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
      attrib = '&copy; OpenStreetMap &copy; CARTO';
    } else if (mapStyle === 'dark') {
      url = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
      attrib = '&copy; OpenStreetMap &copy; CARTO';
    }

    tileLayerRef.current = L.tileLayer(url, {
      attribution: attrib,
      maxZoom: 19,
    }).addTo(mapRef.current);
  }, [mapStyle]);

  // 3. Handle GeoFence overlays rendering
  useEffect(() => {
    if (!mapRef.current || !geofencesGroupRef.current) return;
    geofencesGroupRef.current.clearLayers();

    if (showGeofencesOverlay && db.geofences) {
      db.geofences.forEach(gf => {
        L.circle([gf.lat, gf.lng], {
          radius: gf.radius,
          color: '#3b82f6',
          fillColor: '#3b82f6',
          fillOpacity: 0.08,
          weight: 1.5,
          dashArray: '5, 5',
        })
        .bindPopup(`<strong>GeoFence:</strong> ${gf.name}<br/>Radius: ${gf.radius}m`)
        .addTo(geofencesGroupRef.current!);
      });
    }
  }, [showGeofencesOverlay, db.geofences]);

  // 4. Invalidate size when sidebar toggles or fullscreen toggles
  useEffect(() => {
    setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 300);
  }, [showSidebar, isFullscreen]);

  // 5. Sync Live Location markers on map
  useEffect(() => {
    if (!mapRef.current) return;

    const liveLocs = db.liveLocations || {};
    const employees = db.employees || [];

    // Clean up markers of employees that no longer exist
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

      // SAFETY: check attRecord, sessions exists, and length > 0 to prevent TypeError crashes
      if (attRecord && attRecord.sessions && attRecord.sessions.length > 0) {
        attRecord.sessions.forEach(s => {
          if (s.in) {
            const inTime = new Date(`${todayDateStr}T${s.in}`);
            const outTime = s.out ? new Date(`${todayDateStr}T${s.out}`) : new Date();
            const diffMs = outTime.getTime() - inTime.getTime();
            if (diffMs > 0) todayHours += diffMs / (1000 * 60 * 60);
          }
        });
        const lastSession = attRecord.sessions[attRecord.sessions.length - 1];
        if (lastSession) {
          lastPunchStr = lastSession.out
            ? `${t('Out', 'बाहर')} @ ${lastSession.out}`
            : `${t('In', 'अंदर')} @ ${lastSession.in}`;
        }
      }

      const assignedFence = db.geofences?.find(g => g.assignedStaff && g.assignedStaff.includes(emp.id));
      let fenceDistStr = t('No GeoFence', 'कोई जियोफेंस नहीं');
      if (assignedFence) {
        const distance = getDistanceMeters(assignedFence.lat, assignedFence.lng, loc.lat, loc.lng);
        const inside = distance <= assignedFence.radius;
        fenceDistStr = `${Math.round(distance)}m ${inside ? '✅' : '⚠️'}`;
      }

      // Check working status based on active punches
      const isWorking = attRecord && attRecord.sessions && attRecord.sessions.some(s => !s.out);

      const popupHtml = `
        <div style="font-family:system-ui,sans-serif;font-size:12px;min-width:210px;max-width:250px;line-height:1.4">
          <div style="display:flex;align-items:center;gap:10px;padding-bottom:10px;margin-bottom:10px;border-bottom:1px solid #f1f5f9">
            ${emp.pic ? `<img src="${emp.pic}" style="width:40px;height:40px;border-radius:10px;object-fit:cover" />` : `<div style="width:40px;height:40px;background:#f0f7ff;color:#2563eb;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:16px">${emp.name.charAt(0)}</div>`}
            <div>
              <div style="font-weight:800;color:#0f172a;font-size:13px">${emp.name}</div>
              <div style="font-size:9px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">${emp.type}</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;font-size:11px;color:#334155">
            <div><strong style="color:#64748b">${t('Status','स्थिति')}:</strong><br/><span style="background:${isWorking?'#dcfce7':'#f1f5f9'};color:${isWorking?'#15803d':'#475569'};padding:2px 6px;border-radius:6px;font-weight:700;font-size:10px">${isWorking ? t('Working','कार्यरत') : t('Offline','ऑफलाइन')}</span></div>
            <div><strong style="color:#64748b">${t('Battery','बैटरी')}:</strong><br/>⚡ ${loc.battery ?? '—'}%</div>
            <div><strong style="color:#64748b">${t('Today Hours','आज के घंटे')}:</strong><br/>⏱️ ${todayHours.toFixed(1)} hrs</div>
            <div><strong style="color:#64748b">${t('GPS Accuracy','सटीकता')}:</strong><br/>📡 ${loc.accuracy?.toFixed(0)}m</div>
            <div style="grid-column:span 2"><strong style="color:#64748b">${t('Last Punch','अंतिम पंच')}:</strong><br/>🚪 ${lastPunchStr}</div>
            <div style="grid-column:span 2"><strong style="color:#64748b">${t('GeoFence Distance','जियोफेंस')}:</strong><br/>📍 ${fenceDistStr}</div>
            <div style="grid-column:span 2;font-size:9px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:6px;margin-top:4px">${loc.address || '—'}<br/>${lastSeenStr}</div>
          </div>
        </div>
      `;

      const iconHtml = `
        <div style="position:relative; width:40px; height:40px;">
          <!-- Glowing pulse indicator if online -->
          ${isOnline ? '<div class="absolute inset-0 rounded-full bg-emerald-500/35 animate-ping" style="margin:-4px"></div>' : ''}
          <div style="width:40px;height:40px;border-radius:50%;border:3px solid ${isOnline ? '#10b981' : '#94a3b8'};overflow:hidden;background:#fff;box-shadow:0 3px 10px rgba(0,0,0,0.15)">
            ${emp.pic ? `<img src="${emp.pic}" style="width:100%;height:100%;object-fit:cover"/>` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-weight:800;color:#1e40af;background:#eff6ff;font-size:15px">${emp.name.charAt(0)}</div>`}
          </div>
          <!-- Tiny bottom status badge -->
          <div style="position:absolute;bottom:0px;right:0px;width:12px;height:12px;border-radius:50%;background:${isOnline ? '#10b981' : '#94a3b8'};border:2px solid white"></div>
        </div>
      `;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: '',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -22],
      });

      const marker = markersRef.current.get(empId);
      if (marker) {
        marker.setLatLng([loc.lat, loc.lng]);
        marker.setIcon(customIcon);
        marker.setPopupContent(popupHtml);
      } else {
        const newMarker = L.marker([loc.lat, loc.lng], { icon: customIcon }).addTo(mapRef.current!);
        newMarker.bindPopup(popupHtml, { maxWidth: 260, minWidth: 210 });
        markersRef.current.set(empId, newMarker);
      }
    });

    // Auto-fit map to show active staff if not currently looking at route replay
    if (Object.keys(liveLocs).length > 0 && !activeReplay) {
      fitAllLiveMarkers();
    }
  }, [db.liveLocations, db.employees, lang, selectedEmpId, activeReplay]);

  // Utility to fit live markers in bounds
  const fitAllLiveMarkers = () => {
    if (!mapRef.current) return;
    const liveLocs = db.liveLocations || {};

    let boundsToFit: L.LatLngBounds;
    if (selectedEmpId && liveLocs[selectedEmpId]) {
      const loc = liveLocs[selectedEmpId];
      boundsToFit = L.latLngBounds([[loc.lat, loc.lng]]);
      mapRef.current.setView([loc.lat, loc.lng], 16);
    } else {
      const coords = Object.values(liveLocs).map(loc => [loc.lat, loc.lng] as [number, number]);
      if (coords.length > 0) {
        boundsToFit = L.latLngBounds(coords);
        if (boundsToFit.isValid()) {
          mapRef.current.fitBounds(boundsToFit, { padding: [50, 50], maxZoom: 16 });
        }
      }
    }
  };

  // 6. Handle Route Replay Drawing & Loading
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear previous replay overlays
    if (routeLineRef.current) { routeLineRef.current.remove(); routeLineRef.current = null; }
    routeMarkersRef.current.forEach(m => m.remove());
    routeMarkersRef.current = [];
    if (sliderMarkerRef.current) { sliderMarkerRef.current.remove(); sliderMarkerRef.current = null; }
    setSliderIndex(0);
    setIsPlaying(false);

    if (!selectedEmpId || !replayDate) { setActiveReplay(null); return; }

    const route = (db.routeHistories || []).find(r => r.employeeId === selectedEmpId && r.date === replayDate);
    if (!route || !route.path || route.path.length === 0) { setActiveReplay(null); return; }

    setActiveReplay(route);

    const coords: [number, number][] = route.path.map(p => [p.lat, p.lng]);
    
    // Draw route path line
    routeLineRef.current = L.polyline(coords, { color: '#3b82f6', weight: 5, opacity: 0.85, lineJoin: 'round' }).addTo(mapRef.current);
    mapRef.current.fitBounds(L.latLngBounds(coords), { padding: [50, 50] });

    // Start marker
    const startPoint = route.path[0];
    const startMarker = L.circleMarker([startPoint.lat, startPoint.lng], {
      radius: 8,
      fillColor: '#10b981',
      color: '#ffffff',
      weight: 2,
      fillOpacity: 0.9,
    }).addTo(mapRef.current);
    startMarker.bindPopup(`<strong>Start Position</strong><br/>⏰ ${new Date(startPoint.timestamp).toLocaleTimeString()}`);
    routeMarkersRef.current.push(startMarker);

    // End marker
    if (coords.length > 1) {
      const endPoint = route.path[route.path.length - 1];
      const endMarker = L.circleMarker([endPoint.lat, endPoint.lng], {
        radius: 8,
        fillColor: '#ef4444',
        color: '#ffffff',
        weight: 2,
        fillOpacity: 0.9,
      }).addTo(mapRef.current);
      endMarker.bindPopup(`<strong>End Position</strong><br/>🏁 ${new Date(endPoint.timestamp).toLocaleTimeString()}`);
      routeMarkersRef.current.push(endMarker);
    }

    // Stops overlay markers
    if (showStopsOverlay) {
      detectRouteStops(route.path).forEach((stop, idx) => {
        const stopMarker = L.circleMarker([stop.lat, stop.lng], {
          radius: 7,
          fillColor: '#f59e0b',
          color: '#ffffff',
          weight: 1.5,
          fillOpacity: 0.9,
        }).addTo(mapRef.current!);
        stopMarker.bindPopup(`<strong>Stop #${idx + 1}</strong><br/>⏳ ${stop.durationMin} min<br/>⏰ ${new Date(stop.startTime).toLocaleTimeString()} – ${new Date(stop.endTime).toLocaleTimeString()}`);
        routeMarkersRef.current.push(stopMarker);
      });
    }
  }, [selectedEmpId, replayDate, db.routeHistories, showStopsOverlay]);

  // 7. Route Replay Timeline Slider & Live Marker positioning
  useEffect(() => {
    if (!mapRef.current || !activeReplay?.path?.length) return;
    const idx = Math.min(sliderIndex, activeReplay.path.length - 1);
    const node = activeReplay.path[idx];
    if (!node) return;

    const popupContent = `
      <div style="font-family:system-ui,sans-serif;font-size:11px;line-height:1.4">
        <div style="font-weight:900;color:#1e3a8a">Replaying Position</div>
        <div>📍 Coord: ${node.lat.toFixed(5)}, ${node.lng.toFixed(5)}</div>
        <div>⏰ Time: ${new Date(node.timestamp).toLocaleTimeString()}</div>
        <div>🔢 Node: ${idx + 1}/${activeReplay.path.length}</div>
      </div>
    `;

    if (sliderMarkerRef.current) {
      sliderMarkerRef.current.setLatLng([node.lat, node.lng]);
      sliderMarkerRef.current.setPopupContent(popupContent);
    } else {
      // Custom vehicle/dot marker for replay
      const vehicleIcon = L.divIcon({
        html: `
          <div style="width:24px;height:24px;border-radius:50%;background:#3b82f6;border:3px solid #ffffff;box-shadow:0 0 10px rgba(59,130,246,0.8);display:flex;align-items:center;justify-content:center">
            <div style="width:8px;height:8px;border-radius:50%;background:#ffffff animate-ping"></div>
          </div>
        `,
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12],
      });
      sliderMarkerRef.current = L.marker([node.lat, node.lng], { icon: vehicleIcon }).addTo(mapRef.current);
      sliderMarkerRef.current.bindPopup(popupContent, { closeOnClick: false, autoClose: false });
    }

    // Keep map centered on player if playing
    if (isPlaying) {
      mapRef.current.setView([node.lat, node.lng]);
    }
  }, [sliderIndex, activeReplay, isPlaying]);

  // 8. Replay Playback Timer Engine
  useEffect(() => {
    if (isPlaying && activeReplay?.path?.length) {
      const intervalDuration = 1000 / playSpeed;
      playbackTimerRef.current = setInterval(() => {
        setSliderIndex(prev => {
          if (prev >= activeReplay.path.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, intervalDuration);
    } else {
      if (playbackTimerRef.current) {
        clearInterval(playbackTimerRef.current);
        playbackTimerRef.current = null;
      }
    }

    return () => {
      if (playbackTimerRef.current) {
        clearInterval(playbackTimerRef.current);
      }
    };
  }, [isPlaying, playSpeed, activeReplay]);

  // Replay Stats calculation
  let totalDistanceKm = '0.00';
  let totalTravelHrs = '0.00';
  let stopsCount = 0;
  let detectedStops: TrackedStop[] = [];

  if (activeReplay?.path?.length) {
    let dist = 0;
    for (let i = 1; i < activeReplay.path.length; i++) {
      dist += getDistanceMeters(activeReplay.path[i-1].lat, activeReplay.path[i-1].lng, activeReplay.path[i].lat, activeReplay.path[i].lng);
    }
    totalDistanceKm = (dist / 1000).toFixed(2);

    const startTime = new Date(activeReplay.path[0].timestamp).getTime();
    const endTime = new Date(activeReplay.path[activeReplay.path.length - 1].timestamp).getTime();
    totalTravelHrs = ((endTime - startTime) / (1000 * 60 * 60)).toFixed(2);
    
    detectedStops = detectRouteStops(activeReplay.path);
    stopsCount = detectedStops.length;
  }

  // Handle Stop click to fly to position
  const handleStopClick = (stop: TrackedStop, idx: number) => {
    if (!mapRef.current) return;
    mapRef.current.setView([stop.lat, stop.lng], 16);
    
    L.popup()
      .setLatLng([stop.lat, stop.lng])
      .setContent(`
        <div style="font-family:system-ui,sans-serif;font-size:11px;line-height:1.4">
          <strong style="color:#d97706">Stop #${idx + 1}</strong>
          <div>⏳ Duration: ${stop.durationMin} min</div>
          <div>⏰ ${new Date(stop.startTime).toLocaleTimeString()} – ${new Date(stop.endTime).toLocaleTimeString()}</div>
        </div>
      `)
      .openOn(mapRef.current);
  };

  const activeEmployee = db.employees.find(e => e.id === selectedEmpId);
  const liveCount = Object.keys(db.liveLocations || {}).length;

  return (
    <div className={`flex flex-col h-[calc(100vh-120px)] md:h-[78vh] gap-3 relative ${isFullscreen ? 'fixed inset-0 z-50 bg-slate-50 p-2 h-screen' : ''}`}>
      
      {/* Mobile Control Header toolbar */}
      <div className="flex items-center justify-between gap-2 md:hidden">
        <button
          onClick={() => setShowSidebar(!showSidebar)}
          className="flex items-center gap-1.5 px-3 h-9 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 cursor-pointer shadow-xs"
        >
          <Icon name={showSidebar ? 'close' : 'menu'} size={16} />
          {showSidebar ? t('Hide Menu', 'सूची छिपाएं') : t('Staff & Options', 'सूची व रिप्ले')}
        </button>
        <span className="text-xs font-bold text-slate-500">
          🟢 {liveCount} {t('Active Online', 'ऑनलाइन')}
        </span>
        <button
          onClick={() => setIsFullscreen(!isFullscreen)}
          className="flex items-center gap-1.5 px-3 h-9 bg-blue-600 text-white rounded-xl text-xs font-bold cursor-pointer shadow-xs"
        >
          <Icon name={isFullscreen ? 'fullscreen_exit' : 'fullscreen'} size={16} />
          {isFullscreen ? t('Exit', 'बाहर') : t('Full Screen', 'पूरा स्क्रीन')}
        </button>
      </div>

      <div className="flex flex-1 gap-3 overflow-hidden relative">
        
        {/* Sidebar Navigation */}
        {(showSidebar || window.innerWidth >= 768) && (
          <div className="w-full md:w-80 lg:w-72 bg-white border border-slate-200 p-3.5 rounded-2xl shadow-3xs flex flex-col gap-3 overflow-y-auto shrink-0 md:block z-20">
            
            {/* Sidebar Tab switches */}
            <div className="grid grid-cols-2 rounded-xl border border-slate-200 overflow-hidden bg-slate-50 p-1 mb-2 gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setSidebarTab('live')}
                className={`py-2 rounded-lg text-[10px] font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider ${
                  sidebarTab === 'live' ? 'bg-white text-blue-600 shadow-sm border border-slate-100' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon name="people" size={14} />
                <span>{t('Live Status', 'लाइव ट्रैकिंग')}</span>
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab('replay')}
                className={`py-2 rounded-lg text-[10px] font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider ${
                  sidebarTab === 'replay' ? 'bg-white text-blue-600 shadow-sm border border-slate-100' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon name="history" size={14} />
                <span>{t('Replay History', 'रूट रिप्ले')}</span>
              </button>
            </div>

            {/* TAB 1: LIVE STATUS */}
            {sidebarTab === 'live' && (
              <div className="space-y-3 flex-1 flex flex-col min-h-0">
                <div className="flex justify-between items-center px-1">
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">{t('Roster Online', 'हाजिर स्टाफ')}</h3>
                  <span className="text-[10px] font-bold text-slate-400">{liveCount} active</span>
                </div>

                <div className="space-y-2 flex-1 overflow-y-auto pr-0.5">
                  {db.employees.map(emp => {
                    const loc = db.liveLocations?.[emp.id];
                    const isOnline = loc ? (Date.now() - new Date(loc.timestamp).getTime() < 300000) : false;
                    const isSelected = selectedEmpId === emp.id;
                    
                    return (
                      <div
                        key={emp.id}
                        onClick={() => {
                          setSelectedEmpId(emp.id);
                          // Auto center map on selection
                          if (loc) {
                            mapRef.current?.setView([loc.lat, loc.lng], 16);
                          }
                          if (window.innerWidth < 768) setShowSidebar(false);
                        }}
                        className={`p-3 rounded-xl border flex flex-col gap-2 cursor-pointer transition-all ${
                          isSelected ? 'border-blue-500 bg-blue-50/50 shadow-3xs' : 'border-slate-100 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="relative shrink-0">
                              {emp.pic ? (
                                <img src={emp.pic} alt={emp.name} className="w-9 h-9 rounded-xl object-cover border border-slate-100" />
                              ) : (
                                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-605 flex items-center justify-center font-black text-xs uppercase border border-blue-100">
                                  {emp.name.slice(0, 2)}
                                </div>
                              )}
                              <span className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white ${isOnline ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-black text-slate-800 truncate">{emp.name}</div>
                              <div className="text-[9px] text-slate-450 font-bold uppercase tracking-wide">{emp.type}</div>
                            </div>
                          </div>
                          <Icon name="radar" size={16} className={isOnline ? 'text-emerald-500 animate-pulse' : 'text-slate-300'} />
                        </div>

                        {/* Extra metrics for online staff */}
                        {loc && (
                          <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-slate-100 text-[10px] font-semibold text-slate-500">
                            <div className="flex items-center gap-1">
                              <Icon name="battery_charging_full" size={12} className="text-slate-400" />
                              <span>{loc.battery ?? '—'}%</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Icon name="satellite" size={12} className="text-slate-400" />
                              <span>{loc.accuracy ? `${loc.accuracy.toFixed(0)}m` : '—'}</span>
                            </div>
                            <div className="col-span-2 flex items-center gap-1 text-[9px] text-slate-400 truncate">
                              <Icon name="my_location" size={11} />
                              <span className="truncate">{loc.address}</span>
                            </div>
                          </div>
                        )}

                        <div className="flex justify-end gap-1.5 pt-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedEmpId(emp.id);
                              setSidebarTab('replay');
                            }}
                            className="h-6 px-2.5 bg-blue-55 hover:bg-blue-100 text-blue-600 border border-blue-100 rounded-lg text-[9px] font-black uppercase flex items-center gap-1 transition active:scale-95 cursor-pointer"
                          >
                            <Icon name="route" size={11} />
                            <span>{t('Replay', 'रिप्ले')}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB 2: HISTORY REPLAY */}
            {sidebarTab === 'replay' && (
              <div className="space-y-3 flex-1 flex flex-col min-h-0">
                <div className="flex justify-between items-center px-1">
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">{t('Select Params', 'रिप्ले पैराम्स')}</h3>
                </div>

                {/* Parameters Selection Form */}
                <div className="bg-slate-50 border border-slate-150 p-3 rounded-xl space-y-2.5">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase block">{t('Employee', 'कर्मचारी चुनें')}</label>
                    <select
                      value={selectedEmpId || ''}
                      onChange={e => setSelectedEmpId(e.target.value || null)}
                      className="w-full h-9 border border-slate-200 rounded-lg px-2 text-xs font-bold bg-white outline-none"
                    >
                      <option value="">{t('-- Choose Employee --', '-- कर्मचारी चुनें --')}</option>
                      {db.employees.map(emp => (
                        <option key={emp.id} value={emp.id}>{emp.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase block">{t('History Date', 'तारीख चुनें')}</label>
                    <select
                      value={replayDate}
                      onChange={e => setReplayDate(e.target.value)}
                      className="w-full h-9 border border-slate-200 rounded-lg px-2 text-xs font-bold bg-white outline-none"
                    >
                      {pastDates.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                </div>

                {/* Replay Controller Controls */}
                {selectedEmpId && activeEmployee && activeReplay ? (
                  <div className="space-y-3 flex-1 flex flex-col min-h-0">
                    
                    {/* Route Stats Summary */}
                    <div className="grid grid-cols-3 gap-2 bg-blue-50/40 border border-blue-100 rounded-xl p-2 text-center text-slate-700">
                      <div className="space-y-0.5">
                        <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">{t('Distance', 'दूरी')}</span>
                        <span className="text-xs font-black text-blue-900 block font-mono">{totalDistanceKm} km</span>
                      </div>
                      <div className="space-y-0.5 border-l border-slate-200/50">
                        <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">{t('Duration', 'समय')}</span>
                        <span className="text-xs font-black text-blue-900 block font-mono">{totalTravelHrs} hrs</span>
                      </div>
                      <div className="space-y-0.5 border-l border-slate-200/50">
                        <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">{t('Stops', 'स्टॉप')}</span>
                        <span className="text-xs font-black text-blue-900 block font-mono">{stopsCount}</span>
                      </div>
                    </div>

                    {/* Timeline Playback Bar */}
                    <div className="space-y-2 bg-slate-50 border border-slate-200/50 rounded-xl p-3">
                      <div className="flex justify-between items-center text-[9px] font-black text-slate-400 uppercase">
                        <span>{t('Playback Scrubber', 'समय प्रोग्रेस')}</span>
                        <span className="font-mono text-slate-600">{sliderIndex + 1}/{activeReplay.path.length}</span>
                      </div>
                      
                      <input
                        type="range"
                        min="0"
                        max={activeReplay.path.length - 1}
                        value={sliderIndex}
                        onChange={e => {
                          setSliderIndex(parseInt(e.target.value));
                          setIsPlaying(false);
                        }}
                        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 focus:outline-none"
                        style={{ touchAction: 'none' }}
                      />

                      <div className="text-[10px] text-slate-800 font-extrabold text-center font-sans tracking-wide">
                        ⏰ {new Date(activeReplay.path[sliderIndex]?.timestamp || '').toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}
                      </div>

                      {/* Playback action buttons */}
                      <div className="flex items-center justify-between gap-2 border-t border-slate-200/60 pt-2.5 mt-1.5">
                        
                        {/* Speed dropdown */}
                        <div className="flex items-center gap-1">
                          <span className="text-[8px] font-black text-slate-450 uppercase">{t('Speed:', 'गति:')}</span>
                          <select
                            value={playSpeed}
                            onChange={e => setPlaySpeed(parseInt(e.target.value))}
                            className="h-6 border border-slate-200 rounded bg-white text-[9px] font-black outline-none px-1"
                          >
                            <option value="1">1x</option>
                            <option value="2">2x</option>
                            <option value="5">5x</option>
                            <option value="10">10x</option>
                            <option value="20">20x</option>
                          </select>
                        </div>

                        {/* Play/Pause Button */}
                        <button
                          onClick={() => {
                            if (sliderIndex >= activeReplay.path.length - 1) {
                              setSliderIndex(0);
                            }
                            setIsPlaying(!isPlaying);
                          }}
                          className={`h-8 w-18 rounded-lg flex items-center justify-center gap-1 text-[10px] font-black uppercase text-white shadow-xs cursor-pointer active:scale-95 transition-all ${
                            isPlaying ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-600 hover:bg-blue-700'
                          }`}
                        >
                          <Icon name={isPlaying ? 'pause' : 'play_arrow'} size={14} />
                          <span>{isPlaying ? t('Pause', 'रोकें') : t('Play', 'चलाएं')}</span>
                        </button>
                      </div>
                    </div>

                    {/* Detected Stops lists */}
                    <div className="flex-1 flex flex-col min-h-0 space-y-1.5">
                      <div className="text-[9px] font-black text-slate-450 uppercase tracking-wide pl-1">
                        🛑 {t('Stops Detected', 'रुकने के स्थान')} ({stopsCount})
                      </div>
                      
                      {stopsCount === 0 ? (
                        <p className="text-[10px] text-slate-400 italic p-3 text-center bg-slate-50 rounded-xl border border-slate-100">
                          {t('No stop points (>5 min) detected on this route.', 'इस मार्ग पर कोई ठहराव (5 मिनट से ज्यादा) नहीं मिला।')}
                        </p>
                      ) : (
                        <div className="flex-1 overflow-y-auto pr-0.5 space-y-1.5">
                          {detectedStops.map((stop, idx) => (
                            <div
                              key={idx}
                              onClick={() => handleStopClick(stop, idx)}
                              className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-2.5 text-[10px] cursor-pointer hover:bg-slate-50 transition-all flex items-center gap-2.5"
                            >
                              <div className="w-6 h-6 rounded-lg bg-amber-50 text-amber-700 border border-amber-100 flex items-center justify-center font-black shrink-0">
                                {idx + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-center text-[10px] font-black text-slate-700">
                                  <span>{stop.durationMin} minutes</span>
                                  <span className="text-[8px] text-amber-600 bg-amber-50 px-1 py-0.2 rounded font-extrabold uppercase">STOP</span>
                                </div>
                                <div className="text-[9px] text-slate-450 font-semibold leading-tight mt-0.5">
                                  ⏰ {new Date(stop.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} – {new Date(stop.endTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                  </div>
                ) : (
                  selectedEmpId && activeEmployee && (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-4 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-2">
                        <Icon name="explore" size={24} className="animate-spin" style={{ animationDuration: '4s' }} />
                      </div>
                      <span className="text-xs font-bold text-slate-500">{t('No Route Data Found', 'कोई मार्ग डेटा नहीं मिला')}</span>
                      <p className="text-[10px] text-slate-400 mt-1">{t('No tracking records logged on this date.', 'इस तारीख को कोई ट्रैकिंग रिकॉर्ड उपलब्ध नहीं है।')}</p>
                    </div>
                  )
                )}

                {/* Empty State Prompt */}
                {!selectedEmpId && (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-200 rounded-2xl bg-slate-50/30">
                    <Icon name="route" size={28} className="text-slate-300 mb-2" />
                    <span className="text-xs font-bold text-slate-450">{t('Select Staff', 'कर्मचारी चुनें')}</span>
                    <p className="text-[9px] text-slate-450 leading-relaxed mt-1">
                      {t('Select an employee from the dropdown above to visualize their movement route and timeline.', 'ऊपर दिए गए ड्रॉपडाउन से कर्मचारी का चयन करके उनका यात्रा मार्ग और टाइमलाइन देखें।')}
                    </p>
                  </div>
                )}
              </div>
            )}

          </div>
        )}

        {/* Map Arena Container */}
        <div className="flex-1 bg-white border border-slate-200 rounded-2xl shadow-3xs relative overflow-hidden min-h-0 flex flex-col">
          
          {/* Top Info overlay floating box */}
          {selectedEmpId && activeEmployee && (
            <div className="absolute top-3 left-3 z-[1000] bg-white/90 backdrop-blur-md border border-slate-200/60 px-3 py-2 rounded-xl shadow-md flex items-center gap-2 max-w-[85%]">
              <div className="text-[10px] font-semibold text-slate-600 truncate">
                <span className="font-extrabold text-slate-900">{activeEmployee.name}</span> · {replayDate}
              </div>
              <button
                onClick={() => {
                  setSelectedEmpId(null);
                  setActiveReplay(null);
                }}
                className="text-[9px] font-black text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 p-0.5 rounded cursor-pointer shrink-0 transition"
              >
                ✕
              </button>
            </div>
          )}

          {/* Premium Floating Controls Panel (Glassmorphism Map Overlays) */}
          <div className="absolute top-3 right-3 z-[1000] bg-white/90 backdrop-blur-md border border-slate-200/60 p-2.5 rounded-xl shadow-md flex flex-col gap-2.5 text-[10px] font-bold text-slate-700 min-w-[130px] max-w-[170px]">
            
            {/* Map Styles Selector */}
            <div className="space-y-1">
              <span className="text-[8px] font-black text-slate-400 uppercase block">🗺️ {t('Map Style', 'मैप स्टाइल')}</span>
              <select
                value={mapStyle}
                onChange={e => setMapStyle(e.target.value as any)}
                className="w-full h-6 border border-slate-200 rounded bg-white text-[9px] font-bold outline-none px-1 cursor-pointer"
              >
                <option value="light">{t('Sleek Silver', 'सिल्वर (लाइट)')}</option>
                <option value="dark">{t('Space Obsidian', 'स्पेस (डार्क)')}</option>
                <option value="streets">{t('Standard Map', 'स्टैंडर्ड (OSM)')}</option>
              </select>
            </div>

            <div className="h-[0.5px] bg-slate-200" />

            {/* Overlays Switchers */}
            <div className="space-y-1.5">
              <span className="text-[8px] font-black text-slate-400 uppercase block">⚙️ {t('Overlays', 'परतें')}</span>
              
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showGeofencesOverlay}
                  onChange={e => setShowGeofencesOverlay(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 border-slate-300"
                />
                <span>{t('Show Fences', 'जियोफेंस देखें')}</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showStopsOverlay}
                  onChange={e => setShowStopsOverlay(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 border-slate-300"
                />
                <span>{t('Show Stops', 'स्टॉप्स देखें')}</span>
              </label>
            </div>

            <div className="h-[0.5px] bg-slate-200" />

            {/* Re-center / Fit bounds action button */}
            <button
              onClick={() => {
                if (activeReplay?.path?.length) {
                  const coords: [number, number][] = activeReplay.path.map(p => [p.lat, p.lng]);
                  mapRef.current?.fitBounds(L.latLngBounds(coords), { padding: [50, 50] });
                } else {
                  fitAllLiveMarkers();
                }
              }}
              className="w-full h-7 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded text-[9px] font-extrabold flex items-center justify-center gap-1 transition cursor-pointer"
            >
              <Icon name="my_location" size={11} />
              <span>{t('Fit All Markers', 'सभी को फिट करें')}</span>
            </button>
          </div>

          <div ref={mapContainerRef} className="w-full h-full z-10" />
        </div>
      </div>
    </div>
  );
}
