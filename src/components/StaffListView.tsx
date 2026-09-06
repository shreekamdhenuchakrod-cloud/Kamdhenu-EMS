import React, { useState } from 'react';
import { AppDatabase, Employee } from '../types';
import { calcEmployeeFinancials } from '../db';
import Icon from './Icon';

interface StaffListViewProps {
  db: AppDatabase;
  onNavigate: (view: string, empId?: string) => void;
  lang: 'en' | 'hi';
}

export default function StaffListView({ db, onNavigate, lang }: StaffListViewProps) {
  const t = (en: string, hi: string) => (lang === 'en' ? en : hi);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('All');

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const todayStr = new Date().toISOString().split('T')[0];

  const activeStaff = db.employees.filter(emp => emp.status === 'Active' || emp.status === 'Inactive');

  const filteredStaff = activeStaff.filter(emp => {
    const matchesSearch = emp.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (emp.mobile && emp.mobile.includes(searchQuery));
    const matchesType = filterType === 'All' || emp.type === filterType;
    return matchesSearch && matchesType;
  });

  
  const sortedStaff = [...filteredStaff].sort((a,b) => {
    const order = { 'Hourly': 1, 'Monthly': 2, 'Daily': 3 };
    const aOrder = order[a.type] || 4;
    const bOrder = order[b.type] || 4;
    if(aOrder !== bOrder) return aOrder - bOrder; return a.name.localeCompare(b.name);
  });

const renderStaffCard = (emp: Employee) => {
    const initials = emp.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || emp.name.slice(0, 2).toUpperCase();

    // Today's attendance status
    const r = db.attendance ? db.attendance[`${emp.id}_${todayStr}`] : undefined;
    let statusText = t('Not Marked', 'बिना हाजिरी');
    let pillStyle = 'bg-slate-100 text-[#64748B] border-[#E2E8F0]';
    let statusIcon = 'schedule';

    if (emp.status === 'Inactive' || emp.status === 'Left Job') {
      statusText = emp.status === 'Left Job' ? t('Left Job', 'कार्यमुक्त') : t('Inactive', 'निष्क्रिय');
      pillStyle = 'bg-slate-100 text-[#64748B] border-[#E2E8F0]';
      statusIcon = 'person_off';
    } else if (r) {
      if (emp.type === 'Hourly') {
        const hasWork = (r.sessions || []).some((s: any) => s.in && s.out);
        if (hasWork) {
          statusText = t('Present', 'उपस्थित');
          pillStyle = 'bg-[#ECFDF5] text-[#10B981] border-emerald-100';
          statusIcon = 'check_circle';
        } else {
          statusText = t('Not Marked', 'बिना हाजिरी');
          pillStyle = 'bg-slate-100 text-[#64748B] border-[#E2E8F0]';
          statusIcon = 'schedule';
        }
      } else {
        if (r.status === 'Present') {
          statusText = t('Present', 'उपस्थित');
          pillStyle = 'bg-[#ECFDF5] text-[#10B981] border-emerald-100';
          statusIcon = 'check_circle';
        } else if (r.status === 'Half Day') {
          statusText = t('Half Day', 'आधा दिन');
          pillStyle = 'bg-amber-50 text-amber-700 border-amber-100';
          statusIcon = 'timelapse';
        } else if (r.status === 'Absent') {
          statusText = t('Absent', 'अनुपस्थित');
          pillStyle = 'bg-rose-50 text-rose-700 border-rose-100';
          statusIcon = 'cancel';
        } else if (r.status === 'Leave') {
          statusText = t('Leave', 'छुट्टी');
          pillStyle = 'bg-purple-50 text-purple-700 border-purple-100';
          statusIcon = 'event_busy';
        }
      }
    }

    // Dynamic dues calculation
    let totalDue = 0;
    try {
      const financial = calcEmployeeFinancials(emp, currentYear, currentMonth, db);
      totalDue = financial.totalDue;
    } catch (e) {}

    return (
      <div 
        key={emp.id} 
        onClick={() => onNavigate('profile-detail', emp.id)}
        className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm hover:border-[#2563EB] hover:shadow-md transition-all active:scale-[0.98] cursor-pointer flex items-center justify-between"
      >
        <div className="flex items-center gap-4">
          {emp.pic ? (
            <img src={emp.pic} alt={emp.name} className="w-12 h-12 rounded-full object-cover border border-[#E2E8F0]" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center font-black text-sm border border-[#E2E8F0]">
              {initials}
            </div>
          )}
          
          <div>
            <h3 className="font-bold text-[#0F172A] text-sm leading-tight flex flex-wrap items-center gap-1.5 line-clamp-2">
              {emp.name}
              <span className="text-[9px] font-black uppercase tracking-wider bg-slate-100 text-[#64748B] px-1.5 py-0.5 rounded-md">
                {t(emp.type, emp.type === 'Hourly' ? 'घंटेवार' : emp.type === 'Daily' ? 'दिहाड़ी' : 'मासिक')}
              </span>
            </h3>
            
            {emp.mobile && (
              <p className="text-xs text-[#64748B] font-medium mt-1">
                +91 {emp.mobile.replace(/(\d{5})(\d{5})/, '$1 $2')}
              </p>
            )}
            
            <div className="flex items-center gap-2 mt-2">
              <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${pillStyle}`}>
                <Icon name={statusIcon} size={12} />
                {statusText}
              </span>
            </div>
          </div>
        </div>

        <div className="text-right flex flex-col items-end justify-center h-full gap-1">
          <p className={`text-[9px] font-bold uppercase tracking-wider ${totalDue > 0 ? 'text-emerald-600' : totalDue < 0 ? 'text-rose-600' : 'text-[#64748B]'}`}>
            {totalDue > 0 ? t('Amount Due', 'बकाया राशि') : totalDue < 0 ? t('Advance Paid', 'अग्रिम भुगतान') : t('Settled', 'चुकाया गया')}
          </p>
          <p className={`text-base font-black ${totalDue > 0 ? 'text-emerald-600' : totalDue < 0 ? 'text-rose-600' : 'text-[#64748B]'}`}>
            ₹{Math.round(Math.abs(totalDue)).toLocaleString('en-IN')}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full h-full flex flex-col select-none animate-in fade-in duration-200">
      
      {/* Sticky Header */}
      <div className="bg-[#F7F9FC] md:bg-white sticky top-0 z-10 px-4 md:px-6 pt-4 pb-3 border-b border-[#E2E8F0]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg md:text-xl font-black text-[#0F172A] tracking-tight">{t('Staff Directory', 'कर्मचारी सूची')}</h2>
            <p className="text-xs text-[#64748B] font-medium mt-0.5">{db.employees.length} {t('total registered staff', 'कुल पंजीकृत कर्मचारी')}</p>
          </div>
          <button onClick={() => onNavigate('add-staff')} className="bg-[#2563EB] hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-sm transition-all flex items-center gap-2 active:scale-95">
            <Icon name="person_add" size={18} />
            <span className="hidden md:inline">{t('Add Staff', 'नया स्टाफ')}</span>
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {/* Search Bar */}
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#64748B]">
              <Icon name="search" size={20} />
            </div>
            <input
              type="text"
              placeholder={t('Search staff by name or phone...', 'नाम या मोबाइल से खोजें...')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-[#E2E8F0] rounded-xl text-sm font-medium text-[#0F172A] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-all placeholder-[#94A3B8]"
            />
          </div>

          {/* Scrollable Filters */}
          <div className="flex overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 gap-2 hide-scrollbar">
            {['All', 'Hourly', 'Daily', 'Monthly'].map(type => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`whitespace-nowrap px-4 py-1.5 rounded-full text-xs font-bold border transition-all ${
                  filterType === type 
                    ? 'bg-[#2563EB] text-white border-[#2563EB]' 
                    : 'bg-white text-[#64748B] border-[#E2E8F0] hover:bg-slate-50'
                }`}
              >
                {type === 'All' ? t('All Staff', 'सभी स्टाफ') : t(type, type === 'Hourly' ? 'घंटेवार' : type === 'Daily' ? 'दिहाड़ी' : 'मासिक')}
                <span className="ml-1.5 opacity-80 font-normal">
                  ({type === 'All' ? activeStaff.length : activeStaff.filter(e => e.type === type).length})
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Staff List */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-28 md:pb-8">
        {filteredStaff.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {sortedStaff.map(renderStaffCard)}
          </div>
        ) : (
          <div className="w-full flex flex-col items-center justify-center py-20 text-center px-4">
            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-[#64748B] mb-4">
              <Icon name="search_off" size={32} />
            </div>
            <h3 className="text-lg font-black text-[#0F172A]">{t('No staff found', 'कोई स्टाफ नहीं मिला')}</h3>
            <p className="text-sm text-[#64748B] mt-2 max-w-xs">{t('Try adjusting your search or add a new staff member.', 'खोज बदलें या नया कर्मचारी जोड़ें।')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
