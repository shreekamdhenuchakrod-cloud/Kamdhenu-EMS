import { GeoFence } from '../types';

export class GeoFenceService {
  /**
   * Calculate Haversine distance between two coordinates in meters.
   */
  static calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth radius in meters
    const toRad = (val: number) => (val * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Check if a coordinate is within a geofence.
   */
  static isWithinGeoFence(lat: number, lng: number, geofence: GeoFence): boolean {
    const distance = this.calculateDistance(lat, lng, geofence.lat, geofence.lng);
    return distance <= geofence.radius;
  }

  /**
   * Validates if the location is genuine and not mock GPS.
   * @param isMock From capacitor geolocation plugin if available
   */
  static validateLocationIntegrity(isMock: boolean, accuracy: number): boolean {
    if (isMock) return false;
    if (accuracy > 100) return false; // reject poor accuracy (>100m)
    return true;
  }
}
