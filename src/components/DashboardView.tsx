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
    <div className="w-full select-none space-y-6 animate-in fade-in duration-200">
      
      {/* Real-time Pending Approvals Alert Banner */}
      {pendingRequests.length > 0 && (
        <div 
          onClick={() => onNavigate('approvals')}
          className="bg-amber-50 border border-amber-250 rounded-2xl p-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-amber-100/50 transition-colors shadow-3xs animate-pulse"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-500 text-white rounded-xl flex items-center justify-center shrink-0 shadow-xs">
              <Icon name="verified_user" size={20} />
            </div>
            <div>
              <h4 className="text-xs font-black text-amber-900 uppercase tracking-wide">
                {t('Pending Approvals Alert', 'लंबित अनुमोदन अलर्ट')}
              </h4>
              <p className="text-[10px] text-amber-700 font-semibold mt-0.5">
                {t(`You have ${pendingRequests.length} pending correction requests from employees.`, `आपके पास कर्मचारियों से ${pendingRequests.length} लंबित सुधार अनुरोध हैं।`)}
              </p>
            </div>
          </div>
          <Icon name="chevron_right" className="text-amber-600" size={20} />
        </div>
      )}

      {/* Quick Access Actions Section */}
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3">{t("Quick Actions", "त्वरित कार्य")}</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {/* Staff List Link */}
          <div 
            onClick={() => onNavigate('pv-staff')}
            className="bg-white border border-slate-100 p-4 rounded-2xl cursor-pointer hover:border-blue-300 hover:shadow-xs transition-all active:scale-[0.98] flex items-center gap-3.5 shadow-2xs group"
          >
            <div className="bg-blue-50/70 text-blue-600 w-11 h-11 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-blue-100 transition-colors">
              <Icon name="badge" size={22} className="text-blue-650" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-xs text-slate-900 truncate">{t('Staff Registry', 'कर्मचारी सूची')}</div>
              <div className="text-[9px] text-slate-400 mt-0.5 truncate">{t('Manage profile & wages', 'कर्मचारी प्रबन्ध')}</div>
            </div>
          </div>

          {/* Mark Attendance Link */}
          <div 
            onClick={() => onNavigate('pv-att')}
            className="bg-white border border-slate-100 p-4 rounded-2xl cursor-pointer hover:border-emerald-300 hover:shadow-xs transition-all active:scale-[0.98] flex items-center gap-3.5 shadow-2xs group"
          >
            <div className="bg-emerald-50/70 text-emerald-600 w-11 h-11 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-emerald-100 transition-colors">
              <Icon name="edit_calendar" size={22} className="text-emerald-650" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-xs text-slate-900 truncate">{t('Attendance', 'उपस्थिति')}</div>
              <div className="text-[9px] text-slate-400 mt-0.5 truncate">{t('Mark daily status', 'हाजिरी भरें')}</div>
            </div>
          </div>

          {/* Add New Staff Link */}
          <div 
            onClick={() => onNavigate('pv-add')}
            className="bg-white border border-slate-100 p-4 rounded-2xl cursor-pointer hover:border-purple-300 hover:shadow-xs transition-all active:scale-[0.98] flex items-center gap-3.5 shadow-2xs group"
          >
            <div className="bg-purple-50/70 text-purple-600 w-11 h-11 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-purple-100 transition-colors">
              <Icon name="person_add" size={22} className="text-purple-655" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-xs text-slate-900 truncate">{t('Add Staff', 'नया कर्मचारी')}</div>
              <div className="text-[9px] text-slate-400 mt-0.5 truncate">{t('Onboard employee', 'खाता जोड़ें')}</div>
            </div>
          </div>

          {/* Approval Desk Link */}
          <div 
            onClick={() => onNavigate('approvals')}
            className="bg-white border border-slate-100 p-4 rounded-2xl cursor-pointer hover:border-amber-300 hover:shadow-xs transition-all active:scale-[0.98] flex items-center gap-3.5 shadow-2xs group"
          >
            <div className="bg-amber-50/70 text-amber-600 w-11 h-11 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-amber-100 transition-colors">
              <Icon name="verified_user" size={22} className="text-amber-655" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-xs text-slate-900 truncate">{t('Approval Desk', 'अनुमोदन डेस्क')}</div>
              <div className="text-[9px] text-slate-400 mt-0.5 truncate">{t('Review pending requests', 'रिक्वेस्ट अप्रूव करें')}</div>
            </div>
          </div>

          {/* GeoFence Center Link */}
          <div 
            onClick={() => onNavigate('geofences')}
            className="bg-white border border-slate-100 p-4 rounded-2xl cursor-pointer hover:border-blue-300 hover:shadow-xs transition-all active:scale-[0.98] flex items-center gap-3.5 shadow-2xs group"
          >
            <div className="bg-blue-50/70 text-blue-600 w-11 h-11 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-blue-100 transition-colors">
              <Icon name="radar" size={22} className="text-blue-650" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-xs text-slate-900 truncate">{t('GeoFence Center', 'जियोफेंस केंद्र')}</div>
              <div className="text-[9px] text-slate-400 mt-0.5 truncate">{t('Manage work regions', 'लोकेशन परिधि प्रबन्ध')}</div>
            </div>
          </div>

          {/* Live GPS Map Link */}
          <div 
            onClick={() => onNavigate('tracking')}
            className="bg-white border border-slate-100 p-4 rounded-2xl cursor-pointer hover:border-indigo-300 hover:shadow-xs transition-all active:scale-[0.98] flex items-center gap-3.5 shadow-2xs group"
          >
            <div className="bg-indigo-50/70 text-indigo-600 w-11 h-11 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-indigo-100 transition-colors">
              <Icon name="map" size={22} className="text-indigo-650" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-xs text-slate-900 truncate">{t('Live GPS Map', 'लाइव जीपीएस ट्रैकिंग')}</div>
              <div className="text-[9px] text-slate-400 mt-0.5 truncate">{t('Real-time staff routes', 'लाइव लोकेशन मैप')}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Consolidated Today's Status Header */}
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3">{t("Today's Overview Status", "आज की स्थिति का सारांश")}</h3>
        
        {/* 2-Column Mobile Friendly Metrics Cards, expanding to 3 columns on larger devices */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          
          {/* Present Card */}
          <div className="bg-white border border-slate-150 rounded-2xl p-4 shadow-2xs relative overflow-hidden flex flex-col justify-between h-28">
            <div className="flex justify-between items-start">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">{t('Present Staff', 'उपस्थित स्टाफ')}</span>
              <Icon name="check_circle" size={18} className="text-emerald-500" fill={true} />
            </div>
            <div className="flex items-baseline gap-1 mt-2">
              <span className="text-2xl font-black text-emerald-600 font-mono">{presentCount}</span>
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wide">{t('Active', 'सक्रिय')}</span>
            </div>
          </div>

          {/* Absent Card */}
          <div className="bg-white border border-slate-150 rounded-2xl p-4 shadow-2xs relative overflow-hidden flex flex-col justify-between h-28">
            <div className="flex justify-between items-start">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">{t('Absent Staff', 'अनुपस्थित स्टाफ')}</span>
              <Icon name="cancel" size={18} className="text-red-500" fill={true} />
            </div>
            <div className="flex items-baseline gap-1 mt-2">
              <span className="text-2xl font-black text-red-500 font-mono">{absentCount}</span>
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wide">{t('Absent', 'अनुपस्थित')}</span>
            </div>
          </div>

          {/* Pending Payment Card */}
          <div className="bg-white border border-slate-150 rounded-2xl p-4 shadow-2xs relative overflow-hidden flex flex-col justify-between h-28">
            <div className="flex justify-between items-start">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">{t('Pending Payment', 'लंबित बकाया')}</span>
              <Icon name="payments" size={18} className="text-amber-500" fill={true} />
            </div>
            <div className="mt-2 font-mono">
              <span className="text-xl font-black text-amber-600">
                ₹{Math.round(totalPendingDue).toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          {/* Paid This Month Card */}
          <div className="bg-white border border-slate-150 rounded-2xl p-4 shadow-2xs relative overflow-hidden flex flex-col justify-between h-28">
            <div className="flex justify-between items-start">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">{t('Paid This Month', 'इस महीने भुगतान')}</span>
              <Icon name="account_balance_wallet" size={18} className="text-blue-500" fill={true} />
            </div>
            <div className="mt-2 font-mono">
              <span className="text-xl font-black text-blue-600">
                ₹{Math.round(totalPaidThisMonth).toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          {/* Attendance Summary */}
          <div className="bg-white border border-slate-150 rounded-2xl p-4 shadow-2xs relative overflow-hidden flex flex-col justify-between h-28">
            <div className="flex justify-between items-start">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">{t('Attendance Marked', 'सहेज हाजिरी')}</span>
              <Icon name="assignment_turned_in" size={18} className="text-slate-500" fill={true} />
            </div>
            <div className="flex items-baseline gap-1 mt-2">
              <span className="text-lg font-black text-slate-800 font-mono">{markedCount} <span className="text-slate-350 font-normal">/</span> {activeEmployees.length}</span>
              <span className="text-[9px] text-slate-400 font-bold">{t('Marked', 'सहेजा')}</span>
            </div>
          </div>

          {/* Total Registered Active Staff */}
          <div className="bg-white border border-slate-150 rounded-2xl p-4 shadow-2xs relative overflow-hidden flex flex-col justify-between h-28">
            <div className="flex justify-between items-start">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">{t('Total Staff Count', 'कुल सक्रिय कर्मचारी')}</span>
              <Icon name="group" size={18} className="text-indigo-500" fill={true} />
            </div>
            <div className="flex items-baseline gap-1 mt-2">
              <span className="text-lg font-black text-indigo-600 font-mono">{activeEmployees.length}</span>
              <span className="text-[9px] text-slate-400 font-bold">{t('Staffs', 'कुल')}</span>
            </div>
          </div>

        </div>
      </div>

    </div>
  );
}