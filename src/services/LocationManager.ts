import { getDistanceMeters } from '../db';
import { SyncEngineService } from './SyncEngine';
import { LiveLocation, GeoFence, AppDatabase } from '../types';

export class LocationManager {
  private lastPosition: { lat: number; lng: number; timestamp: number } | null = null;
  private lastWritePosition: { lat: number; lng: number } | null = null;
  private lastWriteTime = 0;
  private watchId: number | null = null;
  private currentInterval = 45000; // start with 45s (moving default)
  private intervalTimerId: any = null;
  private activeGeoFences: GeoFence[] = [];
  private lastInsideGeoFences = new Set<string>();

  // Hardware/permission state flags
  public isGPSEnabled = false;
  public hasPermission = false;
  public hasBackgroundPermission = false;
  public isMockLocationDetected = false;
  public isBatteryOptimizationWarning = false;

  private onLocationTickCallback: ((loc: LiveLocation) => void) | null = null;

  constructor() {
    this.checkPermissions();
  }

  public checkPermissions() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.hasPermission = false;
      this.isGPSEnabled = false;
      return;
    }

    // Default flags simulation
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

  public startTracking(employeeId: string, onTick?: (loc: LiveLocation) => void) {
    if (onTick) this.onLocationTickCallback = onTick;

    if (this.watchId) navigator.geolocation.clearWatch(this.watchId);
    if (this.intervalTimerId) clearInterval(this.intervalTimerId);

    // Watch position in high-accuracy mode
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.handlePositionUpdate(pos, employeeId);
      },
      (err) => {
        console.error('GPS Watch Position Error:', err);
        this.isGPSEnabled = false;
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
    );

    // Start adaptive interval timer loop
    this.intervalTimerId = setInterval(() => {
      this.evaluateAdaptiveInterval(employeeId);
    }, 15000); // Check every 15s to adjust intervals dynamically
  }

  public stopTracking() {
    if (this.watchId) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    if (this.intervalTimerId) {
      clearInterval(this.intervalTimerId);
      this.intervalTimerId = null;
    }
  }

  private handlePositionUpdate(position: GeolocationPosition, employeeId: string) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const accuracy = position.coords.accuracy;
    const timestamp = new Date(position.timestamp).toISOString();

    const speed = position.coords.speed || 0;

    // Simulated checks
    this.isMockLocationDetected = (position as any).mocked === true;
    this.isGPSEnabled = true;
    this.hasPermission = true;

    const loc: LiveLocation = {
      employeeId,
      lat,
      lng,
      battery: 100, // Fallback, will be updated by Dashboard state
      speed,
      accuracy,
      timestamp,
      isMock: this.isMockLocationDetected
    };

    if (this.onLocationTickCallback) {
      this.onLocationTickCallback(loc);
    }

    // Process tracking parameters
    const now = Date.now();
    const distanceMoved = this.lastPosition 
      ? getDistanceMeters(this.lastPosition.lat, this.lastPosition.lng, lat, lng)
      : 0;

    // Detect GeoFence transitions
    let geofenceTransitionTriggered = false;
    this.activeGeoFences.forEach(g => {
      const dist = getDistanceMeters(g.lat, g.lng, lat, lng);
      const isInside = dist <= g.radius;
      const wasInside = this.lastInsideGeoFences.has(g.id);

      if (isInside !== wasInside) {
        geofenceTransitionTriggered = true;
        if (isInside) {
          this.lastInsideGeoFences.add(g.id);
        } else {
          this.lastInsideGeoFences.delete(g.id);
        }
      }
    });

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

  private evaluateAdaptiveInterval(employeeId: string) {
    if (!this.lastPosition) return;

    const speed = this.lastPosition ? 0 : 0; // fallback default
    
    // Adaptive Tracking Logic:
    // Moving Employee: update tracking speed.
    // Background vs Active Screen vs Stationary
    let targetInterval = 45000; // 45s (Moving)

    const isMoving = speed > 1; // speed > 1 m/s (approx 3.6 km/h)
    
    if (document.hidden) {
      targetInterval = 300000; // 5 mins (Background)
    } else if (!isMoving) {
      targetInterval = 180000; // 3 mins (Stationary)
    }

    if (targetInterval !== this.currentInterval) {
      this.currentInterval = targetInterval;
      this.startTracking(employeeId); // restart watch with new frequency interval rules
    }
  }

  public forceLocationUpdate(employeeId: string, lat: number, lng: number) {
    // Manually push location on immediate actions like Punch request
    const loc: LiveLocation = {
      employeeId,
      lat,
      lng,
      battery: 100,
      speed: 0,
      accuracy: 5,
      timestamp: new Date().toISOString(),
      isMock: false
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
    
    // We fetch current route from queue or create fresh
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
