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
  onUpdateDb?: (updatedDb: AppDatabase) => void;
}

export default function EmployeeDashboard({
  employeeId,
  db,
  lang,
  onToggleLang,
  onLogout,
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
        setIsLocationBlocked(true);
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
        const optimizedBase64 = await optimizeImage(file);
        setPunchSelfie(optimizedBase64);
      } catch (err: any) {
        alert(t('Image optimization failed: ' + err.message, 'छवि अनुकूलन विफल रहा: ' + err.message));
      }
    }
  };

  const handlePunchClick = () => {
    if (!gpsLoc) {
      alert(t('GPS coordinates not loaded yet. Please wait...', 'जीपीएस निर्देशांक लोड नहीं हुए। कृपया प्रतीक्षा करें...'));
      return;
    }

    if (!insideGeoFence) {
      alert(t('You are outside of your assigned GeoFence radius. Direct punch is disabled.', 'आप जियोफेंस परिधि से बाहर हैं। डायरेक्ट पंच बंद है।'));
      return;
    }

    const todayDateStr = new Date().toISOString().split('T')[0];
    const check = validatePunchRequestRules(employee.id, punchType, todayDateStr, db);
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
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans select-none text-slate-800 pb-28 md:pb-8">
      
      {/* Premium Web Header */}
      <header className="sticky top-0 bg-white/95 border-b border-slate-200/50 z-40 backdrop-blur-md px-4 py-3 shadow-3xs">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {db.company?.logo ? (
              <img src={db.company.logo} alt="Company Logo" className="w-9 h-9 rounded-xl object-cover border border-slate-100 shadow-3xs" />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-blue-50/70 border border-blue-100 text-blue-600 flex items-center justify-center shadow-3xs">
                <Icon name="agriculture" size={20} />
              </div>
            )}
            <div>
              <h1 className="text-xs font-black text-slate-900 tracking-tight leading-none">
                {db.company?.name || 'Shree Kamdhenu'}
              </h1>
              <span className="text-[8px] text-blue-600 font-bold uppercase tracking-wider block mt-1">
                {t('Employee Self Portal', 'कर्मचारी स्व-सेवा पोर्टल')}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Live Notifications desk */}
            {onUpdateDb && (
              <NotificationDesk 
                db={db}
                onUpdateDb={onUpdateDb}
                userId={employee.id}
                lang={lang}
              />
            )}

            {/* Lang switcher */}
            <button
              onClick={onToggleLang}
              className="h-8 px-3 rounded-xl border border-slate-200 bg-white font-bold text-[10px] text-slate-650 hover:bg-slate-50 active:scale-[0.97] transition-all cursor-pointer shadow-3xs"
            >
              {t('हिंदी', 'English')}
            </button>
            
            {/* Logout */}
            <button
              onClick={onLogout}
              className="h-8 w-8 rounded-xl border border-rose-100 bg-rose-50/50 hover:bg-rose-50 text-rose-600 flex items-center justify-center active:scale-[0.97] transition-all cursor-pointer"
              title={t('Logout', 'लॉगआउट')}
            >
              <Icon name="logout" size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-5 space-y-6">
        
        {/* Profile Card */}
        <div className="bg-white border border-slate-200/60 rounded-3xl p-5 shadow-2xs flex flex-col sm:flex-row items-center gap-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-blue-50/70 text-blue-700 text-[9px] font-black px-3.5 py-1 rounded-bl-2xl border-l border-b border-blue-100/50 uppercase tracking-wider">
            {employee.type === 'Hourly' ? t('Hourly Engine', 'घंटेवार भुगतान') : employee.type === 'Daily' ? t('Daily Wage', 'दैनिक वेतन') : t('Monthly Fixed', 'मासिक वेतन')}
          </div>

          {/* Profile Photo */}
          <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-200 overflow-hidden shadow-3xs flex-shrink-0 flex items-center justify-center">
            {employee.pic ? (
              <img src={employee.pic} alt={employee.name} className="w-full h-full object-cover" />
            ) : (
              <Icon name="person" size={32} className="text-slate-400" />
            )}
          </div>

          <div className="text-center sm:text-left space-y-1">
            <h2 className="text-base font-bold text-slate-900 leading-tight">{employee.name}</h2>
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-3 gap-y-1.5 text-[10px] text-slate-400 font-semibold">
              <span className="flex items-center gap-1"><Icon name="badge" size={12} /> {employee.id}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-slate-300 hidden sm:inline" />
              <span className="flex items-center gap-1"><Icon name="contact_phone" size={12} /> +91 {employee.mobile}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-slate-300 hidden sm:inline" />
              <span className="flex items-center gap-1"><Icon name="event" size={12} /> {t('Joined', 'शामिल हुए')}: {employee.join}</span>
            </div>
            <div className="pt-2 flex items-center justify-center sm:justify-start gap-2">
              <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wide border ${
                employee.status === 'Active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-rose-50 text-rose-700 border-rose-100'
              }`}>
                {employee.status === 'Active' ? t('Active Status', 'सक्रिय') : t('Left Job', 'कार्यमुक्त')}
              </span>
            </div>
          </div>
        </div>

        {/* Dynamic Selector for Month & Year */}
        <div className="bg-white border border-slate-200/50 rounded-2xl p-4 shadow-3xs flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
              <Icon name="calendar_month" size={18} />
            </div>
            <span className="text-xs font-black text-slate-800 uppercase tracking-wider">{t('Select Calculation Period', 'गणना अवधि चुनें')}</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Month Select */}
            <select
              value={selMonth}
              onChange={e => setSelMonth(parseInt(e.target.value))}
              className="h-9 px-3 rounded-xl border border-slate-200 bg-white font-bold text-xs text-slate-700 focus:outline-none focus:border-blue-500 cursor-pointer shadow-3xs"
            >
              {months.map((m, idx) => {
                // Future months blocker
                if (selYear === today.getFullYear() && idx > today.getMonth()) return null;
                return <option key={idx} value={idx}>{m}</option>;
              })}
            </select>

            {/* Year Select */}
            <select
              value={selYear}
              onChange={e => {
                const val = parseInt(e.target.value);
                setSelYear(val);
                if (val === today.getFullYear() && selMonth > today.getMonth()) {
                  setSelMonth(today.getMonth());
                }
              }}
              className="h-9 px-3 rounded-xl border border-slate-200 bg-white font-bold text-xs text-slate-700 focus:outline-none focus:border-blue-500 cursor-pointer shadow-3xs"
            >
              {Array.from({ length: today.getFullYear() - 2024 + 1 }, (_, i) => 2024 + i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Dashboard Tabs Toggle */}
        <div className="flex border-b border-slate-200 overflow-x-auto whitespace-nowrap gap-1 py-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          <button
            onClick={() => setActiveTab('overview')}
            className={`pb-3 text-xs font-black border-b-2 transition-all cursor-pointer text-center px-4 shrink-0 ${
              activeTab === 'overview' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {t('Overview', 'डैशबोर्ड')}
          </button>
          <button
            onClick={() => setActiveTab('attendance')}
            className={`pb-3 text-xs font-black border-b-2 transition-all cursor-pointer text-center px-4 shrink-0 ${
              activeTab === 'attendance' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {t('Attendance', 'हाजिरी')}
          </button>
          <button
            onClick={() => setActiveTab('salary')}
            className={`pb-3 text-xs font-black border-b-2 transition-all cursor-pointer text-center px-4 shrink-0 ${
              activeTab === 'salary' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {t('Salary Slip', 'वेतन पत्र')}
          </button>
          <button
            onClick={() => setActiveTab('requests')}
            className={`pb-3 text-xs font-black border-b-2 transition-all cursor-pointer text-center px-4 shrink-0 ${
              activeTab === 'requests' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {t('Requests', 'अनुरोध')}
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`pb-3 text-xs font-black border-b-2 transition-all cursor-pointer text-center px-4 shrink-0 ${
              activeTab === 'settings' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {t('Settings', 'सेटिंग्स')}
          </button>
        </div>

        {/* --- TAB CONTENT: 1. OVERVIEW --- */}
        {activeTab === 'overview' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Quick Navigation Shortcut Banner */}
            <div 
              onClick={() => setActiveTab('requests')}
              className="bg-gradient-to-r from-blue-600 to-indigo-650 rounded-2xl p-4 shadow-sm text-white flex items-center justify-between cursor-pointer active:scale-[0.98] hover:shadow-md transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                  <Icon name="quickreply" size={20} className="text-white" />
                </div>
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider">{t('Requests Shortcuts Desk', 'त्वरित अनुरोध डेस्क')}</h4>
                  <p className="text-[9.5px] text-white/80 font-medium mt-0.5">{t('Send leave, payments, or attendance correction requests', 'छुट्टी, भुगतान, या पंच सुधार अनुरोध भेजें')}</p>
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-all">
                <Icon name="chevron_right" size={20} />
              </div>
            </div>

            {/* GeoFence verified Smart Punch Card */}
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
                    <Icon name="my_location" size={18} />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">{t('GeoFence Punch Desk', 'जियोफेंस पंच डेस्क')}</h4>
                    <p className="text-[9px] text-slate-400 font-semibold">
                      {closestFence ? `${closestFence.name} (${closestFence.radius}m)` : t('No GeoFence Assigned', 'कोई जियोफेंस असाइन नहीं है')}
                    </p>
                  </div>
                </div>

                {/* GPS Accuracy Status Badge */}
                {gpsLoc ? (
                  gpsLoc.accuracy <= 30 ? (
                    <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 text-[9px] font-black px-2 py-0.5 rounded-full flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
                      GPS Accepted ({gpsLoc.accuracy.toFixed(0)}m)
                    </span>
                  ) : gpsLoc.accuracy <= 100 ? (
                    <span className="bg-amber-50 text-amber-700 border border-amber-100 text-[9px] font-black px-2 py-0.5 rounded-full flex items-center gap-1">
                      ⚠️ GPS Warning ({gpsLoc.accuracy.toFixed(0)}m)
                    </span>
                  ) : (
                    <span className="bg-rose-50 text-rose-700 border border-rose-100 text-[9px] font-black px-2 py-0.5 rounded-full flex items-center gap-1">
                      🚨 GPS Manual Review ({gpsLoc.accuracy.toFixed(0)}m)
                    </span>
                  )
                ) : (
                  <span className="bg-slate-50 text-slate-500 border border-slate-200 text-[9px] font-black px-2 py-0.5 rounded-full animate-pulse">
                    Locating GPS...
                  </span>
                )}
              </div>

              {/* GeoFence status warnings */}
              {gpsLoc ? (
                insideGeoFence ? (
                  <div className="bg-emerald-50/50 border border-emerald-100 text-[10px] text-emerald-700 font-bold p-3 rounded-2xl flex items-center gap-2">
                    <Icon name="check_circle" size={16} className="text-emerald-500" />
                    <span>{t('Inside assigned GeoFence boundary. Direct punch enabled.', 'आप जियोफेंस परिधि के अंदर हैं। डायरेक्ट पंच चालू है।')}</span>
                  </div>
                ) : (
                  <div className="bg-rose-50/50 border border-rose-100 text-[10px] text-rose-700 font-bold p-3 rounded-2xl space-y-2">
                    <div className="flex items-center gap-2">
                      <Icon name="cancel" size={16} className="text-rose-500" />
                      <span>
                        {t('Outside assigned GeoFence boundary. Direct punch disabled.', 'आप जियोफेंस परिधि से बाहर हैं। डायरेक्ट पंच बंद है।')}{' '}
                        {distanceToFence !== null && `(${Math.round(distanceToFence)}m away)`}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setActiveTab('requests');
                      }}
                      className="text-[9.5px] font-black text-rose-600 hover:underline flex items-center gap-1 uppercase cursor-pointer text-left"
                    >
                      <span>{t('Submit Manual Attendance Correction instead', 'इसके बजाय मैनुअल उपस्थिति सुधार अनुरोध भेजें')}</span>
                      <Icon name="arrow_forward" size={12} />
                    </button>
                  </div>
                )
              ) : null}

              {/* Punch Type Selector */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-2xl">
                <button
                  type="button"
                  onClick={() => setPunchType('Punch In')}
                  className={`py-2 text-xs font-black rounded-xl cursor-pointer transition-all ${
                    punchType === 'Punch In'
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {t('Punch In', 'पंच इन')}
                </button>
                <button
                  type="button"
                  onClick={() => setPunchType('Punch Out')}
                  className={`py-2 text-xs font-black rounded-xl cursor-pointer transition-all ${
                    punchType === 'Punch Out'
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {t('Punch Out', 'पंच आउट')}
                </button>
              </div>

              {/* Submit Punch Request Button (Opens Form Modal) */}
              <button
                onClick={handlePunchClick}
                disabled={!gpsLoc || !insideGeoFence}
                className="w-full h-12 rounded-2xl font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.98] bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/10 disabled:opacity-40"
              >
                <Icon name="assignment_turned_in" size={18} />
                <span>{t('Open Attendance Request Form', 'उपस्थिति अनुरोध प्रपत्र खोलें')}</span>
              </button>

              {/* PUNCH REQUEST DETAIL FORM MODAL */}
              {showPunchModal && (
                <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
                  <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4 overflow-hidden animate-in zoom-in-95 duration-200">
                    <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                      <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">{t('Submit Punch Request', 'पंच अनुरोध प्रपत्र')}</h3>
                      <button 
                        onClick={() => { setShowPunchModal(false); setPunchSelfie(null); }}
                        className="text-slate-400 hover:text-slate-650 cursor-pointer"
                      >
                        <Icon name="close" size={20} />
                      </button>
                    </div>

                    <div className="space-y-3.5 text-xs">
                      {/* Request Type Summary */}
                      <div className="grid grid-cols-2 gap-4 bg-slate-50 border border-slate-150 p-3 rounded-2xl">
                        <div>
                          <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block">{t('Request Type', 'अनुरोध प्रकार')}</span>
                          <span className={`font-black uppercase text-[11px] ${punchType === 'Punch In' ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {punchType === 'Punch In' ? t('Punch In', 'पंच इन') : t('Punch Out', 'पंच आउट')}
                          </span>
                        </div>
                        <div>
                          <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block">{t('Date & Time', 'दिनांक और समय')}</span>
                          <span className="font-semibold text-slate-700">
                            {new Date().toISOString().split('T')[0]} @ {formatHHmm(new Date())}
                          </span>
                        </div>
                      </div>

                      {/* Location Information block */}
                      <div className="space-y-2 border border-slate-150 p-3 rounded-2xl">
                        <div className="text-[9px] uppercase tracking-wider text-slate-450 font-black">📍 {t('Proximity & GPS Details', 'स्थान एवं जीपीएस विवरण')}</div>
                        <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-[10px] font-semibold text-slate-600">
                          <div>
                            <span className="text-[8px] text-slate-400 block">{t('GeoFence Target', 'जियोफेंस लक्ष्य')}</span>
                            <span className="font-black text-slate-700">{closestFence ? closestFence.name : '—'}</span>
                          </div>
                          <div>
                            <span className="text-[8px] text-slate-400 block">{t('Distance to Center', 'केन्द्र से दूरी')}</span>
                            <span className="font-black text-slate-700">{distanceToFence !== null ? `${Math.round(distanceToFence)}m` : '—'}</span>
                          </div>
                          <div className="col-span-2">
                            <span className="text-[8px] text-slate-400 block">{t('Coordinates', 'निर्देशांक')}</span>
                            <span className="font-mono text-slate-700 font-bold">{gpsLoc?.lat.toFixed(6)}, {gpsLoc?.lng.toFixed(6)}</span>
                          </div>
                          <div className="col-span-2">
                            <span className="text-[8px] text-slate-400 block">{t('Address', 'पता')}</span>
                            <span className="text-slate-700 leading-normal block font-sans">{gpsLoc?.address || t('Resolving location address...', 'लोकेशन पता खोजा जा रहा है...')}</span>
                          </div>
                        </div>
                      </div>

                      {/* Hardware / Diagnostics summary */}
                      <div className="grid grid-cols-3 gap-2 border border-slate-150 p-2.5 rounded-2xl text-[9px] text-slate-500 font-bold text-center">
                        <div className="bg-slate-50 p-1.5 rounded-xl">
                          <div className="text-slate-400 text-[8px] uppercase">{t('GPS Accuracy', 'सटीकता')}</div>
                          <div className="font-black text-slate-700 mt-0.5">{gpsLoc ? `${gpsLoc.accuracy.toFixed(0)}m` : '—'}</div>
                        </div>
                        <div className="bg-slate-50 p-1.5 rounded-xl">
                          <div className="text-slate-400 text-[8px] uppercase">{t('Battery', 'बैटरी')}</div>
                          <div className="font-black text-slate-700 mt-0.5">{gpsLoc ? `${gpsLoc.battery}%` : '—'}</div>
                        </div>
                        <div className="bg-slate-50 p-1.5 rounded-xl">
                          <div className="text-slate-400 text-[8px] uppercase">{t('Network', 'नेटवर्क')}</div>
                          <div className={`font-black mt-0.5 ${gpsLoc?.network === 'online' ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {gpsLoc ? (gpsLoc.network === 'online' ? t('Online', 'ऑनलाइन') : t('Offline', 'ऑफलाइन')) : '—'}
                          </div>
                        </div>
                      </div>

                      {/* Camera Selfie Verification Block */}
                      <div className="border border-rose-100 rounded-2xl p-3 bg-rose-50/10 flex flex-col items-center justify-center space-y-2">
                        <div className="text-[9px] font-black text-rose-600 uppercase tracking-wider">
                          🤳 {t('Live Selfie Required', 'सेल्फी अनिवार्य है')} — <span className="text-rose-500">{t('Camera Only', 'सिर्फ कैमरे से')}</span>
                        </div>
                        
                        {punchSelfie ? (
                          <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-slate-200 shadow-sm bg-black flex-shrink-0">
                            <img src={punchSelfie} alt="Selfie preview" className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={() => setPunchSelfie(null)}
                              className="absolute top-1 right-1 bg-black/65 text-white w-4 h-4 rounded-full flex items-center justify-center text-[8px] cursor-pointer"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-1.5">
                            <label className="h-8 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[10px] flex items-center gap-1 cursor-pointer transition-all active:scale-95">
                              <Icon name="photo_camera" size={14} />
                              <span>{t('Take Selfie Now', 'अभी सेल्फी लें')}</span>
                              <input
                                type="file"
                                accept="image/*"
                                capture="user"
                                onChange={handleCameraCapture}
                                className="hidden"
                              />
                            </label>
                            <p className="text-[8px] text-rose-500 font-semibold">{t('Gallery upload blocked', 'गैलरी फोटो मान्य नहीं है')}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={submitPunchRequest}
                        disabled={isPunching || !gpsLoc || !punchSelfie}
                        className="flex-1 h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black cursor-pointer shadow-md disabled:opacity-40 transition-all flex items-center justify-center"
                      >
                        {isPunching ? t('Submitting...', 'जमा किया जा रहा है...') : t('Submit Request', 'अनुरोध भेजें')}
                      </button>
                      <button
                        onClick={() => { setShowPunchModal(false); setPunchSelfie(null); }}
                        className="w-24 h-11 border border-slate-250 text-slate-650 bg-white rounded-xl text-xs font-bold hover:bg-slate-100 transition-all cursor-pointer"
                      >
                        {t('Cancel', 'रद्द करें')}
                      </button>
                    </div>
                    {!punchSelfie && (
                      <p className="text-center text-[9px] text-rose-500 font-bold mt-1">{t('Selfie is mandatory to submit punch', 'पंच भेजने के लिए सेल्फी जरूरी है')}</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Metric Cards Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              
              {/* Today status */}
              <div className="bg-white border border-slate-150 rounded-2xl p-4 shadow-3xs space-y-2">
                <span className="text-[9px] uppercase tracking-wider text-slate-450 font-bold block">{t("Today's Status", 'आज की उपस्थिति')}</span>
                <div className="flex items-center justify-between">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${todayStatusColor}`}>
                    {todayStatusLabel}
                  </span>
                </div>
              </div>

              {/* Working Days counts */}
              <div className="bg-white border border-slate-150 rounded-2xl p-4 shadow-3xs space-y-1">
                <span className="text-[9px] uppercase tracking-wider text-slate-450 font-bold block">{t('Attendance', 'उपस्थिति')}</span>
                <span className="block mt-1 text-lg font-black text-slate-900">{metrics.attendanceCounts.present} <span className="text-xs font-semibold text-slate-400">/ {metrics.attendanceCounts.totalMarked}</span></span>
                <span className="text-[8px] text-slate-400 font-bold block">{t('Days Present', 'दिन उपस्थित')}</span>
              </div>

              {/* Total Worked Hours this Month */}
              <div className="bg-white border border-slate-150 rounded-2xl p-4 shadow-3xs space-y-1">
                <span className="text-[9px] uppercase tracking-wider text-slate-455 font-bold block">{t('Total Worked Hours', 'कुल कार्य घंटे')}</span>
                <span className="block mt-1">
                  <span className="text-lg font-black text-slate-900">
                    {(() => {
                      let sumHrs = 0;
                      const daysInMonth = getDaysInMonth(selYear, selMonth);
                      for (let d = 1; d <= daysInMonth; d++) {
                        const dStr = `${selYear}-${String(selMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                        const rec = db.attendance[`${employee?.id || ''}_${dStr}`];
                        if (rec && rec.sessions) {
                          rec.sessions.forEach(s => {
                            if (s.in && s.out) {
                              sumHrs += timeToHrs(s.in, s.out);
                            }
                          });
                        }
                      }
                      return sumHrs.toFixed(1);
                    })()}
                    <span className="text-xs font-semibold text-slate-400 ml-1">{t('Hrs', 'घंटे')}</span>
                  </span>
                </span>
                <span className="text-[8px] text-slate-400 font-bold block">{t('Worked this month', 'इस महीने कार्य')}</span>
              </div>

              {/* Net Pending salary */}
              <div className="bg-white border border-slate-150 rounded-2xl p-4 shadow-3xs space-y-1">
                <span className="text-[9px] uppercase tracking-wider text-slate-455 font-bold block">{t('Current Month Due', 'इस महीने का बाकी')}</span>
                <span className="block mt-1"><span className="text-lg font-black text-slate-900">{formatCurrency(metrics.netPending)}</span></span>
                <span className="text-[8px] text-slate-400 font-bold block">{t('Refreshed in real-time', 'वास्तविक समय में अपडेट')}</span>
              </div>

              {/* Balance Due total */}
              <div className="bg-white border border-slate-150 rounded-2xl p-4 shadow-3xs space-y-1">
                <span className="text-[9px] uppercase tracking-wider text-slate-455 font-bold block">{t('Net Balance Due', 'कुल बकाया शेष')}</span>
                <span className="block mt-1"><span className="text-lg font-black text-blue-650">{formatCurrency(financials.totalDue)}</span></span>
                <span className="text-[8px] text-slate-400 font-bold block">{t('Incl. past dues', 'पिछले बकाये को जोड़कर')}</span>
              </div>

            </div>

            {/* Sub financial overview card details */}
            <div className="bg-white border border-slate-200/60 rounded-3xl p-5 shadow-2xs space-y-4">
              <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <Icon name="account_balance_wallet" size={16} className="text-blue-600" />
                <span>{t('Monthly Financial Statement', 'मासिक वित्तीय विवरण')}</span>
              </h3>

              <div className="space-y-3 pt-2 text-xs">
                <div className="flex items-center justify-between text-slate-500 font-medium">
                  <span>{t('Previous Balance Due', 'पिछले महीने का बकाया')}</span>
                  <span className="font-bold text-slate-800">{formatCurrency(financials.previousDue)}</span>
                </div>
                <div className="flex items-center justify-between text-slate-500 font-medium">
                  <span>{t('Basic Earned Salary', 'अर्जित मूल वेतन')}</span>
                  <span className="font-bold text-slate-800">{formatCurrency(metrics.earnedSalary)}</span>
                </div>
                {employee.type !== 'Hourly' && metrics.overtime > 0 && (
                  <div className="flex items-center justify-between text-slate-500 font-medium">
                    <span>{t('Overtime Pay', 'ओवरटाइम भुगतान')}</span>
                    <span className="font-bold text-slate-800">{formatCurrency(metrics.overtime)}</span>
                  </div>
                )}
                {metrics.extraEarnings > 0 && (
                  <div className="flex items-center justify-between text-slate-500 font-medium">
                    <span>{t('Bonuses & Allowances', 'बोनस और भत्ते')}</span>
                    <span className="font-bold text-slate-800">{formatCurrency(metrics.extraEarnings)}</span>
                  </div>
                )}
                {metrics.deductions > 0 && (
                  <div className="flex items-center justify-between text-slate-500 font-medium text-rose-650">
                    <span>{t('Fines & Deductions', 'जुर्माना और कटौती')}</span>
                    <span className="inline-flex items-center gap-1 font-mono font-bold text-rose-650">- <span className="text-rose-600 font-bold">{formatCurrency(metrics.deductions)}</span></span>
                  </div>
                )}
                <hr className="border-slate-100" />
                <div className="flex items-center justify-between text-slate-500 font-medium">
                  <span>{t('Total Payable', 'कुल देय वेतन')}</span>
                  <span className="font-extrabold text-slate-900">{formatCurrency(financials.totalPayable)}</span>
                </div>
                <div className="flex items-center justify-between text-slate-555 font-medium text-emerald-655">
                  <span>{t('Payments Received', 'कुल प्राप्त भुगतान')}</span>
                  <span className="inline-flex items-center gap-1 font-mono font-extrabold text-emerald-655">- <span className="text-emerald-600 font-extrabold">{formatCurrency(metrics.payments)}</span></span>
                </div>
                <hr className="border-slate-150 border-dashed" />
                <div className="flex items-center justify-between text-sm font-black">
                  <span>{t('Net Balance Pending', 'कुल शेष बकाया')}</span>
                  <span className="text-blue-600 font-black">{formatCurrency(financials.totalDue)}</span>
                </div>
              </div>
            </div>

            {/* Quick Actions Panel */}
            <div className="bg-white border border-slate-200/50 rounded-2xl p-4 shadow-3xs flex flex-wrap gap-3">
              <button
                onClick={() => {
                  setPdfRangeType('current');
                  setShowPdfView(true);
                }}
                className="flex-1 min-w-[140px] h-11 btn bbl text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                <Icon name="download" size={16} />
                <span>{t('Download A4 Salary Slip', 'सैलरी स्लिप डाउनलोड करें')}</span>
              </button>

              <button
                onClick={() => setActiveTab('requests')}
                className="flex-1 min-w-[140px] h-11 border border-blue-200 text-blue-600 rounded-xl font-bold text-xs bg-blue-50/30 hover:bg-blue-50 flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] transition-all"
              >
                <Icon name="add_task" size={16} />
                <span>{t('Request Punch Correction', 'उपस्थिति सुधार का अनुरोध')}</span>
              </button>
            </div>
          </div>
        )}

        {/* --- TAB CONTENT: 2. ATTENDANCE --- */}
        {activeTab === 'attendance' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            {(() => {
              const toMin = (t: string) => {
                const [h, m] = t.split(':').map(Number);
                return h * 60 + m;
              };
              const formatTime12h = (time24?: string) => {
                if (!time24) return '—';
                const parts = time24.split(':');
                if (parts.length < 2) return time24;
                const h = parseInt(parts[0], 10);
                const m = parseInt(parts[1], 10);
                if (isNaN(h) || isNaN(m)) return time24;
                const ampm = h >= 12 ? 'PM' : 'AM';
                const h12 = h % 12 === 0 ? 12 : h % 12;
                return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
              };
              const calculateBreakHours = (sessions: PunchSession[]): number => {
                if (sessions.length <= 1) return 0;
                const sorted = [...sessions]
                  .filter(s => s.in && s.out)
                  .sort((a, b) => toMin(a.in) - toMin(b.in));
                let breakMins = 0;
                for (let i = 0; i < sorted.length - 1; i++) {
                  const endCurrent = toMin(sorted[i].out);
                  const startNext = toMin(sorted[i + 1].in);
                  if (startNext > endCurrent) {
                    breakMins += (startNext - endCurrent);
                  }
                }
                return breakMins / 60;
              };

              return (
                <>
                  <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-2 mb-2">
                    <Icon name="calendar_month" size={16} className="text-blue-600" />
                    <span>{t('Daily Attendance Register', 'दैनिक उपस्थिति विवरण')}</span>
                  </h3>

                  {attendanceList.length === 0 ? (
                    <div className="text-center py-8 bg-white border border-slate-150 rounded-2xl text-xs text-slate-400 font-medium">
                      {t('No attendance records found for this period.', 'इस अवधि के लिए कोई हाजिरी रिकॉर्ड नहीं मिला।')}
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
                      {attendanceList.map(({ dateStr, day, record }) => {
                        let totalHrs = 0;
                        if (record?.sessions) {
                          record.sessions.forEach(s => {
                            if (s.in && s.out) totalHrs += timeToHrs(s.in, s.out);
                          });
                        }

                        return (
                          <div key={day} className="bg-white border border-slate-150 rounded-xl p-3.5 shadow-3xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all hover:border-slate-250">
                            <div className="space-y-1.5 flex-1">
                              <div className="flex items-center gap-2">
                                <div className="text-xs font-black text-slate-950">
                                  {day} {months[selMonth]} {selYear}
                                </div>
                                {(() => {
                                  const dateOT = db.overtimeEntries?.filter(o => o.employeeId === employee.id && o.date === dateStr) || [];
                                  const totalOT = dateOT.reduce((acc, o) => acc + o.hours, 0);
                                  return totalOT > 0 ? (
                                    <span className="text-[8px] font-black bg-amber-50 text-amber-700 border border-amber-100 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                                      OT: {totalOT.toFixed(1)}h
                                    </span>
                                  ) : null;
                                })()}
                              </div>

                              {record?.sessions && record.sessions.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                  {record.sessions.map((s, sidx) => (
                                    <span key={sidx} className="inline-flex items-center text-[9px] text-slate-500 font-bold bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-lg font-mono">
                                      🚪 {formatTime12h(s.in)} - {s.out ? formatTime12h(s.out) : '...'}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">
                                  {t('No punch sessions active', 'कोई पंच सत्र नहीं है')}
                                </div>
                              )}

                              {/* Fine & Hours Stats row */}
                              <div className="flex flex-wrap gap-1.5 mt-1 font-sans">
                                <span className="text-[9px] font-bold bg-slate-50 border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded">
                                  {t('Std:', 'मानक:')} {employee.fineSettings?.standardHours || 8}h
                                </span>
                                <span className="text-[9px] font-bold bg-blue-50 border border-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                                  {t('Worked:', 'कार्य:')} {totalHrs.toFixed(1)}h
                                </span>
                                {totalHrs > (employee.fineSettings?.standardHours || 8) && (
                                  <span className="text-[9px] font-bold bg-emerald-50 border border-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                                    {t('OT:', 'ओवरटाइम:')} {(totalHrs - (employee.fineSettings?.standardHours || 8)).toFixed(1)}h
                                  </span>
                                )}
                                {(() => {
                                  const dateReview = db.attendanceReviews?.find(r => r.employeeId === employee.id && r.date === dateStr);
                                  const dateDed = db.deductions?.find(d => d.employeeId === employee.id && d.date === dateStr && d.isAutoGenerated);
                                  
                                  if (dateReview) {
                                    return (
                                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                        dateReview.status === 'Deducted'
                                          ? 'bg-rose-50 border-rose-100 text-rose-700'
                                          : dateReview.status === 'Waived' || dateReview.status === 'Converted to Leave'
                                            ? 'bg-blue-50 border-blue-100 text-blue-700 line-through'
                                            : 'bg-amber-50 border-amber-100 text-amber-700'
                                      }`}>
                                        {dateReview.status === 'Pending Review' 
                                          ? `${t('Pending Review', 'समीक्षाधीन')} (${t('Grace:', 'अनुग्रह:')} ₹${dateReview.fineAmount})`
                                          : dateReview.status === 'Deducted'
                                            ? `${t('Deducted', 'कटौती')} (-₹${dateReview.fineAmount})`
                                            : `${translateStatus(dateReview.status)} (-₹0)`}
                                      </span>
                                    );
                                  }
                                  
                                  if (dateDed) {
                                    return (
                                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                        dateDed.status === 'Waived'
                                          ? 'bg-blue-50 border-blue-100 text-blue-700 line-through'
                                          : dateDed.status === 'Deleted'
                                            ? 'bg-slate-50 border-slate-100 text-slate-500 line-through'
                                            : 'bg-rose-50 border-rose-100 text-rose-700'
                                      }`}>
                                        {dateDed.status === 'Waived' 
                                          ? `${t('Waived Fine', 'माफ़')} (₹${dateDed.fineAmount || dateDed.originalAmount})`
                                          : dateDed.status === 'Deleted'
                                            ? `${t('Deleted Fine', 'सॉफ्ट डिलीट')}`
                                            : `${t('Auto Fine', 'स्वचालित जुर्माना')} (-₹${dateDed.amount})`}
                                      </span>
                                    );
                                  }
                                  
                                  return null;
                                })()}
                              </div>
                            </div>

                            <div className="flex items-center gap-3 sm:text-right flex-wrap sm:flex-nowrap">
                              <div className="flex items-center gap-2 flex-wrap sm:flex-col sm:items-end">
                                {totalHrs > 0 && (
                                  <span className="text-[9.5px] text-blue-600 font-black bg-blue-50 border border-blue-100/50 px-2 py-0.5 rounded-lg flex items-center gap-1">
                                    {(() => {
                                      const dateOT = db.overtimeEntries?.filter(o => o.employeeId === employee.id && o.date === dateStr) || [];
                                      const totalOT = dateOT.reduce((acc, o) => acc + o.hours, 0);
                                      
                                      const dateFine = db.lateFineEntries?.filter(f => f.employeeId === employee.id && f.date === dateStr) || [];
                                      const totalFine = dateFine.reduce((acc, f) => acc + f.hours, 0);

                                      const baseHrsStr = totalHrs.toFixed(1);
                                      const otStr = totalOT > 0 ? ` [+ ${totalOT.toFixed(1)}]` : '';
                                      const fineStr = totalFine > 0 ? ` [- ${totalFine.toFixed(1)}]` : '';
                                      
                                      return `⏱ ${baseHrsStr}${otStr}${fineStr} ${t('Hrs', 'घंटे')}`;
                                    })()}
                                  </span>
                                )}
                                {(() => {
                                  const breakHrs = record?.sessions ? calculateBreakHours(record.sessions) : 0;
                                  return breakHrs > 0 ? (
                                    <span className="text-[9px] text-slate-500 font-bold bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded-lg flex items-center gap-1 font-mono">
                                      ☕ Break: {breakHrs.toFixed(1)}h
                                    </span>
                                  ) : null;
                                })()}
                              </div>

                              <span className={`text-[10px] inline-block shrink-0 ${getStatusBadgeClass(record?.status)}`}>
                                {record?.status ? translateStatus(record.status) : (totalHrs > 0 ? t('Present', 'उपस्थित') : t('Not Marked', 'अचिह्नित'))}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* --- TAB CONTENT: 3. SALARY BREAKDOWN --- */}
        {activeTab === 'salary' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            {/* 1. Base Earnings Summary */}
            <div className="bg-white border border-slate-150 rounded-2xl shadow-3xs overflow-hidden">
              <div 
                onClick={() => setOpenFolders(prev => ({ ...prev, base: !prev.base }))}
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50/50 transition-colors select-none"
              >
                <div className="flex items-center gap-2.5">
                  <Icon name="folder" size={20} className="text-amber-500" />
                  <span className="text-xs font-black text-slate-800 uppercase tracking-wider">{t('Earnings Summary (Base)', 'मूल अर्जित वेतन विवरण')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-black text-emerald-600 bg-emerald-50 border border-emerald-100/50 px-2 py-0.5 rounded-lg">{formatCurrency(metrics.earnedSalary)}</span>
                  <Icon name="keyboard_arrow_down" size={18} className={`text-slate-400 transition-transform duration-200 ${openFolders.base ? 'rotate-180' : ''}`} />
                </div>
              </div>
              {openFolders.base && (
                <div className="px-4 pb-4 border-t border-slate-50 pt-3 space-y-2 text-xs animate-in slide-in-from-top-1">
                  {metrics.details.earningsRows.length === 0 ? (
                    <div className="text-center py-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                      {t('No base earnings recorded for this period', 'इस अवधि के लिए कोई मूल आय दर्ज नहीं है')}
                    </div>
                  ) : (
                    metrics.details.earningsRows.map((row, idx) => (
                      <div key={idx} className="flex justify-between font-medium text-slate-550 border-b border-slate-50 pb-1.5 last:border-0 last:pb-0">
                        <span>{row.label} ({row.date})</span>
                        <span className="font-bold text-slate-800">{formatCurrency(row.value)}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* 2. Overtime (OT) Details */}
            <div className="bg-white border border-slate-150 rounded-2xl shadow-3xs overflow-hidden">
              <div 
                onClick={() => setOpenFolders(prev => ({ ...prev, ot: !prev.ot }))}
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50/50 transition-colors select-none"
              >
                <div className="flex items-center gap-2.5">
                  <Icon name="folder" size={20} className="text-amber-500" />
                  <span className="text-xs font-black text-slate-800 uppercase tracking-wider">{t('Overtime (OT) Ledger', 'ओवरटाइम विवरण')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-black text-amber-700 bg-amber-50 border border-amber-100/50 px-2 py-0.5 rounded-lg">{formatCurrency(metrics.overtime)}</span>
                  <Icon name="keyboard_arrow_down" size={18} className={`text-slate-400 transition-transform duration-200 ${openFolders.ot ? 'rotate-180' : ''}`} />
                </div>
              </div>
              {openFolders.ot && (
                <div className="px-4 pb-4 border-t border-slate-50 pt-3 space-y-2.5 text-xs animate-in slide-in-from-top-1">
                  {metrics.details.overtimeRows.length === 0 ? (
                    <div className="text-center py-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                      {t('No overtime hours registered this month', 'इस महीने कोई ओवरटाइम दर्ज नहीं है')}
                    </div>
                  ) : (
                    metrics.details.overtimeRows.map((row, idx) => (
                      <div key={idx} className="flex justify-between font-medium text-slate-550 border-b border-slate-50 pb-2 last:border-0 last:pb-0">
                        <div>
                          <div className="font-bold text-slate-800">{row.desc}</div>
                          <div className="text-[9px] text-slate-400 font-mono mt-0.5">{row.date} · {row.hours.toFixed(1)} hrs</div>
                        </div>
                        <span className="font-black text-slate-800 self-center">{formatCurrency(row.amount)}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* 3. Extra Earnings (Bonus/Incentives) */}
            <div className="bg-white border border-slate-150 rounded-2xl shadow-3xs overflow-hidden">
              <div 
                onClick={() => setOpenFolders(prev => ({ ...prev, bonus: !prev.bonus }))}
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50/50 transition-colors select-none"
              >
                <div className="flex items-center gap-2.5">
                  <Icon name="folder" size={20} className="text-amber-500" />
                  <span className="text-xs font-black text-slate-800 uppercase tracking-wider">{t('Bonuses & Extra Earnings', 'बोनस एवं अन्य आय')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-black text-emerald-650 bg-emerald-50 border border-emerald-100/50 px-2 py-0.5 rounded-lg">{formatCurrency(metrics.extraEarnings)}</span>
                  <Icon name="keyboard_arrow_down" size={18} className={`text-slate-400 transition-transform duration-200 ${openFolders.bonus ? 'rotate-180' : ''}`} />
                </div>
              </div>
              {openFolders.bonus && (
                <div className="px-4 pb-4 border-t border-slate-50 pt-3 space-y-2.5 text-xs animate-in slide-in-from-top-1">
                  {metrics.details.extraEarningsRows.length === 0 ? (
                    <div className="text-center py-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                      {t('No bonuses registered this month', 'इस महीने कोई अतिरिक्त आय या बोनस नहीं है')}
                    </div>
                  ) : (
                    metrics.details.extraEarningsRows.map((row, idx) => (
                      <div key={idx} className="flex justify-between font-medium text-slate-550 border-b border-slate-50 pb-2 last:border-0 last:pb-0">
                        <div>
                          <div className="font-bold text-slate-800">{row.desc}</div>
                          <div className="text-[9px] text-slate-400 font-mono mt-0.5">{row.date}</div>
                        </div>
                        <span className="font-black text-emerald-600 self-center">+ {formatCurrency(row.amount)}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* 4. Late Fines (Fines separate) */}
            <div className="bg-white border border-slate-150 rounded-2xl shadow-3xs overflow-hidden">
              {(() => {
                const { activeFines } = getDeductionHistory();
                const totalLateFine = activeFines.reduce((sum, r) => sum + r.amount, 0);

                return (
                  <>
                    <div 
                      onClick={() => setOpenFolders(prev => ({ ...prev, fine: !prev.fine }))}
                      className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50/50 transition-colors select-none"
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon name="folder" size={20} className="text-rose-500" />
                        <span className="text-xs font-black text-slate-800 uppercase tracking-wider">{t('Late Fines Ledger', 'विलंब जुर्माना विवरण')}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-black text-rose-600 bg-rose-50 border border-rose-100/50 px-2 py-0.5 rounded-lg">{formatCurrency(totalLateFine)}</span>
                        <Icon name="keyboard_arrow_down" size={18} className={`text-slate-400 transition-transform duration-200 ${openFolders.fine ? 'rotate-180' : ''}`} />
                      </div>
                    </div>
                    {openFolders.fine && (
                      <div className="px-4 pb-4 border-t border-slate-50 pt-3 space-y-2.5 text-xs animate-in slide-in-from-top-1">
                        {activeFines.length === 0 ? (
                          <div className="text-center py-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                            {t('No late fines registered this month', 'इस महीने कोई लेट फाइन नहीं है')}
                          </div>
                        ) : (
                          activeFines.map((row, idx) => (
                            <div key={idx} className="flex justify-between font-medium text-slate-550 border-b border-slate-50 pb-2 last:border-0 last:pb-0">
                              <div>
                                <div className="font-bold text-slate-800">{row.description}</div>
                                <div className="text-[10px] text-slate-500 font-semibold mt-0.5">
                                  {row.workedHours} / {row.standardHours} hrs · {t('Missing:', 'कम घंटे:')} {row.missingHours} hrs
                                </div>
                                <div className="text-[9px] text-slate-400 font-mono mt-0.5">{row.date}</div>
                              </div>
                              <span className="font-black text-rose-600 self-center">- {formatCurrency(row.amount)}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* 4.1 Waived Fines History */}
            <div className="bg-white border border-slate-150 rounded-2xl shadow-3xs overflow-hidden">
              {(() => {
                const { waivedFines } = getDeductionHistory();

                return (
                  <>
                    <div 
                      onClick={() => setOpenFolders(prev => ({ ...prev, waivedFine: !prev.waivedFine }))}
                      className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50/50 transition-colors select-none"
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon name="folder" size={20} className="text-blue-550" />
                        <span className="text-xs font-black text-slate-800 uppercase tracking-wider">{t('Waived Fines History', 'माफ किए गए जुर्मानें')}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-black text-blue-600 bg-blue-50 border border-blue-100/50 px-2 py-0.5 rounded-lg">{waivedFines.length} {t('Items', 'आइटम')}</span>
                        <Icon name="keyboard_arrow_down" size={18} className={`text-slate-400 transition-transform duration-200 ${openFolders.waivedFine ? 'rotate-180' : ''}`} />
                      </div>
                    </div>
                    {openFolders.waivedFine && (
                      <div className="px-4 pb-4 border-t border-slate-50 pt-3 space-y-2.5 text-xs animate-in slide-in-from-top-1">
                        {waivedFines.length === 0 ? (
                          <div className="text-center py-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                            {t('No waived fines this month', 'इस महीने कोई माफ़ किया गया जुर्माना नहीं है')}
                          </div>
                        ) : (
                          waivedFines.map((row, idx) => (
                            <div key={idx} className="flex justify-between font-medium text-slate-550 border-b border-slate-50 pb-2 last:border-0 last:pb-0">
                              <div>
                                <div className="font-bold text-slate-800">{row.description}</div>
                                <div className="text-[10px] text-slate-555 mt-0.5">
                                  {t('Waived By:', 'द्वारा माफ़:')} {row.waivedBy || 'Admin'} · {t('Reason:', 'कारण:')} {row.waivedReason}
                                </div>
                                <div className="text-[9px] text-slate-450 font-mono mt-0.5">{row.date} (Waived: {row.waivedDate})</div>
                              </div>
                              <span className="font-black text-blue-600 self-center line-through">{formatCurrency(row.fineAmount || 0)}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* 4.2 Deleted Fines History */}
            <div className="bg-white border border-slate-150 rounded-2xl shadow-3xs overflow-hidden">
              {(() => {
                const { deletedFines } = getDeductionHistory();

                return (
                  <>
                    <div 
                      onClick={() => setOpenFolders(prev => ({ ...prev, deletedFine: !prev.deletedFine }))}
                      className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50/50 transition-colors select-none"
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon name="folder" size={20} className="text-slate-400" />
                        <span className="text-xs font-black text-slate-800 uppercase tracking-wider">{t('Deleted Fines History', 'हटाए गए जुर्मानें')}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-black text-slate-500 bg-slate-50 border border-slate-100/50 px-2 py-0.5 rounded-lg">{deletedFines.length} {t('Items', 'आइटम')}</span>
                        <Icon name="keyboard_arrow_down" size={18} className={`text-slate-400 transition-transform duration-200 ${openFolders.deletedFine ? 'rotate-180' : ''}`} />
                      </div>
                    </div>
                    {openFolders.deletedFine && (
                      <div className="px-4 pb-4 border-t border-slate-50 pt-3 space-y-2.5 text-xs animate-in slide-in-from-top-1">
                        {deletedFines.length === 0 ? (
                          <div className="text-center py-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                            {t('No deleted fines this month', 'इस महीने कोई हटाया गया जुर्माना नहीं है')}
                          </div>
                        ) : (
                          deletedFines.map((row, idx) => (
                            <div key={idx} className="flex justify-between font-medium text-slate-550 border-b border-slate-50 pb-2 last:border-0 last:pb-0">
                              <div>
                                <div className="font-bold text-slate-800">{row.description}</div>
                                <div className="text-[10px] text-slate-500 mt-0.5">
                                  {t('Deleted By:', 'द्वारा डिलीट:')} {row.deletedBy || 'Admin'} · {t('Reason:', 'कारण:')} {row.deleteReason}
                                </div>
                                <div className="text-[9px] text-slate-400 font-mono mt-0.5">{row.date} (Deleted: {row.deletedDate})</div>
                              </div>
                              <span className="font-black text-slate-400 self-center line-through">{formatCurrency(row.fineAmount || 0)}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* 5. Deductions (Damage, Recoveries, etc.) */}
            <div className="bg-white border border-slate-150 rounded-2xl shadow-3xs overflow-hidden">
              {(() => {
                const standardDeductions = metrics.details.deductionsRows.filter(r => !r.desc.startsWith('Late Fine:'));
                const totalDeductions = standardDeductions.reduce((sum, r) => sum + r.amount, 0);

                return (
                  <>
                    <div 
                      onClick={() => setOpenFolders(prev => ({ ...prev, ded: !prev.ded }))}
                      className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50/50 transition-colors select-none"
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon name="folder" size={20} className="text-amber-500" />
                        <span className="text-xs font-black text-slate-800 uppercase tracking-wider">{t('Standard Deductions', 'कटौती एवं अन्य वसूलियां')}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-black text-rose-600 bg-rose-50 border border-rose-100/50 px-2 py-0.5 rounded-lg">{formatCurrency(totalDeductions)}</span>
                        <Icon name="keyboard_arrow_down" size={18} className={`text-slate-400 transition-transform duration-200 ${openFolders.ded ? 'rotate-180' : ''}`} />
                      </div>
                    </div>
                    {openFolders.ded && (
                      <div className="px-4 pb-4 border-t border-slate-50 pt-3 space-y-2.5 text-xs animate-in slide-in-from-top-1">
                        {standardDeductions.length === 0 ? (
                          <div className="text-center py-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                            {t('No other deductions this month', 'इस महीने कोई अन्य कटौती नहीं है')}
                          </div>
                        ) : (
                          standardDeductions.map((row, idx) => (
                            <div key={idx} className="flex justify-between font-medium text-slate-550 border-b border-slate-50 pb-2 last:border-0 last:pb-0">
                              <div>
                                <div className="font-bold text-slate-800">{row.desc}</div>
                                <div className="text-[9px] text-slate-400 font-mono mt-0.5">{row.date}</div>
                              </div>
                              <span className="font-black text-rose-600 self-center">- {formatCurrency(row.amount)}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* 6. Payments Ledger */}
            <div className="bg-white border border-slate-150 rounded-2xl shadow-3xs overflow-hidden">
              <div 
                onClick={() => setOpenFolders(prev => ({ ...prev, pay: !prev.pay }))}
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50/50 transition-colors select-none"
              >
                <div className="flex items-center gap-2.5">
                  <Icon name="folder" size={20} className="text-amber-500" />
                  <span className="text-xs font-black text-slate-800 uppercase tracking-wider">{t('Received Payments Ledger', 'प्राप्त भुगतान बही (Ledger)')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-black text-blue-700 bg-blue-50 border border-blue-100/50 px-2 py-0.5 rounded-lg">{formatCurrency(metrics.payments)}</span>
                  <Icon name="keyboard_arrow_down" size={18} className={`text-slate-400 transition-transform duration-200 ${openFolders.pay ? 'rotate-180' : ''}`} />
                </div>
              </div>
              {openFolders.pay && (
                <div className="px-4 pb-4 border-t border-slate-50 pt-3 space-y-3.5 text-xs animate-in slide-in-from-top-1">
                  {metrics.details.paymentsRows.length === 0 ? (
                    <div className="text-center py-2 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                      {t('No payment transactions received this month', 'इस महीने कोई भुगतान प्राप्त नहीं हुआ')}
                    </div>
                  ) : (
                    metrics.details.paymentsRows.map((row, idx) => {
                      const origPay = db.payments.find(p => p.employeeId === employee?.id && p.date === row.date && p.amount === row.value);
                      return (
                        <div key={idx} className="flex justify-between items-start gap-4 border-b border-slate-50 pb-2.5 last:border-b-0 last:pb-0">
                          <div className="space-y-1">
                            <div className="font-bold text-slate-800">{row.desc || t('Salary Disbursed', 'वेतन भुगतान')}</div>
                            <div className="text-[10px] text-slate-450 font-semibold flex items-center gap-1.5 flex-wrap">
                              <span>{row.date}</span>
                              <span className="bg-slate-50 border border-slate-100 rounded px-1.5 py-0.5 font-mono text-[9px]">{row.mode}</span>
                              {origPay?.paidBy && (
                                <span className="bg-blue-50 text-blue-700 border border-blue-100/50 rounded px-1.5 py-0.5 font-bold text-[9px]">
                                  👤 {origPay.paidBy}
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="font-black text-slate-800">{formatCurrency(row.value)}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- TAB CONTENT: 4. APPROVAL REQUESTS --- */}
        {activeTab === 'requests' && (
          <div className="animate-in fade-in duration-200">
            <ApprovalPanel 
              employeeId={employee.id}
              employeeName={employee.name}
              employeePic={employee.pic}
              db={db}
              lang={lang}
              isAdmin={false}
              onUpdateDb={onUpdateDb}
            />
          </div>
        )}

        {/* --- TAB CONTENT: 5. ACCOUNT SETTINGS --- */}
        {activeTab === 'settings' && (
          <div className="bg-white border border-slate-200/60 rounded-3xl p-5 shadow-2xs space-y-4 animate-in fade-in duration-200">
            <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-2 border-b border-slate-50 pb-2">
              <Icon name="vpn_key" size={16} className="text-blue-605" />
              <span>{t('Change Account Password', 'लॉगिन पासवर्ड बदलें')}</span>
            </h3>

            {pwError && (
              <p className="text-xs text-rose-600 font-bold bg-rose-50 border border-rose-100 rounded-xl p-3">
                {pwError}
              </p>
            )}

            {pwSuccess && (
              <p className="text-xs text-emerald-700 font-bold bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                {pwSuccess}
              </p>
            )}

            <form 
              onSubmit={(e) => {
                e.preventDefault();
                setPwError('');
                setPwSuccess('');

                const correctCurrentPin = employee.loginPin || employee.mobile.slice(-4);
                if (currentPw !== correctCurrentPin) {
                  setPwError(t('Current password is incorrect.', 'वर्तमान पासवर्ड गलत है।'));
                  return;
                }
                if (newPw.length < 4) {
                  setPwError(t('New password must be at least 4 characters.', 'नया पासवर्ड कम से कम 4 अंकों का होना चाहिए।'));
                  return;
                }
                if (newPw !== confirmNewPw) {
                  setPwError(t('New password and confirmation do not match.', 'नया पासवर्ड और पुष्टि पासवर्ड मेल नहीं खाते।'));
                  return;
                }

                const updatedEmployees = db.employees.map(emp => {
                  if (emp.id === employee.id) {
                    return { ...emp, loginPin: newPw };
                  }
                  return emp;
                });

                const updatedDb = {
                  ...db,
                  employees: updatedEmployees
                };

                const newAudit: AuditLogEntry = {
                  id: `_AUD_${Date.now()}`,
                  adminName: employee.name,
                  action: 'Employee Changed Portal Password',
                  targetId: employee.id,
                  targetName: employee.name,
                  oldValue: employee.loginPin ? 'Custom PIN' : 'Default PIN',
                  newValue: 'Custom PIN (Updated)',
                  timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
                  device: navigator.userAgent.includes('Mobile') ? 'Mobile Device' : 'Desktop Panel'
                };
                updatedDb.auditLogs = [newAudit, ...(db.auditLogs || [])];

                if (onUpdateDb) {
                  onUpdateDb(updatedDb);
                  setPwSuccess(t('✓ Password changed successfully!', '✓ पासवर्ड सफलतापूर्वक बदल गया!'));
                  setCurrentPw('');
                  setNewPw('');
                  setConfirmNewPw('');
                }
              }} 
              className="space-y-4"
            >
              <div className="fld mb-0">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                  {t('Current Password', 'वर्तमान पासवर्ड')}
                </label>
                <input 
                  type="password" 
                  value={currentPw}
                  onChange={e => setCurrentPw(e.target.value)}
                  placeholder={t('Enter current password', 'अपना वर्तमान पासवर्ड दर्ज करें')}
                  className="fi"
                  required
                />
              </div>

              <div className="fld mb-0">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                  {t('New Password', 'नया पासवर्ड')}
                </label>
                <input 
                  type="password" 
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  placeholder={t('Enter new password (min. 4 digits)', 'नया पासवर्ड दर्ज करें (कम से कम 4 अंक)')}
                  className="fi"
                  required
                />
              </div>

              <div className="fld mb-0">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                  {t('Confirm New Password', 'नए पासवर्ड की पुष्टि करें')}
                </label>
                <input 
                  type="password" 
                  value={confirmNewPw}
                  onChange={e => setConfirmNewPw(e.target.value)}
                  placeholder={t('Confirm your new password', 'नए पासवर्ड को पुनः दर्ज करें')}
                  className="fi"
                  required
                />
              </div>

              <button 
                type="submit"
                className="w-full h-11 btn bbl text-white font-bold text-xs"
              >
                <Icon name="vpn_key" size={14} className="mr-1.5" />
                <span>{t('Change Password', 'पासवर्ड अपडेट करें')}</span>
              </button>
            </form>
          </div>
        )}

      </main>

      {/* --- SALARY SLIP PDF OVERLAY IFRAME PRINTER --- */}
      {showPdfView && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-3xl w-full max-w-3xl h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-250">
            
            {/* Modal Header */}
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon name="picture_as_pdf" className="text-red-500" size={20} />
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">{t('Print Salary Slip', 'सैलरी स्लिप प्रिंट करें')}</h3>
              </div>
              <button 
                onClick={() => setShowPdfView(false)}
                className="w-8 h-8 rounded-full bg-slate-200 hover:bg-slate-350 text-slate-600 flex items-center justify-center cursor-pointer transition-colors"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            {/* PDF Slip container for rendering and printing */}
            <div className="flex-1 overflow-y-auto p-6" id="salary-slip-print-box">
              <SalarySlipPDF 
                employee={employee}
                year={selYear}
                month={selMonth}
                db={db}
                lang={lang}
              />
            </div>

            {/* Print Trigger footer */}
            <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex gap-4">
              <button
                onClick={async () => {
                  const period = `${months[selMonth]}_${selYear}`;
                  await downloadSalarySlipPDF(employee.name, period);
                }}
                className="flex-1 h-12 btn bbl text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-blue-500/10"
              >
                <Icon name="download" size={18} />
                <span>{t('Download PDF', 'पीडीएफ डाउनलोड करें')}</span>
              </button>
              
              <button
                onClick={() => setShowPdfView(false)}
                className="w-32 h-12 border border-slate-250 text-slate-600 rounded-xl font-bold text-xs hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer bg-white"
              >
                {t('Close', 'बंद करें')}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
