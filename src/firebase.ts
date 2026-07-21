import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut 
} from 'firebase/auth';
import { 
  getFirestore, doc, getDoc, setDoc, deleteDoc, onSnapshot, 
  collection, writeBatch, enableMultiTabIndexedDbPersistence, getDocs 
} from 'firebase/firestore';
import { 
  AppDatabase, Employee, Payment, Earning, Deduction, 
  OvertimeEntry, LateFineEntry, AttendanceMap, CompanySettings,
  AuditLogEntry, RecycleBinItem, ApprovalRequest, NotificationItem,
  GeoFence, DeviceRegistration, SyncQueueItem, RouteHistory, LiveLocation, AttendanceReview
} from './types';

// User provided Firebase web app's configuration
const firebaseConfig = {
  apiKey: "AIzaSyDxv0HwYsHa5zIf-oDxbVRNmv0mwQ1W-EE",
  authDomain: "shree-kamdhenu-ems.firebaseapp.com",
  projectId: "shree-kamdhenu-ems",
  storageBucket: "shree-kamdhenu-ems.firebasestorage.app",
  messagingSenderId: "856058225023",
  appId: "1:856058225023:web:e1f27fbd9a873842a1fa4a",
  measurementId: "G-Y1MQ90FY5C"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Enable Offline Cache
enableMultiTabIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    console.warn('Firestore persistence failed-precondition: multiple tabs open.');
  } else if (err.code === 'unimplemented') {
    console.warn('Firestore persistence unimplemeted by browser.');
  }
});

const googleProvider = new GoogleAuthProvider();

export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error("Google Sign-In Error:", error);
    throw error;
  }
}

export async function signUpWithEmail(email: string, pass: string) {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, pass);
    return result.user;
  } catch (error) {
    console.error("Email SignUp Error:", error);
    throw error;
  }
}

export async function loginWithEmail(email: string, pass: string) {
  try {
    const result = await signInWithEmailAndPassword(auth, email, pass);
    return result.user;
  } catch (error) {
    console.error("Email Login Error:", error);
    throw error;
  }
}

export async function logoutFirebase() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Firebase SignOut Error:", error);
    throw error;
  }
}

// Global Firestore error handler
export function handleFirestoreError(error: unknown, path: string | null) {
  console.error(`Firestore Error at [${path}]:`, error);
  return {
    error: error instanceof Error ? error.message : String(error),
    path
  };
}

// Deep clean undefined parameters for Firestore safety
export function cleanUndefined(obj: any): any {
  if (obj === undefined) return null;
  if (obj === null) return null;
  if (Array.isArray(obj)) {
    return obj.map(cleanUndefined);
  }
  if (typeof obj === 'object') {
    const res: any = {};
    for (const key of Object.keys(obj)) {
      res[key] = cleanUndefined(obj[key]);
    }
    return res;
  }
  return obj;
}

// Keep tracking copy of database for diff-based saves
let lastSavedDb: AppDatabase | null = null;

// Initialize legacy migration
let migrationChecked = false;

async function checkAndRunMigration() {
  if (migrationChecked) return;
  migrationChecked = true;

  try {
    const legacyDocRef = doc(db, 'gaushala_configs/main');
    const legacySnap = await getDoc(legacyDocRef);
    if (!legacySnap.exists()) return;

    // Check if already migrated
    const companySettingsRef = doc(db, 'settings/company');
    const settingsSnap = await getDoc(companySettingsRef);
    if (settingsSnap.exists() && settingsSnap.data()?.migrated === true) {
      return; // Already migrated
    }

    const legacyData = legacySnap.data() as AppDatabase;
    console.log('Starting data migration to multi-collection structure...');

    // Migrate company settings
    const company = legacyData.company || { name: 'Shree Kamdhenu' };
    await setDoc(companySettingsRef, { ...company, migrated: true });

    // Helper for batch writes
    const migrateCollection = async (items: any[], colName: string) => {
      if (!items || !items.length) return;
      let batch = writeBatch(db);
      let count = 0;
      for (const item of items) {
        if (!item || !item.id) continue;
        const cleaned = cleanUndefined(item);
        batch.set(doc(db, colName, item.id), cleaned);
        count++;
        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) {
        await batch.commit();
      }
    };

    // Migrate employees
    await migrateCollection(legacyData.employees, 'employees');

    // Migrate transactions
    await migrateCollection(legacyData.payments, 'payments');
    await migrateCollection(legacyData.earnings, 'earnings');
    await migrateCollection(legacyData.deductions, 'deductions');
    await migrateCollection(legacyData.overtimeEntries, 'overtimeEntries');
    await migrateCollection(legacyData.lateFineEntries, 'lateFineEntries');

    // Migrate attendance map
    if (legacyData.attendance) {
      let batch = writeBatch(db);
      let count = 0;
      for (const key of Object.keys(legacyData.attendance)) {
        const record = legacyData.attendance[key];
        if (!record) continue;
        batch.set(doc(db, 'attendance', key), record);
        count++;
        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) {
        await batch.commit();
      }
    }

    console.log('Migration successfully completed!');
  } catch (err) {
    console.error('Migration failed:', err);
  }
}

/**
 * Saves database state to Firebase Firestore using diff-based granular updates
 */
export async function saveDatabaseToFirebase(newDb: AppDatabase): Promise<void> {
  try {
    if (!lastSavedDb) {
      // If we don't have a baseline, we cannot diff, so we store locally and skip
      lastSavedDb = JSON.parse(JSON.stringify(newDb));
      return;
    }

    const batch = writeBatch(db);
    let operationCount = 0;

    const addOperation = () => {
      operationCount++;
      if (operationCount >= 400) {
        console.warn('Batch size reaching limits in single sync. Throttled.');
      }
    };

    // 1. Sync Company Settings
    if (newDb.company) {
      const settingsStr = JSON.stringify(newDb.company);
      const oldSettingsStr = JSON.stringify(lastSavedDb?.company || {});
      if (settingsStr !== oldSettingsStr) {
        // Safe protection: do not allow a clean state without a logo to overwrite a state that has a logo
        if (!newDb.company.logo && lastSavedDb?.company?.logo) {
          newDb.company.logo = lastSavedDb.company.logo;
        }
        const cleaned = cleanUndefined(newDb.company);
        batch.set(doc(db, 'settings/company'), { ...cleaned, migrated: true }, { merge: true });
        addOperation();
      }
    }

    // Helper for standard entity diffs
    const diffEntity = (newItems: any[] = [], oldItems: any[] = [], colName: string) => {
      const oldMap = new Map(oldItems.map(item => [item.id, item]));
      const newMap = new Map(newItems.map(item => [item.id, item]));

      // Write added/updated
      for (const item of newItems) {
        const oldItem = oldMap.get(item.id);
        if (!oldItem || JSON.stringify(item) !== JSON.stringify(oldItem)) {
          const cleaned = cleanUndefined(item);
          batch.set(doc(db, colName, item.id), cleaned, { merge: true });
          addOperation();
        }
      }

      // Delete removed
      for (const item of oldItems) {
        if (!newMap.has(item.id)) {
          batch.delete(doc(db, colName, item.id));
          addOperation();
        }
      }
    };

    // 2. Diff Collections
    diffEntity(newDb.employees, lastSavedDb.employees, 'employees');
    diffEntity(newDb.payments, lastSavedDb.payments, 'payments');
    diffEntity(newDb.earnings, lastSavedDb.earnings, 'earnings');
    diffEntity(newDb.deductions, lastSavedDb.deductions, 'deductions');
    diffEntity(newDb.overtimeEntries, lastSavedDb.overtimeEntries, 'overtimeEntries');
    diffEntity(newDb.lateFineEntries, lastSavedDb.lateFineEntries, 'lateFineEntries');
    diffEntity(newDb.auditLogs, lastSavedDb.auditLogs, 'auditLogs');
    diffEntity(newDb.recycleBin, lastSavedDb.recycleBin, 'recycleBin');
    diffEntity(newDb.approvalRequests, lastSavedDb.approvalRequests, 'approvalRequests');
    diffEntity(newDb.notifications, lastSavedDb.notifications, 'notifications');
    diffEntity(newDb.geofences || [], lastSavedDb.geofences || [], 'geofences');
    diffEntity(newDb.routeHistories || [], lastSavedDb.routeHistories || [], 'routeHistories');
    diffEntity(newDb.devices || [], lastSavedDb.devices || [], 'devices');
    diffEntity(newDb.offlineQueue || [], lastSavedDb.offlineQueue || [], 'offlineQueue');
    diffEntity(newDb.attendanceReviews || [], lastSavedDb.attendanceReviews || [], 'attendanceReviews');

    // 2.5 Diff Live Locations
    const newLocs = newDb.liveLocations || {};
    const oldLocs = lastSavedDb.liveLocations || {};
    for (const key of Object.keys(newLocs)) {
      const newVal = newLocs[key];
      const oldVal = oldLocs[key];
      if (!oldVal || JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
        batch.set(doc(db, 'liveLocations', key), cleanUndefined(newVal), { merge: true });
        addOperation();
      }
    }
    for (const key of Object.keys(oldLocs)) {
      if (!newLocs[key]) {
        batch.delete(doc(db, 'liveLocations', key));
        addOperation();
      }
    }

    // 3. Diff Attendance Map
    const newAtt = newDb.attendance || {};
    const oldAtt = lastSavedDb.attendance || {};

    for (const key of Object.keys(newAtt)) {
      const newVal = newAtt[key];
      const oldVal = oldAtt[key];
      if (!oldVal || JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
        batch.set(doc(db, 'attendance', key), cleanUndefined(newVal), { merge: true });
        addOperation();
      }
    }

    for (const key of Object.keys(oldAtt)) {
      if (!newAtt[key]) {
        batch.delete(doc(db, 'attendance', key));
        addOperation();
      }
    }

    // Commit only if there are pending writes
    if (operationCount > 0) {
      await batch.commit();
    }

    // Keep cache updated
    lastSavedDb = JSON.parse(JSON.stringify(newDb));
  } catch (error) {
    handleFirestoreError(error, 'StateSync');
    throw error;
  }
}

/**
 * Loads database state from Firebase Firestore (One-time fetch)
 */
export async function loadDatabaseFromFirebase(): Promise<AppDatabase | null> {
  // Return null so checking scripts fall back to legacy check
  return null;
}

/**
 * Sets up a realtime sync listener with Firestore for all collections
 */
export function syncDatabaseFromFirebase(
  onUpdate: (database: AppDatabase) => void,
  onError: (error: any) => void
) {
  // Trigger legacy migration first
  checkAndRunMigration();

  // In-memory collections state
  const state: AppDatabase = {
    employees: [],
    attendance: {},
    payments: [],
    earnings: [],
    deductions: [],
    overtimeEntries: [],
    lateFineEntries: [],
    company: undefined,
    auditLogs: [],
    recycleBin: [],
    approvalRequests: [],
    notifications: [],
    geofences: [],
    devices: [],
    offlineQueue: [],
    routeHistories: [],
    liveLocations: {},
    attendanceReviews: []
  };

  let cleanupScheduled = false;

  const runAutoCleanupAndArchiving = async (dbInstance: AppDatabase) => {
    if (cleanupScheduled) return;
    cleanupScheduled = true;
    try {
      const today = new Date();
      const batch = writeBatch(db);
      let count = 0;

      // 1. Delete route histories older than 5 days
      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(today.getDate() - 5);
      const routesSnap = await getDocs(collection(db, 'routeHistories'));
      routesSnap.forEach(dDoc => {
        const data = dDoc.data();
        if (data.date) {
          const dDate = new Date(data.date + 'T00:00:00');
          if (dDate < fiveDaysAgo) {
            batch.delete(dDoc.ref);
            count++;
          }
        }
      });

      // 2. Selfie Purge: delete selfie images from attendance records older than 15 days
      const fifteenDaysAgo = new Date();
      fifteenDaysAgo.setDate(today.getDate() - 15);
      const attendanceSnap = await getDocs(collection(db, 'attendance'));
      attendanceSnap.forEach(dDoc => {
        const data = dDoc.data();
        const parts = dDoc.id.split('_');
        if (parts.length >= 2) {
          const dateStr = parts[1];
          const attDate = new Date(dateStr + 'T00:00:00');
          if (attDate < fifteenDaysAgo && data.selfie) {
            batch.update(dDoc.ref, { selfie: null });
            count++;
          }
        }
      });

      // 3. Purge notifications older than 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(today.getDate() - 90);
      const notificationsSnap = await getDocs(collection(db, 'notifications'));
      notificationsSnap.forEach(dDoc => {
        const data = dDoc.data();
        if (data.timestamp) {
          const nDate = new Date(data.timestamp);
          if (nDate < ninetyDaysAgo) {
            batch.delete(dDoc.ref);
            count++;
          }
        }
      });

      // 4. Archive policy for Audit Logs: move logs older than 90 days to 'audit_logs_archive'
      const auditLogsSnap = await getDocs(collection(db, 'auditLogs'));
      for (const dDoc of auditLogsSnap.docs) {
        const data = dDoc.data();
        if (data.timestamp) {
          const aDate = new Date(data.timestamp.replace(' ', 'T'));
          if (aDate < ninetyDaysAgo) {
            await setDoc(doc(db, 'audit_logs_archive', dDoc.id), data);
            batch.delete(dDoc.ref);
            count++;
          }
        }
      }

      if (count > 0) {
        await batch.commit();
        console.log(`Automatic cleanup scheduler completed. Purged/Archived ${count} items.`);
      }
    } catch (err) {
      console.error('Failed to run automatic cleanup scheduler', err);
    }
  };

  const unsubscribes: (() => void)[] = [];
  const loadedKeys = new Set<string>();

  const triggerUpdate = (key: string) => {
    loadedKeys.add(key);
    // Only fire update events to App.tsx when all 18 listeners have completed their initial fetch
    if (loadedKeys.size >= 18) {
      const freshDb = { ...state };
      lastSavedDb = JSON.parse(JSON.stringify(freshDb));
      onUpdate(freshDb);
      runAutoCleanupAndArchiving(freshDb);
    }
  };

  const setupCollectionListener = <T>(
    colName: string,
    stateKey: keyof AppDatabase,
    parser: (docData: any, docId: string) => T
  ) => {
    const unsub = onSnapshot(
      collection(db, colName),
      (snap) => {
        const list: T[] = [];
        snap.forEach((doc) => {
          list.push(parser(doc.data(), doc.id));
        });
        (state[stateKey] as T[]) = list;
        triggerUpdate(colName);
      },
      (error) => {
        handleFirestoreError(error, colName);
        onError(error);
      }
    );
    unsubscribes.push(unsub);
  };

  // Setup list listeners (10 listeners)
  setupCollectionListener<Employee>('employees', 'employees', (data) => data as Employee);
  setupCollectionListener<Payment>('payments', 'payments', (data) => data as Payment);
  setupCollectionListener<Earning>('earnings', 'earnings', (data) => data as Earning);
  setupCollectionListener<Deduction>('deductions', 'deductions', (data) => data as Deduction);
  setupCollectionListener<OvertimeEntry>('overtimeEntries', 'overtimeEntries', (data) => data as OvertimeEntry);
  setupCollectionListener<LateFineEntry>('lateFineEntries', 'lateFineEntries', (data) => data as LateFineEntry);
  setupCollectionListener<AuditLogEntry>('auditLogs', 'auditLogs', (data) => data as AuditLogEntry);
  setupCollectionListener<RecycleBinItem>('recycleBin', 'recycleBin', (data) => data as RecycleBinItem);
  setupCollectionListener<ApprovalRequest>('approvalRequests', 'approvalRequests', (data) => data as ApprovalRequest);
  setupCollectionListener<NotificationItem>('notifications', 'notifications', (data) => data as NotificationItem);
  setupCollectionListener<GeoFence>('geofences', 'geofences', (data) => data as GeoFence);
  setupCollectionListener<DeviceRegistration>('devices', 'devices', (data) => data as DeviceRegistration);
  setupCollectionListener<SyncQueueItem>('offlineQueue', 'offlineQueue', (data) => data as SyncQueueItem);
  setupCollectionListener<RouteHistory>('routeHistories', 'routeHistories', (data) => data as RouteHistory);
  setupCollectionListener<AttendanceReview>('attendanceReviews', 'attendanceReviews', (data) => data as AttendanceReview);

  // Setup liveLocations listener (15th listener)
  const unsubLocs = onSnapshot(
    collection(db, 'liveLocations'),
    (snap) => {
      const map: Record<string, LiveLocation> = {};
      snap.forEach((doc) => {
        map[doc.id] = doc.data() as LiveLocation;
      });
      state.liveLocations = map;
      triggerUpdate('liveLocations');
    },
    (error) => {
      handleFirestoreError(error, 'liveLocations');
      onError(error);
    }
  );
  unsubscribes.push(unsubLocs);

  // Setup attendance map listener (11th listener)
  const unsubAtt = onSnapshot(
    collection(db, 'attendance'),
    (snap) => {
      const map: AttendanceMap = {};
      snap.forEach((doc) => {
        map[doc.id] = doc.data();
      });
      state.attendance = map;
      triggerUpdate('attendance');
    },
    (error) => {
      handleFirestoreError(error, 'attendance');
      onError(error);
    }
  );
  unsubscribes.push(unsubAtt);

  // Setup company settings listener (12th listener)
  const unsubSettings = onSnapshot(
    doc(db, 'settings/company'),
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const { migrated, ...companySettings } = data;
        state.company = companySettings as CompanySettings;
        triggerUpdate('settings');
      } else {
        // Seed default settings if empty
        const defaultCompany: CompanySettings = {
          name: 'Shree Kamdhenu',
          orgName: 'Kamdhenu Trust',
          website: 'https://shreekamdhenu.in',
          notes: 'Pious cow shelter and welfare administration.',
          enablePunchIO: true,
          enableLocation: true,
          enableSelfie: false,
          geoRadius: '100 Meter',
          defaultCycle: '1st to End of Month',
          calcMonthlyWage: 'Prorated by attendance days',
          calcDailyWage: 'Present vs Half Day vs Absent',
          calcHourlyWage: 'Hourly rate * Hours logged',
          allowAdvance: true,
          allowExtraEarnings: true,
          allowDeductions: true,
          allowOvertime: true,
          theme: 'Light',
          adminPin: ''
        };
        setDoc(doc(db, 'settings/company'), { ...defaultCompany, migrated: true });
        state.company = defaultCompany;
        triggerUpdate('settings');
      }
    },
    (error) => {
      handleFirestoreError(error, 'settings/company');
      onError(error);
    }
  );
  unsubscribes.push(unsubSettings);

  // Return unified unsubscribe helper
  return () => {
    unsubscribes.forEach(unsub => unsub());
  };
}
