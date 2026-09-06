import React, { useState, useEffect, useRef } from 'react';
import { AppDatabase, Employee, EmployeeType, RecycleBinItem, AuditLogEntry, ApprovalRequest } from './types';
import { loadDatabase, saveDatabase, calcEmployeeFinancials, DEFAULT_DATABASE, timeToHrs } from './db';
import { SyncEngineService } from './services/SyncEngine';
import { 
  saveDatabaseToFirebase, 
  syncDatabaseFromFirebase, 
  loadDatabaseFromFirebase,
  auth,
  logoutFirebase
} from './firebase';
import { onAuthStateChanged } from 'firebase/auth';

// Modular Visual Component Importations
import LoginView from './components/LoginView';
import DashboardView from './components/DashboardView';
import StaffListView from './components/StaffListView';
import AddStaffView from './components/AddStaffView';
import ProfileView from './components/ProfileView';
import AttendanceView from './components/AttendanceView';
import SettingsView from './components/SettingsView';
import FirebaseTroubleshoot from './components/FirebaseTroubleshoot';
import Icon from './components/Icon';

import EmployeeDashboard from './components/EmployeeDashboard';
import RecycleBinView from './components/RecycleBinView';
import AuditLogsView from './components/AuditLogsView';
import ApprovalPanel from './components/ApprovalPanel';
import GeoFenceManager from './components/GeoFenceManager';
import NotificationDesk from './components/NotificationDesk';

export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<any>(null);
  const [authInitialized, setAuthInitialized] = useState<boolean>(false);
  const [isPinVerified, setIsPinVerified] = useState<boolean>(() => {
    return sessionStorage.getItem('gaushala_pin_verified') === 'true';
  });

  // Employee Portal Session
  const [employeeSessionId, setEmployeeSessionId] = useState<string | null>(() => {
    return localStorage.getItem('gaushala_employee_session_id') || null;
  });

  // Helper function to sync auto overtime, late fine evaluations, and auto deduction triggers
  const syncAutoOvertime = (currentDb: AppDatabase): AppDatabase => {
    let otEntries = [...(currentDb.overtimeEntries || [])];
    
    // 1. Filter out previous auto-calculated overtime entries to clean slate
    otEntries = otEntries.filter((o) => o.description !== "Auto-calculated Overtime");
    
    // 2. Clear out legacy late fine entries (they are replaced by deductions module reviews)
    let lfEntries: any[] = [];

    // Copy collections to drafts
    let reviews = [...(currentDb.attendanceReviews || [])];
    let deductions = [...(currentDb.deductions || [])];
    let notifications = [...(currentDb.notifications || [])];

    // Helper to format Date + Days
    const addDays = (dateStr: string, days: number): Date => {
      const d = new Date(dateStr + 'T00:00:00');
      return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
    };

    const isExpired = (dateStr: string, graceDays: number): boolean => {
      const expiryDate = addDays(dateStr, graceDays);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      expiryDate.setHours(0, 0, 0, 0);
      return today > expiryDate;
    };

    // Calculate overtime & under-hours for each day
    Object.keys(currentDb.attendance).forEach((key) => {
      const parts = key.split('_');
      if (parts.length < 2) return;
      const employeeId = parts[0];
      const date = parts[1];

      const employee = currentDb.employees.find((e) => e.id === employeeId);
      if (!employee) return;

      const rec = currentDb.attendance[key];
      
      // Sum hours of all sessions for this day
      let totalHrs = 0;
      if (rec && rec.sessions) {
        rec.sessions.forEach((s) => {
          if (s.in && s.out) {
            totalHrs += timeToHrs(s.in, s.out);
          }
        });
      }

      const baseHours = employee.baseHours || 8;
      
      // 3. Overtime logic: if Worked > Standard
      if (totalHrs > baseHours && employee.type !== 'Hourly') {
        const excessHrs = totalHrs - baseHours;
        otEntries.push({
          id: `_OT_AUTO_${employeeId}_${date}_${Date.now()}`,
          employeeId,
          date,
          hours: parseFloat(excessHrs.toFixed(2)),
          calcType: 'HourlyRate',
          amount: 0,
          description: 'Auto-calculated Overtime'
        });
      }

      // 4. Under-hours Fine Evaluation: if Worked < Standard
      if (rec && (totalHrs < baseHours || rec.status === 'Absent')) {
        const comp = currentDb.company || ({} as any);
        const empSettings = employee.fineSettings;

        const fineEnabled = empSettings ? empSettings.fineEnabled : (comp.attendanceFineEnabled !== false);
        const autoDeductionOn = empSettings ? empSettings.autoDeductionEnabled : (comp.autoDeductionEnabled !== false);
        const gracePeriodDays = empSettings ? empSettings.gracePeriodDays : (comp.gracePeriodDays ?? 3);
        const maxFine = empSettings ? empSettings.maxFineAmount : (comp.maxFineAmount ?? 50);
        const fiftyPercentRule = empSettings ? empSettings.fiftyPercentRuleEnabled : (comp.fiftyPercentRuleEnabled !== false);
        
        if (fineEnabled) {
          const missingHrs = Math.max(0, baseHours - totalHrs);
          
          let fineAmt = 0;
          if (fiftyPercentRule && totalHrs >= (baseHours * 0.5)) {
            fineAmt = 0; // 50% No Deduction Rule
          } else {
            // Find in fine table
            const table = (empSettings && empSettings.fineTable) ? empSettings.fineTable : (comp.companyFineTable || {});
            const integerMissing = Math.round(missingHrs);
            
            if (table[integerMissing] !== undefined) {
              fineAmt = table[integerMissing];
            } else {
              // Fallback: Proportional
              fineAmt = (missingHrs / baseHours) * maxFine;
            }
          }

          // Check if there is an approved leave request for this date
          const approvedLeave = (currentDb.approvalRequests || []).find(r => 
            r.employeeId === employeeId && 
            r.category === 'Leave Request' && 
            r.date === date && 
            r.status === 'Approved'
          );

          if (approvedLeave) {
            fineAmt = 0; // No fine for approved leave
          }

          if (fineAmt > 0) {
            // Check if review entry exists
            const reviewKey = `_REV_${employeeId}_${date}`;
            let existingReview = reviews.find(r => r.id === reviewKey);

            if (!existingReview) {
              // Create Pending Review
              existingReview = {
                id: reviewKey,
                employeeId,
                date,
                workedHours: parseFloat(totalHrs.toFixed(2)),
                standardHours: baseHours,
                missingHours: parseFloat(missingHrs.toFixed(2)),
                fineAmount: parseFloat(fineAmt.toFixed(2)),
                status: 'Pending Review',
                createdDate: new Date().toISOString().split('T')[0],
                gracePeriodDays,
                autoDeductionOn
              };
              reviews.push(existingReview);

              // Notify employee
              notifications.push({
                id: `_NTF_EMP_REV_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
                userId: employeeId,
                title: 'Attendance Under Review',
                message: `You worked only ${totalHrs.toFixed(1)} hours today. Missing Hours: ${missingHrs.toFixed(1)}. Your attendance is under review. Complete a leave request within ${gracePeriodDays} days to avoid automatic deduction.`,
                timestamp: new Date().toISOString(),
                read: false
              });

              // Notify Admin
              notifications.push({
                id: `_NTF_ADM_REV_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
                userId: 'admin',
                title: 'Employee Attendance Under Review',
                message: `${employee.name} attendance is pending review. Grace period remaining: ${gracePeriodDays} days. Take action before automatic deduction.`,
                timestamp: new Date().toISOString(),
                read: false
              });
            }
          }
        }
      }
    });

    return {
      ...currentDb,
      overtimeEntries: otEntries,
      lateFineEntries: lfEntries,
      attendanceReviews: reviews,
      deductions,
      notifications
    };
  };

  const [db, rawSetDb] = useState<AppDatabase>(() => loadDatabase());

  const setDb = (newDb: AppDatabase | ((prev: AppDatabase) => AppDatabase)) => {
    if (typeof newDb === 'function') {
      rawSetDb((prev) => syncAutoOvertime(newDb(prev)));
    } else {
      rawSetDb(syncAutoOvertime(newDb));
    }
  };
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  // Enterprise overlays
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [showAuditLogs, setShowAuditLogs] = useState(false);

  // PWA Install Prompt Listener
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallApp = async () => {
    if (!deferredPrompt) {
      alert(lang === 'hi' ? 'ऐप पहले से इंस्टॉल है या आपका ब्राउज़र इसे सपोर्ट नहीं करता। कृपया ब्राउज़र मेनू से "Add to Home Screen" का उपयोग करें।' : 'App is already installed or your browser does not support this. Please use "Add to Home Screen" from your browser menu.');
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  // Real-time Cloud Synchronization status ('connecting' | 'synced' | 'error')
  const [syncStatus, setSyncStatus] = useState<'connecting' | 'synced' | 'error'>('connecting');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [showTroubleshoot, setShowTroubleshoot] = useState<boolean>(false);
  
  // Ref tracking the last serialized cloud string to avoid redundant writes and update feedback loops
  const lastFetchedDbRef = useRef<string>('');

  // Navigation Panel Views: 'dashboard', 'pv-staff', 'pv-att', 'pv-add', 'profile-detail', 'pv-rep', 'approvals'
  const [currentView, setCurrentView] = useState<string>('dashboard');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  // Track Firebase Auth state change
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthInitialized(true);
      if (!user) {
        setIsPinVerified(false);
        sessionStorage.removeItem('gaushala_pin_verified');
      } else {
        // Prevent automatic Change Passcode/PIN screen on normal login
        setIsPinVerified(true);
        sessionStorage.setItem('gaushala_pin_verified', 'true');
      }
    });
    return () => unsubscribeAuth();
  }, []);

  // Support mobile back button and browser history sync (PWA Navigation integration)
  useEffect(() => {
    if ((!firebaseUser || !isPinVerified) && !employeeSessionId) return;

    // Set a baseline state if no state is defined yet
    if (!window.history.state) {
      window.history.replaceState({ currentView, selectedEmployeeId }, '');
    }

    const handlePopState = (event: PopStateEvent) => {
      if (event.state) {
        const state = event.state as { currentView: string; selectedEmployeeId: string | null };
        if (state.currentView) {
          setCurrentView(state.currentView);
          setSelectedEmployeeId(state.selectedEmployeeId);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [firebaseUser, isPinVerified, employeeSessionId, currentView, selectedEmployeeId]);

  useEffect(() => {
    if ((!firebaseUser || !isPinVerified) && !employeeSessionId) return;

    const stateInHistory = window.history.state as { currentView: string; selectedEmployeeId: string | null } | null;
    if (
      !stateInHistory ||
      stateInHistory.currentView !== currentView ||
      stateInHistory.selectedEmployeeId !== selectedEmployeeId
    ) {
      window.history.pushState({ currentView, selectedEmployeeId }, '');
    }
  }, [currentView, selectedEmployeeId, firebaseUser, isPinVerified, employeeSessionId]);

  // Global Multi-lingual Switch ('en' | 'hi')
  const [lang, setLang] = useState<'en' | 'hi'>(() => {
    return (localStorage.getItem('gaushala_lang') as 'en' | 'hi') || 'en';
  });

  // Real-time Bidirectional Firebase Synchronization Listener
  useEffect(() => {
    // Sync regardless of login to fetch metadata
    let isSubscribed = true;
    setSyncStatus('connecting');

    const unsubscribe = syncDatabaseFromFirebase(
      (firestoreDb) => {
        if (!isSubscribed) return;
        const syncedDb = syncAutoOvertime(firestoreDb);
        
        // Merge offline queue items on top of firestore snapshot before setting state
        let mergedDb = syncedDb;
        const pendingQueueItems = SyncEngineService.getQueue().filter(q => q.status !== 'Synced');
        pendingQueueItems.forEach(item => {
          mergedDb = SyncEngineService.applyActionToDb(mergedDb, item);
        });

        const serialized = JSON.stringify(mergedDb);
        if (serialized !== lastFetchedDbRef.current && serialized !== JSON.stringify(db)) {
          lastFetchedDbRef.current = serialized;
          rawSetDb(mergedDb);
        }
        setSyncStatus('synced');
        setSyncError(null);
      },
      (error) => {
        if (!isSubscribed) return;
        console.error('Firebase sync error callback:', error);
        setSyncStatus('error');
        setSyncError(error?.error || String(error));
      }
    );

    return () => {
      isSubscribed = false;
      unsubscribe();
    };
  }, []);

  // Keep state synced onto secure local storage snaps and Firebase Cloud
  useEffect(() => {
    // 1. Sync to offline LocalStorage
    saveDatabase(db);

    // Prevent local database snapshots from overwriting cloud database before initial load finishes
    if (syncStatus !== 'synced') return;

    // 2. Sync to Firebase Cloud Firestore if update is user-driven (differs from cloud cache)
    const serialized = JSON.stringify(db);
    if (serialized !== lastFetchedDbRef.current) {
      lastFetchedDbRef.current = serialized;
      saveDatabaseToFirebase(db)
        .then(() => {
          setSyncError(null);
        })
        .catch((err) => {
          console.error('Firebase save error:', err);
          setSyncStatus('error');
          setSyncError(err instanceof Error ? err.message : String(err));
        });
    }
  }, [db, syncStatus]);

  // Register SyncEngine active context whenever database changes
  useEffect(() => {
    SyncEngineService.setDbContext(db, setDb);
  }, [db]);

  // Periodic background SyncEngine queue flush to Firebase every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (syncStatus === 'synced') {
        SyncEngineService.processQueue(db, (updatedDb) => {
          setDb(updatedDb);
        });
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [db, syncStatus]);

  // Auto-delete audit logs older than 15 days on application start
  useEffect(() => {
    if (db.auditLogs && db.auditLogs.length > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 15);
      const filtered = db.auditLogs.filter((log) => {
        try {
          // Format YYYY-MM-DD HH:mm:ss to parsable ISO format
          const parsableStr = log.timestamp.replace(' ', 'T');
          return new Date(parsableStr) >= cutoff;
        } catch {
          return true; 
        }
      });
      if (filtered.length !== db.auditLogs.length) {
        setDb((prev) => ({
          ...prev,
          auditLogs: filtered
        }));
      }
    }
    // Run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check at 8:00 PM if any employee forgot to punch out and alert the admin
  useEffect(() => {
    const checkForgotPunchOut = () => {
      const now = new Date();
      if (now.getHours() === 20 && now.getMinutes() < 2) {
        const dateStr = now.toISOString().split('T')[0];
        let updated = false;
        let newNotifs = [...(db.notifications || [])];

        db.employees.forEach((emp) => {
          if (emp.status !== 'Active') return;
          const rec = db.attendance[`${emp.id}_${dateStr}`];
          if (rec && rec.sessions && rec.sessions.length > 0) {
            const lastSession = rec.sessions[rec.sessions.length - 1];
            if (lastSession.in && !lastSession.out) {
              const notifId = `_NTF_FPO_${emp.id}_${dateStr}`;
              if (!newNotifs.some((n) => n.id === notifId)) {
                newNotifs.unshift({
                  id: notifId,
                  userId: 'admin',
                  title: lang === 'en' ? 'Forgot Punch Out' : 'पंच-आउट भूल गए',
                  message: `${emp.name} ${lang === 'en' ? 'forgot to punch out today.' : 'आज शाम को पंच-आउट करना भूल गए।'}`,
                  timestamp: new Date().toISOString(),
                  read: false
                });
                updated = true;
              }
            }
          }
        });

        if (updated) {
          setDb((prev) => ({
            ...prev,
            notifications: newNotifs
          }));
        }
      }
    };

    const interval = setInterval(checkForgotPunchOut, 60000);
    return () => clearInterval(interval);
  }, [db.employees, db.attendance, db.notifications, lang]);

  useEffect(() => {
    localStorage.setItem('gaushala_lang', lang);
  }, [lang]);

  const handleLogout = async () => {
    if (confirm(lang === 'en' ? 'Log out of this account?' : 'इस खाते से लॉगआउट करें?')) {
      await logoutFirebase();
      setIsPinVerified(false);
      sessionStorage.removeItem('gaushala_pin_verified');
    }
  };

  const handleEmployeeLogout = () => {
    if (confirm(lang === 'en' ? 'Log out of Employee Portal?' : 'स्टाफ पोर्टल से लॉगआउट करें?')) {
      setEmployeeSessionId(null);
      localStorage.removeItem('gaushala_employee_session_id');
    }
  };

  // --- Core CRUD Handlers ---

  // Onboard save
  const handleOnboardSave = (data: {
    name: string;
    mobile: string;
    type: EmployeeType;
    rate: number;
    pic: string;
    join: string;
    baseHours: number;
    address: string;
  }) => {
    const freshId = `_EMP_${Date.now()}`;
    const newEmp: Employee = {
      id: freshId,
      name: data.name,
      mobile: data.mobile,
      type: data.type,
      join: data.join,
      status: 'Active',
      baseHours: data.baseHours,
      address: data.address,
      pic: data.pic,
      salHistory: [{ ym: data.join.slice(0, 7), rate: data.rate }],
      loginPin: data.mobile.slice(-4) // Default PIN is last 4 digits of phone
    };

    const updatedDb = { ...db, employees: [...db.employees, newEmp] };
    
    // Add Audit Log
    const newAudit: AuditLogEntry = {
      id: `_AUD_${Date.now()}`,
      adminName: db.company?.ownerName || 'Admin',
      action: 'Staff Registered',
      targetId: freshId,
      targetName: data.name,
      oldValue: 'None',
      newValue: 'Active Roster',
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      device: navigator.userAgent.includes('Mobile') ? 'Mobile Device' : 'Desktop Panel'
    };
    updatedDb.auditLogs = [newAudit, ...(db.auditLogs || [])];

    setDb(updatedDb);
    setCurrentView('pv-staff');
    alert(lang === 'en' ? '✓ New employee registered successfully!' : '✓ नया कर्मचारी सफलतापूर्वक पंजीकृत!');
  };

  // Restore staff statuses back to active
  const handleRestoreStaff = (id: string) => {
    const updatedEmployees = db.employees.map(e => {
      if (e.id === id) {
        return { ...e, status: 'Active' as const };
      }
      return e;
    });

    // Add Audit Log
    const emp = db.employees.find(e => e.id === id);
    const newAudit: AuditLogEntry = {
      id: `_AUD_${Date.now()}`,
      adminName: db.company?.ownerName || 'Admin',
      action: 'Staff Status Restored',
      targetId: id,
      targetName: emp?.name || '',
      oldValue: emp?.status || '',
      newValue: 'Active',
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      device: navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop'
    };

    setDb({ 
      ...db, 
      employees: updatedEmployees, 
      auditLogs: [newAudit, ...(db.auditLogs || [])] 
    });
    alert(lang === 'en' ? '✓ Employee status restored to active successfully!' : '✓ कर्मचारी को पुनः सक्रिय कर दिया गया है!');
  };

  // Change active profile to inactive/left job status
  const handleChangeStatusToLeft = (id: string) => {
    if (!confirm(lang === 'en' ? 'Mark this employee as Left Job?' : 'इस कर्मचारी को कार्य मुक्त (Left Job) के रूप में चिह्नित करें?')) return;
    const updatedEmployees = db.employees.map(e => {
      if (e.id === id) {
        return { ...e, status: 'Left Job' as const };
      }
      return e;
    });

    const emp = db.employees.find(e => e.id === id);
    const newAudit: AuditLogEntry = {
      id: `_AUD_${Date.now()}`,
      adminName: db.company?.ownerName || 'Admin',
      action: 'Staff Status Left Job',
      targetId: id,
      targetName: emp?.name || '',
      oldValue: 'Active',
      newValue: 'Left Job',
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      device: navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop'
    };

    setDb({ 
      ...db, 
      employees: updatedEmployees, 
      auditLogs: [newAudit, ...(db.auditLogs || [])] 
    });
    setCurrentView('pv-staff');
    setSelectedEmployeeId(null);
  };

  // Soft Delete Employee (Moves to Recycle Bin, Gated by 6-digit PIN)
  const handleDeleteStaffFully = (id: string) => {
    const emp = db.employees.find(e => e.id === id);
    if (!emp) return;

    const enteredPin = prompt(lang === 'en' ? 'Enter 6-digit Security PIN to confirm deletion:' : 'कर्मचारी हटाने की पुष्टि के लिए ६-अंकीय पिन डालें:');
    if (enteredPin !== db.company?.adminPin) {
      alert(lang === 'en' ? 'Incorrect Security PIN!' : 'गलत सुरक्षा पिन!');
      return;
    }

    // Capture records for Recycle Bin
    const attendance: any = {};
    Object.keys(db.attendance).forEach(k => {
      if (k.startsWith(`${id}_`)) {
        attendance[k] = db.attendance[k];
      }
    });

    const payments = db.payments.filter(p => p.employeeId === id);
    const earnings = db.earnings.filter(e => e.employeeId === id);
    const deductions = db.deductions.filter(d => d.employeeId === id);
    const overtimeEntries = db.overtimeEntries.filter(o => o.employeeId === id);
    const lateFineEntries = db.lateFineEntries.filter(f => f.employeeId === id);

    const binItem: RecycleBinItem = {
      id: `_BIN_${Date.now()}`,
      deletedAt: new Date().toISOString(),
      employee: emp,
      attendance,
      payments,
      earnings,
      deductions,
      overtimeEntries,
      lateFineEntries
    };

    // Filter tables
    const newEmployees = db.employees.filter(e => e.id !== id);
    const newPayments = db.payments.filter(p => p.employeeId !== id);
    const newEarnings = db.earnings.filter(e => e.employeeId !== id);
    const newDeductions = db.deductions.filter(d => d.employeeId !== id);
    const newOvertimeEntries = db.overtimeEntries.filter(o => o.employeeId !== id);
    const newLateFineEntries = db.lateFineEntries.filter(f => f.employeeId !== id);

    const newAttendance = { ...db.attendance };
    Object.keys(newAttendance).forEach(k => {
      if (k.startsWith(`${id}_`)) {
        delete newAttendance[k];
      }
    });

    const updatedDb: AppDatabase = {
      employees: newEmployees,
      attendance: newAttendance,
      payments: newPayments,
      earnings: newEarnings,
      deductions: newDeductions,
      overtimeEntries: newOvertimeEntries,
      lateFineEntries: newLateFineEntries,
      company: db.company,
      recycleBin: [binItem, ...(db.recycleBin || [])]
    };

    // Add Audit Log
    const newAudit: AuditLogEntry = {
      id: `_AUD_${Date.now()}`,
      adminName: db.company?.ownerName || 'Admin',
      action: 'Staff Moved to Recycle Bin',
      targetId: id,
      targetName: emp.name,
      oldValue: emp.status,
      newValue: 'Deleted (Recycle Bin)',
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      device: navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop'
    };
    updatedDb.auditLogs = [newAudit, ...(db.auditLogs || [])];

    setDb(updatedDb);
    setCurrentView('pv-staff');
    setSelectedEmployeeId(null);
    alert(lang === 'en' ? '✓ Employee records archived to Recycle Bin.' : '✓ कर्मचारी का रिकॉर्ड रीसायकल बिन में सहेज दिया गया है।');
  };

  // Restore Recycle Bin Item
  const handleRestoreRecycleItem = (item: RecycleBinItem) => {
    const updatedDb: AppDatabase = {
      ...db,
      employees: [...db.employees, item.employee],
      attendance: { ...db.attendance, ...item.attendance },
      payments: [...db.payments, ...item.payments],
      earnings: [...db.earnings, ...item.earnings],
      deductions: [...db.deductions, ...item.deductions],
      overtimeEntries: [...db.overtimeEntries, ...item.overtimeEntries],
      lateFineEntries: [...db.lateFineEntries, ...item.lateFineEntries],
      recycleBin: (db.recycleBin || []).filter(bin => bin.id !== item.id)
    };

    // Add Audit Log
    const newAudit: AuditLogEntry = {
      id: `_AUD_${Date.now()}`,
      adminName: db.company?.ownerName || 'Admin',
      action: 'Staff Restored from Recycle Bin',
      targetId: item.employee.id,
      targetName: item.employee.name,
      oldValue: 'Archived',
      newValue: 'Active',
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      device: navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop'
    };
    updatedDb.auditLogs = [newAudit, ...(db.auditLogs || [])];

    setDb(updatedDb);
    alert(lang === 'en' ? `✓ ${item.employee.name} restored successfully.` : `✓ ${item.employee.name} पुनः प्राप्त कर लिया गया है।`);
  };

  // Permanent Delete Recycle Bin Item
  const handlePermanentDeleteRecycleItem = (itemId: string) => {
    const item = db.recycleBin?.find(bin => bin.id === itemId);
    if (!item) return;

    if (!confirm(lang === 'en' ? 'PERMANENT PURGE: This will completely delete all records. This cannot be undone. Proceed?' : 'स्थायी विलोपन: यह सारा इतिहास स्थायी रूप से मिटा देगा। यह वापस नहीं होगा। पुष्टि करें?')) return;

    const updatedDb: AppDatabase = {
      ...db,
      recycleBin: (db.recycleBin || []).filter(bin => bin.id !== itemId)
    };

    // Add Audit Log
    const newAudit: AuditLogEntry = {
      id: `_AUD_${Date.now()}`,
      adminName: db.company?.ownerName || 'Admin',
      action: 'Staff Record Permanently Purged',
      targetId: item.employee.id,
      targetName: item.employee.name,
      oldValue: 'Recycle Bin',
      newValue: 'Permanently Purged',
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      device: navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop'
    };
    updatedDb.auditLogs = [newAudit, ...(db.auditLogs || [])];

    setDb(updatedDb);
    alert(lang === 'en' ? '✓ Archives permanently deleted.' : '✓ रिकॉर्ड स्थायी रूप से मिटा दिया गया है।');
  };

  const handleUpdateDatabaseDirectly = (updatedDb: AppDatabase) => {
    setDb(updatedDb);
  };

  const t = (en: string, hi: string) => (lang === 'en' ? en : hi);

  // If authentication is still initializing, show a full-screen loading spinner
  if (!authInitialized) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <Icon name="progress_activity" size={32} className="animate-spin text-blue-600" />
      </div>
    );
  }

  // A. If employee is logged in, show Employee Dashboard directly
  if (employeeSessionId) {
    return (
      <EmployeeDashboard
        employeeId={employeeSessionId}
        db={db}
        lang={lang}
        onToggleLang={() => setLang(l => l === 'en' ? 'hi' : 'en')}
        onLogout={handleEmployeeLogout}
        onUpdateDb={handleUpdateDatabaseDirectly}
      />
    );
  }

  // B. If not logged in via Gmail, or PIN is not verified
  if (!firebaseUser || !isPinVerified) {
    return (
      <LoginView 
        lang={lang} 
        onToggleLang={setLang} 
        companyName={db.company?.name}
        logo={db.company?.logo}
        firebaseUser={firebaseUser}
        adminPin={db.company?.adminPin}
        employees={db.employees}
        deferredPrompt={deferredPrompt}
        onInstallApp={handleInstallApp}
        onVerifyPinSuccess={() => {
          setIsPinVerified(true);
          sessionStorage.setItem('gaushala_pin_verified', 'true');
        }}
        onSetPinSuccess={(newPin) => {
          const updatedCompany = {
            ...(db.company || DEFAULT_DATABASE.company),
            adminPin: newPin
          };
          const updatedDb = {
            ...db,
            company: updatedCompany
          };
          setDb(updatedDb);
          setIsPinVerified(true);
          sessionStorage.setItem('gaushala_pin_verified', 'true');
        }}
        onLogoutGmail={async () => {
          await logoutFirebase();
          setIsPinVerified(false);
          sessionStorage.removeItem('gaushala_pin_verified');
        }}
        onVerifyEmployeeSuccess={(id) => {
          setEmployeeSessionId(id);
          localStorage.setItem('gaushala_employee_session_id', id);
        }}
      />
    );
  }

  const pendingApprovalsCount = (db.approvalRequests || []).filter(r => r.status === 'Pending').length;

  return (
    <div className="min-h-screen h-screen bg-[#F7F9FC] flex font-sans text-[#0F172A] overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      
      {/* Premium Desktop Sidebar Navigation */}
      <aside className="hidden md:flex flex-col w-72 bg-white border-r border-[#E2E8F0] shrink-0 h-screen sticky top-0 p-6 justify-between shadow-sm">
        <div className="space-y-6">
          {/* Logo and Branding Banner */}
          <div className="flex items-center gap-3 px-1 py-1">
            {db.company?.logo ? (
              <img 
                src={db.company.logo} 
                alt="Logo" 
                className="w-10 h-10 rounded-xl object-cover border border-[#E2E8F0] shadow-sm" 
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center border border-blue-100 shadow-sm">
                <Icon name="agriculture" size={24} />
              </div>
            )}
            <div>
              <h1 className="text-sm font-bold text-[#0F172A] tracking-tight leading-none">
                {lang === 'en' ? (db.company?.name || 'Shree Kamdhenu') : (db.company?.name || 'श्री कामधेनु')}
              </h1>
              <span className="text-[10px] text-[#2563EB] font-bold uppercase tracking-wider block mt-1.5">
                {t('EMS Administration', 'प्रशासनिक बहीखाता')}
              </span>
            </div>
          </div>

          <hr className="border-[#E2E8F0]" />

          {/* Navigation Items */}
          <nav className="space-y-1">
            <button onClick={() => { setCurrentView('dashboard'); setSelectedEmployeeId(null); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all cursor-pointer ${currentView === 'dashboard' ? 'bg-[#2563EB] text-white shadow-md' : 'text-[#64748B] hover:bg-slate-50 hover:text-[#0F172A]'}`}>
              <Icon name="dashboard" size={20} />
              <span className="text-sm font-bold tracking-wide">{t('Dashboard', 'डैशबोर्ड')}</span>
            </button>

            <button onClick={() => { setCurrentView('pv-staff'); setSelectedEmployeeId(null); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all cursor-pointer ${currentView === 'pv-staff' || currentView === 'profile-detail' || currentView === 'add-staff' ? 'bg-[#2563EB] text-white shadow-md' : 'text-[#64748B] hover:bg-slate-50 hover:text-[#0F172A]'}`}>
              <Icon name="people" size={20} />
              <span className="text-sm font-bold tracking-wide">{t('Staff Directory', 'कर्मचारी सूची')}</span>
            </button>

            <button onClick={() => { setCurrentView('pv-att'); setSelectedEmployeeId(null); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all cursor-pointer ${currentView === 'pv-att' ? 'bg-[#2563EB] text-white shadow-md' : 'text-[#64748B] hover:bg-slate-50 hover:text-[#0F172A]'}`}>
              <Icon name="event_available" size={20} />
              <span className="text-sm font-bold tracking-wide">{t('Daily Attendance', 'दैनिक हाजिरी')}</span>
            </button>

            <button onClick={() => { setCurrentView('approvals'); setSelectedEmployeeId(null); }} className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl transition-all cursor-pointer ${currentView === 'approvals' ? 'bg-[#2563EB] text-white shadow-md' : 'text-[#64748B] hover:bg-slate-50 hover:text-[#0F172A]'}`}>
              <div className="flex items-center gap-3">
                <Icon name="fact_check" size={20} />
                <span className="text-sm font-bold tracking-wide">{t('Approval Desk', 'अनुमोदन कक्ष')}</span>
              </div>
              {((db.approvalRequests || []).filter(r => r.status === 'Pending').length) > 0 && (
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${currentView === 'approvals' ? 'bg-white text-[#2563EB]' : 'bg-amber-100 text-amber-700'}`}>
                  {((db.approvalRequests || []).filter(r => r.status === 'Pending').length)}
                </span>
              )}
            </button>

            <button onClick={() => { setCurrentView('geofences'); setSelectedEmployeeId(null); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all cursor-pointer ${currentView === 'geofences' ? 'bg-[#2563EB] text-white shadow-md' : 'text-[#64748B] hover:bg-slate-50 hover:text-[#0F172A]'}`}>
              <Icon name="location_on" size={20} />
              <span className="text-sm font-bold tracking-wide">{t('GeoFence Center', 'जियो-फेंस केंद्र')}</span>
            </button>

            <button onClick={() => { setCurrentView('settings'); setSelectedEmployeeId(null); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all cursor-pointer ${currentView === 'settings' ? 'bg-[#2563EB] text-white shadow-md' : 'text-[#64748B] hover:bg-slate-50 hover:text-[#0F172A]'}`}>
              <Icon name="settings" size={20} />
              <span className="text-sm font-bold tracking-wide">{t('System Settings', 'सिस्टम सेटिंग्स')}</span>
            </button>
          </nav>
        </div>

        {/* Bottom Sidebar Section */}
        <div className="space-y-4 pt-4 border-t border-[#E2E8F0]">
          {/* Sync Status Card */}
          <div className="bg-[#F7F9FC] border border-[#E2E8F0] p-3 rounded-2xl flex items-center justify-between shadow-sm cursor-pointer hover:bg-slate-100" onClick={() => setShowTroubleshoot(true)}>
            <div className="flex items-center gap-2">
              <Icon name="cloud_sync" size={16} className="text-[#64748B]" />
              <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">{t('Sync Status', 'सिंक स्थिति')}</span>
            </div>
            {syncStatus === 'synced' && <span className="bg-[#ECFDF5] text-[#10B981] border border-emerald-100 text-[8px] font-black px-2 py-0.5 rounded-full flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#10B981] rounded-full animate-pulse" /> SYNCED</span>}
            {syncStatus === 'connecting' && <span className="bg-amber-50 text-amber-700 border border-amber-100 text-[8px] font-black px-2 py-0.5 rounded-full flex items-center gap-1">WAITING</span>}
            {syncStatus === 'error' && <span className="bg-rose-50 text-rose-700 border border-rose-100 text-[8px] font-black px-2 py-0.5 rounded-full flex items-center gap-1">ERROR</span>}
          </div>

          <div className="flex items-center gap-2">
            <select value={lang} onChange={(e) => setLang(e.target.value as 'en' | 'hi')} className="flex-1 h-10 px-3 rounded-xl border border-[#E2E8F0] bg-[#F7F9FC] font-bold text-[11px] text-[#0F172A] focus:outline-none focus:border-[#2563EB] cursor-pointer">
              <option value="en">English (EN)</option>
              <option value="hi">हिंदी (HI)</option>
            </select>
            
            <button onClick={handleLogout} className="flex-1 h-10 border border-rose-100 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl text-[11px] font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer">
              <Icon name="logout" size={14} />
              {t('Logout', 'लॉगआउट')}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area (Dynamic Views) */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
        
        {/* Mobile Top Header (Hidden on Desktop) */}
        <header className="md:hidden sticky top-0 bg-white/95 border-b border-[#E2E8F0] z-40 backdrop-blur-md px-4 py-3 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            {db.company?.logo ? (
              <img src={db.company.logo} alt="Logo" className="w-8 h-8 rounded-xl object-cover border border-[#E2E8F0] shadow-sm" />
            ) : (
              <div className="w-8 h-8 rounded-xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center border border-blue-100 shadow-sm">
                <Icon name="agriculture" size={18} />
              </div>
            )}
            <div>
              <h1 className="text-xs font-black text-[#0F172A] tracking-tight leading-none">
                {lang === 'en' ? (db.company?.name || 'Shree Kamdhenu') : (db.company?.name || 'श्री कामधेनु')}
              </h1>
              <span className="text-[9px] text-[#2563EB] font-bold uppercase tracking-wider block mt-0.5">
                Admin App
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NotificationDesk db={db} onUpdateDb={setDb} userId="admin" lang={lang} />
            <button onClick={() => setShowTroubleshoot(true)} className="w-8 h-8 rounded-full border border-[#E2E8F0] bg-white text-[10px] font-bold text-[#64748B] flex items-center justify-center cursor-pointer relative">
              <Icon name="cloud_sync" size={16} />
              {syncStatus !== 'synced' && <span className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-amber-500 border border-white"></span>}
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto w-full pb-20 md:pb-0 scroll-smooth">
          {/* Dashboard View */}
          {currentView === 'dashboard' && (
            <DashboardView 
              db={db} 
              lang={lang} 
              onNavigate={(view: string, empId?: string) => {
                setCurrentView(view);
                if (empId) setSelectedEmployeeId(empId);
              }} 
            />
          )}

          {/* Staff List View */}
          {currentView === 'pv-staff' && (
            <StaffListView 
              db={db} 
              lang={lang} 
              onNavigate={(view: string, empId?: string) => {
                setCurrentView(view);
                if (empId) setSelectedEmployeeId(empId);
              }} 
            />
          )}

          {/* Add Staff View */}
          {currentView === 'add-staff' && (
            <AddStaffView 
              onSave={handleOnboardSave} 
              onCancel={() => setCurrentView('pv-staff')} 
              lang={lang} 
            />
          )}

          {/* Employee Detail Profile View */}
          {currentView === 'profile-detail' && selectedEmployeeId && (
            <ProfileView
              employeeId={selectedEmployeeId}
              db={db}
              lang={lang}
              onUpdateDb={setDb}
              onGoBack={() => {
                setCurrentView('pv-staff');
                setSelectedEmployeeId(null);
              }}
              onSoftDelete={handleDeleteStaffFully}
              onStatusLeft={handleChangeStatusToLeft}
              onRestore={handleRestoreStaff}
            />
          )}

          {/* Attendance Module View */}
          {currentView === 'pv-att' && (
            <AttendanceView 
              db={db} 
              onUpdateAttendance={(newAtt) => setDb({ ...db, attendance: newAtt })}
              onUpdateDb={setDb} 
              lang={lang} 
            />
          )}

          {/* Approvals Request Desk */}
          {currentView === 'approvals' && (
            <ApprovalPanel 
              db={db} 
              onUpdateDb={setDb} 
              lang={lang} 
              isAdmin={true} 
            />
          )}

          {/* GeoFence Manager */}
          {currentView === 'geofences' && (
            <GeoFenceManager 
              db={db} 
              onUpdateDb={setDb} 
              lang={lang} 
            />
          )}

          {/* System Settings Panel */}
          {currentView === 'settings' && (
            <SettingsView 
              db={db} 
              onUpdateDb={setDb} 
              lang={lang} 
              onNavigate={setCurrentView} 
              onLogout={handleLogout}
              setLang={setLang}
            />
          )}

          {/* Recycle Bin Recovery */}
          {currentView === 'recycle-bin' && (
            <RecycleBinView 
              db={db} 
              onUpdateDb={setDb} 
              lang={lang} 
              onGoBack={() => setCurrentView('settings')} 
            />
          )}

          {/* Audit Logs Trail */}
          {currentView === 'audit-logs' && (
            <AuditLogsView 
              db={db} 
              lang={lang} 
              onGoBack={() => setCurrentView('settings')} 
            />
          )}
          
          {/* Mobile "More" Menu Panel */}
          {currentView === 'mobile-more' && (
            <div className="p-4 space-y-4 animate-in fade-in duration-200">
              <h2 className="text-xl font-black text-[#0F172A] tracking-tight mb-4">{t('Menu', 'मेनू')}</h2>
              
              <div className="bg-white border border-[#E2E8F0] rounded-3xl shadow-sm overflow-hidden">
                <div onClick={() => setCurrentView('geofences')} className="p-4 flex items-center justify-between border-b border-slate-100 active:bg-slate-50 cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center">
                      <Icon name="location_on" size={20} />
                    </div>
                    <span className="text-sm font-bold text-[#0F172A]">{t('GeoFence Center', 'जियो-फेंस केंद्र')}</span>
                  </div>
                  <Icon name="chevron_right" size={20} className="text-[#64748B]" />
                </div>
                
                <div onClick={() => setCurrentView('settings')} className="p-4 flex items-center justify-between border-b border-slate-100 active:bg-slate-50 cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center">
                      <Icon name="settings" size={20} />
                    </div>
                    <span className="text-sm font-bold text-[#0F172A]">{t('System Settings', 'सिस्टम सेटिंग्स')}</span>
                  </div>
                  <Icon name="chevron_right" size={20} className="text-[#64748B]" />
                </div>
              </div>

              <div className="bg-white border border-[#E2E8F0] rounded-3xl p-4 shadow-sm space-y-4 mt-6">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-bold text-[#64748B]">{t('Language', 'भाषा')}</span>
                  <select value={lang} onChange={(e) => setLang(e.target.value as 'en' | 'hi')} className="h-10 px-4 rounded-xl border border-[#E2E8F0] bg-[#F7F9FC] font-bold text-[#0F172A] focus:outline-none focus:border-[#2563EB] cursor-pointer">
                    <option value="en">English (EN)</option>
                    <option value="hi">हिंदी (HI)</option>
                  </select>
                </div>
              </div>

              <button onClick={handleLogout} className="w-full h-14 mt-6 border-2 border-rose-100 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-2xl text-sm font-black uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.98] cursor-pointer">
                <Icon name="logout" size={20} />
                {t('Logout Admin Desk', 'लॉगआउट')}
              </button>
            </div>
          )}
        </div>

        {/* Mobile Bottom Navigation (Hidden on Desktop) */}
        <nav className="md:hidden fixed bottom-0 left-0 w-full bg-white border-t border-[#E2E8F0] px-2 py-2 flex justify-between items-center shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-50 pb-safe">
          <button onClick={() => { setCurrentView('dashboard'); setSelectedEmployeeId(null); }} className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${currentView === 'dashboard' ? 'text-[#2563EB]' : 'text-[#64748B] active:bg-slate-50'}`}>
            <Icon name="home" size={24} />
            <span className="text-[10px] font-bold">{t('Home', 'होम')}</span>
          </button>
          <button onClick={() => { setCurrentView('pv-staff'); setSelectedEmployeeId(null); }} className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${currentView === 'pv-staff' || currentView === 'add-staff' || currentView === 'profile-detail' ? 'text-[#2563EB]' : 'text-[#64748B] active:bg-slate-50'}`}>
            <Icon name="people" size={24} />
            <span className="text-[10px] font-bold">{t('Staff', 'स्टाफ')}</span>
          </button>
          <button onClick={() => { setCurrentView('pv-att'); setSelectedEmployeeId(null); }} className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${currentView === 'pv-att' ? 'text-[#2563EB]' : 'text-[#64748B] active:bg-slate-50'}`}>
            <Icon name="calendar_month" size={24} />
            <span className="text-[10px] font-bold">{t('Attend', 'हाजिरी')}</span>
          </button>
          <button onClick={() => { setCurrentView('approvals'); setSelectedEmployeeId(null); }} className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-xl transition-all relative ${currentView === 'approvals' ? 'text-[#2563EB]' : 'text-[#64748B] active:bg-slate-50'}`}>
            <Icon name="send" size={24} />
            <span className="text-[10px] font-bold">{t('Approvals', 'अप्रूवल')}</span>
            {((db.approvalRequests || []).filter(r => r.status === 'Pending').length) > 0 && <span className="absolute top-1 right-2 w-3 h-3 rounded-full bg-amber-500 border-2 border-white"></span>}
          </button>
          <button onClick={() => setCurrentView('mobile-more')} className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${currentView === 'mobile-more' || currentView === 'geofences' || currentView === 'settings' ? 'text-[#2563EB]' : 'text-[#64748B] active:bg-slate-50'}`}>
            <Icon name="grid_view" size={24} />
            <span className="text-[10px] font-bold">{t('More', 'अधिक')}</span>
          </button>
        </nav>

        {/* Global Firebase Connection Troubleshoot Modal */}
        {showTroubleshoot && (
          <FirebaseTroubleshoot 
            db={db}
            syncStatus={syncStatus}
            syncError={syncError}
            onClose={() => setShowTroubleshoot(false)} 
            lang={lang} 
          />
        )}
      </main>
    </div>
  );
}
