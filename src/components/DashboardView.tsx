import React from 'react';
import { AppDatabase } from '../types';
import { calcEmployeeFinancials } from '../db';
import Icon from './Icon';

interface DashboardViewProps {
  db: AppDatabase;
  onNavigate: (view: string) => void;
  lang: 'en' | 'hi';
}

export default function DashboardView({ db, onNavigate, lang }: DashboardViewProps) {
  const activeEmployees = db.employees.filter(e => e.status === 'Active');
  const todayStr = new Date().toISOString().split('T')[0];

  let presentCount = 0;
  let absentCount = 0;
  let totalPendingDue = 0;
  let markedCount = 0;

  // Real-time payments made in this current month
  let totalPaidThisMonth = 0;
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();

  db.payments.forEach(pay => {
    try {
      const pDate = new Date(pay.date + 'T00:00:00');
      if (pDate.getFullYear() === currentYear && pDate.getMonth() === currentMonth) {
        totalPaidThisMonth += pay.amount;
      }
    } catch {}
  });

  activeEmployees.forEach(emp => {
    // Check attendance for today
    const rec = db.attendance[`${emp.id}_${todayStr}`];
    if (rec) {
      markedCount++;
      if (emp.type === 'Hourly') {
        const sessions = rec.sessions || [];
        const dayHrs = sessions.some(s => s.in && s.out);
        if (dayHrs) presentCount++;
        else absentCount++;
      } else {
        if (rec.status === 'Present' || rec.status === 'Half Day') {
          presentCount++; 
        } else if (rec.status === 'Absent') {
          absentCount++;
        }
      }
    }

    // Accumulate dues
    try {
      const financial = calcEmployeeFinancials(emp, currentYear, currentMonth, db);
      if (financial.totalDue > 0) {
        totalPendingDue += financial.totalDue;
      }
    } catch {}
  });

  const t = (en: string, hi: string) => (lang === 'en' ? en : hi);
  const pendingRequests = (db.approvalRequests || []).filter(r => r.status === 'Pending');

  return (
    <div className="w-full select-none space-y-6 animate-in fade-in duration-200 p-4 md:p-6 pb-28 md:pb-8">
      
      {/* Real-time Pending Approvals Alert */}
      {pendingRequests.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between shadow-sm cursor-pointer hover:bg-amber-100 transition-colors" onClick={() => onNavigate('approvals')}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
              <Icon name="assignment_late" size={20} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-amber-900 leading-tight">
                {t(`${pendingRequests.length} Pending Approval${pendingRequests.length > 1 ? 's' : ''}`, `${pendingRequests.length} पेंडिंग अप्रूवल`)}
              </h3>
              <p className="text-xs text-amber-700 font-medium mt-0.5">{t('Needs your attention', 'आपकी मंजूरी का इंतजार')}</p>
            </div>
          </div>
          <Icon name="chevron_right" size={20} className="text-amber-500" />
        </div>
      )}

      {/* Quick Actions Grid */}
      <section>
        <h2 className="text-sm font-bold text-[#64748B] uppercase tracking-wider mb-3 px-1">{t('Quick Actions', 'त्वरित कार्य')}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
          <button onClick={() => onNavigate('pv-staff')} className="bg-white border border-[#E2E8F0] rounded-2xl p-4 flex flex-col items-start gap-3 shadow-sm hover:border-[#2563EB] hover:shadow-md transition-all active:scale-[0.98]">
            <div className="w-10 h-10 rounded-xl bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center">
              <Icon name="people" size={20} />
            </div>
            <div className="text-left">
              <span className="block text-sm font-bold text-[#0F172A] leading-tight">{t('Staff Registry', 'स्टाफ सूची')}</span>
              <span className="block text-xs text-[#64748B] mt-0.5">{t('Manage profile', 'प्रोफाइल प्रबंधित करें')}</span>
            </div>
          </button>
          
          <button onClick={() => onNavigate('pv-att')} className="bg-white border border-[#E2E8F0] rounded-2xl p-4 flex flex-col items-start gap-3 shadow-sm hover:border-[#2563EB] hover:shadow-md transition-all active:scale-[0.98]">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Icon name="event_available" size={20} />
            </div>
            <div className="text-left">
              <span className="block text-sm font-bold text-[#0F172A] leading-tight">{t('Attendance', 'हाजिरी')}</span>
              <span className="block text-xs text-[#64748B] mt-0.5">{t('Mark daily status', 'दैनिक स्थिति')}</span>
            </div>
          </button>

          <button onClick={() => onNavigate('add-staff')} className="bg-white border border-[#E2E8F0] rounded-2xl p-4 flex flex-col items-start gap-3 shadow-sm hover:border-[#2563EB] hover:shadow-md transition-all active:scale-[0.98]">
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <Icon name="person_add" size={20} />
            </div>
            <div className="text-left">
              <span className="block text-sm font-bold text-[#0F172A] leading-tight">{t('Add Staff', 'नया स्टाफ')}</span>
              <span className="block text-xs text-[#64748B] mt-0.5">{t('Onboard employee', 'नया कर्मचारी जोड़े')}</span>
            </div>
          </button>

          <button onClick={() => onNavigate('approvals')} className="bg-white border border-[#E2E8F0] rounded-2xl p-4 flex flex-col items-start gap-3 shadow-sm hover:border-[#2563EB] hover:shadow-md transition-all active:scale-[0.98]">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Icon name="fact_check" size={20} />
            </div>
            <div className="text-left">
              <span className="block text-sm font-bold text-[#0F172A] leading-tight">{t('Approval Desk', 'अनुमोदन कक्ष')}</span>
              <span className="block text-xs text-[#64748B] mt-0.5">{t('Review requests', 'अनुरोध जांचे')}</span>
            </div>
          </button>

          <button onClick={() => onNavigate('geofences')} className="hidden lg:flex bg-white border border-[#E2E8F0] rounded-2xl p-4 flex-col items-start gap-3 shadow-sm hover:border-[#2563EB] hover:shadow-md transition-all active:scale-[0.98]">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Icon name="location_on" size={20} />
            </div>
            <div className="text-left">
              <span className="block text-sm font-bold text-[#0F172A] leading-tight">{t('GeoFence', 'जियो-फेंस')}</span>
              <span className="block text-xs text-[#64748B] mt-0.5">{t('Manage regions', 'कार्य क्षेत्र')}</span>
            </div>
          </button>
        </div>
      </section>

      {/* Today's Overview KPI Cards */}
      <section>
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="text-sm font-bold text-[#64748B] uppercase tracking-wider">{t("Today's Overview", 'आज का अवलोकन')}</h2>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Present */}
          <div className="bg-white border border-emerald-100 rounded-2xl p-4 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-20 text-emerald-500">
              <Icon name="check_circle" size={40} />
            </div>
            <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider">{t('Present', 'उपस्थित')}</p>
            <p className="text-2xl font-black text-[#0F172A] mt-1">{presentCount}</p>
            <p className="text-[10px] font-bold text-[#64748B] mt-1 uppercase tracking-wide">{t('Active today', 'आज कार्य पर')}</p>
          </div>

          {/* Absent */}
          <div className="bg-white border border-rose-100 rounded-2xl p-4 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-20 text-rose-500">
              <Icon name="cancel" size={40} />
            </div>
            <p className="text-xs font-bold text-rose-700 uppercase tracking-wider">{t('Absent', 'अनुपस्थित')}</p>
            <p className="text-2xl font-black text-[#0F172A] mt-1">{absentCount}</p>
            <p className="text-[10px] font-bold text-[#64748B] mt-1 uppercase tracking-wide">{t('On leave / absent', 'छुट्टी / गैरहाजिर')}</p>
          </div>

          {/* Pending Payment */}
          <div className="bg-white border border-amber-100 rounded-2xl p-4 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-20 text-amber-500">
              <Icon name="account_balance_wallet" size={40} />
            </div>
            <p className="text-xs font-bold text-amber-700 uppercase tracking-wider">{t('Pending Payment', 'बकाया भुगतान')}</p>
            <p className="text-2xl font-black text-[#0F172A] mt-1">₹{Math.round(totalPendingDue).toLocaleString('en-IN')}</p>
            <p className="text-[10px] font-bold text-[#64748B] mt-1 uppercase tracking-wide">{t('Total Pending', 'कुल बकाया')}</p>
          </div>

          {/* Paid This Month */}
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm relative overflow-hidden">
             <div className="absolute top-0 right-0 p-3 opacity-20 text-[#2563EB]">
              <Icon name="payments" size={40} />
            </div>
            <p className="text-xs font-bold text-[#2563EB] uppercase tracking-wider">{t('Paid This Month', 'इस महीने भुगतान')}</p>
            <p className="text-2xl font-black text-[#0F172A] mt-1">₹{Math.round(totalPaidThisMonth).toLocaleString('en-IN')}</p>
            <p className="text-[10px] font-bold text-[#64748B] mt-1 uppercase tracking-wide">{t('Total Paid', 'कुल जमा')}</p>
          </div>
        </div>
      </section>

      {/* Attendance & Staff Snapshot Row */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Attendance Summary Panel */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm">
          <div className="flex justify-between items-center mb-4">
             <h2 className="text-sm font-bold text-[#64748B] uppercase tracking-wider">{t('Attendance Marked', 'हाजिरी विवरण')}</h2>
             <span className="text-xs font-bold text-[#0F172A] bg-slate-100 px-2 py-1 rounded-md">
               {markedCount} / {activeEmployees.length}
             </span>
          </div>
          
          <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden flex mb-3">
             <div style={{width: `${activeEmployees.length > 0 ? (presentCount / activeEmployees.length) * 100 : 0}%`}} className="bg-[#10B981] h-full" />
             <div style={{width: `${activeEmployees.length > 0 ? (absentCount / activeEmployees.length) * 100 : 0}%`}} className="bg-[#EF4444] h-full border-l border-white/30" />
          </div>
          
          <div className="flex items-center justify-between text-xs font-bold text-[#64748B]">
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#10B981]"></span> Present ({presentCount})</div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#EF4444]"></span> Absent ({absentCount})</div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-300"></span> Unmarked ({activeEmployees.length - markedCount})</div>
          </div>
        </div>

        {/* Total Staff Panel */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm flex items-center justify-between cursor-pointer hover:border-[#2563EB] transition-colors" onClick={() => onNavigate('pv-staff')}>
          <div>
             <h2 className="text-sm font-bold text-[#64748B] uppercase tracking-wider mb-2">{t('Total Staff', 'कुल स्टाफ')}</h2>
             <div className="flex items-baseline gap-2">
               <span className="text-3xl font-black text-[#0F172A]">{activeEmployees.length}</span>
               <span className="text-xs font-bold text-[#64748B]">{t('Active Employees', 'सक्रिय कर्मचारी')}</span>
             </div>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-500 flex items-center justify-center">
             <Icon name="groups" size={28} />
          </div>
        </div>
      </section>

    </div>
  );
}
