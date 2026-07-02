import { AppDatabase } from '../types';

export class CleanupService {
  /**
   * Daily background purge for old tracking data to keep the database lightweight.
   * Rules:
   * - routeHistories older than 5 days are deleted
   * - offline queue failed items older than 15 days are removed
   */
  static runDailyCleanup(db: AppDatabase): void {
    const now = new Date();
    
    // Cleanup old route histories (if any were implemented in db)
    if (db.routeHistories) {
      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(now.getDate() - 5);
      
      const toKeep = db.routeHistories.filter(route => {
        const routeDate = new Date(route.date + 'T00:00:00');
        return routeDate >= fiveDaysAgo;
      });
      
      if (toKeep.length !== db.routeHistories.length) {
        db.routeHistories = toKeep;
        console.log(`[CleanupService] Removed ${db.routeHistories.length - toKeep.length} old route histories.`);
      }
    }
    
    // Offline queues are usually handled locally per device, so nothing global needed here,
    // unless we also clean the recycle bin.
    if (db.recycleBin) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(now.getDate() - 30);
      
      const toKeep = db.recycleBin.filter(bin => {
        const delDate = new Date(bin.deletedAt);
        return delDate >= thirtyDaysAgo;
      });
      
      if (toKeep.length !== db.recycleBin.length) {
        db.recycleBin = toKeep;
        console.log(`[CleanupService] Removed ${db.recycleBin.length - toKeep.length} old recycle bin items.`);
      }
    }
  }
}
