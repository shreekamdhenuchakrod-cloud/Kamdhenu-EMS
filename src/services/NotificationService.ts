import { AppDatabase, NotificationItem } from '../types';

export class NotificationService {
  /**
   * Get all notifications for a specific user.
   */
  static getUserNotifications(userId: string, db: AppDatabase): NotificationItem[] {
    if (!db.notifications) return [];
    return db.notifications
      .filter(n => n.userId === userId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /**
   * Get the unread badge count for a specific user.
   */
  static getUnreadCount(userId: string, db: AppDatabase): number {
    if (!db.notifications) return 0;
    return db.notifications.filter(n => n.userId === userId && !n.read).length;
  }
}
