export interface LocationCoords {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  timestamp: string;
}

export interface ILocationService {
  startWatchPosition(onSuccess: (coords: LocationCoords) => void, onError: (err: any) => void): void;
  clearWatch(): void;
}

export interface IBatteryService {
  getBatteryLevel(): Promise<number>;
  subscribeBatteryLevel(onChange: (level: number) => void): () => void;
}

export interface INetworkService {
  isOnline(): boolean;
  subscribeConnection(onChange: (online: boolean) => void): () => void;
}

export interface INotificationService {
  requestPermission(): Promise<boolean>;
  showNotification(title: string, body: string): void;
}

export interface IDeviceInfo {
  model: string;
  os: string;
  uuid: string;
}

export interface IDeviceInfoService {
  getDeviceInfo(): IDeviceInfo;
}

// ----------------------------------------------------
// Web Implementations (Browser Web APIs)
// ----------------------------------------------------

class WebLocationService implements ILocationService {
  private watchId: number | null = null;

  startWatchPosition(onSuccess: (coords: LocationCoords) => void, onError: (err: any) => void): void {
    if (this.watchId !== null) this.clearWatch();

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      onError(new Error('Geolocation not supported by this platform.'));
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        onSuccess({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          speed: pos.coords.speed,
          timestamp: new Date(pos.timestamp).toISOString(),
        });
      },
      (err) => onError(err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  }

  clearWatch(): void {
    if (this.watchId !== null && typeof navigator !== 'undefined') {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }
}

class WebBatteryService implements IBatteryService {
  async getBatteryLevel(): Promise<number> {
    if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
      try {
        const battery = await (navigator as any).getBattery();
        return Math.round(battery.level * 100);
      } catch (e) {
        console.warn('Error reading battery level:', e);
      }
    }
    return 100; // Fallback
  }

  subscribeBatteryLevel(onChange: (level: number) => void): () => void {
    let active = true;
    let unsub: (() => void) | null = null;

    if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
      (navigator as any).getBattery().then((battery: any) => {
        if (!active) return;
        onChange(Math.round(battery.level * 100));

        const handler = () => onChange(Math.round(battery.level * 100));
        battery.addEventListener('levelchange', handler);
        unsub = () => battery.removeEventListener('levelchange', handler);
      });
    } else {
      onChange(100);
    }

    return () => {
      active = false;
      if (unsub) unsub();
    };
  }
}

class WebNetworkService implements INetworkService {
  isOnline(): boolean {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  }

  subscribeConnection(onChange: (online: boolean) => void): () => void {
    if (typeof window === 'undefined') return () => {};

    const handleOnline = () => onChange(true);
    const handleOffline = () => onChange(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial trigger
    onChange(this.isOnline());

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }
}

class WebNotificationService implements INotificationService {
  async requestPermission(): Promise<boolean> {
    if (typeof Notification === 'undefined') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  }

  showNotification(title: string, body: string): void {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body });
    } else {
      console.log(`[Notification mock]: ${title} - ${body}`);
    }
  }
}

class WebDeviceInfoService implements IDeviceInfoService {
  getDeviceInfo(): IDeviceInfo {
    let uuid = '';
    if (typeof localStorage !== 'undefined') {
      let cached = localStorage.getItem('skbg_device_uuid');
      if (!cached) {
        cached = 'DEV_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now();
        localStorage.setItem('skbg_device_uuid', cached);
      }
      uuid = cached;
    } else {
      uuid = 'DEV_SERVER_MOCK';
    }

    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown';
    const platform = typeof navigator !== 'undefined' ? navigator.platform : 'Unknown';

    // Crude extraction of model/browser name
    const model = userAgent.split(' ')[0] || 'Browser';
    const os = platform || 'Web';

    return { model, os, uuid };
  }
}

// ----------------------------------------------------
// Android Native Mock Integration Interfaces
// ----------------------------------------------------
// (These route calls to native JavascriptInterface bindings exposed by Android app)
// ----------------------------------------------------

class UnifiedLocationService implements ILocationService {
  private webLoc = new WebLocationService();

  startWatchPosition(onSuccess: (coords: LocationCoords) => void, onError: (err: any) => void): void {
    if (typeof window !== 'undefined' && (window as any).AndroidLocation) {
      (window as any).onAndroidLocationUpdate = (lat: number, lng: number, accuracy: number, speed: number, timestamp: string) => {
        onSuccess({ latitude: lat, longitude: lng, accuracy, speed, timestamp });
      };
      (window as any).onAndroidLocationError = (errMsg: string) => {
        onError(new Error(errMsg));
      };
      (window as any).AndroidLocation.startWatch();
    } else {
      this.webLoc.startWatchPosition(onSuccess, onError);
    }
  }

  clearWatch(): void {
    if (typeof window !== 'undefined' && (window as any).AndroidLocation) {
      (window as any).AndroidLocation.stopWatch();
    } else {
      this.webLoc.clearWatch();
    }
  }
}

// ----------------------------------------------------
// Platform Abstracted Exports
// ----------------------------------------------------

export const PlatformLocation = new UnifiedLocationService();
export const PlatformBattery = new WebBatteryService();
export const PlatformNetwork = new WebNetworkService();
export const PlatformNotification = new WebNotificationService();
export const PlatformDeviceInfo = new WebDeviceInfoService();
