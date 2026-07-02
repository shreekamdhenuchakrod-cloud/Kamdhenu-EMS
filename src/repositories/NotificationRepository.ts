import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { db, cleanUndefined } from '../firebase';
import { NotificationItem, AuditLogEntry } from '../types';

export class NotificationRepository {
  static async saveNotification(notification: NotificationItem): Promise<void> {
    const cleaned = cleanUndefined(notification);
    await setDoc(doc(db, 'notifications', notification.id), cleaned, { merge: true });
  }

  static async markAsRead(id: string): Promise<void> {
    await updateDoc(doc(db, 'notifications', id), { read: true });
  }

  static async saveAuditLog(log: AuditLogEntry): Promise<void> {
    const cleaned = cleanUndefined(log);
    await setDoc(doc(db, 'auditLogs', log.id), cleaned, { merge: true });
  }
}
