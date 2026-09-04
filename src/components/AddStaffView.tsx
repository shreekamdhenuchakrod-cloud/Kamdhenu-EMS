import React, { useState } from 'react';
import { EmployeeType, EmployeeStatus } from '../types';
import Icon from './Icon';
import { optimizeImage } from '../utils/imageOptimizer';

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

  const handlePicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const optimizedBase64 = await optimizeImage(file);
      setPicBase64(optimizedBase64);
    } catch (err: any) {
      alert("Image optimization failed: " + err.message);
    }
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
    <div className="w-full h-full flex flex-col select-none animate-in slide-in-from-right-4 duration-200">
      
      {/* Sticky Header */}
      <div className="bg-[#F7F9FC] md:bg-white sticky top-0 z-10 px-4 md:px-6 pt-4 pb-3 border-b border-[#E2E8F0] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onGoBack} className="w-10 h-10 rounded-full bg-white border border-[#E2E8F0] flex items-center justify-center text-[#0F172A] shadow-sm active:scale-95 transition-all">
            <Icon name="arrow_back" size={20} />
          </button>
          <div>
            <h2 className="text-lg md:text-xl font-black text-[#0F172A] tracking-tight">{t('Add Staff', 'नया स्टाफ')}</h2>
            <p className="text-xs text-[#64748B] font-medium mt-0.5">{step === 1 ? t('Step 1 of 2: Staff Type', 'चरण 1: प्रकार चुनें') : t('Step 2 of 2: Details', 'चरण 2: विवरण भरें')}</p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-28 md:pb-8">
        
        {step === 1 ? (
          <div className="max-w-md mx-auto space-y-6">
            <p className="text-sm font-bold text-[#64748B] mb-2">{t('Select the calculation type for this employee:', 'कर्मचारी के लिए वेतन गणना का प्रकार चुनें:')}</p>
            
            <div 
              onClick={() => setSelType('Hourly')}
              className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-start gap-4 ${selType === 'Hourly' ? 'border-[#2563EB] bg-[#EFF6FF] shadow-md' : 'border-[#E2E8F0] bg-white hover:border-slate-300 shadow-sm'}`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${selType === 'Hourly' ? 'bg-[#2563EB] text-white' : 'bg-[#F7F9FC] text-[#64748B]'}`}>
                <Icon name="schedule" size={24} />
              </div>
              <div>
                <h3 className={`font-black ${selType === 'Hourly' ? 'text-[#0F172A]' : 'text-[#0F172A]'}`}>{t('Hourly Wage Staff', 'घंटेवार कर्मचारी')}</h3>
                <p className="text-xs text-[#64748B] mt-1 leading-relaxed">
                  {t('Paid per hour worked. Attendance is strictly calculated based on in/out punch timings.', 'काम किए गए घंटों के आधार पर भुगतान। हाजिरी इन/आउट पंच के समय के आधार पर।')}
                </p>
              </div>
            </div>

            <div 
              onClick={() => setSelType('Daily')}
              className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-start gap-4 ${selType === 'Daily' ? 'border-[#2563EB] bg-[#EFF6FF] shadow-md' : 'border-[#E2E8F0] bg-white hover:border-slate-300 shadow-sm'}`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${selType === 'Daily' ? 'bg-[#2563EB] text-white' : 'bg-[#F7F9FC] text-[#64748B]'}`}>
                <Icon name="today" size={24} />
              </div>
              <div>
                <h3 className={`font-black ${selType === 'Daily' ? 'text-[#0F172A]' : 'text-[#0F172A]'}`}>{t('Daily Wage Staff', 'दिहाड़ी कर्मचारी')}</h3>
                <p className="text-xs text-[#64748B] mt-1 leading-relaxed">
                  {t('Paid per day. Half-days and absents auto-deduct wage based on standard hours.', 'प्रति दिन भुगतान। हाफ-डे या अनुपस्थिति में दैनिक वेतन कटेगा।')}
                </p>
              </div>
            </div>

            <div 
              onClick={() => setSelType('Monthly')}
              className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-start gap-4 ${selType === 'Monthly' ? 'border-[#2563EB] bg-[#EFF6FF] shadow-md' : 'border-[#E2E8F0] bg-white hover:border-slate-300 shadow-sm'}`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${selType === 'Monthly' ? 'bg-[#2563EB] text-white' : 'bg-[#F7F9FC] text-[#64748B]'}`}>
                <Icon name="date_range" size={24} />
              </div>
              <div>
                <h3 className={`font-black ${selType === 'Monthly' ? 'text-[#0F172A]' : 'text-[#0F172A]'}`}>{t('Monthly Salary Staff', 'मासिक वेतन कर्मचारी')}</h3>
                <p className="text-xs text-[#64748B] mt-1 leading-relaxed">
                  {t('Fixed monthly salary. Absents directly reduce the month\'s payable days.', 'तय मासिक वेतन। गैरहाजिरी से महीने के देय दिन घट जाएंगे।')}
                </p>
              </div>
            </div>

            <div className="pt-6">
              <button 
                onClick={handleNextStep}
                disabled={!selType}
                className={`w-full py-4 rounded-xl font-black text-sm uppercase tracking-wider transition-all ${selType ? 'bg-[#2563EB] text-white shadow-md active:scale-[0.98]' : 'bg-slate-100 text-[#94A3B8] cursor-not-allowed'}`}
              >
                {t('Continue', 'आगे बढ़ें')}
              </button>
            </div>
          </div>
        ) : (
          <div className="max-w-md mx-auto space-y-6 animate-in slide-in-from-right-4 duration-200">
            
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm space-y-5">
              <div className="flex items-center gap-3 border-b border-[#E2E8F0] pb-3">
                 <Icon name="person" size={20} className="text-[#2563EB]" />
                 <h3 className="font-bold text-[#0F172A]">{t('Personal Information', 'व्यक्तिगत जानकारी')}</h3>
              </div>

              {/* Photo Upload */}
              <div className="flex flex-col items-center">
                <div className="relative group cursor-pointer w-24 h-24 mb-2">
                  <input type="file" accept="image/*" onChange={handlePicUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                  {picBase64 ? (
                    <img src={picBase64} alt="Preview" className="w-24 h-24 rounded-full object-cover border-2 border-[#E2E8F0] shadow-sm" />
                  ) : (
                    <div className="w-24 h-24 rounded-full bg-[#F7F9FC] border-2 border-dashed border-[#CBD5E1] flex flex-col items-center justify-center text-[#64748B] group-hover:border-[#2563EB] group-hover:text-[#2563EB] transition-colors">
                      <Icon name="add_a_photo" size={24} />
                      <span className="text-[10px] font-bold mt-1">{t('Photo', 'फोटो')}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#64748B] uppercase tracking-wider">{t('Full Name', 'पूरा नाम')} <span className="text-rose-500">*</span></label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#94A3B8]">
                    <Icon name="badge" size={18} />
                  </div>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t('Enter name', 'नाम दर्ज करें')} className="w-full pl-10 pr-4 py-3 bg-[#F7F9FC] border border-[#E2E8F0] rounded-xl text-sm font-bold text-[#0F172A] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]" />
                </div>
              </div>

              {/* Mobile */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#64748B] uppercase tracking-wider">{t('Mobile Number', 'मोबाइल नंबर')} <span className="text-rose-500">*</span></label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#94A3B8]">
                    <Icon name="call" size={18} />
                  </div>
                  <input type="tel" maxLength={10} value={mobile} onChange={e => setMobile(e.target.value.replace(/\D/g, ''))} placeholder="9876543210" className="w-full pl-10 pr-4 py-3 bg-[#F7F9FC] border border-[#E2E8F0] rounded-xl text-sm font-bold text-[#0F172A] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]" />
                </div>
                <p className="text-[10px] text-[#64748B] mt-1 ml-1">{t('Login PIN will be last 4 digits.', 'लॉगिन पिन अंतिम 4 अंक होंगे।')}</p>
              </div>

              {/* Address */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#64748B] uppercase tracking-wider">{t('Address (Optional)', 'पता (वैकल्पिक)')}</label>
                <div className="relative">
                  <div className="absolute top-3 left-0 pl-3 pointer-events-none text-[#94A3B8]">
                    <Icon name="home" size={18} />
                  </div>
                  <textarea value={address} onChange={e => setAddress(e.target.value)} rows={2} placeholder={t('Enter address', 'पता दर्ज करें')} className="w-full pl-10 pr-4 py-3 bg-[#F7F9FC] border border-[#E2E8F0] rounded-xl text-sm font-bold text-[#0F172A] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] resize-none" />
                </div>
              </div>
            </div>

            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm space-y-5">
              <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
                 <div className="flex items-center gap-3">
                   <Icon name="work" size={20} className="text-[#2563EB]" />
                   <h3 className="font-bold text-[#0F172A]">{t('Employment Details', 'रोजगार विवरण')}</h3>
                 </div>
                 <span className="text-[10px] font-black uppercase bg-[#EFF6FF] text-[#2563EB] px-2 py-1 rounded-md">
                   {selType}
                 </span>
              </div>

              {/* Join Date */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#64748B] uppercase tracking-wider">{t('Join Date', 'जॉइनिंग दिनांक')} <span className="text-rose-500">*</span></label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#94A3B8]">
                    <Icon name="event" size={18} />
                  </div>
                  <input type="date" value={join} onChange={e => setJoin(e.target.value)} className="w-full pl-10 pr-4 py-3 bg-[#F7F9FC] border border-[#E2E8F0] rounded-xl text-sm font-bold text-[#0F172A] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]" />
                </div>
              </div>

              {/* Rate */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#64748B] uppercase tracking-wider">
                  {selType === 'Hourly' ? t('Hourly Rate (₹)', 'प्रति घंटा दर (₹)') : selType === 'Daily' ? t('Daily Wage (₹)', 'दिहाड़ी दर (₹)') : t('Monthly Salary (₹)', 'मासिक वेतन (₹)')}
                  <span className="text-rose-500"> *</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#94A3B8]">
                    <span className="font-bold text-lg">₹</span>
                  </div>
                  <input type="number" value={rate} onChange={e => setRate(e.target.value)} placeholder="0" className="w-full pl-10 pr-4 py-3 bg-[#F7F9FC] border border-[#E2E8F0] rounded-xl text-sm font-bold text-[#0F172A] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]" />
                </div>
              </div>

              {/* Base Hours */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#64748B] uppercase tracking-wider">{t('Standard Daily Hours', 'दैनिक मानक घंटे')} <span className="text-rose-500">*</span></label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#94A3B8]">
                    <Icon name="timer" size={18} />
                  </div>
                  <input type="number" value={baseHours} onChange={e => setBaseHours(parseInt(e.target.value) || 8)} min="1" max="24" className="w-full pl-10 pr-4 py-3 bg-[#F7F9FC] border border-[#E2E8F0] rounded-xl text-sm font-bold text-[#0F172A] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]" />
                </div>
                <p className="text-[10px] text-[#64748B] mt-1 ml-1">{t('Used to calculate overtime and partial days.', 'ओवरटाइम और आधे दिन की गणना के लिए।')}</p>
              </div>

            </div>

            <div className="pt-4 pb-10 flex gap-3">
              <button 
                onClick={() => setStep(1)}
                className="flex-1 py-4 bg-white border border-[#E2E8F0] text-[#0F172A] rounded-xl font-black text-sm uppercase tracking-wider shadow-sm hover:bg-slate-50 transition-all active:scale-[0.98]"
              >
                {t('Back', 'पीछे')}
              </button>
              <button 
                onClick={handleSave}
                className="flex-[2] py-4 bg-[#10B981] hover:bg-emerald-600 text-white rounded-xl font-black text-sm uppercase tracking-wider shadow-sm transition-all active:scale-[0.98]"
              >
                {t('Save Employee', 'सेव करें')}
              </button>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
