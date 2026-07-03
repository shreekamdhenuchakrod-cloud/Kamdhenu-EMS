/**
 * Reverse Geocoding Utility with localStorage caching
 */

export async function reverseGeocodeOSM(lat: number, lng: number): Promise<string> {
  const precision = 4; // ~11 meters grid resolution
  const cacheKey = `geo_cache_${lat.toFixed(precision)}_${lng.toFixed(precision)}`;

  // 1. Try to read from localStorage cache
  if (typeof localStorage !== 'undefined') {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      return cached;
    }
  }

  // 2. Fetch from OpenStreetMap Nominatim API
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18`,
      {
        headers: {
          'Accept-Language': 'en',
          'User-Agent': 'Kamdhenu-EMS/1.0'
        }
      }
    );

    if (response.ok) {
      const data = await response.json();
      const address = data.display_name || `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
      
      // Cache the result
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(cacheKey, address);
      }
      return address;
    }
  } catch (error) {
    console.error('OSM Reverse Geocoding Failed:', error);
  }

  // Fallback
  return `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
}
