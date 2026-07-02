import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

export class MonitoringService {
  /**
   * Lightweight error logging to Firestore 'logs' collection.
   * Logs failures only; no continuous telemetry or GPS logs.
   */
  static async logError(context: string, error: Error | any): Promise<void> {
    try {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const logId = `_LOG_${Date.now()}`;
      await setDoc(doc(db, 'logs', logId), {
        context,
        message: errorMsg,
        timestamp: new Date().toISOString()
      });
      console.error(`[MonitoringService] Logged Error in ${context}:`, errorMsg);
    } catch (e) {
      console.error('Failed to log error to Firestore:', e);
    }
  }
}
