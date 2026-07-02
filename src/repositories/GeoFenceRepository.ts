import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db, cleanUndefined } from '../firebase';
import { GeoFence } from '../types';

export class GeoFenceRepository {
  static async getGeoFence(id: string): Promise<GeoFence | null> {
    const docRef = doc(db, 'geofences', id);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as GeoFence;
    }
    return null;
  }

  static async saveGeoFence(geofence: GeoFence): Promise<void> {
    const cleaned = cleanUndefined(geofence);
    await setDoc(doc(db, 'geofences', geofence.id), cleaned, { merge: true });
  }

  static async deleteGeoFence(id: string): Promise<void> {
    await deleteDoc(doc(db, 'geofences', id));
  }
}
