import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon path issues in bundle environments
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

export interface MapMarkerOptions {
  title?: string;
  popupHtml?: string;
  iconUrl?: string;
}

export interface MapCircleOptions {
  color?: string;
  fillColor?: string;
  fillOpacity?: number;
}

/**
 * Unified IMapProvider interface to abstract Leaflet, OpenStreetMap, or future Google Maps migrations.
 */
export interface IMapProvider {
  initialize(containerId: string, center: [number, number], zoom: number): void;
  setCenter(center: [number, number], zoom?: number): void;
  addMarker(id: string, lat: number, lng: number, options?: MapMarkerOptions): void;
  removeMarker(id: string): void;
  addGeoFenceCircle(id: string, lat: number, lng: number, radiusMeters: number, options?: MapCircleOptions): void;
  removeGeoFenceCircle(id: string): void;
  drawRoute(routeId: string, coordinates: [number, number][], options?: { color?: string }): void;
  clearRoute(routeId: string): void;
  destroy(): void;
}

export class LeafletMapProvider implements IMapProvider {
  private map: L.Map | null = null;
  private markers = new Map<string, L.Marker>();
  private circles = new Map<string, L.Circle>();
  private routes = new Map<string, L.Polyline>();

  initialize(containerId: string, center: [number, number], zoom: number): void {
    if (this.map) {
      this.destroy();
    }

    this.map = L.map(containerId).setView(center, zoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(this.map);
  }

  setCenter(center: [number, number], zoom?: number): void {
    if (!this.map) return;
    if (zoom !== undefined) {
      this.map.setView(center, zoom);
    } else {
      this.map.panTo(center);
    }
  }

  addMarker(id: string, lat: number, lng: number, options?: MapMarkerOptions): void {
    if (!this.map) return;

    this.removeMarker(id);

    const markerOptions: L.MarkerOptions = {
      title: options?.title,
    };

    if (options?.iconUrl) {
      markerOptions.icon = L.icon({
        iconUrl: options.iconUrl,
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
        shadowSize: [41, 41]
      });
    }

    const marker = L.marker([lat, lng], markerOptions).addTo(this.map);

    if (options?.popupHtml) {
      marker.bindPopup(options.popupHtml);
    }

    this.markers.set(id, marker);
  }

  removeMarker(id: string): void {
    const marker = this.markers.get(id);
    if (marker && this.map) {
      marker.remove();
      this.markers.delete(id);
    }
  }

  addGeoFenceCircle(id: string, lat: number, lng: number, radiusMeters: number, options?: MapCircleOptions): void {
    if (!this.map) return;

    this.removeGeoFenceCircle(id);

    const circle = L.circle([lat, lng], {
      radius: radiusMeters,
      color: options?.color || '#3b82f6',
      fillColor: options?.fillColor || '#93c5fd',
      fillOpacity: options?.fillOpacity || 0.25,
    }).addTo(this.map);

    this.circles.set(id, circle);
  }

  removeGeoFenceCircle(id: string): void {
    const circle = this.circles.get(id);
    if (circle && this.map) {
      circle.remove();
      this.circles.delete(id);
    }
  }

  drawRoute(routeId: string, coordinates: [number, number][], options?: { color?: string }): void {
    if (!this.map) return;

    this.clearRoute(routeId);

    const polyline = L.polyline(coordinates, {
      color: options?.color || '#6366f1',
      weight: 4,
      opacity: 0.8,
    }).addTo(this.map);

    this.routes.set(routeId, polyline);
  }

  clearRoute(routeId: string): void {
    const polyline = this.routes.get(routeId);
    if (polyline && this.map) {
      polyline.remove();
      this.routes.delete(routeId);
    }
  }

  destroy(): void {
    this.markers.forEach(m => m.remove());
    this.markers.clear();
    this.circles.forEach(c => c.remove());
    this.circles.clear();
    this.routes.forEach(r => r.remove());
    this.routes.clear();

    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }
}

// Global service instantiation
export const MapService = new LeafletMapProvider();
