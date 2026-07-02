import React from 'react';
import { AppDatabase, Employee } from '../types';
import { calcEmployeeFinancials } from '../db';
import Icon from './Icon';

interface StaffListViewProps {
  db: AppDatabase;
  onNavigate: (view: string) => void;
  onSelectEmployee: (id: string) => void;
  onRestoreEmployee: (id: string) => void;
  lang: 'en' | 'hi';
}

export default function StaffListView({
  db,
  onNavigate,
  onSelectEmployee,
  lang
}: StaffListViewProps) {
  const t = (en: string, hi: string) => (lang === 'en' ? en : hi);

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const todayStr = new Date().toISOString().split('T')[0];

  // Filters staff by active status only
  const filteredStaff = db.employees.filter(emp => emp.status === 'Active');

  // Group by Employee Type
  const hourlyStaff = filteredStaff.filter(e => e.type === 'Hourly');
  const dailyStaff = filteredStaff.filter(e => e.type === 'Daily');
  const monthlyStaff = filteredStaff.filter(e => e.type === 'Monthly');

  const renderStaffCard = (emp: Employee) => {
    const initials = emp.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || emp.name.slice(0, 2).toUpperCase();

    // Today's attendance status
    const r = db.attendance[`${emp.id}_${todayStr}`];
    let statusText = t('Not Marked', 'बिना हाजिरी');
    let pillStyle = 'bg-slate-55 text-slate-500 border-slate-200';

    if (r) {
      if (emp.type === 'Hourly') {
        const hasWork = (r.sessions || []).some((s: any) => s.in && s.out);
        if (hasWork) {
          statusText = t('Present', 'उपस्थित');
          pillStyle = 'bg-emerald-50 text-emerald-700 border-emerald-100';
        } else {
          statusText = t('Not Marked', 'बिना हाजिरी');
          pillStyle = 'bg-slate-55 text-slate-500 border-slate-200';
        }
      } else {
        if (r.status === 'Present') {
          statusText = t('Present', 'उपस्थित');
          pillStyle = 'bg-emerald-50 text-emerald-700 border-emerald-100';
        } else if (r.status === 'Half Day') {
          statusText = t('Half Day', 'आधा दिन');
          pillStyle = 'bg-amber-50 text-amber-700 border-amber-100';
        } else if (r.status === 'Absent') {
          statusText = t('Absent', 'अनुपस्थित');
          pillStyle = 'bg-rose-50 text-rose-700 border-rose-100';
        } else if (r.status === 'Leave') {
          statusText = t('Leave', 'छुट्टी');
          pillStyle = 'bg-purple-50 text-purple-700 border-purple-100';
        }
      }
    }

    // Dynamic dues calculation
    let totalDue = 0;
    try {
      const financial = calcEmployeeFinancials(emp, currentYear, currentMonth, db);
      totalDue = financial.totalDue;
    } catch {}

    return (
      <div 
        key={emp.id}
        onClick={() => onSelectEmployee(emp.id)}
        className="bg-white border border-slate-150 cursor-pointer hover:border-blue-300 hover:shadow-xs active:scale-[0.99] rounded-2xl p-3.5 mb-2.5 transition-all flex items-center justify-between shadow-3xs"
      >
        <div className="flex items-center gap-3.5 min-w-0">
          {/* Profile Pic with modern rounded-xl avatar box */}
          <div className="w-10 h-10 rounded-xl bg-blue-50/70 border border-blue-150 flex items-center justify-center font-bold text-blue-650 text-xs overflow-hidden shrink-0 shadow-3xs">
            {emp.pic ? (
              <img referrerPolicy="no-referrer" src={emp.pic} alt={emp.name} className="w-full h-full object-cover" />
            ) : (
              <span>{initials}</span>
            )}
          </div>

          <div className="min-w-0">
            <div className="font-semibold text-xs text-slate-900 truncate">{emp.name}</div>
            <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
              <Icon name="phone" size={11} className="text-slate-350" />
              <span>+91 {emp.mobile}</span>
            </div>
          </div>
        </div>

        {/* Right side Attendance Pill & Total Due / Adv */}
        <div className="flex flex-col items-end gap-1.5 shrink-0 text-right">
          <div className={`px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wide border ${pillStyle}`}>
            {statusText}
          </div>
            {totalDue >= 0 ? (
              <span className="text-xs font-bold text-emerald-700 font-mono">
                ₹{Math.round(totalDue).toLocaleString('en-IN')} {t('due', 'बाकी')}
              </span>
            ) : (
              <span className="text-xs font-bold text-amber-700 font-mono">
                ₹{Math.round(Math.abs(totalDue)).toLocaleString('en-IN')} {t('adv', 'पेशगी')}
              </span>
            )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full animate-in fade-in duration-200">
      
      {/* Registry Title and Quick Add Button */}
      <div className="flex justify-between items-center mb-4 bg-white border border-slate-100/80 rounded-2xl p-4 shadow-2xs">
        <div>
          <h2 className="text-xs font-bold text-slate-900 leading-none">{t('Staff Registry', 'कर्मचारी सूची')}</h2>
          <p className="text-[9px] text-slate-400 font-bold mt-1.5 uppercase tracking-wider">{filteredStaff.length} {t('Employees', 'कर्मचारी')}</p>
        </div>
        <button
          onClick={() => onNavigate('pv-add')}
          className="h-9 px-3.5 bg-blue-600 text-white rounded-xl text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer hover:bg-blue-700 active:scale-[0.98] transition-all shadow-sm shadow-blue-500/10"
        >
          <Icon name="add" size={15} />
          <span>{t('Add Staff', 'स्टाफ जोड़ें')}</span>
        </button>
      </div>

      <div>
        {/* Hourly Section */}
        {hourlyStaff.length > 0 && (
          <div className="mb-4">
            <div className="slbl text-[10px] font-bold tracking-wider text-slate-400 uppercase mb-2">
              {t('Hourly Staff', 'प्रति घंटा कर्मचारी')} ({hourlyStaff.length})
            </div>
            {hourlyStaff.map(emp => renderStaffCard(emp))}
          </div>
        )}

        {/* Daily Section */}
        {dailyStaff.length > 0 && (
          <div className="mb-4">
            <div className="slbl text-[10px] font-bold tracking-wider text-slate-400 uppercase mb-2">
              {t('Daily Staff', 'दैनिक वेतन कर्मचारी')} ({dailyStaff.length})
            </div>
            {dailyStaff.map(emp => renderStaffCard(emp))}
          </div>
        )}

        {/* Monthly Section */}
        {monthlyStaff.length > 0 && (
          <div className="mb-4">
            <div className="slbl text-[10px] font-bold tracking-wider text-slate-400 uppercase mb-2">
              {t('Monthly Staff', 'मासिक वेतन कर्मचारी')} ({monthlyStaff.length})
            </div>
            {monthlyStaff.map(emp => renderStaffCard(emp))}
          </div>
        )}

        {filteredStaff.length === 0 && (
          <div className="text-center bg-white border border-slate-150 rounded-2xl p-10 shadow-2xs flex flex-col items-center justify-center">
            <div className="w-14 h-14 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 mb-3">
              <Icon name="group" size={28} />
            </div>
            <p className="text-xs font-semibold text-slate-500">{t('No active employees found', 'कोई सक्रिय कर्मचारी नहीं मिला')}</p>
            <button
              onClick={() => onNavigate('pv-add')}
              className="mt-4 inline-flex items-center gap-1.5 h-9 px-4.5 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 active:scale-[0.98] transition-all shadow-sm"
            >
              <Icon name="person_add" size={16} />
              <span>{t('Register Employee', 'नया कर्मचारी जोड़ें')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
