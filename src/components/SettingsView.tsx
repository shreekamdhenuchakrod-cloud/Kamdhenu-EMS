import React, { useState } from 'react';
import Icon from './Icon';
import { AppDatabase, CompanySettings, PaymentMode } from '../types';
import { calcEmployeeFinancials } from '../db';
import { optimizeImage } from '../utils/imageOptimizer';

interface SettingsViewProps {
  db: AppDatabase;
  onUpdateDb: (updatedDb: AppDatabase) => void;
  lang: 'en' | 'hi';
  onToggleLang: () => void;
  onLogout: () => void;
  syncStatus?: 'connecting' | 'synced' | 'error';
  deferredPrompt?: any;
  onInstallApp?: () => void;
  onOpenRecycleBin?: () => void;
  onOpenAuditLogs?: () => void;
}

export default function SettingsView({
  db,
  onUpdateDb,
  lang,
  onToggleLang,
  onLogout,
  syncStatus = 'connecting',
  deferredPrompt,
  onInstallApp,
  onOpenRecycleBin,
  onOpenAuditLogs
}: SettingsViewProps) {
  const t = (en: string, hi: string) => (lang === 'en' ? en : hi);

  // Fallback company settings object
  const company: CompanySettings = db.company || {
    name: 'Shree Kamdhenu',
    logo: ''
  };

  const [compName, setCompName] = useState(company.name);
  const [saveStatus, setSaveStatus] = useState('');
  const [newPaidBy, setNewPaidBy] = useState('');

  // Attendance Fine settings local state
  const [fineEnabled, setFineEnabled] = useState(company.attendanceFineEnabled !== false);
  const [autoDeduct, setAutoDeduct] = useState(company.autoDeductionEnabled !== false);
  const [gracePeriod, setGracePeriod] = useState(company.gracePeriodDays ?? 3);
  const [maxFine, setMaxFine] = useState(company.maxFineAmount ?? 50);
  const [fiftyPercentRule, setFiftyPercentRule] = useState(company.fiftyPercentRuleEnabled !== false);
  const [fineTable, setFineTable] = useState<Record<number, number>>(
    company.companyFineTable || { 1: 5, 2: 10, 3: 15, 4: 20, 5: 25, 6: 30, 7: 35, 8: 40, 9: 45, 10: 50, 11: 50, 12: 50 }
  );

  const handleSaveFineSettings = () => {
    onUpdateDb({
      ...db,
      company: {
        ...company,
        attendanceFineEnabled: fineEnabled,
        autoDeductionEnabled: autoDeduct,
        gracePeriodDays: gracePeriod,
        maxFineAmount: maxFine,
        fiftyPercentRuleEnabled: fiftyPercentRule,
        companyFineTable: fineTable
      }
    });
    setSaveStatus(t('✓ Company attendance fine defaults saved!', '✓ गौशाला उपस्थिति जुर्माना नीतियां सहेजी गईं!'));
    setTimeout(() => setSaveStatus(''), 4000);
  };

  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // Change Password state
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmNewPw, setConfirmNewPw] = useState('');
  const [pwError, setPwError] = useState('');

  // PIN Protected Danger Zone state
  const [showPinModal, setShowPinModal] = useState(false);
  const [securityPin, setSecurityPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [isDangerZoneRevealed, setIsDangerZoneRevealed] = useState(false);

  // Change Password Handler
  const handleUpdatePassword = () => {
    const storedPw = localStorage.getItem('gaushala_admin_password') || '123456';
    if (!currentPw) {
      setPwError(t('Please enter current password.', 'कृपया वर्तमान पासवर्ड दर्ज करें।'));
      return;
    }
    if (currentPw !== storedPw) {
      setPwError(t('Current password is incorrect.', 'वर्तमान पासवर्ड गलत है।'));
      return;
    }
    if (!newPw) {
      setPwError(t('Please enter a new password.', 'कृपया नया पासवर्ड दर्ज करें।'));
      return;
    }
    if (newPw.length < 6) {
      setPwError(t('New password must be at least 6 characters.', 'नया पासवर्ड कम से कम 6 अक्षरों का होना चाहिए।'));
      return;
    }
    if (newPw !== confirmNewPw) {
      setPwError(t('New password and confirmation do not match.', 'नया पासवर्ड और पुष्टि पासवर्ड मेल नहीं खाते।'));
      return;
    }

    localStorage.setItem('gaushala_admin_password', newPw);
    setPwError('');
    setCurrentPw('');
    setNewPw('');
    setConfirmNewPw('');
    setSaveStatus(t('✓ Password updated successfully!', '✓ पासवर्ड सफलतापूर्वक अपडेट हो गया!'));
    setTimeout(() => setSaveStatus(''), 4000);
  };

  // PIN Verification Handler
  const handleVerifyPin = () => {
    const storedPin = db.company?.adminPin || '1234';
    if (securityPin === storedPin) {
      setIsDangerZoneRevealed(true);
      setShowPinModal(false);
      setSecurityPin('');
      setPinError('');
      setSaveStatus(t('✓ Danger Zone unlocked successfully!', '✓ सुरक्षा खतरा क्षेत्र अनलॉक हो गया!'));
      setTimeout(() => setSaveStatus(''), 4000);
    } else {
      setPinError(t('Incorrect security PIN.', 'गलत सुरक्षा पिन।'));
    }
  };

  // Save modified Company Name only
  const handleSaveCompanyName = () => {
    const updatedCompany: CompanySettings = {
      ...company,
      name: compName || 'Shree Kamdhenu'
    };

    onUpdateDb({
      ...db,
      company: updatedCompany
    });

    setSaveStatus(t('✓ Company Name Saved!', '✓ संस्था का नाम सहेजा गया!'));
    setTimeout(() => setSaveStatus(''), 4000);
  };

  // Upload/Remove logo
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const optimizedBase64 = await optimizeImage(file);
      const updatedCompany: CompanySettings = {
        ...company,
        logo: optimizedBase64
      };
      onUpdateDb({ ...db, company: updatedCompany });
      setSaveStatus(t('✓ Logo uploaded successfully!', '✓ लोगो अपलोड हो गया है!'));
      setTimeout(() => setSaveStatus(''), 4000);
    } catch (err: any) {
      alert("Image optimization failed: " + err.message);
    }
  };

  const handleRemoveLogo = () => {
    const updatedCompany: CompanySettings = {
      ...company,
      logo: ''
    };
    onUpdateDb({ ...db, company: updatedCompany });
    setSaveStatus(t('✓ Logo removed!', '✓ लोगो हटा दिया गया है!'));
    setTimeout(() => setSaveStatus(''), 4000);
  };

  // CSV Report Generator
  const [navYear, setNavYear] = useState(new Date().getFullYear());
  const [navMonth, setNavMonth] = useState(new Date().getMonth());
  const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const handleMonthShift = (dir: number) => {
    let newM = navMonth + dir;
    let newY = navYear;
    if (newM < 0) {
      newM = 11;
      newY--;
    } else if (newM > 11) {
      newM = 0;
      newY++;
    }
    setNavMonth(newM);
    setNavYear(newY);
  };

  const handleDownloadCsv = () => {
    const currentMonthLabel = `${MN[navMonth]}_${navYear}`;
    const headers = [
      'Employee ID',
      'Name',
      'Type',
      'Base Wage Rate',
      'Previous Month Pending Balance',
      'Current Month Wages Earned',
      'Overtime Earnings',
      'Incentives & Extra Earnings',
      'Deductions (Late Fees & Fines)',
      'Cumulative Payable amount',
      'Paid This Month',
      'Final Balance Due Now'
    ];

    const activeEmployees = db.employees.filter(e => e.status === 'Active');
    const rows = activeEmployees.map(emp => {
      const financials = calcEmployeeFinancials(emp, navYear, navMonth, db);
      return [
        emp.id,
        `"${emp.name.replace(/"/g, '""')}"`,
        emp.type,
        financials.metrics.rate,
        Math.round(financials.previousDue),
        Math.round(financials.currentEarnings),
        Math.round(financials.overtime),
        Math.round(financials.extraEarnings),
        Math.round(financials.deductions),
        Math.round(financials.currentEarnings + financials.overtime + financials.extraEarnings - financials.deductions + financials.previousDue),
        Math.round(financials.payments),
        Math.round(financials.totalDue)
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Payroll_Report_${currentMonthLabel}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // JSON database backups
  const handleDownloadBackupUrl = () => {
    try {
      const dataStr = JSON.stringify(db, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Master_Backup_${new Date().toISOString().split('T')[0]}.json`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setSaveStatus(t('✓ Backup file generated!', '✓ सुरक्षित बैकअप संचिका निर्मित!'));
      setTimeout(() => setSaveStatus(''), 4000);
    } catch {
      alert('Backup packaging failed.');
    }
  };

  const handleImportBackupPayload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const rdr = new FileReader();
    rdr.onload = () => {
      try {
        const rawJson = JSON.parse(rdr.result as string);
        if (!Array.isArray(rawJson.employees) || !rawJson.attendance || !Array.isArray(rawJson.payments)) {
          alert(t('Invalid backup file. Missing critical tables.', 'अमान्य बैकअप फाइल। सही डेटाबेस बैकअप चुनें।'));
          return;
        }
        onUpdateDb(rawJson);
        setSaveStatus(t('✓ Backup restored successfully!', '✓ बैकअप डेटा पुनर्स्थापित हो गया!'));
        setTimeout(() => setSaveStatus(''), 4000);
      } catch {
        alert('Failed parsing backup JSON.');
      }
    };
    rdr.readAsText(file);
  };

  // Resets & Destructive processes triggered by Confirmation Modal
  const executeResetAllData = () => {
    localStorage.removeItem('skbg_database_v3');
    window.location.reload();
  };

  const executeDeleteAllAttendance = () => {
    onUpdateDb({
      ...db,
      attendance: {}
    });
    setSaveStatus(t('✓ All attendance records purged!', '✓ समस्त हाजिरी रिकॉर्ड मिटा दिए गए!'));
    setTimeout(() => setSaveStatus(''), 4000);
  };

  const executeDeleteAllStaff = () => {
    onUpdateDb({
      ...db,
      employees: [],
      attendance: {},
      payments: [],
      earnings: [],
      deductions: [],
      overtimeEntries: [],
      lateFineEntries: []
    });
    setSaveStatus(t('✓ All staff records deleted!', '✓ समस्त स्टाफ रिकॉर्ड मिटा दिए गए!'));
    setTimeout(() => setSaveStatus(''), 4000);
  };

  const executeDeleteAllPayments = () => {
    onUpdateDb({
      ...db,
      payments: [],
      earnings: [],
      deductions: [],
      overtimeEntries: [],
      lateFineEntries: []
    });
    setSaveStatus(t('✓ All transaction logs purged!', '✓ वित्तीय संचिका प्रविष्टि साफ़!'));
    setTimeout(() => setSaveStatus(''), 4000);
  };

  return (
    <div className="space-y-6 pb-16 font-sans">
      
      {/* Toast Feedback Status Banner */}
      {saveStatus && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 bg-slate-900/95 text-white font-semibold text-xs px-4 py-3.5 rounded-2xl shadow-2xl z-[200] flex items-center gap-2.5 backdrop-blur-md border border-slate-800 animate-in fade-in slide-in-from-top-4 duration-250 max-w-sm">
          <Icon name="check_circle" size={16} className="text-emerald-400 shrink-0" />
          <span className="leading-tight">{saveStatus}</span>
        </div>
      )}

      {/* Hero Overview Header */}
      <div className="bg-white border border-slate-100 p-6 rounded-2xl shadow-xs relative overflow-hidden flex items-center justify-between">
        <div className="min-w-0">
          <span className="text-[10px] uppercase font-bold tracking-wider bg-slate-50 text-slate-500 px-2.5 py-1 rounded-md inline-block leading-none border border-slate-100 font-sans">
            {t('Administration Desk', 'प्रशासनिक नियंत्रक डेस्क')}
          </span>
          <h2 className="text-lg font-black text-slate-900 mt-3 tracking-tight leading-none">
            {company.name || 'Shree Kamdhenu'}
          </h2>
          <p className="text-[11px] text-slate-400 font-semibold mt-2 uppercase tracking-wider leading-none">
            {t('Shree Kamdhenu EMS · Settings', 'श्री कामधेनु ईएमएस · सेटिंग्स')}
          </p>
        </div>
        <div className="w-12 h-12 rounded-xl bg-blue-50/50 border border-blue-100/50 flex items-center justify-center text-blue-600 shrink-0 shadow-xs">
          <Icon name="settings" size={24} />
        </div>
      </div>

      {/* SECTION: SYSTEM PREFERENCES (Language Switch & Logout) */}
      <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-xs">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-4 flex items-center gap-2">
          <Icon name="desktop_windows" size={18} className="text-blue-600" />
          <span>{t('System Preferences', 'सिस्टम प्राथमिकताएँ')}</span>
        </h3>

        <div className="space-y-3">
          {/* Language selection Row */}
          <div className="flex items-center justify-between p-3.5 bg-slate-50/50 rounded-xl border border-slate-100">
            <div>
              <span className="text-xs font-bold text-slate-800 block">{t('App Language', 'ऐप की भाषा')}</span>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1 block leading-none">{lang === 'en' ? 'ENGLISH (ACTIVE)' : 'हिन्दी (सक्रिय)'}</span>
            </div>
            <button
              onClick={onToggleLang}
              className="h-9 px-4 rounded-xl btn bou font-bold text-xs"
            >
              {lang === 'en' ? 'हिन्दी में बदलें' : 'Switch to English'}
            </button>
          </div>

          {/* Secure Logout Row */}
          <div className="flex items-center justify-between p-3.5 bg-rose-50/10 rounded-xl border border-rose-100/40">
            <div>
              <span className="text-xs font-bold text-slate-800 block">{t('Admin Authentication', 'प्रशासन लॉक सुरक्षा')}</span>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-1 block leading-none">{t('Lock accessibility', 'प्रवेश सुरक्षा लागू करें')}</span>
            </div>
            <button
              onClick={onLogout}
              className="h-9 px-4 rounded-xl btn bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-100/50 font-bold text-xs"
            >
              {t('Logout EMS', 'सुरक्षित बाहर निकलें')}
            </button>
          </div>
        </div>
      </div>

      {/* PWA INSTALLATION PANEL */}
      {deferredPrompt && (
        <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-xs animate-in slide-in-from-top-2 duration-200">
          <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-4 flex items-center gap-2">
            <Icon name="download" size={18} className="text-blue-600" />
            <span>{t('Desktop/Mobile Application', 'डेस्कटॉप/मोबाइल एप्लीकेशन')}</span>
          </h3>
          <div className="bg-blue-50/50 rounded-xl p-4 border border-blue-100/50 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-center sm:text-left">
              <span className="text-xs font-bold text-slate-800 block">
                {t('Install Kamdhenu EMS', 'कामधेनु ईएमएस इनस्टॉल करें')}
              </span>
              <span className="text-[10px] text-slate-400 mt-1 block leading-normal font-medium">
                {t('Download the offline-first app onto your home screen for rapid access and native PWA window layout.', 'तेज़ पहुंच और स्थानीय विंडो लेआउट के लिए ऑफ़लाइन-फ़र्स्ट ऐप को अपनी होम स्क्रीन पर डाउनलोड करें।')}
              </span>
            </div>
            <button
              onClick={onInstallApp}
              className="h-10 btn bbl font-bold text-xs shrink-0 px-5 flex items-center gap-1.5"
            >
              <Icon name="download" size={14} />
              <span>{t('Install App', 'ऐप डाउनलोड करें')}</span>
            </button>
          </div>
        </div>
      )}

      {/* SECTION 2: COMPANY LOGO PANEL */}
      <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-xs">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-4 flex items-center gap-2">
          <Icon name="image" size={18} className="text-blue-600" />
          <span>{t('Company Logo', 'संस्था लोगो')}</span>
        </h3>

        <div className="flex items-center gap-4 py-1">
          <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden shrink-0 shadow-xs">
            {company.logo ? (
              <img 
                src={company.logo} 
                alt="Logo Preview" 
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="text-xl">🐄</span>
            )}
          </div>

          <div className="flex-1 space-y-2">
            <h4 className="text-[9px] font-bold uppercase text-slate-400 tracking-wider leading-none">{t('Launcher Icon Emblem', 'गौशाला पहचान चिन्ह')}</h4>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => document.getElementById('logo-file-picker')?.click()}
                className="h-8.5 px-3 rounded-xl btn bou font-bold text-[10px] flex items-center gap-1.5 cursor-pointer hover:bg-slate-50 transition-colors"
              >
                <Icon name="upload" size={12} />
                <span>{t('Upload Logo', 'अपलोड लोगो')}</span>
              </button>
              {company.logo && (
                <button 
                  onClick={handleRemoveLogo}
                  className="h-8.5 w-8.5 rounded-xl btn bg-rose-50 hover:bg-rose-100 text-rose-500 border border-rose-100/50 flex items-center justify-center cursor-pointer transition-colors"
                  title="Remove Logo"
                >
                  <Icon name="delete" size={13} />
                </button>
              )}
            </div>
            <input 
              type="file" 
              id="logo-file-picker" 
              accept="image/*" 
              className="hidden" 
              onChange={handleLogoUpload}
            />
          </div>
        </div>
      </div>

      {/* SECTION 1: COMPANY INFORMATION (Company Name only) */}
      <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-xs">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-4 flex items-center gap-2">
          <Icon name="corporate_fare" size={18} className="text-blue-600" />
          <span>{t('Company Profile', 'मुख्य संस्था विवरण')}</span>
        </h3>

        <div className="space-y-4">
          <div className="fld mb-0">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">{t('Company Name', 'संस्था / गौशाला का नाम')}</label>
            <input 
              type="text" 
              className="fi font-sans font-semibold text-slate-800" 
              value={compName} 
              onChange={(e) => setCompName(e.target.value)} 
              placeholder={t('Enter Business Name', 'व्यवसाय का नाम डालें')}
            />
          </div>

          <button 
            onClick={handleSaveCompanyName}
            className="w-full btn bbl font-bold text-xs"
          >
            <Icon name="save" size={14} className="mr-1.5" />
            <span>{t('Save Corporate Name', 'संस्था का नाम सहेजें')}</span>
          </button>
        </div>
      </div>

      {/* SECTION: FIREBASE CLOUD SYNC */}
      <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-xs">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-4 flex items-center gap-2">
          <Icon name="cloud" size={18} className="text-blue-600" />
          <span>{t('Firebase Cloud Sync', 'फायरबेस क्लाउड सिंक')}</span>
        </h3>

        <div className="bg-slate-50/50 rounded-xl p-4 border border-slate-100 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-500 uppercase text-[9px] tracking-wide">
              {t('Sync Status', 'सिंक स्थिति')}:
            </span>
            <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider flex items-center gap-1.5 border ${
              syncStatus === 'synced' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
              syncStatus === 'connecting' ? 'bg-amber-50 text-amber-700 border-amber-100' :
              'bg-rose-50 text-rose-700 border-rose-100'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                syncStatus === 'synced' ? 'bg-emerald-500' :
                syncStatus === 'connecting' ? 'bg-amber-500 animate-pulse' :
                'bg-rose-500'
              }`} />
              {syncStatus === 'synced' ? t('Synced', 'सक्रिय') :
               syncStatus === 'connecting' ? t('Connecting', 'जुड़ रहा है') :
               t('Offline / Error', 'ऑफ़लाइन / त्रुटि')}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px] pt-2 border-t border-slate-100 font-semibold text-slate-500 leading-relaxed">
            <div>
              <span className="block text-[8px] font-black text-slate-400 uppercase tracking-wider">{t('Project ID', 'प्रोजेक्ट आईडी')}</span>
              <span className="font-mono text-slate-800">shree-kamdhenu-ems</span>
            </div>
            <div>
              <span className="block text-[8px] font-black text-slate-400 uppercase tracking-wider">{t('Firestore Path', 'फायरस्टोर पाथ')}</span>
              <span className="font-mono text-slate-800">gaushala_configs/main</span>
            </div>
          </div>

          <p className="text-[10px] text-slate-400 leading-normal pt-2.5 border-t border-slate-100">
            {t('All employee lists, punch sessions, and ledger changes are securely synced and persistent in real-time across your staff members\' devices.', 'सभी कर्मचारी सूची, दैनिक उपस्थिति और बहीखाता विवरण वास्तविक समय में सुरक्षित रूप से सिंक और बैकअप किए जाते हैं।')}
          </p>
        </div>
      </div>

      {/* SECTION: CHANGE PASSWORD */}
      <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-xs">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-4 flex items-center gap-2">
          <Icon name="vpn_key" size={18} className="text-blue-600" />
          <span>{t('Change Password', 'पासवर्ड बदलें')}</span>
        </h3>

        <div className="space-y-4">
          {pwError && (
            <p className="text-xs text-red-600 font-semibold bg-rose-50 p-3 rounded-xl border border-rose-100">
              {pwError}
            </p>
          )}

          <div className="space-y-3">
            <div className="fld mb-0">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">{t('Current Password', 'वर्तमान पासवर्ड')}</label>
              <input 
                type="password" 
                className="fi" 
                value={currentPw} 
                onChange={(e) => setCurrentPw(e.target.value)} 
                placeholder={t('Enter current password', 'वर्तमान पासवर्ड दर्ज करें')}
              />
            </div>

            <div className="fld mb-0">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">{t('New Password', 'नया पासवर्ड')}</label>
              <input 
                type="password" 
                className="fi" 
                value={newPw} 
                onChange={(e) => setNewPw(e.target.value)} 
                placeholder={t('Enter new password (min. 6 chars)', 'नया पासवर्ड दर्ज करें (न्यूनतम 6 अक्षर)')}
              />
            </div>

            <div className="fld mb-0">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">{t('Confirm New Password', 'नए पासवर्ड की पुष्टि करें')}</label>
              <input 
                type="password" 
                className="fi" 
                value={confirmNewPw} 
                onChange={(e) => setConfirmNewPw(e.target.value)} 
                placeholder={t('Re-enter new password', 'नया पासवर्ड पुनः दर्ज करें')}
              />
            </div>
          </div>

          <button 
            onClick={handleUpdatePassword}
            className="w-full btn bbl font-bold text-xs"
          >
            <Icon name="vpn_key" size={14} className="mr-1.5" />
            <span>{t('Update Password', 'पासवर्ड अपडेट करें')}</span>
          </button>
        </div>
      </div>
      
      {/* SECTION: PAID BY MANAGEMENT */}
      <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-xs">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-4 flex items-center gap-2">
          <Icon name="account_balance_wallet" size={18} className="text-blue-600" />
          <span>{t('Manage Paid By Options', 'भुगतानकर्ता (Paid By) सूची')}</span>
        </h3>

        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              className="fi flex-1"
              value={newPaidBy}
              onChange={(e) => setNewPaidBy(e.target.value)}
              placeholder={t('Add new Paid By option (e.g. by Pankaj)', 'नया नाम जोड़ें (उदा. by Pankaj)')}
            />
            <button
              onClick={() => {
                if (!newPaidBy.trim()) return;
                const paidByList = company.paidByNames || ['by Pankaj', 'by Vinod', 'by Babuji', 'by ghar vale'];
                const updatedNames = [...paidByList, newPaidBy.trim()];
                onUpdateDb({
                  ...db,
                  company: {
                    ...company,
                    paidByNames: updatedNames
                  }
                });
                setNewPaidBy('');
                setSaveStatus(t('✓ Paid By option added!', '✓ नया भुगतानकर्ता जोड़ा गया!'));
                setTimeout(() => setSaveStatus(''), 4000);
              }}
              className="btn bbl px-4 font-bold text-xs shrink-0 flex items-center justify-center cursor-pointer"
            >
              <Icon name="add" size={16} />
            </button>
          </div>

          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {(company.paidByNames || ['by Pankaj', 'by Vinod', 'by Babuji', 'by ghar vale']).map((name, idx) => (
              <div key={idx} className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-xl p-3">
                <span className="text-xs font-bold text-slate-800">{name}</span>
                <button
                  onClick={() => {
                    const paidByList = company.paidByNames || ['by Pankaj', 'by Vinod', 'by Babuji', 'by ghar vale'];
                    const updatedNames = paidByList.filter((_, i) => i !== idx);
                    onUpdateDb({
                      ...db,
                      company: {
                        ...company,
                        paidByNames: updatedNames
                      }
                    });
                    setSaveStatus(t('✓ Paid By option removed!', '✓ भुगतानकर्ता हटा दिया गया!'));
                    setTimeout(() => setSaveStatus(''), 4000);
                  }}
                  className="w-6 h-6 rounded-full hover:bg-rose-50 text-rose-500 flex items-center justify-center cursor-pointer transition-colors"
                >
                  <Icon name="delete" size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SECTION: COMPANY DEFAULT ATTENDANCE FINES */}
      <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-xs space-y-4">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider flex items-center gap-2">
          <Icon name="gavel" size={18} className="text-blue-600" />
          <span>{t('Company Fine Defaults', 'कंपनी जुर्माना नीति डिफ़ॉल्ट')}</span>
        </h3>

        <div className="space-y-4">
          {/* Toggles */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl">
              <div>
                <span className="text-[10px] font-bold text-slate-800 block leading-tight">{t('Attendance Fine', 'उपस्थिति जुर्माना')}</span>
                <span className="text-[8px] text-slate-400 uppercase tracking-wider">{t('Global Active', 'वैश्विक स्तर पर सक्रिय')}</span>
              </div>
              <input
                type="checkbox"
                checked={fineEnabled}
                onChange={(e) => setFineEnabled(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl">
              <div>
                <span className="text-[10px] font-bold text-slate-800 block leading-tight">{t('Auto Deduction', 'स्वचालित कटौती')}</span>
                <span className="text-[8px] text-slate-400 uppercase tracking-wider">{t('Automatic run', 'स्वतः जुर्माना प्रविष्टि')}</span>
              </div>
              <input
                type="checkbox"
                checked={autoDeduct}
                onChange={(e) => setAutoDeduct(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl">
              <div>
                <span className="text-[10px] font-bold text-slate-800 block leading-tight">{t('50% Safe Rule', '50% सुरक्षित नियम')}</span>
                <span className="text-[8px] text-slate-400 uppercase tracking-wider">{t('No fine if >=50% work', '>=50% कार्य पर जुर्माना नहीं')}</span>
              </div>
              <input
                type="checkbox"
                checked={fiftyPercentRule}
                onChange={(e) => setFiftyPercentRule(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer"
              />
            </div>

            <div className="fld mb-0">
              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block mb-1">{t('Grace Period (Days)', 'अनुग्रह अवधि (दिन)')}</label>
              <select
                value={gracePeriod}
                onChange={(e) => setGracePeriod(parseInt(e.target.value, 10))}
                className="fi bg-white font-sans text-xs"
              >
                {[0, 1, 2, 3, 5, 7, 15, 30].map(d => (
                  <option key={d} value={d}>{d} {t('Days', 'दिन')}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="fld mb-0">
              <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block mb-1">{t('Max Fine Amount (₹)', 'अधिकतम जुर्माना राशि (₹)')}</label>
              <input
                type="number"
                className="fi font-sans font-semibold text-slate-800"
                value={maxFine}
                onChange={(e) => setMaxFine(parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>

          {/* Default Fine Table mapping */}
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3.5 space-y-2.5">
            <span className="text-[9px] font-black uppercase text-slate-500 tracking-wider block">{t('Default Fine Table (Missing Hours → ₹)', 'डिफ़ॉल्ट जुर्माना तालिका (कम घंटे → ₹)')}</span>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(hrs => (
                <div key={hrs} className="bg-white border border-slate-100 rounded-lg p-2 flex items-center justify-between gap-1.5 shadow-3xs">
                  <span className="text-[10px] font-extrabold text-slate-600 shrink-0">{hrs} {t('hrs', 'घंटे')}</span>
                  <input
                    type="number"
                    className="w-12 h-6 border-b border-slate-200 text-right font-sans font-bold text-[10px] text-blue-600 focus:outline-none focus:border-blue-500"
                    value={fineTable[hrs] ?? ''}
                    placeholder={`${hrs * 5}`}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setFineTable({ ...fineTable, [hrs]: val });
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={handleSaveFineSettings}
            className="w-full btn bbl font-bold text-xs"
          >
            <Icon name="save" size={14} className="mr-1.5" />
            <span>{t('Save Corporate Fine Policies', 'जुर्माना नीतियां सहेजें')}</span>
          </button>
        </div>
      </div>

      {/* SECTION 8: REPORTS & REPORTING (CSV & Data backups) */}
      <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-xs space-y-4">
        <h3 className="text-xs font-bold uppercase text-slate-400 tracking-wider flex items-center gap-2">
          <Icon name="database" size={18} className="text-blue-600" />
          <span>{t('Reports & Data backups', 'रिपोर्ट एवं बैकअप बंडल')}</span>
        </h3>

        {/* Generate CSV */}
        <div className="bg-slate-50/50 rounded-xl p-4 border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">{t('Download CSV Ledger', 'मासिक बहीखाता (CSV)')}</span>
            <div className="flex items-center gap-2 text-xs">
              <button 
                onClick={() => handleMonthShift(-1)}
                className="w-7 h-7 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center font-bold cursor-pointer active:scale-90 transition shadow-3xs"
              >
                <Icon name="chevron_left" size={14} />
              </button>
              <span className="font-bold text-slate-800 px-1 uppercase shrink-0 font-sans">
                {MN[navMonth]} {navYear}
              </span>
              <button 
                onClick={() => handleMonthShift(1)}
                className="w-7 h-7 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center font-bold cursor-pointer active:scale-90 transition shadow-3xs"
              >
                <Icon name="chevron_right" size={14} />
              </button>
            </div>
          </div>
          <button
            onClick={handleDownloadCsv}
            className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-3xs transition"
          >
            <Icon name="download_for_offline" size={16} />
            <span>{t('Download Spreadsheet Ledger', 'एक्सेल शीट डाउनलोड करें')}</span>
          </button>
        </div>

        {/* JSON Import & Export Backup files */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={handleDownloadBackupUrl}
            className="h-10 btn bou font-bold text-xs"
          >
            <Icon name="download" size={14} className="text-blue-600 mr-1.5" />
            <span>{t('Export JSON Backup', 'डेटा का बैकअप सहेजें')}</span>
          </button>

          <button
            onClick={() => document.getElementById('settings-uploader-json')?.click()}
            className="h-10 btn bbl font-bold text-xs"
          >
            <Icon name="upload" size={14} className="mr-1.5" />
            <span>{t('Restore Backup', 'डेटा लोड करें')}</span>
          </button>
        </div>

        {/* Audit & Recycle Bin Gated Operations */}
        <div className="grid grid-cols-2 gap-2.5 pt-1.5">
          <button
            onClick={() => onOpenAuditLogs && onOpenAuditLogs()}
            className="h-10 border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98] transition-all"
          >
            <Icon name="history" size={14} className="text-blue-600" />
            <span>{t('View Audit Logs', 'ऑडिट लॉग्स देखें')}</span>
          </button>

          <button
            onClick={() => onOpenRecycleBin && onOpenRecycleBin()}
            className="h-10 border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98] transition-all"
          >
            <Icon name="delete_sweep" size={14} className="text-rose-500" />
            <span>{t('Recycle Bin', 'रीसायकल बिन')}</span>
          </button>
        </div>
        <input 
          type="file" 
          id="settings-uploader-json" 
          accept=".json" 
          className="hidden" 
          onChange={handleImportBackupPayload} 
        />
      </div>

      {/* SECURITY GATED AREA FOR DANGER ZONE */}
      {!isDangerZoneRevealed ? (
        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6 shadow-3xs text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-slate-100/50 flex items-center justify-center mx-auto border border-slate-100">
            <Icon name="lock" className="w-5 h-5 text-slate-400" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              {t('Administrative Security Lock', 'प्रशासनिक सुरक्षा लॉक')}
            </h3>
            <p className="text-[10px] text-slate-400 leading-relaxed mt-1.5 max-w-xs mx-auto font-medium">
              {t('To protect corporate payroll, attendance and configurations, enter your Security PIN.', 'वेतन, उपस्थिति और मुख्य डेटाबेस को मिटाने हेतु सुरक्षा पिन दर्ज करें।')}
            </p>
          </div>
          <button 
            type="button"
            onClick={() => {
              setPinError('');
              setSecurityPin('');
              setShowPinModal(true);
            }}
            className="px-5 py-3 bg-blue-50 border border-blue-105 hover:bg-blue-100 text-blue-700 font-bold rounded-xl text-xs inline-flex items-center gap-2 transition active:scale-[0.97] cursor-pointer"
          >
            <Icon name="lock" size={14} />
            <span>{t('Unlock Danger Zone', 'खतरनाक क्षेत्र अनलॉक करें')}</span>
          </button>
        </div>
      ) : (
        /* SECTION 9: DANGER ZONE */
        <div className="bg-rose-50/10 border border-rose-100 rounded-2xl p-6 shadow-xs space-y-4">
          <h3 className="text-xs font-bold uppercase text-red-700 tracking-wider flex items-center gap-2">
            <Icon name="security" size={18} className="text-red-500" />
            <span>{t('Danger Zone Reset', 'सुरक्षा खतरा क्षेत्र')}</span>
          </h3>
          <p className="text-[10px] text-red-800/80 leading-normal font-semibold">
            {t('Actions below are permanent. Proceed ONLY if you are absolutely sure of database deletion.', 'नीचे दिए गए बटन समस्त डेटा को नष्ट कर देंगे। सचेत रहें।')}
          </p>

          <div className="space-y-3 pt-1">
            <button
              type="button"
              onClick={() => setConfirmModal({
                title: t('Delete All Attendance History', 'सभी हाजिरी इतिहास हटाएँ'),
                message: t('This will permanently delete every calendar entry and working session for all employees. This action is IRREVERSIBLE. Confirm?', 'यह सभी कर्मचारियों के ऐतिहासिक कैलेंडर और दैनिक सत्र प्रविष्टियों को हमेशा के लिए मिटा देगा। क्या आप पुष्टि करते हैं?'),
                onConfirm: executeDeleteAllAttendance
              })}
              className="w-full h-11 bg-white border border-rose-200 text-red-650 hover:bg-rose-50/50 font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition active:scale-[0.98]"
            >
              <Icon name="delete" size={14} />
              <span>{t('Flush All Attendance Logs', 'हाजिरी का संपूर्ण इतिहास मिटाएं')}</span>
            </button>

            <button
              type="button"
              onClick={() => setConfirmModal({
                title: t('Delete All Staff Profiles', 'सभी कर्मचारियों का रिकॉर्ड हटाएँ'),
                message: t('This will permanently delete all registered staff members and their metadata. Confirm?', 'क्या आप सिस्टम से सभी पंजीकृत कर्मचारियों को स्थायी रूप से हटाने की पुष्टि करते हैं?'),
                onConfirm: executeDeleteAllStaff
              })}
              className="w-full h-11 bg-white border border-rose-200 text-red-655 hover:bg-rose-50/50 font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer hover:bg-rose-50 transition active:scale-[0.98]"
            >
              <Icon name="delete" size={14} />
              <span>{t('Delete All Staff Profiles', 'सभी कर्मचारियों का रिकॉर्ड हटाएँ')}</span>
            </button>

            <button
              type="button"
              onClick={() => setConfirmModal({
                title: t('Delete Financial Transaction Histories', 'सभी भुगतान रिकॉर्ड हटाएँ'),
                message: t('This will permanently clear every payment made, salary bonus earning, late fine, and overtime entry across the system. Confirm?', 'यह बहीखाते से समस्त भुगतान इतिहास, ओवर-टाइम एवं जुर्माना रिकॉर्ड को स्थायी रूप से हटा देगा। क्या आप आगे बढ़ना चाहते हैं?'),
                onConfirm: executeDeleteAllPayments
              })}
              className="w-full h-11 bg-white border border-rose-200 text-red-655 hover:bg-rose-50/50 font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer hover:bg-rose-50 transition active:scale-[0.98]"
            >
              <Icon name="delete" size={14} />
              <span>{t('Flush All Transaction Logs', 'वित्तीय प्रविष्टियां मिटाएं')}</span>
            </button>

            <button
              type="button"
              onClick={() => setConfirmModal({
                title: t('FULL APP PURGE / HARD RESET', 'पूर्ण ऐप रीसेट (डेटा विलोपन)'),
                message: t('WARNING: This will purge every active worker, profile photo, and attendance spreadsheet. Code will fresh reinitialize. Proceed?', 'चेतावनी: यह सभी कर्मचारियों की सूची, फोटो, और बहीखाता विवरण साफ़ कर देगा। क्या आप इस कठोर कार्रवाई को आगे बढ़ाना चाहते हैं?'),
                onConfirm: executeResetAllData
              })}
              className="w-full h-12 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-red-500/10 transition active:scale-[0.98]"
            >
              <Icon name="warning" size={16} />
              <span>{t('RESET ENTIRE EMS SYSTEM', 'ऐप रीसेट करें (डेटा नष्ट)')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Security PIN verification modal */}
      {showPinModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center z-[250] p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-t-2xl sm:rounded-2xl pb-6 shadow-2xl animate-in slide-in-from-bottom duration-300 text-center space-y-4">
            <div className="m-hnd mt-3 mb-1 sm:hidden" />
            <div className="px-6 pt-4 space-y-4">
              <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto border border-blue-100 shadow-3xs">
                <Icon name="lock" size={20} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                  {t('Enter Security PIN', 'सुरक्षा पिन दर्ज करें')}
                </h4>
                <p className="text-[10px] text-slate-400 leading-relaxed mt-1.5 font-semibold">
                  {t('Enter your 4-digit administrator security PIN to confirm access.', 'जारी रखने के लिए अपना 4-अंकीय एडमिन सुरक्षा पिन दर्ज करें।')}
                </p>
              </div>

              <div className="space-y-3">
                <input
                  type="password"
                  maxLength={4}
                  value={securityPin}
                  onChange={(e) => setSecurityPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="• • • •"
                  className="w-32 h-12 text-center text-xl font-extrabold tracking-widest border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-blue-500 outline-none focus:ring-4 focus:ring-blue-500/8 transition"
                />
                {pinError && (
                  <p className="text-[10px] text-red-600 font-bold leading-none">{pinError}</p>
                )}
              </div>

              <div className="flex gap-3 text-xs pt-2">
                <button
                  type="button"
                  onClick={() => setShowPinModal(false)}
                  className="flex-1 btn bou font-bold"
                >
                  {t('Cancel', 'रद्द करें')}
                </button>
                <button
                  type="button"
                  onClick={handleVerifyPin}
                  className="flex-1 btn bbl font-bold text-white shadow-xs"
                >
                  {t('Verify PIN', 'पिन सत्यापित करें')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Elegant Design Confirmation Modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center z-[250] p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-t-2xl sm:rounded-2xl pb-6 shadow-2xl animate-in slide-in-from-bottom duration-300">
            <div className="m-hnd mt-3 mb-1 sm:hidden" />
            <div className="px-6 pt-4 space-y-4">
              <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto border border-rose-100">
                <Icon name="warning" size={24} />
              </div>
              <h4 className="text-sm font-black text-slate-900 text-center uppercase tracking-wide">
                {confirmModal.title}
              </h4>
              <p className="text-xs text-slate-500 text-center leading-relaxed font-semibold">
                {confirmModal.message}
              </p>
              <div className="flex gap-3 text-xs pt-2">
                <button
                  onClick={() => setConfirmModal(null)}
                  className="flex-1 btn bou font-bold"
                >
                  {t('Cancel', 'रद्द करें')}
                </button>
                <button
                  onClick={() => {
                    confirmModal.onConfirm();
                    setConfirmModal(null);
                  }}
                  className="flex-1 btn bg-red-600 hover:bg-red-750 text-white font-black shadow-xs"
                >
                  {t('Confirm Delete', 'पुष्टि करें')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
