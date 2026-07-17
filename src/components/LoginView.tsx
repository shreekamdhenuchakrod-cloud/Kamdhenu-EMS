import React, { useState, useEffect } from 'react';
import Icon from './Icon';
import { signInWithGoogle, loginWithEmail, signUpWithEmail } from '../firebase';
import { Employee } from '../types';

interface LoginViewProps {
  lang: 'en' | 'hi';
  onToggleLang: (l: 'en' | 'hi') => void;
  companyName?: string;
  logo?: string;
  
  firebaseUser: any; // Authenticated firebase user or null
  adminPin?: string; // The PIN loaded from Firestore database
  employees: Employee[]; // Full employee roster to verify login
  
  onVerifyPinSuccess: () => void;
  onSetPinSuccess: (newPin: string) => void;
  onLogoutGmail: () => void;
  onVerifyEmployeeSuccess: (employeeId: string) => void;
}

export default function LoginView({
  lang,
  onToggleLang,
  companyName,
  logo,
  firebaseUser,
  adminPin,
  employees,
  onVerifyPinSuccess,
  onSetPinSuccess,
  onLogoutGmail,
  onVerifyEmployeeSuccess
}: LoginViewProps) {
  const t = (en: string, hi: string) => (lang === 'en' ? en : hi);

  // Portal Mode: 'admin' | 'employee'
  const [portalMode, setPortalMode] = useState<'admin' | 'employee'>(() => {
    return (localStorage.getItem('gaushala_login_mode') as 'admin' | 'employee') || 'admin';
  });

  // Admin login states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Admin PIN states
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState('');

  // Employee login states
  const [empMobile, setEmpMobile] = useState('');
  const [empPin, setEmpPin] = useState('');
  const [empError, setEmpError] = useState('');

  // Clear errors when toggling modes
  useEffect(() => {
    setAuthError('');
    setPinError('');
    setEmpError('');
    setPin('');
    setConfirmPin('');
    setEmpPin('');
    localStorage.setItem('gaushala_login_mode', portalMode);
  }, [firebaseUser, isSignUp, portalMode]);

  // Gmail Google Sign-In
  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setAuthError('');
    try {
      await signInWithGoogle();
    } catch (err: any) {
      console.error(err);
      setAuthError(t('Google Sign-In failed. Please try again.', 'गूगल लॉगिन विफल रहा। कृपया पुनः प्रयास करें।'));
    } finally {
      setIsLoading(false);
    }
  };

  // Gmail Email/Password Sign-In & Sign-Up
  const handleEmailAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setAuthError(t('Please fill all fields', 'कृपया सभी फ़ील्ड भरें'));
      return;
    }
    if (password.length < 6) {
      setAuthError(t('Password must be at least 6 characters', 'पासवर्ड कम से कम 6 अक्षरों का होना चाहिए'));
      return;
    }

    setIsLoading(true);
    setAuthError('');
    try {
      if (isSignUp) {
        await signUpWithEmail(email, password);
      } else {
        await loginWithEmail(email, password);
      }
    } catch (err: any) {
      console.error(err);
      let msg = err.message || '';
      if (msg.includes('user-not-found') || msg.includes('invalid-credential')) {
        setAuthError(t('Incorrect email or password.', 'गलत ईमेल या पासवर्ड।'));
      } else if (msg.includes('email-already-in-use')) {
        setAuthError(t('This email is already registered.', 'यह ईमेल पहले से पंजीकृत है।'));
      } else {
        setAuthError(msg || t('Authentication failed.', 'प्रमाणीकरण विफल रहा।'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  // PIN Setup Handler
  const handlePinSetupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 4 || isNaN(Number(pin))) {
      setPinError(t('PIN must be 4 digits', 'पिन 4 अंकों का होना चाहिए'));
      return;
    }
    if (pin !== confirmPin) {
      setPinError(t('PIN and confirmation do not match', 'पिन और पुष्टि पिन मेल नहीं खाते'));
      return;
    }

    onSetPinSuccess(pin);
  };

  // PIN Login Verification Handler
  const handlePinLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 4) {
      setPinError(t('PIN must be 4 digits', 'पिन 4 अंकों का होना चाहिए'));
      return;
    }
    
    if (pin === adminPin) {
      onVerifyPinSuccess();
    } else {
      setPinError(t('Incorrect PIN. Please try again.', 'गलत पिन। कृपया पुनः प्रयास करें।'));
      setPin('');
    }
  };

  // Employee Portal Login Handler
  const handleEmployeeLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (empMobile.length !== 10) {
      setEmpError(t('Please enter a valid 10-digit mobile number', 'कृपया 10 अंकों का मोबाइल नंबर डालें'));
      return;
    }
    if (!empPin.trim()) {
      setEmpError(t('Please enter your login PIN', 'कृपया अपना लॉगिन पिन दर्ज करें'));
      return;
    }

    // Find employee by mobile number
    const foundEmp = employees.find(
      emp => emp.mobile === empMobile && emp.status === 'Active'
    );

    if (!foundEmp) {
      setEmpError(t('Mobile number not registered or inactive.', 'मोबाइल नंबर पंजीकृत या सक्रिय नहीं है।'));
      return;
    }

    const attemptsKey = `gaushala_failed_attempts_${empMobile}`;
    const attempts = parseInt(localStorage.getItem(attemptsKey) || '0', 10);

    const hasCustomPin = foundEmp.loginPin && foundEmp.loginPin !== empMobile.slice(-4);
    const defaultPin = empMobile.slice(-4);

    let isValid = false;
    if (hasCustomPin) {
      if (attempts >= 10) {
        // Unlock fallback: both custom and default work
        isValid = empPin === foundEmp.loginPin || empPin === defaultPin;
      } else {
        // Before 10 attempts: only custom works
        isValid = empPin === foundEmp.loginPin;
      }
    } else {
      // No custom PIN set: only default works
      isValid = empPin === defaultPin;
    }

    if (isValid) {
      localStorage.removeItem(attemptsKey);
      onVerifyEmployeeSuccess(foundEmp.id);
    } else {
      const newAttempts = attempts + 1;
      localStorage.setItem(attemptsKey, String(newAttempts));
      
      if (newAttempts >= 10) {
        setEmpError(t(
          'Incorrect login PIN. 10 failed attempts reached. Default login PIN (last 4 digits of mobile) is now unlocked.',
          'गलत लॉगिन पिन। 10 असफल प्रयास पूरे हुए। डिफ़ॉल्ट पिन (मोबाइल के अंतिम 4 अंक) अब अनलॉक हो गया है।'
        ));
      } else {
        const left = 10 - newAttempts;
        setEmpError(t(
          `Incorrect login PIN. Attempts left before backup unlock: ${left}`,
          `गलत लॉगिन पिन। बैकअप अनलॉक होने में शेष प्रयास: ${left}`
        ));
      }
      setEmpPin('');
    }
  };

  // 1. CHOOSE LOGIN PORTAL VIEW
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 font-sans select-none">
      <div className="bg-white rounded-3xl border border-slate-100 shadow-xl w-full max-w-sm p-6 sm:p-8 animate-in fade-in zoom-in-95 duration-300">
        
        {/* Logo & Branding */}
        <div className="text-center mb-5">
          <div className="w-[80px] h-[80px] rounded-full bg-blue-50/50 border border-blue-100/50 flex items-center justify-center mx-auto mb-3 overflow-hidden shadow-xs">
            {logo ? (
              <img src={logo} alt="Logo" className="w-full h-full object-cover" />
            ) : (
              <div className="w-12 h-12 bg-blue-50 flex items-center justify-center rounded-xl text-blue-600">
                <Icon name="agriculture" size={32} className="text-blue-600" />
              </div>
            )}
          </div>
          <h1 className="text-base font-bold text-slate-900 tracking-tight leading-tight">
            {companyName || 'Shree Kamdhenu'}
          </h1>
          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-1.5">
            {t('Employee Management System', 'कर्मचारी प्रबंधन प्रणाली')}
          </p>
        </div>

        {/* Portal Selection Toggle */}
        {!firebaseUser && (
          <div className="flex rounded-xl border border-slate-200 overflow-hidden bg-slate-50 p-1 mb-5">
            <button
              onClick={() => setPortalMode('admin')}
              className={`flex-1 h-9 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                portalMode === 'admin' ? 'bg-white text-blue-600 shadow-sm border border-slate-100' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon name="admin_panel_settings" size={16} />
              <span>{t('Admin Desk', 'एडमिन डेस्क')}</span>
            </button>
            <button
              onClick={() => setPortalMode('employee')}
              className={`flex-1 h-9 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                portalMode === 'employee' ? 'bg-white text-blue-600 shadow-sm border border-slate-100' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon name="badge" size={16} />
              <span>{t('Employee Portal', 'स्टाफ लॉगिन')}</span>
            </button>
          </div>
        )}

        <hr className="border-slate-100 my-4" />

        {/* --- A. EMPLOYEE PORTAL LOGIN --- */}
        {portalMode === 'employee' && (
          <div className="animate-in fade-in duration-200">
            <div className="text-center mb-4">
              <span className="text-[10px] text-blue-600 font-bold uppercase tracking-wider">
                {t('Employee Sign-In', 'कर्मचारी लॉगिन')}
              </span>
            </div>

            {empError && (
              <p className="text-[11px] text-red-650 font-bold bg-rose-50 border border-rose-100 rounded-xl p-3 mb-4 leading-normal flex items-start gap-1.5 animate-in fade-in duration-200">
                <Icon name="error" size={14} className="text-red-500 shrink-0 mt-0.5" />
                <span>{empError}</span>
              </p>
            )}

            <form onSubmit={handleEmployeeLoginSubmit} className="space-y-4">
              {/* Mobile Number */}
              <div className="fld mb-0">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                  {t('Registered Mobile Number', 'पंजीकृत मोबाइल नंबर')} <span className="text-red-500">*</span>
                </label>
                <div className="pw">
                  <span className="pfx">+91</span>
                  <input
                    type="tel"
                    value={empMobile}
                    onChange={e => {
                      setEmpMobile(e.target.value.replace(/\D/g, '').slice(0, 10));
                      setEmpError('');
                    }}
                    placeholder={t('Enter 10-digit mobile number', '10-अंकीय नंबर डालें')}
                    maxLength={10}
                    className="fi"
                    inputMode="numeric"
                  />
                </div>
              </div>

              {/* Login PIN */}
              <div className="fld mb-0">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                  {t('Employee Login PIN', 'लॉगिन सुरक्षा पिन')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  maxLength={6}
                  value={empPin}
                  onChange={e => {
                    setEmpPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                    setEmpError('');
                  }}
                  placeholder="• • • •"
                  className="w-full h-11 text-center text-lg font-extrabold tracking-widest border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-blue-500 outline-none focus:ring-4 focus:ring-blue-500/8 transition"
                  inputMode="numeric"
                />
                <span className="text-[9px] text-slate-400 mt-2 block font-medium leading-relaxed">
                  {t('Default PIN: Last 4 digits of mobile number (unless updated by admin).', 'डिफ़ॉल्ट पिन: मोबाइल नंबर के अंतिम 4 अंक।')}
                </span>
              </div>

              <button
                type="submit"
                className="w-full btn bbl text-white font-bold text-xs"
              >
                <span>{t('Sign In to My Portal', 'पोर्टल में प्रवेश करें')}</span>
              </button>
            </form>
          </div>
        )}

        {/* --- B. ADMIN DESK LOGIN --- */}
        {portalMode === 'admin' && (
          <div className="animate-in fade-in duration-200">
            {/* 1. Admin Email/Google Login */}
            {!firebaseUser && (
              <>
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={isLoading}
                  className="w-full h-11 border border-slate-200 rounded-xl font-bold text-xs flex items-center justify-center gap-2.5 bg-white hover:bg-slate-50 text-slate-700 transition active:scale-[0.98] cursor-pointer shadow-3xs mb-4"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22-.03-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>{t('Sign in with Google / Gmail', 'गूगल / जीमेल से लॉगिन करें')}</span>
                </button>

                <div className="flex items-center gap-3 my-4">
                  <div className="h-[1px] bg-slate-100 flex-1" />
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{t('OR USE EMAIL', 'या ईमेल का उपयोग करें')}</span>
                  <div className="h-[1px] bg-slate-100 flex-1" />
                </div>

                {authError && (
                  <p className="text-[11px] text-red-650 font-bold bg-rose-50 border border-rose-100 rounded-xl p-3 mb-4 leading-normal flex items-start gap-1.5 animate-in">
                    <Icon name="error" size={14} className="text-red-500 shrink-0 mt-0.5" />
                    <span>{authError}</span>
                  </p>
                )}

                <form onSubmit={handleEmailAuthSubmit} className="space-y-4" noValidate>
                  <div className="fld mb-0">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                      {t('Email Address (Gmail)', 'ईमेल आईडी (जीमेल)')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="e.g. admin@gmail.com"
                      className="fi"
                      disabled={isLoading}
                    />
                  </div>

                  <div className="fld mb-0">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                      {t('Password', 'पासवर्ड')} <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder={t('Enter password (min 6 chars)', 'पासवर्ड दर्ज करें (न्यूनतम 6 अक्षर)')}
                        className="fi pr-12"
                        disabled={isLoading}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(p => !p)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-650 cursor-pointer p-1"
                      >
                        <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={18} />
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full btn bbl text-white font-bold text-xs"
                  >
                    {isLoading ? (
                      <Icon name="progress_activity" size={18} className="animate-spin mr-1.5" />
                    ) : null}
                    <span>
                      {isSignUp 
                        ? t('Create Account & Register', 'खाता बनाएं और पंजीकृत करें') 
                        : t('Email Password Login', 'ईमेल और पासवर्ड लॉगिन')}
                    </span>
                  </button>
                </form>

                <div className="text-center mt-5">
                  <button
                    type="button"
                    onClick={() => setIsSignUp(!isSignUp)}
                    className="text-[11px] text-blue-650 font-bold hover:underline cursor-pointer"
                  >
                    {isSignUp 
                      ? t('Already have an account? Log In', 'पहले से खाता है? लॉगिन करें')
                      : t('First Time? Create Admin Account', 'पहली बार? एडमिन खाता बनाएं')}
                  </button>
                </div>
              </>
            )}

            {/* 2. Admin PIN Setup (Authenticated, but PIN not set in DB) */}
            {firebaseUser && !adminPin && (
              <div className="animate-in fade-in duration-200">
                <div className="text-center mb-4">
                  <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-3 border border-blue-100 shadow-3xs">
                    <Icon name="lock" size={22} />
                  </div>
                  <h1 className="text-base font-bold text-slate-900 tracking-tight">
                    {t('Set 4-Digit Security PIN', '४-अंकीय सुरक्षा पिन बनाएँ')}
                  </h1>
                  <p className="text-[10px] text-slate-400 mt-1 font-semibold leading-relaxed">
                    {t('Configure your shared admin PIN to secure this dashboard across all manager devices.', 'इस डैशबोर्ड को सुरक्षित करने के लिए अपना साझा एडमिन पिन सेट करें।')}
                  </p>
                </div>

                {pinError && (
                  <p className="text-[11px] text-red-650 font-bold bg-rose-50 border border-rose-100 rounded-xl p-3 mb-4 leading-normal flex items-start gap-1.5 animate-in">
                    <Icon name="error" size={14} className="text-red-500 shrink-0 mt-0.5" />
                    <span>{pinError}</span>
                  </p>
                )}

                <form onSubmit={handlePinSetupSubmit} className="space-y-4">
                  <div className="fld mb-0">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                      {t('Choose PIN (4 digits)', 'सुरक्षा पिन (4 अंक)')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      maxLength={4}
                      value={pin}
                      onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="• • • •"
                      className="w-full h-11 text-center text-lg font-extrabold tracking-widest border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-blue-500 outline-none focus:ring-4 focus:ring-blue-500/8 transition"
                      inputMode="numeric"
                    />
                  </div>

                  <div className="fld mb-0">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                      {t('Confirm PIN', 'पिन की पुष्टि करें')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      maxLength={4}
                      value={confirmPin}
                      onChange={e => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="• • • •"
                      className="w-full h-11 text-center text-lg font-extrabold tracking-widest border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-blue-500 outline-none focus:ring-4 focus:ring-blue-500/8 transition"
                      inputMode="numeric"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full btn bbl text-white font-bold text-xs"
                  >
                    {t('Initialize Dashboard & Sync', 'डैशबोर्ड प्रारंभ और सिंक करें')}
                  </button>
                </form>

                <div className="mt-5 text-center text-[10px] text-slate-400">
                  {t('Authenticated as:', 'प्रमाणित जीमेल:')}{' '}
                  <span className="font-semibold text-slate-600">{firebaseUser.email}</span>
                  <button 
                    onClick={onLogoutGmail}
                    className="block mx-auto mt-2 text-red-500 font-bold hover:underline cursor-pointer text-[10px]"
                  >
                    {t('Logout / Switch Account', 'लॉगआउट / ईमेल बदलें')}
                  </button>
                </div>
              </div>
            )}

            {/* 3. Admin PIN Verification (Authenticated and PIN exists) */}
            {firebaseUser && adminPin && (
              <div className="animate-in fade-in duration-200">
                <div className="text-center mb-4">
                  <span className="text-[10px] text-blue-600 font-bold uppercase tracking-wider block mb-1">
                    {t('Administrative Security Lock', 'प्रशासनिक सुरक्षा लॉक')}
                  </span>
                </div>

                {pinError && (
                  <p className="text-[11px] text-red-650 font-bold bg-rose-50 border border-rose-100 rounded-xl p-3 mb-4 leading-normal flex items-start gap-1.5 animate-in">
                    <Icon name="error" size={14} className="text-red-500 shrink-0 mt-0.5" />
                    <span>{pinError}</span>
                  </p>
                )}

                <form onSubmit={handlePinLoginSubmit} className="space-y-4">
                  <div className="fld mb-0">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5 text-center">
                      {t('Enter 4-Digit Administrator PIN', '४-अंकीय एडमिन सुरक्षा पिन दर्ज करें')}
                    </label>
                    <input
                      type="password"
                      maxLength={4}
                      value={pin}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                        setPin(val);
                        setPinError('');
                        if (val.length === 4 && val === adminPin) {
                          onVerifyPinSuccess();
                        }
                      }}
                      placeholder="• • • •"
                      className="w-36 h-12 mx-auto text-center text-lg font-extrabold tracking-widest border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-blue-500 outline-none focus:ring-4 focus:ring-blue-500/8 transition block"
                      inputMode="numeric"
                      autoFocus
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full btn bbl text-white font-bold text-xs"
                  >
                    {t('Unlock Dashboard', 'डैशबोर्ड अनलॉक करें')}
                  </button>
                </form>

                <div className="mt-5 text-center text-[10px] text-slate-400">
                  <div>
                    {t('Manager:', 'अकाउंट जीमेल:')}{' '}
                    <span className="font-semibold text-slate-600">{firebaseUser.email}</span>
                  </div>
                  <button 
                    onClick={onLogoutGmail}
                    className="mt-2.5 text-red-500 font-bold hover:underline cursor-pointer block mx-auto text-[10px]"
                  >
                    {t('Sign Out / Switch Gmail Account', 'साइन आउट / ईमेल बदलें')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Bilingual Quick Switcher */}
        <div className="mt-6 border-t border-slate-100 pt-5">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-slate-50 p-0.5">
            <button
              onClick={() => onToggleLang('en')}
              className={`flex-1 h-8 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                lang === 'en' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-400'
              }`}
            >
              English
            </button>
            <button
              onClick={() => onToggleLang('hi')}
              className={`flex-1 h-8 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                lang === 'hi' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-400'
              }`}
            >
              हिंदी
            </button>
          </div>
        </div>

      </div>
      <footer className="text-center text-[10px] text-slate-400 mt-6 tracking-wide font-medium">
        © Shree Kamdhenu · v3.0
      </footer>
    </div>
  );
}
