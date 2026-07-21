import { SyncQueueItem, AppDatabase } from '../types';
import { saveDatabaseToFirebase } from '../firebase';

export class SyncEngine {
  private queue: SyncQueueItem[] = [];
  private onQueueChangeCallback: (() => void) | null = null;
  private isProcessing = false;
  private maxRetries = 5;
  
  private activeDb: AppDatabase | null = null;
  private onUpdateDbCallback: ((newDb: AppDatabase) => void) | null = null;

  constructor() {
    this.loadQueue();
    // Watch for network connectivity transitions
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.processQueue());
    }
  }

  public setDbContext(db: AppDatabase, onUpdate: (newDb: AppDatabase) => void) {
    this.activeDb = db;
    this.onUpdateDbCallback = onUpdate;
  }

  private loadQueue() {
    try {
      const data = localStorage.getItem('skbg_sync_queue');
      if (data) {
        this.queue = JSON.parse(data);
      }
    } catch (e) {
      console.error('Failed to load sync queue', e);
    }
  }

  private saveQueue() {
    try {
      localStorage.setItem('skbg_sync_queue', JSON.stringify(this.queue));
      if (this.onQueueChangeCallback) {
        this.onQueueChangeCallback();
      }
    } catch (e) {
      console.error('Failed to save sync queue', e);
    }
  }

  public getQueue(): SyncQueueItem[] {
    return this.queue;
  }

  public subscribe(callback: () => void): () => void {
    this.onQueueChangeCallback = callback;
    return () => {
      this.onQueueChangeCallback = null;
    };
  }

  /**
   * Pushes a new request into the local offline queue
   */
  public enqueue(action: string, payload: any) {
    const item: SyncQueueItem = {
      id: `${action}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      action,
      payload,
      timestamp: new Date().toISOString(),
      retryCount: 0,
      status: 'Pending'
    };

    // If duplicate check: avoid identical pending punch/action payload
    const isDuplicate = this.queue.some(
      q => q.action === action && JSON.stringify(q.payload) === JSON.stringify(payload)
    );

    if (isDuplicate) {
      console.warn('Idempotent check blocked duplicate sync item:', item);
      return;
    }

    this.queue.push(item);
    this.saveQueue();
    this.processQueue();
  }

  /**
   * Iterates through the offline queue and processes pending elements online
   */
  public async processQueue(dbInstance?: AppDatabase, onUpdateDb?: (newDb: AppDatabase) => void) {
    if (this.isProcessing || !navigator.onLine || this.queue.length === 0) return;

    const dbToUse = dbInstance || this.activeDb;
    const updateCbToUse = onUpdateDb || this.onUpdateDbCallback;

    if (!dbToUse || !updateCbToUse) {
      console.warn('Database instance not loaded during sync execution');
      return;
    }

    this.isProcessing = true;
    console.log(`Processing sync queue containing ${this.queue.length} items...`);

    const failedItems: SyncQueueItem[] = [];
    let currentDbState = dbToUse;

    // Loop through the queue
    for (const item of this.queue) {
      if (item.status === 'Synced') continue;

      try {
        const updatedDb = this.applyActionToDb(currentDbState, item);
        
        // Sync changes immediately to Firebase
        await saveDatabaseToFirebase(updatedDb);
        updateCbToUse(updatedDb);
        currentDbState = updatedDb;

        item.status = 'Synced';
      } catch (error: any) {
        console.error(`Sync error on request ${item.id}:`, error);
        item.retryCount++;
        item.failureReason = error.message || String(error);

        if (item.retryCount >= this.maxRetries) {
          item.status = 'Failed';
          // Notify admin and user
          alert(`Sync Failure: Request "${item.action}" failed to upload after ${this.maxRetries} attempts. Details preserved in queue.`);
        } else {
          failedItems.push(item);
        }
      }
    }

    // Retain only unsynced or failed entries in the queue
    this.queue = this.queue.filter(item => item.status !== 'Synced');
    this.saveQueue();
    this.isProcessing = false;
  }

  public applyActionToDb(db: AppDatabase, item: SyncQueueItem): AppDatabase {
    const fresh = JSON.parse(JSON.stringify(db)) as AppDatabase;

    if (item.action === 'approval_request') {
      const list = fresh.approvalRequests || [];
      // Idempotent write: ensure request doesn't already exist
      if (!list.some(r => r.id === item.payload.id)) {
        list.push(item.payload);
      }
      fresh.approvalRequests = list;
    } else if (item.action === 'device_registration') {
      const list = fresh.devices || [];
      if (!list.some(d => d.id === item.payload.id)) {
        list.push(item.payload);
      }
      fresh.devices = list;
    } else if (item.action === 'audit_log') {
      const list = fresh.auditLogs || [];
      if (!list.some(a => a.id === item.payload.id)) {
        list.push(item.payload);
      }
      fresh.auditLogs = list;
    } else if (item.action === 'notification') {
      const list = fresh.notifications || [];
      if (!list.some(n => n.id === item.payload.id)) {
        list.push(item.payload);
      }
      fresh.notifications = list;
    } else if (item.action === 'live_location') {
      const loc = item.payload;
      if (!fresh.liveLocations) {
        fresh.liveLocations = {};
      }
      fresh.liveLocations[loc.employeeId] = loc;
    } else if (item.action === 'route_history') {
      const route = item.payload;
      const list = fresh.routeHistories || [];
      const idx = list.findIndex(r => r.id === route.id);
      if (idx > -1) {
        list[idx] = route;
      } else {
        list.push(route);
      }
      fresh.routeHistories = list;
    }

    return fresh;
  }
}

export const SyncEngineService = new SyncEngine();
