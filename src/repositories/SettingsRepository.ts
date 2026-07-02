import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, cleanUndefined } from '../firebase';
import { CompanySettings } from '../types';

export class SettingsRepository {
  static async getCompanySettings(): Promise<CompanySettings | null> {
    const docRef = doc(db, 'settings', 'company');
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as CompanySettings;
    }
    return null;
  }

  static async saveCompanySettings(settings: CompanySettings): Promise<void> {
    const cleaned = cleanUndefined(settings);
    await setDoc(doc(db, 'settings', 'company'), cleaned, { merge: true });
  }
}
