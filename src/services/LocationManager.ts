import { getDistanceMeters } from '../db';
import { SyncEngineService } from './SyncEngine';
import { LiveLocation, GeoFence } from '../types';
import { PlatformLocation, PlatformBattery, PlatformNetwork } from './platform/PlatformAbstraction';

export class LocationManager {
  private lastPosition: { lat: number; lng: number; timestamp: number } | null = null;
  private lastWritePosition: { lat: number; lng: number } | null = null;
  private lastWriteTime = 0;
  private activeGeoFences: GeoFence[] = [];
  private lastInsideGeoFences = new Set<string>();
  private intervalTimerId: any = null;
  private currentInterval = 45000; // default interval

  // Cached device parameters
  private batteryLevel = 100;
  private isOnline = true;
  private lastResolvedAddress = '';
  private lastGeocodedPosition: { lat: number; lng: number } | null = null;

  // Hardware/permission state flags
  public isGPSEnabled = false;
  public hasPermission = false;
  public hasBackgroundPermission = false;
  public isMockLocationDetected = false;
  public isBatteryOptimizationWarning = false;

  private onLocationTickCallback: ((loc: LiveLocation) => void) | null = null;

  constructor() {
    this.checkPermissions();
    this.initDeviceSubscribers();
  }

  private initDeviceSubscribers() {
    PlatformBattery.subscribeBatteryLevel((level) => {
      this.batteryLevel = level;
    });
    PlatformNetwork.subscribeConnection((online) => {
      this.isOnline = online;
    });
  }

  public checkPermissions() {
    // Default simulated flag checkers
    this.isGPSEnabled = true;
    this.hasPermission = true;
    this.hasBackgroundPermission = true; 
    this.isMockLocationDetected = false;
    this.isBatteryOptimizationWarning = false;
  }

  /**
   * Sets up active geofences for boundary crossing detection
   */
  public updateActiveGeoFences(geofences: GeoFence[], employeeId: string) {
    this.activeGeoFences = geofences.filter(g => g.assignedStaff && g.assignedStaff.includes(employeeId));
  }

  public startTracking(employeeId: string, onTick?: (loc: LiveLocation) => void, onError?: (err: any) => void) {
    if (onTick) this.onLocationTickCallback = onTick;

    // Watch position using Platform Abstraction Layer (runs continuously and stable)
    PlatformLocation.startWatchPosition(
      (coords) => {
        this.isGPSEnabled = true;
        this.handlePlatformLocationUpdate(coords, employeeId);
      },
      (err) => {
        console.error('GPS Watch Position Error:', err);
        this.isGPSEnabled = false;
        if (onError) onError(err);
      }
    );
  }

  private async handlePlatformLocationUpdate(coords: any, employeeId: string) {
    const lat = coords.latitude;
    const lng = coords.longitude;
    const accuracy = coords.accuracy;
    const timestamp = coords.timestamp;
    const speed = coords.speed || 0;
    const now = Date.now();

    // Determine if reverse geocoding is required based on event limits (Entry/Exit/100m movement)
    let needsGeocode = false;

    // Detect GeoFence transitions
    let geofenceTransitionTriggered = false;
    this.activeGeoFences.forEach(g => {
      const dist = getDistanceMeters(g.lat, g.lng, lat, lng);
      const isInside = dist <= g.radius;
      const wasInside = this.lastInsideGeoFences.has(g.id);

      if (isInside !== wasInside) {
        geofenceTransitionTriggered = true;
        needsGeocode = true;
        if (isInside) {
          this.lastInsideGeoFences.add(g.id);
        } else {
          this.lastInsideGeoFences.delete(g.id);
        }
      }
    });

    if (!this.lastGeocodedPosition) {
      needsGeocode = true;
    } else {
      const distFromLastGeocode = getDistanceMeters(this.lastGeocodedPosition.lat, this.lastGeocodedPosition.lng, lat, lng);
      if (distFromLastGeocode > 100) {
        needsGeocode = true;
      }
    }

    if (needsGeocode) {
      try {
        const { reverseGeocodeOSM } = await import('../utils/geocoding');
        this.lastResolvedAddress = await reverseGeocodeOSM(lat, lng);
        this.lastGeocodedPosition = { lat, lng };
      } catch (err) {
        console.error('Failed to import or call reverseGeocodeOSM:', err);
      }
    }

    const loc: LiveLocation = {
      employeeId,
      lat,
      lng,
      battery: this.batteryLevel,
      speed,
      accuracy,
      timestamp,
      isMock: this.isMockLocationDetected,
      network: this.isOnline ? 'online' : 'offline',
      address: this.lastResolvedAddress || `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`
    };

    if (this.onLocationTickCallback) {
      this.onLocationTickCallback(loc);
    }

    // Determine if we should commit write to database (Throttling Check)
    let shouldWrite = false;
    
    // Condition 1: Moved more than 20 meters
    if (this.lastWritePosition) {
      const distFromLastWrite = getDistanceMeters(this.lastWritePosition.lat, this.lastWritePosition.lng, lat, lng);
      if (distFromLastWrite > 20) {
        shouldWrite = true;
      }
    } else {
      shouldWrite = true; // First record
    }

    // Condition 2: GeoFence Transition
    if (geofenceTransitionTriggered) {
      shouldWrite = true;
    }

    // Condition 3: More than 60 seconds elapsed since last successful database write
    if (now - this.lastWriteTime > 60000) {
      shouldWrite = true;
    }

    if (shouldWrite) {
      this.commitLiveLocationToSync(loc);
      this.lastWritePosition = { lat, lng };
      this.lastWriteTime = now;
    }

    // Save position state
    this.lastPosition = { lat, lng, timestamp: now };
  }

  public stopTracking() {
    PlatformLocation.clearWatch();
  }

  public async forceLocationUpdate(employeeId: string, lat: number, lng: number) {
    // Manually force geocode address on Punch In / Punch Out
    try {
      const { reverseGeocodeOSM } = await import('../utils/geocoding');
      const address = await reverseGeocodeOSM(lat, lng);
      this.lastResolvedAddress = address;
      this.lastGeocodedPosition = { lat, lng };
    } catch (err) {
      console.error('Failed to import or call reverseGeocodeOSM:', err);
    }

    const loc: LiveLocation = {
      employeeId,
      lat,
      lng,
      battery: this.batteryLevel,
      speed: 0,
      accuracy: 5,
      timestamp: new Date().toISOString(),
      isMock: false,
      network: this.isOnline ? 'online' : 'offline',
      address: this.lastResolvedAddress || `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`
    };

    this.commitLiveLocationToSync(loc);
    this.lastWritePosition = { lat, lng };
    this.lastWriteTime = Date.now();
  }

  private commitLiveLocationToSync(loc: LiveLocation) {
    SyncEngineService.enqueue('live_location', loc);

    // Also append to RouteHistory
    const dateStr = new Date().toISOString().split('T')[0];
    const routeId = `${loc.employeeId}_${dateStr}`;
    
    const queue = SyncEngineService.getQueue();
    const existingSyncRoute = queue.find(q => q.action === 'route_history' && q.payload.id === routeId);

    const freshPathNode = {
      lat: loc.lat,
      lng: loc.lng,
      timestamp: loc.timestamp
    };

    if (existingSyncRoute) {
      const routePayload = existingSyncRoute.payload;
      routePayload.path.push(freshPathNode);
    } else {
      const newRoute = {
        id: routeId,
        employeeId: loc.employeeId,
        date: dateStr,
        path: [freshPathNode],
        stops: [] // filled dynamically during stop validations
      };
      SyncEngineService.enqueue('route_history', newRoute);
    }
  }
}

export const LocationManagerService = new LocationManager();
