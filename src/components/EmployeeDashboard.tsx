import React, { useState, useEffect } from 'react';
import { 
  AppDatabase, Employee, Payment, Earning, Deduction, 
  OvertimeEntry, LateFineEntry, AttendanceRecord, PunchSession, PaymentMode, AuditLogEntry, ApprovalRequest, LiveLocation, GeoFence
} from '../types';
import { calcEmployeeFinancials, getDaysInMonth, timeToHrs, getDistanceMeters, validateSessions, validatePunchRequestRules, getDailyAttendanceMetrics, formatHrsMins } from '../db';
import Icon from './Icon';
import SalarySlipPDF, { downloadSalarySlipPDF } from './SalarySlipPDF';
import ApprovalPanel from './ApprovalPanel';
import NotificationDesk from './NotificationDesk';
import { LocationManagerService } from '../services/LocationManager';
import { PlatformDeviceInfo } from '../services/platform/PlatformAbstraction';
import { optimizeImage } from '../utils/imageOptimizer';

const formatHHmm = (d: Date = new Date()) => {
  const hrs = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${hrs}:${mins}`;
};

interface EmployeeDashboardProps {
  employeeId: string;
  db: AppDatabase;
  lang: 'en' | 'hi';
  onToggleLang: () => void;
  onLogout: () => void;
  onInstallApp?: () => void;
  onUpdateDb?: (updatedDb: AppDatabase) => void;
}

export default function EmployeeDashboard({
  employeeId,
  db,
  lang,
  onToggleLang,
  onLogout,
  onInstallApp,
  onUpdateDb
}: EmployeeDashboardProps) {
  const t = (en: string, hi: string) => (lang === 'en' ? en : hi);

  // Find active employee record first
  const employee = db.employees.find(e => e.id === employeeId);

  // Device Binding validation
  const [deviceId, setDeviceId] = useState<string | null>(null);
  
  useEffect(() => {
    if (!employee) return;
    let dId = localStorage.getItem('skbg_device_uuid');
    if (!dId) {
      dId = 'DEV_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now();
      localStorage.setItem('skbg_device_uuid', dId);
    }
    setDeviceId(dId);

    const needsRequest = !employee.currentDeviceId || employee.currentDeviceId !== dId || !employee.deviceApproved;
    const hasPendingReq = (db.approvalRequests || []).some(
      r => r.employeeId === employee.id && r.category === 'Device Register' && r.newValue === dId && r.status === 'Pending'
    );

    if (needsRequest && !hasPendingReq) {
      const devReg: ApprovalRequest = {
        id: `_REQ_${Date.now()}`,
        employeeId: employee.id,
        employeeName: employee.name,
        category: 'Device Register',
        date: new Date().toISOString().split('T')[0],
        oldValue: employee.currentDeviceId || 'Unbound Account',
        newValue: dId,
        reason: 'Device binding request (switching or initial authorization)',
        timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
        status: 'Pending',
        gpsAccuracy: 5,
        gpsProvider: 'Browser Fused',
        deviceId: dId,
        deviceModel: navigator.userAgent.split(' ')[0] || 'Browser',
        osVersion: navigator.platform || 'Web'
      };

      const newNotification = {
        id: `_NTF_${Date.now()}`,
        userId: 'admin',
        title: 'New Device Registration',
        message: `${employee.name} requested device link binding.`,
        timestamp: new Date().toISOString(),
        read: false
      };

      if (onUpdateDb) {
        onUpdateDb({
          ...db,
          approvalRequests: [devReg, ...(db.approvalRequests || [])],
          notifications: [newNotification, ...(db.notifications || [])]
        });
      }
    }
  }, [employee?.id, employee?.currentDeviceId, employee?.deviceApproved, db.approvalRequests]);

  const currentDevId = localStorage.getItem('skbg_device_uuid') || '';
  const isDeviceBlocked = employee ? (!employee.currentDeviceId || employee.currentDeviceId !== currentDevId || !employee.deviceApproved) : true;

  // Active view tab: 'overview' | 'attendance' | 'salary' | 'requests' | 'settings'
  const [activeTab, setActiveTab] = useState<'overview' | 'attendance' | 'salary' | 'requests' | 'settings'>('overview');

  // Month & Year Selector (default to current month)
  const today = new Date();
  const [selYear, setSelYear] = useState<number>(today.getFullYear());
  const [selMonth, setSelMonth] = useState<number>(today.getMonth());
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({
    base: false,
    ot: false,
    bonus: false,
    fine: false,
    ded: false,
    pay: false
  });

  // Password form states
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmNewPw, setConfirmNewPw] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');

  // PDF Modal
  const [showPdfView, setShowPdfView] = useState(false);
  const [pdfRangeType, setPdfRangeType] = useState<'current' | 'previous' | 'all'>('current');

  // GPS & GeoFence Punch card states
  const [gpsLoc, setGpsLoc] = useState<LiveLocation | null>(null);
  const [closestFence, setClosestFence] = useState<GeoFence | null>(null);
  const [distanceToFence, setDistanceToFence] = useState<number | null>(null);
  const [isPunching, setIsPunching] = useState(false);
  const [punchSelfie, setPunchSelfie] = useState<string | null>(null);
  const [isPdfReady, setIsPdfReady] = useState(false);
  const [punchType, setPunchType] = useState<'Punch In' | 'Punch Out'>('Punch In');
  const [showPunchModal, setShowPunchModal] = useState(false);
  const [isLocationBlocked, setIsLocationBlocked] = useState<boolean>(false);

  useEffect(() => {
    if (!employee || isDeviceBlocked) return;

    if (!navigator.geolocation) {
      setIsLocationBlocked(true);
    }

    LocationManagerService.startTracking(
      employee.id,
      (loc) => {
        setGpsLoc(loc);
        setIsLocationBlocked(false);

        const fences = db.geofences || [];
        const myFences = fences.filter(f => f.assignedStaff && f.assignedStaff.includes(employee.id));
        LocationManagerService.updateActiveGeoFences(fences, employee.id);

        if (myFences.length > 0) {
          let minDistance = Infinity;
          let bestFence = myFences[0];
          myFences.forEach(f => {
            const d = getDistanceMeters(f.lat, f.lng, loc.lat, loc.lng);
            if (d < minDistance) {
              minDistance = d;
              bestFence = f;
            }
          });
          setClosestFence(bestFence);
          setDistanceToFence(minDistance);
        } else {
          setClosestFence(null);
          setDistanceToFence(null);
        }
      },
      (err) => {
        console.error('GPS tracking failed:', err);
        // Only block if permission is explicitly denied (code 1)
        if (err && err.code === 1) {
          setIsLocationBlocked(true);
        } else {
          console.warn('GPS tracking encountered a non-fatal watch error (signal low/timeout):', err);
        }
      }
    );

    return () => {
      LocationManagerService.stopTracking();
    };
  }, [employee?.id, db.geofences, isDeviceBlocked]);

  if (!employee) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <p className="text-sm font-bold text-slate-700">{t('Employee record not found!', 'कर्मचारी रिकॉर्ड नहीं मिला!')}</p>
        <button onClick={onLogout} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold">
          {t('Go to Login', 'लॉगिन पर जाएं')}
        </button>
      </div>
    );
  }

  if (isLocationBlocked) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center select-none animate-in fade-in duration-200">
        <div className="max-w-md bg-white border border-slate-200 rounded-3xl p-8 shadow-xl space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center text-red-500 mx-auto">
            <Icon name="location_off" size={32} />
          </div>
          <div className="space-y-2">
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider">{t('Location Required', 'लोकेशन आवश्यक है')}</h2>
            <p className="text-xs text-slate-500 font-semibold leading-relaxed">
              {t('please turnon location first to use the application.', 'एप का उपयोग करने के लिए कृपया अपनी लोकेशन / GPS चालू करें।')}
            </p>
          </div>
          <button
            onClick={() => {
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  setIsLocationBlocked(false);
                  window.location.reload();
                },
                (err) => {
                  alert(t('Location is still disabled or blocked. Please enable it in browser settings.', 'लोकेशन अभी भी बंद या ब्लॉक है। कृपया ब्राउज़र सेटिंग में जाकर अनुमति दें।'));
                }
              );
            }}
            className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black cursor-pointer shadow-md transition-all flex items-center justify-center"
          >
            {t('Try Again', 'पुनः प्रयास करें')}
          </button>
        </div>
      </div>
    );
  }

  if (isDeviceBlocked) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center select-none">
        <div className="max-w-md bg-white border border-slate-200 rounded-3xl p-8 shadow-xl space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-500 mx-auto">
            <Icon name="phonelink_lock" size={32} />
          </div>
          <div className="space-y-2">
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider">{t('Device Authorization Required', 'डिवाइस प्रमाणीकरण आवश्यक')}</h2>
            <p className="text-xs text-slate-500 font-semibold leading-relaxed">
              {t('Your employee account is currently bound to another device. A registration request for this device has been sent to the administrator. Please contact your manager to approve this request.', 'आपका कर्मचारी खाता वर्तमान में किसी अन्य डिवाइस से जुड़ा हुआ है। इस डिवाइस के लिए पंजीकरण अनुरोध व्यवस्थापक को भेजा गया है। कृपया अपने प्रबंधक से संपर्क करें।')}
            </p>
          </div>
          <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl text-[10px] text-slate-450 font-bold text-left space-y-1">
            <div>📲 Device ID: <span className="font-mono text-slate-700">{currentDevId}</span></div>
            <div>📌 Account Status: <span className="text-amber-600">Pending Admin Approval</span></div>
          </div>
          <button onClick={onLogout} className="w-full h-11 bg-slate-100 hover:bg-slate-250 text-slate-700 rounded-xl text-xs font-black cursor-pointer transition-all">
            {t('Log Out of Portal', 'पोर्टल से लॉगआउट')}
          </button>
        </div>
      </div>
    );
  }

  // Calculate financials for selected month
  const financials = calcEmployeeFinancials(employee, selYear, selMonth, db);
  const metrics = financials.metrics;

  const insideGeoFence = distanceToFence !== null && closestFence !== null && distanceToFence <= closestFence.radius;

  // Next action validation
  const dateKey = `${selYear}-${String(selMonth + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todayAtt = db.attendance[`${employee.id}_${dateKey}`];
  const nextAction = todayAtt?.sessions && todayAtt.sessions.length > 0 && !todayAtt.sessions[todayAtt.sessions.length - 1].out
    ? 'out'
    : 'in';

  const handleCameraCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const optimizedBase64 = await optimizeImage(file, 0.6, 800);
        setPunchSelfie(optimizedBase64);
      } catch (err: any) {
        alert(t('Image optimization failed: ' + err.message, 'छवि अनुकूलन विफल रहा: ' + err.message));
      }
    }
  };

  const handlePunchClick = (currentPunchType: 'Punch In' | 'Punch Out') => {
    if (!gpsLoc) {
      alert(t('GPS coordinates not loaded yet. Please wait...', 'जीपीएस निर्देशांक लोड नहीं हुए। कृपया प्रतीक्षा करें...'));
      return;
    }

    if (!insideGeoFence) {
      alert(t('You are outside of your assigned GeoFence radius. Direct punch is disabled.', 'आप जियोफेंस परिधि से बाहर हैं। डायरेक्ट पंच बंद है।'));
      return;
    }

    const todayDateStr = new Date().toISOString().split('T')[0];
    const check = validatePunchRequestRules(employee.id, currentPunchType, todayDateStr, db);
    if (!check.valid) {
      alert(check.reason || 'Punch request invalid.');
      return;
    }

    setShowPunchModal(true);
  };

  const submitPunchRequest = async () => {
    if (!gpsLoc) return;

    if (!punchSelfie) {
      alert(t('Selfie verification is mandatory to submit punch request.', 'पंच अनुरोध के लिए सेल्फी सत्यापन अनिवार्य है।'));
      return;
    }

    setIsPunching(true);
    const todayDateStr = new Date().toISOString().split('T')[0];

    const check = validatePunchRequestRules(employee.id, punchType, todayDateStr, db);
    if (!check.valid) {
      alert(check.reason || 'Punch request invalid.');
      setIsPunching(false);
      return;
    }

    try {
      await LocationManagerService.forceLocationUpdate(employee.id, gpsLoc.lat, gpsLoc.lng);
    } catch (e) {
      console.warn('Failed to force location update:', e);
    }

    const newReq: ApprovalRequest = {
      id: `_REQ_${Date.now()}`,
      employeeId: employee.id,
      employeeName: employee.name,
      employeePic: punchSelfie || employee.pic || '',
      category: punchType,
      date: todayDateStr,
      oldValue: todayAtt?.sessions ? JSON.stringify(todayAtt.sessions) : 'None',
      newValue: formatHHmm(new Date()),
      reason: t('GeoFence punch verified by GPS', 'जीपीएस द्वारा जियोफेंस पंच सत्यापित'),
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      status: 'Pending',
      gpsAccuracy: gpsLoc.accuracy,
      gpsProvider: gpsLoc.network === 'online' ? 'Web Browser Fused' : 'Offline Fused Cached',
      gpsLat: gpsLoc.lat,
      gpsLng: gpsLoc.lng,
      gpsAddress: gpsLoc.address || `Lat: ${gpsLoc.lat.toFixed(5)}, Lng: ${gpsLoc.lng.toFixed(5)}`,
      deviceId: currentDevId || '',
      deviceModel: PlatformDeviceInfo.getDeviceInfo().model,
      osVersion: PlatformDeviceInfo.getDeviceInfo().os
    };

    const updatedDb: AppDatabase = {
      ...db,
      approvalRequests: [newReq, ...(db.approvalRequests || [])]
    };

    const newNotification = {
      id: `_NTF_${Date.now()}`,
      userId: 'admin',
      title: t('New Punch Request', 'नया पंच अनुरोध'),
      message: `${employee.name} requested ${punchType} with accuracy ${gpsLoc.accuracy.toFixed(0)}m.`,
      timestamp: new Date().toISOString(),
      read: false
    };
    updatedDb.notifications = [newNotification, ...(db.notifications || [])];

    if (onUpdateDb) {
      onUpdateDb(updatedDb);
      alert(t('✓ Punch request submitted for Admin Approval!', '✓ पंच अनुरोध एडमिन स्वीकृति के लिए भेजा गया!'));
      setPunchSelfie(null);
      setShowPunchModal(false);
    }
    setIsPunching(false);
  };



  // Formatting utility
  const formatCurrency = (amt: number) => {
    const formatted = `₹${Math.round(amt).toLocaleString('en-IN')}`;
    return formatted;
  };


  // Generate Month list for selector
  const months = [
    t('January', 'जनवरी'), t('February', 'फ़रवरी'), t('March', 'मार्च'), 
    t('April', 'अप्रैल'), t('May', 'मई'), t('June', 'जून'), 
    t('July', 'जुलाई'), t('August', 'अगस्त'), t('September', 'सितंबर'), 
    t('October', 'अक्टूबर'), t('November', 'नवंबर'), t('December', 'दिसंबर')
  ];

  // Get Today's Status
  let todayStatusLabel = t('Not Marked', 'मार्क नहीं है');
  let todayStatusColor = 'bg-slate-105 text-slate-600 border border-slate-200';
  if (todayAtt) {
    if (employee.type === 'Hourly') {
      const activeHrs = (todayAtt.sessions || []).reduce((acc, s) => acc + timeToHrs(s.in, s.out), 0);
      todayStatusLabel = activeHrs > 0 ? `${activeHrs.toFixed(2)} ${t('Hrs', 'घंटे')}` : t('Punch Active', 'पंच सक्रिय');
      todayStatusColor = 'bg-blue-50 text-blue-750 border border-blue-100';
    } else {
      todayStatusLabel = lang === 'en' ? (todayAtt.status || 'Not Marked') : (todayAtt.status === 'Present' ? 'उपस्थित' : todayAtt.status === 'Absent' ? 'अनुपस्थित' : todayAtt.status === 'Half Day' ? 'आधा दिन' : 'छुट्टी');
      if (todayAtt.status === 'Present') todayStatusColor = 'bg-emerald-50 text-emerald-700 border border-emerald-100';
      else if (todayAtt.status === 'Absent') todayStatusColor = 'bg-rose-50 text-rose-700 border border-rose-100';
      else if (todayAtt.status === 'Half Day') todayStatusColor = 'bg-amber-50 text-amber-700 border border-amber-100';
      else if (todayAtt.status === 'Leave') todayStatusColor = 'bg-violet-50 text-violet-750 border border-violet-100';
    }
  }

  // Attendance listing for selected month (hiding future dates for current month)
  const daysInMonth = getDaysInMonth(selYear, selMonth);
  const totalDaysToRender = (selYear === today.getFullYear() && selMonth === today.getMonth()) ? today.getDate() : daysInMonth;
  const attendanceList: Array<{ dateStr: string; day: number; record?: AttendanceRecord }> = [];
  for (let d = 1; d <= totalDaysToRender; d++) {
    const dStr = `${selYear}-${String(selMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    attendanceList.push({
      dateStr: dStr,
      day: d,
      record: db.attendance[`${employee.id}_${dStr}`]
    });
  }
  // Show latest days first
  attendanceList.reverse();

  // Helper for status translations
  const translateStatus = (status?: string) => {
    if (!status) return '-';
    if (lang === 'en') return status;
    switch(status) {
      case 'Present': return 'उपस्थित';
      case 'Absent': return 'अनुपस्थित';
      case 'Half Day': return 'आधा दिन';
      case 'Leave': return 'छुट्टी';
      default: return status;
    }
  };

  const autoGeneratedFines = db.deductions?.filter(d => d.employeeId === employee.id && d.isAutoGenerated) || [];
  const activeFines = autoGeneratedFines.filter(f => f.status !== 'Waived' && f.status !== 'Deleted');
  const waivedFines = autoGeneratedFines.filter(f => f.status === 'Waived');
  const deletedFines = autoGeneratedFines.filter(f => f.status === 'Deleted');

  const getStatusBadgeClass = (status?: string) => {
    if (!status) return 'text-slate-400';
    switch(status) {
      case 'Present': return 'text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 font-bold';
      case 'Absent': return 'text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-100 font-bold';
      case 'Half Day': return 'text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 font-bold';
      case 'Leave': return 'text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full border border-violet-100 font-bold';
      default: return '';
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F9FC] font-sans select-none text-slate-800 pb-20 md:pb-8 flex justify-center">
      <div className="w-full max-w-md bg-[#F7F9FC] min-h-screen relative flex flex-col shadow-sm">
        
        {/* PREMIUM WEB HEADER */}
        <header className="sticky top-0 bg-white/95 border-b border-[#E2E8F0] z-40 backdrop-blur-md px-4 py-3 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            {db.company?.logo ? (
              <img src={db.company.logo} alt="Company Logo" className="w-10 h-10 rounded-xl object-cover border border-[#E2E8F0]" />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 text-[#2563EB] flex items-center justify-center">
                <Icon name="agriculture" size={20} />
              </div>
            )}
            <div>
              <h1 className="text-sm font-black text-[#0F172A] tracking-tight leading-none">
                {db.company?.name || 'Shree Kamdhenu'}
              </h1>
              <span className="text-[9px] text-[#2563EB] font-bold uppercase tracking-wider block mt-1">
                {t('Employee Portal', 'कर्मचारी पोर्टल')}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onUpdateDb && (
              <NotificationDesk 
                db={db}
                onUpdateDb={onUpdateDb}
                userId={employee.id}
                lang={lang}
              />
            )}
            <button
              onClick={onToggleLang}
              className="w-8 h-8 rounded-full border border-[#E2E8F0] bg-white text-[10px] font-bold text-[#64748B] hover:bg-slate-50 active:scale-95 transition-all cursor-pointer flex items-center justify-center shadow-sm"
            >
              {t('A/अ', 'A/अ')}
            </button>
          </div>
        </header>

        {/* MAIN CONTAINER */}
        <main className="flex-1 w-full px-4 py-5 space-y-5 overflow-y-auto">
          
          {/* TAB 1: OVERVIEW / HOME */}
          {activeTab === 'overview' && (
            <div className="space-y-5 animate-in fade-in duration-200">
              
              {/* Profile Card */}
              <div className="bg-white border border-[#E2E8F0] rounded-3xl p-5 shadow-sm flex flex-col sm:flex-row items-center gap-4 relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-[#EFF6FF] text-[#2563EB] text-[9px] font-black px-3.5 py-1 rounded-bl-2xl border-l border-b border-blue-100/50 uppercase tracking-wider">
                  {employee.type === 'Hourly' ? t('Hourly Engine', 'घंटेवार') : employee.type === 'Daily' ? t('Daily Wage', 'दैनिक') : t('Monthly', 'मासिक')}
                </div>
                
                <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-[#E2E8F0] overflow-hidden flex-shrink-0 flex items-center justify-center">
                  {employee.pic ? (
                    <img src={employee.pic} alt={employee.name} className="w-full h-full object-cover" />
                  ) : (
                    <Icon name="person" size={32} className="text-[#64748B]" />
                  )}
                </div>

                <div className="text-center sm:text-left space-y-1">
                  <h2 className="text-base font-bold text-[#0F172A] leading-tight">{employee.name}</h2>
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-2 gap-y-1 text-[10px] text-[#64748B] font-semibold">
                    <span className="flex items-center gap-1"><Icon name="badge" size={12} /> {employee.id}</span>
                    <span className="w-1 h-1 rounded-full bg-[#E2E8F0]" />
                    <span className="flex items-center gap-1"><Icon name="event" size={12} /> {employee.join}</span>
                  </div>
                  <div className="pt-2">
                    <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wide border ${
                      employee.status === 'Active' ? 'bg-[#ECFDF5] text-[#10B981] border-emerald-100' : 'bg-rose-50 text-[#EF4444] border-rose-100'
                    }`}>
                      {employee.status === 'Active' ? t('Active', 'सक्रिय') : t('Left Job', 'कार्यमुक्त')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Today's Attendance & GeoFence Punch */}
              <div className="bg-white border border-[#E2E8F0] rounded-3xl p-5 shadow-sm space-y-4">
                <div className="flex justify-between items-center border-b border-[#E2E8F0] pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center">
                      <Icon name="my_location" size={18} />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-[#0F172A] uppercase tracking-wider">{t("Today's Attendance", 'आज की हाजिरी')}</h4>
                      <p className="text-[9px] text-[#64748B] font-semibold mt-0.5">
                        {new Date().toLocaleDateString(lang === 'en' ? 'en-US' : 'hi-IN', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' })}
                      </p>
                    </div>
                  </div>
                  {/* Status Badge */}
                  {gpsLoc ? (
                    insideGeoFence ? (
                      <span className="bg-[#ECFDF5] text-[#10B981] border border-emerald-100 text-[9px] font-black px-2 py-1 rounded-full flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-[#10B981] rounded-full animate-pulse" />
                        {t('In Zone', 'ज़ोन में')}
                      </span>
                    ) : (
                      <span className="bg-rose-50 text-[#EF4444] border border-rose-100 text-[9px] font-black px-2 py-1 rounded-full flex items-center gap-1">
                        <Icon name="cancel" size={10} />
                        {t('Outside', 'बाहर')}
                      </span>
                    )
                  ) : (
                    <span className="bg-slate-50 text-[#64748B] border border-[#E2E8F0] text-[9px] font-black px-2 py-1 rounded-full">
                      Loading...
                    </span>
                  )}
                </div>

                {!insideGeoFence && gpsLoc && (
                  <div className="bg-rose-50/50 border border-rose-100 text-[10px] text-rose-700 font-bold p-3 rounded-2xl">
                    <p className="flex items-center gap-1.5 mb-2">
                      <Icon name="info" size={14} />
                      {t("You're outside the assigned work area", 'आप कार्य क्षेत्र से बाहर हैं')}
                    </p>
                    <p className="text-[9px] text-rose-500 font-semibold mb-2">
                      {t('Direct punch is unavailable', 'डायरेक्ट पंच उपलब्ध नहीं है')} ({distanceToFence !== null ? Math.round(distanceToFence) : '?'}m away)
                    </p>
                    <button
                      onClick={() => setActiveTab('requests')}
                      className="text-[#2563EB] hover:underline flex items-center gap-1"
                    >
                      <Icon name="edit_document" size={12} /> {t('Request Attendance Correction', 'हाजिरी सुधार अनुरोध करें')}
                    </button>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => { setPunchType('Punch In'); handlePunchClick('Punch In'); }}
                    disabled={!gpsLoc || !insideGeoFence}
                    className="flex-1 h-12 bg-[#2563EB] hover:bg-blue-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50 disabled:bg-slate-300 disabled:text-slate-500 transition-all active:scale-[0.98]"
                  >
                    <Icon name="login" size={18} />
                    {t('Punch In', 'पंच इन')}
                  </button>
                  <button
                    onClick={() => { setPunchType('Punch Out'); handlePunchClick('Punch Out'); }}
                    disabled={!gpsLoc || !insideGeoFence}
                    className="flex-1 h-12 bg-white border-2 border-[#E2E8F0] text-[#0F172A] hover:bg-slate-50 rounded-2xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-sm disabled:opacity-50 transition-all active:scale-[0.98]"
                  >
                    <Icon name="logout" size={18} />
                    {t('Punch Out', 'पंच आउट')}
                  </button>
                </div>
              </div>

              {/* Today's Overview Metrics */}
              <div className="space-y-2">
                <h3 className="text-[11px] font-black text-[#0F172A] uppercase tracking-wider pl-1">{t("Today's Overview", 'आज का विवरण')}</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm">
                    <span className="text-[9px] text-[#64748B] font-bold block mb-1">{t('Status', 'स्थिति')}</span>
                    <span className={`text-xs font-black flex items-center gap-1 ${
                      todayAtt?.status === 'Present' ? 'text-[#10B981]' : 
                      todayAtt?.status === 'Absent' ? 'text-[#EF4444]' : 'text-[#2563EB]'
                    }`}>
                      <Icon name={todayAtt?.status === 'Present' ? 'check_circle' : todayAtt?.status === 'Absent' ? 'cancel' : 'schedule'} size={14} />
                      {todayStatusLabel}
                    </span>
                  </div>
                  <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm">
                    <span className="text-[9px] text-[#64748B] font-bold block mb-1">{t('Worked Hours', 'कार्य घंटे')}</span>
                    <span className="text-xs font-black text-[#0F172A] flex items-center gap-1">
                      <Icon name="timer" size={14} className="text-slate-400" />
                      {(() => {
                        let sumHrs = 0;
                        if (todayAtt && todayAtt.sessions) {
                          todayAtt.sessions.forEach(s => {
                            if (s.in && s.out) sumHrs += timeToHrs(s.in, s.out);
                          });
                        }
                        return sumHrs.toFixed(1);
                      })()} hrs
                    </span>
                  </div>
                  <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm">
                    <span className="text-[9px] text-[#64748B] font-bold block mb-1">{t('Current Month Due', 'इस महीने का बकाया')}</span>
                    <span className="text-xs font-black text-[#0F172A]">{formatCurrency(metrics.netPending)}</span>
                  </div>
                  <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm">
                    <span className="text-[9px] text-[#64748B] font-bold block mb-1">{t('Net Balance Due', 'कुल बकाया')}</span>
                    <span className="text-xs font-black text-[#10B981]">{formatCurrency(financials.totalDue)}</span>
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="space-y-2">
                <h3 className="text-[11px] font-black text-[#0F172A] uppercase tracking-wider pl-1">{t('Quick Actions', 'त्वरित क्रियाएं')}</h3>
                <div className="grid grid-cols-4 gap-2">
                  <div onClick={() => setActiveTab('attendance')} className="bg-white border border-[#E2E8F0] rounded-2xl p-3 flex flex-col items-center justify-center gap-2 cursor-pointer shadow-sm hover:bg-slate-50 active:scale-95 transition-all">
                    <div className="text-[#2563EB]"><Icon name="calendar_month" size={24} /></div>
                    <span className="text-[9px] font-bold text-[#64748B] text-center leading-tight">{t('Attendance', 'हाजिरी')}</span>
                  </div>
                  <div onClick={() => setActiveTab('salary')} className="bg-white border border-[#E2E8F0] rounded-2xl p-3 flex flex-col items-center justify-center gap-2 cursor-pointer shadow-sm hover:bg-slate-50 active:scale-95 transition-all">
                    <div className="text-[#2563EB]"><Icon name="receipt_long" size={24} /></div>
                    <span className="text-[9px] font-bold text-[#64748B] text-center leading-tight">{t('Salary Slip', 'वेतन पत्र')}</span>
                  </div>
                  <div onClick={() => setActiveTab('requests')} className="bg-white border border-[#E2E8F0] rounded-2xl p-3 flex flex-col items-center justify-center gap-2 cursor-pointer shadow-sm hover:bg-slate-50 active:scale-95 transition-all">
                    <div className="text-[#2563EB]"><Icon name="post_add" size={24} /></div>
                    <span className="text-[9px] font-bold text-[#64748B] text-center leading-tight">{t('Raise Request', 'अनुरोध')}</span>
                  </div>
                  <div onClick={() => setActiveTab('settings')} className="bg-white border border-[#E2E8F0] rounded-2xl p-3 flex flex-col items-center justify-center gap-2 cursor-pointer shadow-sm hover:bg-slate-50 active:scale-95 transition-all">
                    <div className="text-[#2563EB]"><Icon name="person" size={24} /></div>
                    <span className="text-[9px] font-bold text-[#64748B] text-center leading-tight">{t('My Profile', 'प्रोफाइल')}</span>
                  </div>
                </div>
              </div>

              {/* Monthly Financial Statement summary */}
              <div className="bg-white border border-[#E2E8F0] rounded-3xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black text-[#0F172A] uppercase tracking-wider">{t('Monthly Financial Statement', 'मासिक वित्तीय विवरण')}</h3>
                  <button onClick={() => setActiveTab('salary')} className="text-[9px] text-[#2563EB] font-bold flex items-center gap-0.5">{t('View Details', 'विवरण')} <Icon name="chevron_right" size={12} /></button>
                </div>
                <div className="space-y-3 pt-1 text-xs">
                  <div className="flex items-center justify-between text-[#64748B] font-medium">
                    <span>{t('Previous Balance Due', 'पिछले महीने का बकाया')}</span>
                    <span className="font-bold text-[#0F172A]">{formatCurrency(financials.previousDue)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[#64748B] font-medium">
                    <span>{t('Basic Earned Salary', 'अर्जित मूल वेतन')}</span>
                    <span className="font-bold text-[#0F172A]">{formatCurrency(metrics.earnedSalary)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[#64748B] font-medium">
                    <span>{t('Total Payable', 'कुल देय वेतन')}</span>
                    <span className="font-extrabold text-[#0F172A]">{formatCurrency(financials.totalPayable)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[#64748B] font-medium">
                    <span>{t('Payments Received', 'कुल प्राप्त भुगतान')}</span>
                    <span className="font-bold text-emerald-600">-{formatCurrency(metrics.payments)}</span>
                  </div>
                  <hr className="border-[#E2E8F0]" />
                  <div className="flex items-center justify-between text-sm font-black text-[#0F172A]">
                    <span>{t('Net Balance Pending', 'कुल शेष बकाया')}</span>
                    <span className="text-[#2563EB]">{formatCurrency(financials.totalDue)}</span>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* TAB 2: ATTENDANCE */}
          {activeTab === 'attendance' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="bg-white border border-[#E2E8F0] rounded-3xl p-4 shadow-sm flex items-center justify-between">
                <button onClick={() => {
                  if (selMonth === 0) { setSelMonth(11); setSelYear(selYear - 1); }
                  else setSelMonth(selMonth - 1);
                }} className="w-8 h-8 rounded-full hover:bg-slate-50 flex items-center justify-center text-[#64748B] cursor-pointer"><Icon name="chevron_left" size={20}/></button>
                <div className="text-sm font-black text-[#0F172A]">{months[selMonth]} {selYear}</div>
                <button onClick={() => {
                  if (selYear === today.getFullYear() && selMonth >= today.getMonth()) return;
                  if (selMonth === 11) { setSelMonth(0); setSelYear(selYear + 1); }
                  else setSelMonth(selMonth + 1);
                }} className={`w-8 h-8 rounded-full flex items-center justify-center cursor-pointer ${selYear === today.getFullYear() && selMonth >= today.getMonth() ? 'text-slate-300 cursor-not-allowed' : 'text-[#64748B] hover:bg-slate-50'}`}><Icon name="chevron_right" size={20}/></button>
              </div>

              <div className="space-y-3">
                {attendanceList.map((item, idx) => {
                  let badge = 'text-[#64748B] bg-slate-50 border-[#E2E8F0]';
                  let lbl = t('Not Marked', 'मार्क नहीं');
                  if (item.record?.status === 'Present') { badge = 'text-[#10B981] bg-[#ECFDF5] border-emerald-100'; lbl = t('Present', 'उपस्थित'); }
                  if (item.record?.status === 'Absent') { badge = 'text-[#EF4444] bg-rose-50 border-rose-100'; lbl = t('Absent', 'अनुपस्थित'); }
                  if (item.record?.status === 'Half Day') { badge = 'text-[#F59E0B] bg-amber-50 border-amber-100'; lbl = t('Half Day', 'आधा दिन'); }
                  if (item.record?.status === 'Leave') { badge = 'text-[#2563EB] bg-[#EFF6FF] border-blue-100'; lbl = t('Leave', 'छुट्टी'); }

                  let workHrs = 0;
                  if (item.record?.sessions) {
                    item.record.sessions.forEach(s => { if (s.in && s.out) workHrs += timeToHrs(s.in, s.out); });
                  }
                  
                  return (
                    <div key={idx} className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <div className="font-bold text-sm text-[#0F172A]">{item.day} {months[selMonth].substring(0,3)} {selYear}</div>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${badge}`}>{lbl}</span>
                      </div>
                      
                      {item.record?.sessions && item.record.sessions.length > 0 && (
                        <div className="text-xs text-[#64748B] space-y-1">
                          {item.record.sessions.map((s, i) => (
                            <div key={i} className="flex items-center justify-between bg-slate-50 p-2 rounded-xl">
                              <span>{s.in} - {s.out || '?'}</span>
                              <span className="font-semibold text-[#0F172A]">{s.out ? timeToHrs(s.in, s.out).toFixed(1) + 'h' : 'Active'}</span>
                            </div>
                          ))}
                          <div className="flex items-center gap-3 pt-1 text-[10px] font-bold">
                            <span className="text-[#2563EB]">Work: {workHrs.toFixed(1)}h</span>
                            {item.record.overtimeHours ? <span className="text-[#10B981]">OT: {item.record.overtimeHours}h</span> : null}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: SALARY SLIP */}
          {activeTab === 'salary' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="bg-white border border-[#E2E8F0] rounded-3xl p-4 shadow-sm flex items-center justify-between">
                <button onClick={() => {
                  if (selMonth === 0) { setSelMonth(11); setSelYear(selYear - 1); }
                  else setSelMonth(selMonth - 1);
                }} className="w-8 h-8 rounded-full hover:bg-slate-50 flex items-center justify-center text-[#64748B] cursor-pointer"><Icon name="chevron_left" size={20}/></button>
                <div className="text-sm font-black text-[#0F172A]">{months[selMonth]} {selYear}</div>
                <button onClick={() => {
                  if (selYear === today.getFullYear() && selMonth >= today.getMonth()) return;
                  if (selMonth === 11) { setSelMonth(0); setSelYear(selYear + 1); }
                  else setSelMonth(selMonth + 1);
                }} className={`w-8 h-8 rounded-full flex items-center justify-center cursor-pointer ${selYear === today.getFullYear() && selMonth >= today.getMonth() ? 'text-slate-300 cursor-not-allowed' : 'text-[#64748B] hover:bg-slate-50'}`}><Icon name="chevron_right" size={20}/></button>
              </div>

              {/* Folders */}
              <div className="space-y-3">
                {/* Base Earnings */}
                <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden">
                  <div onClick={() => setOpenFolders(p => ({...p, base: !p.base}))} className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50">
                    <div className="flex items-center gap-2">
                      <Icon name="payments" size={20} className="text-[#10B981]" />
                      <span className="text-xs font-black text-[#0F172A]">{t('Earnings Summary (Base)', 'अर्जित मूल वेतन')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-[#10B981]">{formatCurrency(metrics.earnedSalary)}</span>
                      <Icon name="expand_more" size={18} className={`text-[#64748B] transition-transform ${openFolders.base ? 'rotate-180' : ''}`} />
                    </div>
                  </div>
                  {openFolders.base && (
                    <div className="px-4 pb-4 pt-2 text-xs border-t border-[#E2E8F0] space-y-2">
                      <div className="flex justify-between"><span>{t('Basic Salary', 'बेसिक')}</span><span className="font-bold">{formatCurrency(metrics.earnedSalary)}</span></div>
                    </div>
                  )}
                </div>

                {/* Overtime */}
                <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden">
                  <div onClick={() => setOpenFolders(p => ({...p, ot: !p.ot}))} className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50">
                    <div className="flex items-center gap-2">
                      <Icon name="more_time" size={20} className="text-[#F59E0B]" />
                      <span className="text-xs font-black text-[#0F172A]">{t('Overtime (OT) Ledger', 'ओवरटाइम')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-[#F59E0B]">{formatCurrency(metrics.overtime)}</span>
                      <Icon name="expand_more" size={18} className={`text-[#64748B] transition-transform ${openFolders.ot ? 'rotate-180' : ''}`} />
                    </div>
                  </div>
                  {openFolders.ot && (
                    <div className="px-4 pb-4 pt-2 text-xs border-t border-[#E2E8F0] space-y-2">
                      {metrics.details.overtimeRows.length === 0 ? <div className="text-center text-[#64748B] py-2">{t('No OT this month', 'कोई ओवरटाइम नहीं')}</div> :
                        metrics.details.overtimeRows.map((r: any, i: number) => (
                          <div key={i} className="flex justify-between items-center border-b border-slate-50 pb-2">
                            <span>{r.date} <span className="text-[10px] text-slate-400">({r.hours}h)</span></span>
                            <span className="font-bold">{formatCurrency(r.amount)}</span>
                          </div>
                        ))
                      }
                    </div>
                  )}
                </div>

                {/* Extras */}
                <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden">
                  <div onClick={() => setOpenFolders(p => ({...p, bonus: !p.bonus}))} className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50">
                    <div className="flex items-center gap-2">
                      <Icon name="stars" size={20} className="text-[#2563EB]" />
                      <span className="text-xs font-black text-[#0F172A]">{t('Bonuses & Extra Earnings', 'बोनस')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-[#2563EB]">{formatCurrency(metrics.extraEarnings)}</span>
                      <Icon name="expand_more" size={18} className={`text-[#64748B] transition-transform ${openFolders.bonus ? 'rotate-180' : ''}`} />
                    </div>
                  </div>
                  {openFolders.bonus && (
                    <div className="px-4 pb-4 pt-2 text-xs border-t border-[#E2E8F0] space-y-2">
                      {metrics.details.extraEarningsRows.length === 0 ? <div className="text-center text-[#64748B] py-2">{t('No bonus this month', 'कोई बोनस नहीं')}</div> :
                        metrics.details.extraEarningsRows.map((r: any, i: number) => (
                          <div key={i} className="flex justify-between items-center border-b border-slate-50 pb-2">
                            <span>{r.date} - {r.desc}</span>
                            <span className="font-bold">{formatCurrency(r.amount)}</span>
                          </div>
                        ))
                      }
                    </div>
                  )}
                </div>

                {/* Deductions */}
                <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden">
                  <div onClick={() => setOpenFolders(p => ({...p, ded: !p.ded}))} className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50">
                    <div className="flex items-center gap-2">
                      <Icon name="money_off" size={20} className="text-[#EF4444]" />
                      <span className="text-xs font-black text-[#0F172A]">{t('Deductions & Fines', 'कटौती')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-[#EF4444]">{formatCurrency(metrics.deductions)}</span>
                      <Icon name="expand_more" size={18} className={`text-[#64748B] transition-transform ${openFolders.ded ? 'rotate-180' : ''}`} />
                    </div>
                  </div>
                  {openFolders.ded && (
                    <div className="px-4 pb-4 pt-2 text-xs border-t border-[#E2E8F0] space-y-2">
                      {metrics.details.deductionsRows.length === 0 ? <div className="text-center text-[#64748B] py-2">{t('No deductions', 'कोई कटौती नहीं')}</div> :
                        metrics.details.deductionsRows.map((r: any, i: number) => (
                          <div key={i} className="flex justify-between items-center border-b border-slate-50 pb-2">
                            <span>{r.date} - {r.desc}</span>
                            <span className="font-bold text-rose-600">-{formatCurrency(r.amount)}</span>
                          </div>
                        ))
                      }
                    </div>
                  )}
                </div>

                {/* Payments */}
                <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden">
                  <div onClick={() => setOpenFolders(p => ({...p, pay: !p.pay}))} className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50">
                    <div className="flex items-center gap-2">
                      <Icon name="check_circle" size={20} className="text-[#10B981]" />
                      <span className="text-xs font-black text-[#0F172A]">{t('Received Payments', 'प्राप्त भुगतान')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-[#10B981]">{formatCurrency(metrics.payments)}</span>
                      <Icon name="expand_more" size={18} className={`text-[#64748B] transition-transform ${openFolders.pay ? 'rotate-180' : ''}`} />
                    </div>
                  </div>
                  {openFolders.pay && (
                    <div className="px-4 pb-4 pt-2 text-xs border-t border-[#E2E8F0] space-y-2">
                      {metrics.details.paymentsRows.length === 0 ? <div className="text-center text-[#64748B] py-2">{t('No payments', 'कोई भुगतान नहीं')}</div> :
                        metrics.details.paymentsRows.map((r: any, i: number) => (
                          <div key={i} className="flex justify-between items-center border-b border-slate-50 pb-2">
                            <span>{r.date} - {r.mode}</span>
                            <span className="font-bold text-emerald-600">{formatCurrency(r.amount)}</span>
                          </div>
                        ))
                      }
                    </div>
                  )}
                </div>

                <div className="pt-4 px-2 flex items-center justify-between font-black text-lg text-[#0F172A]">
                  <span>{t('Net Payable', 'कुल देय')}</span>
                  <span className="text-[#10B981]">{formatCurrency(financials.totalPayable - metrics.payments)}</span>
                </div>

                <button
                  onClick={() => setIsPdfReady(true)}
                  className="mt-6 w-full h-12 bg-[#2563EB] hover:bg-blue-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.98]"
                >
                  <Icon name="download" size={18} />
                  {t('Download Salary Slip', 'सैलरी स्लिप डाउनलोड करें')}
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: REQUESTS (Wrapped ApprovalPanel) */}
          {activeTab === 'requests' && (
            <div className="animate-in fade-in duration-200">
              <ApprovalPanel 
                employeeId={employee.id}
                employeeName={employee.name}
                employeePic={employee.pic} db={db} lang={lang} isAdmin={false}
              />
            </div>
          )}

          {/* TAB 5: MORE / SETTINGS */}
          {activeTab === 'settings' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              
              <div className="bg-white border border-[#E2E8F0] rounded-3xl p-4 shadow-sm flex items-center gap-4">
                 <div className="w-14 h-14 rounded-full bg-slate-50 border border-[#E2E8F0] overflow-hidden flex-shrink-0 flex items-center justify-center">
                  {employee.pic ? (
                    <img src={employee.pic} alt={employee.name} className="w-full h-full object-cover" />
                  ) : (
                    <Icon name="person" size={28} className="text-[#64748B]" />
                  )}
                </div>
                <div>
                  <h2 className="text-sm font-bold text-[#0F172A]">{employee.name}</h2>
                  <div className="text-[10px] text-[#64748B] font-semibold mt-0.5">{employee.id}</div>
                  <div className="text-[9px] text-[#2563EB] font-bold mt-0.5">{employee.type}</div>
                </div>
              </div>

              <div className="bg-white border border-[#E2E8F0] rounded-3xl shadow-sm overflow-hidden">
                <div className="p-4 flex items-center justify-between border-b border-slate-100 active:bg-slate-50 cursor-pointer">
                  <div className="flex items-center gap-3">
                    <Icon name="person" size={20} className="text-[#2563EB]" />
                    <span className="text-xs font-bold text-[#0F172A]">{t('My Profile', 'प्रोफाइल')}</span>
                  </div>
                  <Icon name="chevron_right" size={18} className="text-[#64748B]" />
                </div>
                
                <div 
                  onClick={() => {
                    const np = prompt(t('Enter new password:', 'नया पासवर्ड दर्ज करें:'));
                    if (np && np.length >= 4) {
                      if (onUpdateDb) {
                        const updated = {...db, employees: db.employees.map(e => e.id === employee.id ? {...e, pass: np} : e)};
                        onUpdateDb(updated);
                        alert(t('Password changed successfully!', 'पासवर्ड सफलतापूर्वक बदल गया!'));
                      }
                    }
                  }}
                  className="p-4 flex items-center justify-between border-b border-slate-100 active:bg-slate-50 cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <Icon name="lock" size={20} className="text-[#2563EB]" />
                    <span className="text-xs font-bold text-[#0F172A]">{t('Change Password', 'पासवर्ड बदलें')}</span>
                  </div>
                  <Icon name="chevron_right" size={18} className="text-[#64748B]" />
                </div>

                <div className="p-4 flex items-center justify-between active:bg-slate-50 cursor-pointer">
                  <div className="flex items-center gap-3">
                    <Icon name="help" size={20} className="text-[#2563EB]" />
                    <span className="text-xs font-bold text-[#0F172A]">{t('Help & Support', 'सहायता')}</span>
                  </div>
                  <Icon name="chevron_right" size={18} className="text-[#64748B]" />
                </div>
              </div>

              <button
                onClick={onLogout}
                className="mt-6 w-full h-12 border-2 border-rose-100 text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-2xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.98] cursor-pointer"
              >
                <Icon name="logout" size={18} />
                {t('Logout', 'लॉगआउट')}
              </button>
            </div>
          )}

        </main>

        {/* BOTTOM NAVIGATION BAR */}
        <nav className="fixed bottom-0 left-0 w-full md:relative md:bottom-auto bg-white border-t border-[#E2E8F0] px-2 py-2 flex justify-between items-center shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-40 pb-safe">
          <button onClick={() => setActiveTab('overview')} className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${activeTab === 'overview' ? 'text-[#2563EB]' : 'text-[#64748B] hover:bg-slate-50'}`}>
            <Icon name="home" size={22} />
            <span className="text-[9px] font-bold">{t('Home', 'होम')}</span>
          </button>
          <button onClick={() => setActiveTab('attendance')} className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${activeTab === 'attendance' ? 'text-[#2563EB]' : 'text-[#64748B] hover:bg-slate-50'}`}>
            <Icon name="calendar_month" size={22} />
            <span className="text-[9px] font-bold">{t('Attendance', 'हाजिरी')}</span>
          </button>
          <button onClick={() => setActiveTab('salary')} className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${activeTab === 'salary' ? 'text-[#2563EB]' : 'text-[#64748B] hover:bg-slate-50'}`}>
            <Icon name="receipt_long" size={22} />
            <span className="text-[9px] font-bold">{t('Salary', 'सैलरी')}</span>
          </button>
          <button onClick={() => setActiveTab('requests')} className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${activeTab === 'requests' ? 'text-[#2563EB]' : 'text-[#64748B] hover:bg-slate-50'}`}>
            <Icon name="send" size={22} />
            <span className="text-[9px] font-bold">{t('Requests', 'अनुरोध')}</span>
          </button>
          <button onClick={() => setActiveTab('settings')} className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${activeTab === 'settings' ? 'text-[#2563EB]' : 'text-[#64748B] hover:bg-slate-50'}`}>
            <Icon name="grid_view" size={22} />
            <span className="text-[9px] font-bold">{t('More', 'अधिक')}</span>
          </button>
        </nav>

        {/* PDF MODAL */}
        {isPdfReady && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex flex-col">
             <div className="flex justify-between items-center p-4 bg-white border-b border-slate-200">
               <h3 className="font-bold">{t('Salary Slip', 'सैलरी स्लिप')}</h3>
               <button onClick={() => setIsPdfReady(false)} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center"><Icon name="close" size={20}/></button>
             </div>
             <div className="flex-1 overflow-y-auto bg-slate-50 p-4">
                <SalarySlipPDF employee={employee} db={db} month={selMonth} year={selYear} lang={lang} />
             </div>
             <div className="p-4 bg-white border-t border-slate-200">
               <button onClick={() => downloadSalarySlipPDF(employee.name, ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][selMonth] + '_' + selYear)} className="w-full h-12 bg-blue-600 text-white rounded-xl font-bold flex justify-center items-center gap-2">
                 <Icon name="download" size={20} /> {t('Download PDF', 'PDF डाउनलोड करें')}
               </button>
             </div>
          </div>
        )}

      </div>
    </div>
  );
}
