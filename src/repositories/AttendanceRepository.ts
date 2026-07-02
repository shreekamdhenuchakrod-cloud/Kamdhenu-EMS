import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db, cleanUndefined } from '../firebase';
import { AttendanceRecord, PunchSession } from '../types';

export class AttendanceRepository {
  /**
   * Retrieves an attendance record for a specific employee on a specific date.
   * @param employeeId Employee ID
   * @param date Date in YYYY-MM-DD format
   */
  static async getRecord(employeeId: string, date: string): Promise<AttendanceRecord | null> {
    const id = `${employeeId}_${date}`;
    const docRef = doc(db, 'attendance', id);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as AttendanceRecord;
    }
    return null;
  }

  /**
   * Saves or merges an attendance record.
   * @param employeeId Employee ID
   * @param date Date in YYYY-MM-DD format
   * @param record Attendance record to save
   */
  static async saveRecord(employeeId: string, date: string, record: AttendanceRecord): Promise<void> {
    const id = `${employeeId}_${date}`;
    const cleaned = cleanUndefined(record);
    await setDoc(doc(db, 'attendance', id), cleaned, { merge: true });
  }

  /**
   * Deletes an attendance record.
   */
  static async deleteRecord(employeeId: string, date: string): Promise<void> {
    const id = `${employeeId}_${date}`;
    await deleteDoc(doc(db, 'attendance', id));
  }

  /**
   * Offline Sync Queue Methods
   */
  static async queueOfflinePunch(employeeId: string, date: string, punch: { type: 'in' | 'out', time: string, photoUrl?: string }): Promise<void> {
    const queue = this.getOfflineQueue();
    queue.push({ id: `_QUEUE_${Date.now()}`, employeeId, date, punch, timestamp: Date.now() });
    localStorage.setItem('gaushala_offline_punches', JSON.stringify(queue));
  }

  static getOfflineQueue(): any[] {
    const str = localStorage.getItem('gaushala_offline_punches');
    if (str) {
      try {
        return JSON.parse(str);
      } catch (e) {
        return [];
      }
    }
    return [];
  }

  static clearOfflineQueue(): void {
    localStorage.removeItem('gaushala_offline_punches');
  }

  static removeQueueItem(id: string): void {
    let queue = this.getOfflineQueue();
    queue = queue.filter(q => q.id !== id);
    localStorage.setItem('gaushala_offline_punches', JSON.stringify(queue));
  }
}
