import React, { useState, useEffect, useRef } from 'react';
import { AppDatabase, Employee, EmployeeType, RecycleBinItem, AuditLogEntry, ApprovalRequest } from './types';
import { loadDatabase, saveDatabase, calcEmployeeFinancials, DEFAULT_DATABASE } from './db';
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
import LiveTrackingView from './components/LiveTrackingView';
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

  const [db, setDb] = useState<AppDatabase>(() => loadDatabase());
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
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to install prompt: ${outcome}`);
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
        const serialized = JSON.stringify(firestoreDb);
        if (serialized !== lastFetchedDbRef.current && serialized !== JSON.stringify(db)) {
          lastFetchedDbRef.current = serialized;
          setDb(firestoreDb);
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
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row font-sans select-none text-slate-800 pb-28 md:pb-0">
      
      {/* Premium Desktop Sidebar Navigation */}
      <aside className="hidden md:flex flex-col w-72 bg-white border-r border-slate-200/50 shrink-0 h-screen sticky top-0 p-6 justify-between shadow-2xs">
        <div className="space-y-6">
          {/* Logo and Branding Banner */}
          <div className="flex items-center gap-3 px-1 py-1">
            {db.company?.logo ? (
              <img 
                src={db.company.logo} 
                alt="Logo" 
                className="w-10 h-10 rounded-xl object-cover border border-slate-100 shadow-xs" 
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-blue-50/70 text-blue-600 flex items-center justify-center border border-blue-100 shadow-xs">
                <Icon name="agriculture" size={24} className="text-blue-600" />
              </div>
            )}
            <div>
              <h1 className="text-sm font-bold text-slate-900 tracking-tight leading-none">
                {lang === 'en' ? (db.company?.name || 'Shree Kamdhenu') : (db.company?.name || 'श्री कामधेनु')}
              </h1>
              <span className="text-[10px] text-blue-600 font-bold uppercase tracking-wider block mt-1.5">
                {t('EMS Administration', 'प्रशासनिक बहीखाता')}
              </span>
            </div>
          </div>

          <hr className="border-slate-100/80" />

          {/* Navigation Items */}
          <nav className="space-y-1">
            {/* Dashboard Navigation */}
            <button
              onClick={() => {
                setCurrentView('dashboard');
                setSelectedEmployeeId(null);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer ${
                currentView === 'dashboard' 
                  ? 'bg-blue-50/70 text-blue-600 font-bold border-l-4 border-blue-600 rounded-l-none' 
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Icon name="dashboard" size={20} fill={currentView === 'dashboard'} />
              <span>{t('Dashboard Overview', 'डैशबोर्ड अवलोकन')}</span>
            </button>

            {/* Staff Directory Navigation */}
            <button
              onClick={() => {
                setCurrentView('pv-staff');
                setSelectedEmployeeId(null);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer ${
                currentView === 'pv-staff' || currentView === 'profile-detail' 
                  ? 'bg-blue-50/70 text-blue-600 font-bold border-l-4 border-blue-600 rounded-l-none' 
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Icon name="badge" size={20} fill={currentView === 'pv-staff' || currentView === 'profile-detail'} />
              <span>{t('Staff Directory', 'कर्मचारी सूची')}</span>
            </button>

            {/* Mark Attendance Navigation */}
            <button
              onClick={() => {
                setCurrentView('pv-att');
                setSelectedEmployeeId(null);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer ${
                currentView === 'pv-att' 
                  ? 'bg-blue-50/70 text-blue-600 font-bold border-l-4 border-blue-600 rounded-l-none' 
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Icon name="edit_calendar" size={20} fill={currentView === 'pv-att'} />
              <span>{t('Daily Attendance', 'दैनिक हाजिरी भरें')}</span>
            </button>

            {/* Live Approval Requests Navigation */}
            <button
              onClick={() => {
                setCurrentView('approvals');
                setSelectedEmployeeId(null);
              }}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer ${
                currentView === 'approvals' 
                  ? 'bg-blue-50/70 text-blue-600 font-bold border-l-4 border-blue-600 rounded-l-none' 
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon name="verified_user" size={20} fill={currentView === 'approvals'} />
                <span>{t('Approval Desk', 'अनुमोदन डेस्क')}</span>
              </div>
              {pendingApprovalsCount > 0 && (
                <span className="bg-amber-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full shrink-0">
                  {pendingApprovalsCount}
                </span>
              )}
            </button>

            {/* Live GPS Tracking */}
            <button
              onClick={() => {
                setCurrentView('tracking');
                setSelectedEmployeeId(null);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer ${
                currentView === 'tracking' 
                  ? 'bg-blue-50/70 text-blue-600 font-bold border-l-4 border-blue-600 rounded-l-none' 
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Icon name="map" size={20} fill={currentView === 'tracking'} />
              <span>{t('Live GPS Map', 'लाइव जीपीएस ट्रैकिंग')}</span>
            </button>

            {/* GeoFence Management */}
            <button
              onClick={() => {
                setCurrentView('geofences');
                setSelectedEmployeeId(null);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer ${
                currentView === 'geofences' 
                  ? 'bg-blue-50/70 text-blue-600 font-bold border-l-4 border-blue-600 rounded-l-none' 
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Icon name="radar" size={20} fill={currentView === 'geofences'} />
              <span>{t('GeoFence Center', 'जियोफेंस केंद्र')}</span>
            </button>

            {/* Settings & Reports Navigation */}
            <button
              onClick={() => {
                setCurrentView('pv-rep');
                setSelectedEmployeeId(null);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer ${
                currentView === 'pv-rep' 
                  ? 'bg-blue-50/70 text-blue-600 font-bold border-l-4 border-blue-600 rounded-l-none' 
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Icon name="settings" size={20} fill={currentView === 'pv-rep'} />
              <span>{t('System Settings', 'सिस्टम सेटिंग्स')}</span>
            </button>
          </nav>
        </div>

        {/* Sidebar Footer Details */}
        <div className="space-y-4">
          {/* Real-time Cloud status panel */}
          <div className="p-3 bg-slate-50/80 border border-slate-100 rounded-xl space-y-2 text-[10px] font-semibold text-slate-500">
            <div className="flex items-center justify-between">
              <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">{t('Sync Status', 'सिंक की स्थिति')}</span>
              <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                syncStatus === 'synced' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                syncStatus === 'connecting' ? 'bg-amber-50 text-amber-700 border border-amber-100 animate-pulse' :
                'bg-rose-50 text-rose-700 border border-rose-100'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  syncStatus === 'synced' ? 'bg-emerald-500' :
                  syncStatus === 'connecting' ? 'bg-amber-500 animate-pulse' :
                  'bg-rose-500'
                }`} />
                {syncStatus === 'synced' ? t('Synced', 'सुरक्षित') :
                 syncStatus === 'connecting' ? t('Syncing...', 'सिंक...') :
                 t('Offline', 'ऑफ़लाइन')}
              </span>
            </div>
            {syncStatus === 'error' && (
              <button 
                onClick={() => setShowTroubleshoot(true)}
                className="w-full text-center text-rose-600 hover:underline text-[9px] mt-1 cursor-pointer block font-bold"
              >
                {t('⚠️ View Firestore Fix Guide', '⚠️ समाधान गाइड देखें')}
              </button>
            )}
          </div>

          {/* Bilingual Quick Toggle */}
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>{t('Language:', 'भाषा:')}</span>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-slate-50 p-0.5">
              <button
                onClick={() => setLang('en')}
                className={`px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer transition-all ${
                  lang === 'en' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                EN
              </button>
              <button
                onClick={() => setLang('hi')}
                className={`px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer transition-all ${
                  lang === 'hi' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                हिं
              </button>
            </div>
          </div>

          {deferredPrompt && (
            <button
              onClick={handleInstallApp}
              className="w-full h-11 btn bbl text-white font-bold text-xs flex items-center justify-center gap-2 active:scale-[0.97] transition-all cursor-pointer"
            >
              <Icon name="download" size={16} />
              <span>{t('Download PC/Mobile App', 'ऐप डाउनलोड करें')}</span>
            </button>
          )}

          <button
            onClick={handleLogout}
            className="w-full h-11 border border-red-100 text-red-600 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-red-50/50 active:scale-[0.97] transition-all cursor-pointer"
          >
            <Icon name="logout" size={16} />
            <span>{t('Logout Admin Desk', 'लॉगआउट करें')}</span>
          </button>
        </div>
      </aside>

      {/* Visual Navigation Top Header (Visible only on Mobile) */}
      {currentView !== 'profile-detail' && (
        <header className="md:hidden sticky top-0 bg-white/95 border-b border-slate-100 z-50 backdrop-blur-md px-4 py-3 shadow-2xs">
          <div className="max-w-md mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {db.company?.logo ? (
                <img 
                  src={db.company.logo} 
                  alt="Logo" 
                  className="w-8 h-8 rounded-lg object-cover" 
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center border border-blue-100 shadow-3xs">
                  <Icon name="agriculture" size={18} className="text-blue-600" />
                </div>
              )}
              <div>
                <h1 className="text-xs font-bold text-slate-900 tracking-tight leading-none">
                  {lang === 'en' ? (db.company?.name || 'Shree Kamdhenu') : (db.company?.name || 'श्री कामधेनु')}
                </h1>
                <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider block mt-1">
                  {t('Employee Management System', 'कर्मचारी प्रबंधन प्रणाली')}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Admin Notification Desk */}
              <NotificationDesk 
                db={db}
                onUpdateDb={handleUpdateDatabaseDirectly}
                userId="admin"
                lang={lang}
              />
              
              {/* Cloud Sync Status Badge */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-50 border border-slate-100">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  syncStatus === 'synced' ? 'bg-emerald-500' :
                  syncStatus === 'connecting' ? 'bg-amber-500 animate-pulse' :
                  'bg-rose-500'
                }`} />
                <span className="text-[9px] font-bold text-slate-500 tracking-tight">
                  {syncStatus === 'synced' ? t('Synced', 'सिंक') :
                   syncStatus === 'connecting' ? t('Syncing...', 'सिंक...') :
                   t('Offline', 'ऑफ़लाइन')}
                </span>
              </div>
            </div>
          </div>
        </header>
      )}

      {/* Main Container Wrapper */}
      <main className="flex-1 w-full max-w-md md:max-w-3xl lg:max-w-4xl mx-auto px-4 py-5 md:py-8 overflow-x-hidden md:h-screen md:overflow-y-auto">
        
        {/* Firebase Error Warning Banner */}
        {syncStatus === 'error' && (
          <div className="mb-5 bg-rose-50 border border-rose-100 rounded-2xl p-4 flex items-start gap-3 shadow-2xs animate-in fade-in duration-200">
            <div className="p-1.5 bg-rose-100 text-rose-700 rounded-lg shrink-0 mt-0.5">
              <Icon name="warning" size={18} fill={true} />
            </div>
            <div className="space-y-1">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-rose-800">
                {t('Cloud Sync Interrupted', 'क्लाउड सिंक रुका हुआ है')}
              </h4>
              <p className="text-[10px] text-rose-700 font-semibold leading-relaxed">
                {t('Error Details:', 'त्रुटि विवरण:')} <span className="font-mono bg-rose-100/60 px-1.5 py-0.5 rounded border border-rose-200 text-[9px] font-bold text-rose-900">{syncError || 'Unknown connection error'}</span>
              </p>
              <button
                onClick={() => setShowTroubleshoot(true)}
                className="inline-flex items-center gap-1.5 mt-2 text-[10px] font-bold text-rose-800 bg-rose-100 hover:bg-rose-200/70 px-3 py-1.5 rounded-lg border border-rose-200 transition-colors uppercase tracking-wider cursor-pointer"
              >
                <Icon name="sync_problem" size={13} />
                {t('View 2-Min Fix', '२-मिनट हल देखें')}
              </button>
            </div>
          </div>
        )}

        {/* Dynamic Navigation Routers */}

        {/* 1. Dashboard Landing View */}
        {currentView === 'dashboard' && (
          <DashboardView 
            db={db} 
            onNavigate={setCurrentView} 
            lang={lang} 
          />
        )}

        {/* 2. Staff Directory lists */}
        {currentView === 'pv-staff' && (
          <StaffListView
            db={db}
            onNavigate={setCurrentView}
            onSelectEmployee={(id) => {
              setSelectedEmployeeId(id);
              setCurrentView('profile-detail');
            }}
            onRestoreEmployee={handleRestoreStaff}
            lang={lang}
          />
        )}

        {/* 3. Daily Attendance Markup Register lists */}
        {currentView === 'pv-att' && (
          <AttendanceView
            db={db}
            onUpdateAttendance={(updatedAtt) => setDb({ ...db, attendance: updatedAtt })}
            onUpdateDb={handleUpdateDatabaseDirectly}
            lang={lang}
            onGoBack={() => setCurrentView('dashboard')}
          />
        )}

        {/* 4. Onboard Add Employee stepper */}
        {currentView === 'pv-add' && (
          <AddStaffView
            onSave={handleOnboardSave}
            onGoBack={() => setCurrentView('dashboard')}
            lang={lang}
          />
        )}

        {/* 5. Detailed workers statistics sheets profile (With Delete and Status Actions) */}
        {currentView === 'profile-detail' && selectedEmployeeId && (
          <div className="animate-in fade-in duration-200">
            <ProfileView
              employeeId={selectedEmployeeId}
              db={db}
              lang={lang}
              onUpdateDb={handleUpdateDatabaseDirectly}
              onGoBack={() => {
                setCurrentView('pv-staff');
                setSelectedEmployeeId(null);
              }}
              onDeleteEmployeeFully={handleDeleteStaffFully}
              onChangeStatusToLeft={handleChangeStatusToLeft}
            />
          </div>
        )}

        {/* 6. Settings and Configuration view */}
        {currentView === 'pv-rep' && (
          <SettingsView
            db={db}
            onUpdateDb={handleUpdateDatabaseDirectly}
            lang={lang}
            onToggleLang={() => setLang(l => l === 'en' ? 'hi' : 'en')}
            onLogout={handleLogout}
            syncStatus={syncStatus}
            deferredPrompt={deferredPrompt}
            onInstallApp={handleInstallApp}
            onOpenRecycleBin={() => setShowRecycleBin(true)}
            onOpenAuditLogs={() => setShowAuditLogs(true)}
          />
        )}

        {/* 7. Live Approval Requests Desk */}
        {currentView === 'approvals' && (
          <ApprovalPanel 
            db={db}
            lang={lang}
            isAdmin={true}
            onUpdateDb={handleUpdateDatabaseDirectly}
          />
        )}

        {/* 8. Live Tracking maps dashboard */}
        {currentView === 'tracking' && (
          <LiveTrackingView 
            db={db}
            lang={lang}
          />
        )}

        {/* 9. GeoFence Manager desk */}
        {currentView === 'geofences' && (
          <GeoFenceManager 
            db={db}
            onUpdateDb={handleUpdateDatabaseDirectly}
            lang={lang}
          />
        )}

      </main>

      {/* --- Sticky Floating Bottom Navigation Rail (Mobile Only) --- */}
      <nav className="md:hidden fixed bottom-4 left-4 right-4 bg-white/95 backdrop-blur-md border border-slate-150 py-2.5 px-3 shadow-lg z-50 rounded-2xl max-w-md mx-auto transition-transform duration-200">
        <div className="grid grid-cols-5 gap-1 text-center items-center justify-center">
          
          {/* Dashboard */}
          <button
            onClick={() => {
              setCurrentView('dashboard');
              setSelectedEmployeeId(null);
            }}
            className={`flex flex-col items-center justify-center py-1.5 rounded-xl cursor-pointer transition-all duration-200 ${
              currentView === 'dashboard' 
                ? 'text-blue-600 bg-blue-50/60 font-bold scale-102' 
                 : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <Icon name="dashboard" size={18} fill={currentView === 'dashboard'} />
            <span className="text-[8px] tracking-tight mt-1">{t('Home', 'होम')}</span>
          </button>

          {/* Directory */}
          <button
            onClick={() => {
              setCurrentView('pv-staff');
              setSelectedEmployeeId(null);
            }}
            className={`flex flex-col items-center justify-center py-1.5 rounded-xl cursor-pointer transition-all duration-200 ${
              currentView === 'pv-staff' || currentView === 'profile-detail' 
                ? 'text-blue-600 bg-blue-50/60 font-bold scale-102' 
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <Icon name="badge" size={18} fill={currentView === 'pv-staff' || currentView === 'profile-detail'} />
            <span className="text-[8px] tracking-tight mt-1">{t('Staff', 'कर्मचारी')}</span>
          </button>

          {/* Attendance Mark */}
          <button
            onClick={() => {
              setCurrentView('pv-att');
              setSelectedEmployeeId(null);
            }}
            className={`flex flex-col items-center justify-center py-1.5 rounded-xl cursor-pointer transition-all duration-200 ${
              currentView === 'pv-att' 
                ? 'text-blue-600 bg-blue-50/60 font-bold scale-102' 
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <Icon name="edit_calendar" size={18} fill={currentView === 'pv-att'} />
            <span className="text-[8px] tracking-tight mt-1">{t('Mark', 'हाजिरी')}</span>
          </button>

          {/* Approvals Desk */}
          <button
            onClick={() => {
              setCurrentView('approvals');
              setSelectedEmployeeId(null);
            }}
            className={`flex flex-col items-center justify-center py-1.5 rounded-xl cursor-pointer transition-all duration-200 relative ${
              currentView === 'approvals' 
                ? 'text-blue-600 bg-blue-50/60 font-bold scale-102' 
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <Icon name="verified_user" size={18} fill={currentView === 'approvals'} />
            <span className="text-[8px] tracking-tight mt-1">{t('Approvals', 'अनुमोदन')}</span>
            {pendingApprovalsCount > 0 && (
              <span className="absolute top-0 right-1.5 bg-amber-500 text-white text-[8px] font-black w-4 h-4 rounded-full flex items-center justify-center border border-white">
                {pendingApprovalsCount}
              </span>
            )}
          </button>

          {/* Settings & Configuration Tab */}
          <button
            onClick={() => {
              setCurrentView('pv-rep');
              setSelectedEmployeeId(null);
            }}
            className={`flex flex-col items-center justify-center py-1.5 rounded-xl cursor-pointer transition-all duration-200 ${
              currentView === 'pv-rep' 
                ? 'text-blue-600 bg-blue-50/60 font-bold scale-102' 
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <Icon name="settings" size={18} fill={currentView === 'pv-rep'} />
            <span className="text-[8px] tracking-tight mt-1">{t('Settings', 'सेटिंग्स')}</span>
          </button>

        </div>
      </nav>

      {/* --- RECYCLE BIN OVERLAY --- */}
      {showRecycleBin && (
        <RecycleBinView
          db={db}
          lang={lang}
          onClose={() => setShowRecycleBin(false)}
          onRestore={handleRestoreRecycleItem}
          onPermanentDelete={handlePermanentDeleteRecycleItem}
        />
      )}

      {/* --- AUDIT LOGS OVERLAY --- */}
      {showAuditLogs && (
        <AuditLogsView
          db={db}
          lang={lang}
          onClose={() => setShowAuditLogs(false)}
        />
      )}

      {showTroubleshoot && (
        <FirebaseTroubleshoot lang={lang} onClose={() => setShowTroubleshoot(false)} />
      )}

    </div>
  );
}
