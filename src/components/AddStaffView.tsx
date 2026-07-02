import React, { useState } from 'react';
import { EmployeeType, EmployeeStatus } from '../types';
import Icon from './Icon';

interface AddStaffViewProps {
  onSave: (data: {
    name: string;
    mobile: string;
    type: EmployeeType;
    rate: number;
    pic: string;
    join: string;
    baseHours: number;
    address: string;
  }) => void;
  onGoBack: () => void;
  lang: 'en' | 'hi';
}

export default function AddStaffView({ onSave, onGoBack, lang }: AddStaffViewProps) {
  const [step, setStep] = useState(1);
  const [selType, setSelType] = useState<EmployeeType | null>(null);

  // Form Details State
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [join, setJoin] = useState(new Date().toISOString().split('T')[0]);
  const [rate, setRate] = useState('');
  const [baseHours, setBaseHours] = useState<number>(8); // default to 8 base hours
  const [address, setAddress] = useState('');
  const [picBase64, setPicBase64] = useState('');

  const t = (en: string, hi: string) => (lang === 'en' ? en : hi);

  const handlePicUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setPicBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleNextStep = () => {
    if (!selType) return;
    setStep(2);
  };

  const handleSave = () => {
    if (!name.trim()) {
      alert(t('Name is required!', 'नाम दर्ज करना आवश्यक है!'));
      return;
    }
    if (!mobile.trim() || mobile.length !== 10) {
      alert(t('Please enter a valid 10-digit mobile number!', 'मान्य 10-अंकीय मोबाइल दर्ज करें!'));
      return;
    }
    if (!join) {
      alert(t('Joining date is required!', 'ज्वाइनिंग तारीख आवश्यक है!'));
      return;
    }
    const numRate = parseFloat(rate);
    if (isNaN(numRate) || numRate <= 0) {
      alert(t('Please enter a valid salary rate/wage!', 'कृपया मान्य वेतन या दर दर्ज करें!'));
      return;
    }

    onSave({
      name,
      mobile,
      type: selType!,
      rate: numRate,
      pic: picBase64,
      join,
      baseHours,
      address
    });
  };

  return (
    <div className="w-full">
      {step === 1 ? (
        <div className="animate-in fade-in duration-200">
          {/* Stepper Header */}
          <div className="steps mb-6 bg-white border border-slate-100/80 p-4 rounded-2xl shadow-2xs">
            <div className="flex items-center gap-2.5 flex-1">
              <div className="stpdot ac font-bold text-xs">1</div>
              <span className="stplb ac font-bold text-xs">{t('Staff Type', 'कर्मचारी प्रकार')}</span>
            </div>
            <div className="stpln" />
            <div className="flex items-center gap-2.5 flex-1 justify-end">
              <div className="stpdot pe font-bold text-xs">2</div>
              <span className="stplb font-bold text-xs">{t('Onboard Info', 'विवरण भरें')}</span>
            </div>
          </div>

          <p className="text-xs font-semibold text-slate-500 mb-5 tracking-wide leading-relaxed">
            {t(
              'Select the attendance and calculation engine for this employee:',
              'इस कर्मचारी के लिए वेतन गणना और उपस्थिति का प्रकार चुनें:'
            )}
          </p>

          {/* Type Select Cards */}
          <div 
            onClick={() => setSelType('Hourly')}
            className={`tcard ${selType === 'Hourly' ? 'sel' : ''}`}
          >
            <div className="tcico">
              <Icon name="schedule" size={24} fill={selType === 'Hourly'} />
            </div>
            <div className="tcin">
              <div className="tcn">{t('Hourly Tracked', 'प्रति घंटा भुगतान')}</div>
              <div className="tcd">{t('Earns salary computed per hour. Supports multiple punch sessions.', 'काम के घंटों के हिसाब से भुगतान। दैनिक एकाधिक पाली का समर्थन।')}</div>
            </div>
            <div className="rdot"><div className="rin" /></div>
          </div>

          <div 
            onClick={() => setSelType('Daily')}
            className={`tcard relative ${selType === 'Daily' ? 'sel' : ''}`}
          >
            <div className="tcico">
              <Icon name="today" size={24} fill={selType === 'Daily'} />
            </div>
            <div className="tcin">
              <div className="tcn">{t('Daily Wage', 'दैनिक वेतन')}</div>
              <div className="tcd">{t('Earns a fixed daily wage for marked Present. Half days are 0.5 wage.', 'प्रतिदिन निश्चित वेतन। आधा दिन चिह्नित करने पर आधा दैनिक वेतन।')}</div>
            </div>
            <span className="absolute top-3 right-12 bg-emerald-50 text-emerald-700 text-[9px] font-bold px-2 py-0.5 rounded-full border border-emerald-100 uppercase tracking-wider">
              {t('Common', 'सामान्य')}
            </span>
            <div className="rdot"><div className="rin" /></div>
          </div>

          <div 
            onClick={() => setSelType('Monthly')}
            className={`tcard ${selType === 'Monthly' ? 'sel' : ''}`}
          >
            <div className="tcico">
              <Icon name="calendar_month" size={24} fill={selType === 'Monthly'} />
            </div>
            <div className="tcin">
              <div className="tcn">{t('Monthly Salary', 'मासिक नियत वेतन')}</div>
              <div className="tcd">{t('Earns a monthly cyclic salary prorated dynamically by Present days.', 'मासिक नियत वेतन जो उपस्थिति के दिनों के अनुसार अनुपातित रूप से दिया जाता है।')}</div>
            </div>
            <div className="rdot"><div className="rin" /></div>
          </div>

          {/* Action Bar */}
          <div className="mt-8 bg-white border border-slate-100 rounded-2xl p-4 flex gap-4 shadow-2xs">
            <button
              onClick={onGoBack}
              className="flex-1 btn bou text-xs font-semibold"
            >
              {t('Cancel', 'रद्द करें')}
            </button>
            <button
              onClick={handleNextStep}
              className={`flex-1 h-12 rounded-xl text-xs font-semibold transition-all ${
                selType 
                  ? 'bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98] shadow-sm shadow-blue-500/10' 
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
              }`}
              disabled={!selType}
            >
              {t('Continue', 'आगे बढ़ें')}
            </button>
          </div>
        </div>
      ) : (
        <div className="animate-in slide-in-from-right duration-250">
          {/* Stepper Header */}
          <div className="steps mb-6 bg-white border border-slate-100/80 p-4 rounded-2xl shadow-2xs">
            <div className="flex items-center gap-2.5 flex-1">
              <div className="stpdot dn font-bold text-xs"><Icon name="check" size={14} className="text-white font-black" /></div>
              <span className="stplb dn font-bold text-xs">{t('Staff Type', 'कर्मचारी प्रकार')}</span>
            </div>
            <div className="stpln dn" />
            <div className="flex items-center gap-2.5 flex-1 justify-end">
              <div className="stpdot ac font-bold text-xs">2</div>
              <span className="stplb ac font-bold text-xs">{t('Details', 'विवरण भरें')}</span>
            </div>
          </div>

          <div className="bg-white border border-slate-150 rounded-2xl p-5 shadow-2xs mb-4">
            <div className="slbl mb-4">{t('Personal Profile', 'व्यक्तिगत विवरण')}</div>

            {/* Photo upload zone */}
            <div className="flex items-center gap-4 mb-6 border-b border-slate-50 pb-5">
              <div 
                onClick={() => document.getElementById('emp-file-pic')?.click()}
                className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center border border-dashed border-slate-300 text-slate-400 cursor-pointer overflow-hidden shadow-inner flex-shrink-0 hover:bg-slate-100/70 hover:border-slate-400 transition-colors"
              >
                {picBase64 ? (
                  <img src={picBase64} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <Icon name="upload" size={24} className="text-slate-400" />
                )}
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => document.getElementById('emp-file-pic')?.click()}
                  className="h-9 px-4 rounded-xl border border-slate-200 bg-white font-semibold text-xs text-slate-700 shadow-3xs active:scale-[0.98] transition-all hover:bg-slate-50 cursor-pointer"
                >
                  {picBase64 ? t('Change Photo', 'तस्वीर बदलें') : t('Upload Photo', 'तस्वीर अपलोड करें')}
                </button>
                <div className="text-[10px] text-slate-400 mt-1.5 font-medium">{t('PNG, JPG or WEBP formats supported', 'वैकल्पिक तस्वीर')}</div>
                <input 
                  type="file" 
                  id="emp-file-pic" 
                  accept="image/*" 
                  onChange={handlePicUpload} 
                  className="hidden" 
                />
              </div>
            </div>

            {/* Name */}
            <div className="fld">
              <label>{t('Staff Full Name', 'कर्मचारी का पूरा नाम')} <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t('Enter full name', 'पूरा नाम दर्ज करें')}
                className="fi"
              />
            </div>

            {/* Mobile number */}
            <div className="fld">
              <label>{t('Mobile Number', 'मोबाइल नंबर')} <span className="text-red-500">*</span></label>
              <div className="pw">
                <span className="pfx">+91</span>
                <input
                  type="tel"
                  value={mobile}
                  onChange={e => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder={t('Enter 10-digit mobile', '10-अंकीय नंबर डालें')}
                  maxLength={10}
                />
              </div>
            </div>

            {/* Address */}
            <div className="fld mb-0">
              <label>{t('Address', 'पता')}</label>
              <input
                type="text"
                value={address}
                onChange={e => setAddress(e.target.value)}
                placeholder={t('Enter home address (optional)', 'घर का पता (वैकल्पिक)')}
                className="fi"
              />
            </div>
          </div>

          <div className="bg-white border border-slate-150 rounded-2xl p-5 shadow-2xs mb-4">
            <div className="slbl mb-4">{t('Employment Payroll Config', 'वेतन और कार्य घंटे')}</div>

            {/* Joining Date */}
            <div className="fld">
              <label>{t('Onboarding / Joining Date', 'ज्वाइनिंग की तारीख')} <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={join}
                onChange={e => setJoin(e.target.value)}
                className="fi"
              />
            </div>

            {/* Wage rate */}
            <div className="fld">
              <label>
                {selType === 'Hourly' 
                  ? t('Hourly Salary (₹/hr)', 'प्रति घंटा दर (₹/घंटा)') 
                  : selType === 'Daily' 
                  ? t('Daily Wage (₹/day)', 'दैनिक वेतन (₹/दिन)') 
                  : t('Fixed Monthly Salary (₹/mo)', 'मासिक नियत वेतन (₹/माह)')}
                <span className="text-red-500">*</span>
              </label>
              <div className="rw">
                <span className="rs">₹</span>
                <input
                  type="number"
                  value={rate}
                  onChange={e => setRate(e.target.value)}
                  placeholder="0"
                  inputMode="numeric"
                />
              </div>
              <span className="text-[10px] text-slate-400 font-medium block mt-2 leading-relaxed">
                {selType === 'Hourly' 
                  ? t('Calculates daily payroll hours worked * rate.', 'काम के प्रति घंटे के हिसाब से भुगतान।')
                  : selType === 'Daily' 
                  ? t('Present days are evaluated at full rate, half days at 50%.', 'पूर्ण दिन पर पूर्ण वेतन, आधा दिन पर आधा दैनिक वेतन।')
                  : t('Entire monthly salary is earned based on present day ratio.', 'उपस्थिति के दिनों के अनुसार विभाजित कर मासिक भुगतान।')}
              </span>
            </div>

            {/* Base Daily Working Hours dropdown */}
            <div className="fld mb-0">
              <label>{t('Base Daily Working Hours', 'दैनिक मानक कार्य घंटे')} <span className="text-red-500">*</span></label>
              <div className="relative">
                <select
                  value={baseHours}
                  onChange={e => setBaseHours(parseInt(e.target.value, 10))}
                  className="fi appearance-none pr-10"
                >
                  <option value={8}>8 Hours</option>
                  <option value={9}>9 Hours (Common)</option>
                  <option value={10}>10 Hours</option>
                  <option value={12}>12 Hours</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none flex items-center justify-center">
                  <Icon name="arrow_drop_down" size={24} />
                </div>
              </div>
              <div className="hint text-[10px] text-slate-450 font-medium leading-relaxed mt-2">
                {t('This hour limit serves as the denominator to calculate custom overtime and late fine rates.', 'यह समय सीमा ओवरटाइम और लेट फाइन गणना के लिए आधार बनाई जाएगी।')}
              </div>
            </div>
          </div>

          {/* Action Bar */}
          <div className="bg-white border border-slate-100 rounded-2xl p-4 flex gap-4 shadow-2xs">
            <button
              onClick={() => setStep(1)}
              className="flex-1 btn bou text-xs font-semibold"
            >
              {t('Back', 'पीछे जाएँ')}
            </button>
            <button
              onClick={handleSave}
              className="flex-1 btn bbl text-xs font-semibold shadow-blue-500/10"
            >
              {t('Save Employee', 'कर्मचारी सहेजें')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
