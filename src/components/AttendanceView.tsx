import React, { useState, useEffect } from 'react';
import Icon from './Icon';
import TimeWheelPicker from './TimeWheelPicker';
import InlineDurationPicker from './InlineDurationPicker';
import { AppDatabase, OvertimeEntry, LateFineEntry, PunchSession } from '../types';
import { getRateForMonth, getDaysInMonth, getHourlyRate, toMin, timeToHrs, isOverlap } from '../db';

interface AttendanceViewProps {
  db: AppDatabase;
  onUpdateAttendance: (updatedAttendance: AppDatabase['attendance']) => void;
  onUpdateDb: (updatedDb: AppDatabase) => void;
  lang: 'en' | 'hi';
  onGoBack?: () => void;
}

const formatCurrency = (amt: number) => `₹${Math.round(amt).toLocaleString("en-IN")}`;

const formatHrsMins = (h: number): string => {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}:${mm.toString().padStart(2, '0')}`;
};

const formatTimeForDisplay = (timeStr?: string) => {
  if (!timeStr) return "";
  const parts = timeStr.split(":");
  if (parts.length < 2) return timeStr;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return timeStr;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ampm}`;
};

export default function AttendanceView({
  db,
  onUpdateAttendance,
  onUpdateDb,
  lang,
  onGoBack
}: AttendanceViewProps) {
  const [attDate, setAttDate] = useState(new Date().toISOString().split('T')[0]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Custom infinite time picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMeta, setPickerMeta] = useState<{
    empId: string;
    sessionIdx: number;
    field: 'in' | 'out';
    initialVal: string;
  } | null>(null);

  // Overtime Modal Form State
  const [otForm, setOtForm] = useState<{
    isOpen: boolean;
    employeeId: string;
    employeeName: string;
    date: string;
    hours: string;
    calcType: 'HourlyRate' | 'CustomAmount';
    amount: string;
    description: string;
  } | null>(null);

  // Late Fine Modal Form State
  const [fineForm, setFineForm] = useState<{
    isOpen: boolean;
    employeeId: string;
    employeeName: string;
    date: string;
    hours: string;
    calcType: 'HourlyRate' | 'CustomAmount';
    amount: string;
    description: string;
  } | null>(null);

  const t = (en: string, hi: string) => (lang === 'en' ? en : hi);

  const getHourlyRateForDate = (employeeId: string, dateStr: string) => {
    const emp = db.employees.find(e => e.id === employeeId);
    if (!emp || !dateStr) return 0;
    try {
      const parts = dateStr.split('-');
      if (parts.length < 2) return 0;
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      if (isNaN(year) || isNaN(month)) return 0;
      const baseSalary = getRateForMonth(emp, year, month);
      const daysCount = getDaysInMonth(year, month);
      return getHourlyRate(emp, baseSalary, daysCount);
    } catch {
      return 0;
    }
  };

  // Formats to nice readable date
  const formatHeaderDate = (ds: string) => {
    try {
      const dt = new Date(ds + 'T00:00:00');
      return dt.toLocaleDateString(lang === 'en' ? 'en-IN' : 'hi-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return ds;
    }
  };

  const handleDayShift = (days: number) => {
    const [y, m, d] = attDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    const newDs = `${yy}-${mm}-${dd}`;

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    if (newDs <= todayStr) {
      setAttDate(newDs);
      setExpandedId(null); // Close active row on date shift to prevent mismatch
    }
  };

  const getRecord = (empId: string): any => {
    if (!db.attendance[`${empId}_${attDate}`]) {
      return { sessions: [], status: undefined };
    }
    return db.attendance[`${empId}_${attDate}`];
  };

  const handleUpdateRecord = (empId: string, updatedRecord: any) => {
    const newAttendance = { ...db.attendance };
    newAttendance[`${empId}_${attDate}`] = updatedRecord;
    onUpdateAttendance(newAttendance);
  };

  const getCurrentTimeHHmm = () => {
    const d = new Date();
    const hrs = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${hrs}:${mins}`;
  };

  const triggerTimePicker = (empId: string, sessionIdx: number, field: 'in' | 'out', val: string) => {
    setPickerMeta({ empId, sessionIdx, field, initialVal: val || getCurrentTimeHHmm() });
    setPickerOpen(true);
  };

  const saveTimePickerValue = (finalTime: string) => {
    if (!pickerMeta) return;
    const { empId, sessionIdx, field } = pickerMeta;
    const rec = { ...getRecord(empId) };
    const sessions = [...(rec.sessions || [])];

    if (!sessions[sessionIdx]) {
      sessions[sessionIdx] = { in: '', out: '' };
    }

    const currentSession = { ...sessions[sessionIdx] };
    currentSession[field] = finalTime;

    // Validation
    const proposedIn = field === 'in' ? finalTime : currentSession.in;
    const proposedOut = field === 'out' ? finalTime : currentSession.out;

    if (proposedIn && proposedOut) {
      if (toMin(proposedOut) <= toMin(proposedIn)) {
        alert(t('Punch Out time must be later than Punch In time.', 'पंच आउट का समय पंच इन से बाद का होना चाहिए।'));
        setPickerOpen(false);
        return;
      }

      if (isOverlap(proposedIn, proposedOut, sessions, sessionIdx)) {
        alert(t('Selected time range overlaps with existing attendance session.', 'चुना गया समय अंतराल अन्य सक्रिय पाली के साथ ओवरलैप करता है।'));
        setPickerOpen(false);
        return;
      }
    }

    sessions[sessionIdx] = currentSession;
    rec.sessions = sessions;
    
    // Automatically mark status as Present if hours logging
    rec.status = 'Present';

    handleUpdateRecord(empId, rec);
    setPickerOpen(false);
  };

  const addPunchSessionRow = (empId: string) => {
    const rec = { ...getRecord(empId) };
    const sessions = [...(rec.sessions || [])];
    sessions.push({ in: '', out: '' });
    rec.sessions = sessions;
    handleUpdateRecord(empId, rec);
  };

  const removePunchSessionRow = (empId: string, idx: number) => {
    const rec = { ...getRecord(empId) };
    const sessions = [...(rec.sessions || [])];
    sessions.splice(idx, 1);
    rec.sessions = sessions;
    if (sessions.length === 0) rec.status = undefined;
    handleUpdateRecord(empId, rec);
  };

  const quickMarkSimpleStatus = (empId: string, status: 'Present' | 'Absent' | 'Half Day' | 'Leave') => {
    const rec = { ...getRecord(empId) };
    rec.status = status;
    rec.sessions = []; // clear clock in simple context
    handleUpdateRecord(empId, rec);
  };

  const handleClearRecord = (empId: string) => {
    const newAttendance = { ...db.attendance };
    delete newAttendance[`${empId}_${attDate}`];

    const newOt = (db.overtimeEntries || []).filter(
      (o) => !(o.employeeId === empId && o.date === attDate)
    );
    const newLf = (db.lateFineEntries || []).filter(
      (f) => !(f.employeeId === empId && f.date === attDate)
    );

    onUpdateDb({
      ...db,
      attendance: newAttendance,
      overtimeEntries: newOt,
      lateFineEntries: newLf
    });
  };

  // Modern modal submit handlers
  const handleSaveOt = () => {
    if (!otForm) return;
    const { employeeId, date, hours, calcType, amount, description } = otForm;
    
    const numHours = parseFloat(hours) || 0;
    const numAmount = parseFloat(amount) || 0;

    const updated = [...db.overtimeEntries];
    const idx = updated.findIndex(o => o.employeeId === employeeId && o.date === date);

    if (numHours <= 0 && numAmount <= 0) {
      if (idx !== -1) {
        updated.splice(idx, 1);
      }
    } else {
      const entry: OvertimeEntry = {
        id: idx !== -1 ? updated[idx].id : 'OT_' + Math.random().toString(36).substr(2, 9),
        employeeId,
        date,
        hours: numHours,
        calcType,
        amount: calcType === 'HourlyRate' ? 0 : numAmount,
        description: description || ''
      };

      if (idx !== -1) {
        updated[idx] = entry;
      } else {
        updated.push(entry);
      }
    }

    onUpdateDb({ ...db, overtimeEntries: updated });
    setOtForm(null);
  };

  const handleSaveFine = () => {
    if (!fineForm) return;
    const { employeeId, date, hours, calcType, amount, description } = fineForm;
    
    const numHours = parseFloat(hours) || 0;
    const numAmount = parseFloat(amount) || 0;

    const updated = [...db.lateFineEntries];
    const idx = updated.findIndex(f => f.employeeId === employeeId && f.date === date);

    if (numHours <= 0 && numAmount <= 0) {
      if (idx !== -1) {
        updated.splice(idx, 1);
      }
    } else {
      const entry: LateFineEntry = {
        id: idx !== -1 ? updated[idx].id : 'LF_' + Math.random().toString(36).substr(2, 9),
        employeeId,
        date,
        hours: numHours,
        calcType,
        amount: calcType === 'HourlyRate' ? 0 : numAmount,
        description: description || ''
      };

      if (idx !== -1) {
        updated[idx] = entry;
      } else {
        updated.push(entry);
      }
    }

    onUpdateDb({ ...db, lateFineEntries: updated });
    setFineForm(null);
  };

  const handlePunchInClick = (empId: string) => {
    const rec = { ...getRecord(empId) };
    const s = rec.sessions || [];
    if (s.length === 0) {
      s.push({ in: '', out: '' });
      rec.sessions = s;
      handleUpdateRecord(empId, rec);
    }
    triggerTimePicker(empId, 0, 'in', s[0]?.in || getCurrentTimeHHmm());
  };

  const handlePunchOutClick = (empId: string) => {
    const rec = { ...getRecord(empId) };
    const s = rec.sessions || [];
    if (s.length === 0) {
      s.push({ in: '', out: '' });
      rec.sessions = s;
      handleUpdateRecord(empId, rec);
    }
    triggerTimePicker(empId, 0, 'out', s[0]?.out || getCurrentTimeHHmm());
  };

  // Grouped active staffs (no search bar used as requested)
  const allActiveEmployees = db.employees.filter(e => e.status === 'Active');
  
  const hourlyEmployees = allActiveEmployees.filter(e => e.type === 'Hourly');
  const dailyEmployees = allActiveEmployees.filter(e => e.type === 'Daily');
  const monthlyEmployees = allActiveEmployees.filter(e => e.type === 'Monthly');

  // Stats summaries
  let statsPresent = 0;
  let statsAbsent = 0;
  let statsUnmarked = 0;

  allActiveEmployees.forEach(e => {
    const r = db.attendance[`${e.id}_${attDate}`];
    if (!r) {
      statsUnmarked++;
    } else {
      if (e.type === 'Hourly') {
        const hasWork = (r.sessions || []).some((s: any) => s.in && s.out);
        if (hasWork) statsPresent++;
        else statsUnmarked++;
      } else {
        if (r.status === 'Present' || r.status === 'Half Day') statsPresent++;
        else if (r.status === 'Absent') statsAbsent++;
        else statsUnmarked++;
      }
    }
  });

  return (
    <div className="w-full select-none pb-8">
      
      {/* Title Header bar matching mockup */}
      <div className="bg-white border-b border-slate-150 p-4 flex items-center justify-between mb-4 -mx-4 shadow-3xs">
        <div className="flex items-center gap-3">
          <button
            onClick={onGoBack}
            className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-205 text-slate-550 flex items-center justify-center hover:bg-slate-100 active:scale-[0.97] transition cursor-pointer"
          >
            <Icon name="arrow_back" size={16} />
          </button>
          <h2 className="text-sm font-bold text-slate-900 leading-none">{t('Attendance', 'उपस्थिति')}</h2>
        </div>
        <button
          onClick={() => {
            setAttDate(new Date().toISOString().split('T')[0]);
            setExpandedId(null);
          }}
          className="text-xs font-semibold text-blue-600 hover:text-blue-750 transition cursor-pointer"
        >
          {t('Today', 'आज')}
        </button>
      </div>

      {/* Date Navigation Block with fixed full card opacity click overlay */}
      <div className="relative bg-white border border-slate-150 rounded-2xl p-4 shadow-2xs mb-4 flex items-center justify-between cursor-pointer hover:bg-slate-50/50 transition-all duration-200">
        
        {/* Invisible absolute overlay datepicker matching container dimensions perfectly */}
        <input
          type="date"
          value={attDate}
          max={new Date().toISOString().split('T')[0]}
          onClick={(e) => {
            try {
              if ('showPicker' in e.currentTarget) {
                (e.currentTarget as any).showPicker();
              }
            } catch (err) {}
          }}
          onChange={(e) => {
            setAttDate(e.target.value);
            setExpandedId(null);
          }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 block"
        />

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50/70 border border-blue-150 flex items-center justify-center text-blue-605 shrink-0 shadow-3xs">
            <Icon name="calendar_today" size={18} />
          </div>
          <div>
            <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block leading-none">{t('Active Date', 'पंचांग तिथि')}</span>
            <span className="text-xs font-bold text-slate-900 block mt-1.5 leading-none font-sans">
              {attDate === new Date().toISOString().split('T')[0] ? t('Today', 'आज') : formatHeaderDate(attDate)}
            </span>
          </div>
        </div>

        {/* Prevent click bubbling for navigation buttons */}
        <div className="flex items-center gap-1.5 relative z-20">
          <button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              handleDayShift(-1);
            }}
            className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-205 text-slate-600 flex items-center justify-center hover:bg-slate-100 active:scale-[0.95] transition cursor-pointer"
          >
            <Icon name="chevron_left" size={16} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              handleDayShift(1);
            }}
            disabled={attDate === new Date().toISOString().split('T')[0]}
            className={`w-8 h-8 rounded-lg text-slate-650 flex items-center justify-center border border-slate-205 active:scale-[0.95] transition cursor-pointer ${
              attDate === new Date().toISOString().split('T')[0] ? 'opacity-30 cursor-not-allowed bg-slate-100' : 'bg-slate-50 hover:bg-slate-100'
            }`}
          >
            <Icon name="chevron_right" size={16} />
          </button>
        </div>
      </div>

      {/* Attendance Stats Cards - Sleeker smaller metrics */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-emerald-50/45 border border-emerald-100/80 rounded-xl p-3 flex flex-col justify-between h-[64px] shadow-3xs">
          <span className="text-[9px] text-emerald-700/85 font-black uppercase tracking-wider block leading-none">{t('Present', 'उपस्थित')}</span>
          <span className="text-sm font-black text-emerald-700 mt-1 block leading-none font-mono">{statsPresent}</span>
        </div>
        <div className="bg-rose-50/45 border border-rose-100/80 rounded-xl p-3 flex flex-col justify-between h-[64px] shadow-3xs">
          <span className="text-[9px] text-rose-700/85 font-black uppercase tracking-wider block leading-none">{t('Absent', 'अनुपस्थित')}</span>
          <span className="text-sm font-black text-rose-700 mt-1 block leading-none font-mono">{statsAbsent}</span>
        </div>
        <div className="bg-slate-50 border border-slate-200/50 rounded-xl p-3 flex flex-col justify-between h-[64px] shadow-3xs">
          <span className="text-[9px] text-slate-500 font-black uppercase tracking-wider block leading-none">{t('Unmarked', 'बाकी')}</span>
          <span className="text-sm font-black text-slate-600 mt-1 block leading-none font-mono">{statsUnmarked}</span>
        </div>
      </div>

      {/* Grouped Lists - Compact, smaller margins, and cozy card sizes */}
      <div className="space-y-4">
        
        {/* Hourly Category Block */}
        {hourlyEmployees.length > 0 && (
          <div className="space-y-2">
            <div className="text-[9px] font-black text-slate-400 tracking-widest uppercase pl-1">
              HOURLY ({hourlyEmployees.length})
            </div>
            {hourlyEmployees.map(emp => {
              const rec = getRecord(emp.id);
              const sessions: PunchSession[] = rec.sessions || [];
              const isEmpExpanded = expandedId === emp.id;
              
              const totalHrs = sessions.reduce((sum, s) => sum + (s.in && s.out ? timeToHrs(s.in, s.out) : 0), 0);
              const session_0 = sessions[0] || { in: '', out: '' };

              return (
                <div key={emp.id} className="bg-white border border-slate-150 rounded-2xl p-4 space-y-4 shadow-2xs hover:border-slate-250 transition-all duration-200">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-50/70 border border-blue-150 flex items-center justify-center font-bold text-blue-600 text-sm uppercase overflow-hidden shrink-0 shadow-3xs">
                        {emp.pic ? (
                          <img referrerPolicy="no-referrer" src={emp.pic} alt={emp.name} className="w-full h-full object-cover" />
                        ) : (
                          emp.name.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-900 leading-tight">{emp.name}</div>
                      </div>
                    </div>
                    <div className="text-right text-[11px] font-bold text-slate-700 font-mono">
                      {(() => {
                        const empOt = db.overtimeEntries.find(o => o.employeeId === emp.id && o.date === attDate);
                        const otHrs = empOt ? empOt.hours : 0;
                        const empFine = db.lateFineEntries.find(f => f.employeeId === emp.id && f.date === attDate);
                        const fineHrs = empFine ? empFine.hours : 0;
                        
                        const baseHrsStr = formatHrsMins(totalHrs);
                        const otStr = otHrs > 0 ? ` [+ ${formatHrsMins(otHrs)}]` : '';
                        const fineStr = fineHrs > 0 ? ` [- ${formatHrsMins(fineHrs)}]` : '';
                        
                        if (totalHrs > 0 || otHrs > 0 || fineHrs > 0) {
                          return `${baseHrsStr}${otStr}${fineStr} Hrs`;
                        }
                        return '—';
                      })()}
                    </div>
                  </div>

                  {/* Operational Punch Actions inline */}
                  <div className="flex gap-2 items-center">
                    <button
                      onClick={() => handlePunchInClick(emp.id)}
                      className={`h-10 rounded-xl text-xs font-bold border flex-1 transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.97] ${
                        session_0.in
                          ? 'bg-emerald-600 border-emerald-600 text-white font-semibold shadow-3xs'
                          : 'bg-white border-slate-200 text-slate-650 hover:bg-slate-50 hover:border-slate-350'
                      }`}
                    >
                      <span>{session_0.in ? formatTimeForDisplay(session_0.in) : t('Punch In', 'पंच इन')}</span>
                    </button>
                    <button
                      onClick={() => handlePunchOutClick(emp.id)}
                      className={`h-10 rounded-xl text-xs font-bold border flex-1 transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.97] ${
                        session_0.out
                          ? 'bg-slate-900 border-slate-900 text-white font-semibold shadow-3xs'
                          : 'bg-white border-slate-200 text-slate-650 hover:bg-slate-50 hover:border-slate-350'
                      }`}
                    >
                      <span>{session_0.out ? formatTimeForDisplay(session_0.out) : t('Punch Out', 'पंच आउट')}</span>
                    </button>

                    <button
                      onClick={() => handleClearRecord(emp.id)}
                      className="w-10 h-10 rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-red-500 hover:bg-rose-50 hover:border-red-100 flex items-center justify-center cursor-pointer transition-all shrink-0 active:scale-[0.95]"
                      title={t('Clear Attendance Record', 'उपस्थिति हटाएं')}
                    >
                      <Icon name="delete" size={16} />
                    </button>

                    <button
                      onClick={() => setExpandedId(isEmpExpanded ? null : emp.id)}
                      className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 cursor-pointer transition-all active:scale-[0.95] ${
                        isEmpExpanded ? 'bg-blue-600 border-blue-600 text-white rotate-180' : 'bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100/50'
                      }`}
                    >
                      <Icon name="keyboard_arrow_down" size={16} />
                    </button>
                  </div>

                  {/* Expanded Sub-drawer: Extra punch slots & OT/Fine Buttons */}
                  {isEmpExpanded && (
                    <div className="bg-slate-50/60 p-3 rounded-2xl space-y-3 border border-slate-100/80 animate-in slide-in-from-top-2 duration-200">
                      <button
                        onClick={() => addPunchSessionRow(emp.id)}
                        className="w-full h-9 border border-blue-200 text-blue-600 bg-white hover:bg-blue-50/50 border-dashed rounded-xl flex items-center justify-center font-semibold text-xs cursor-pointer gap-1.5 transition-all active:scale-[0.98]"
                      >
                        <Icon name="add" size={14} />
                        <span>{t('Add Punch Section', 'नया पंच-इन स्लॉट जोड़ें')}</span>
                      </button>

                      {/* Display subsequent shift slots */}
                      {sessions.length > 1 && (
                        <div className="space-y-2 pt-2 border-t border-slate-200/60">
                          {sessions.slice(1).map((s, rawIdx) => {
                            const sIdx = rawIdx + 1;
                            return (
                              <div key={sIdx} className="flex items-center gap-2 bg-white p-1.5 border border-slate-200 rounded-xl">
                                <div className="w-6 h-6 rounded-lg bg-slate-100 text-slate-500 font-bold text-xs flex items-center justify-center">
                                  {sIdx + 1}
                                </div>
                                <button
                                  onClick={() => triggerTimePicker(emp.id, sIdx, 'in', s.in)}
                                  className={`flex-1 h-9 rounded-lg text-xs font-semibold border transition-all ${
                                    s.in ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200 text-slate-600'
                                  }`}
                                >
                                  <span>{s.in ? formatTimeForDisplay(s.in) : t('In Time', 'पंच इन')}</span>
                                </button>
                                <button
                                  onClick={() => triggerTimePicker(emp.id, sIdx, 'out', s.out)}
                                  className={`flex-1 h-9 rounded-lg text-xs font-semibold border transition-all ${
                                    s.out ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-550'
                                  }`}
                                >
                                  <span>{s.out ? formatTimeForDisplay(s.out) : t('Out Time', 'पंच आउट')}</span>
                                </button>
                                <button
                                  onClick={() => removePunchSessionRow(emp.id, sIdx)}
                                  className="w-9 h-9 rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-red-500 hover:bg-rose-50 flex items-center justify-center shrink-0 transition"
                                >
                                  <Icon name="delete" size={14} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Overtime & Late Fine Buttons opening dedicated mockup records */}
                      <div className="flex gap-2 pt-2 border-t border-slate-200/50">
                        <button
                          onClick={() => {
                            const existing = db.overtimeEntries.find(o => o.employeeId === emp.id && o.date === attDate);
                            setOtForm({
                              isOpen: true,
                              employeeId: emp.id,
                              employeeName: emp.name,
                              date: attDate,
                              hours: existing ? String(existing.hours || '') : '',
                              calcType: existing ? existing.calcType : 'HourlyRate',
                              amount: existing ? String(existing.amount || '') : '',
                              description: existing ? existing.description : 'Overtime'
                            });
                          }}
                          className="flex-1 h-9 rounded-xl border border-blue-200 text-blue-605 bg-blue-50/50 hover:bg-blue-100/50 font-bold text-xs flex items-center justify-center gap-1 active:scale-[0.98] transition cursor-pointer"
                        >
                          <Icon name="schedule" size={14} />
                          <span>{t('+ Overtime', '+ ओवरटाइम')}</span>
                        </button>
                        <button
                          onClick={() => {
                            const existing = db.lateFineEntries.find(f => f.employeeId === emp.id && f.date === attDate);
                            setFineForm({
                              isOpen: true,
                              employeeId: emp.id,
                              employeeName: emp.name,
                              date: attDate,
                              hours: existing ? String(existing.hours || '') : '',
                              calcType: existing ? existing.calcType : 'HourlyRate',
                              amount: existing ? String(existing.amount || '') : '',
                              description: existing ? existing.description : 'Late arrival'
                            });
                          }}
                          className="flex-1 h-9 rounded-xl border border-rose-200 text-rose-600 bg-rose-50/50 hover:bg-rose-100/50 font-bold text-xs flex items-center justify-center gap-1 active:scale-[0.98] transition cursor-pointer"
                        >
                          <Icon name="warning" size={14} />
                          <span>{t('+ Late Fine', '+ लेट फाइन')}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Daily Category Block */}
        {dailyEmployees.length > 0 && (
          <div className="space-y-2">
            <div className="text-[9px] font-black text-slate-400 tracking-widest uppercase pl-1">
              DAILY ({dailyEmployees.length})
            </div>
            {dailyEmployees.map(emp => {
              const rec = getRecord(emp.id);
              const isEmpExpanded = expandedId === emp.id;

              return (
                <div key={emp.id} className="bg-white border border-slate-150 rounded-2xl p-4 space-y-4 shadow-2xs hover:border-slate-250 transition-all duration-200">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-50/70 border border-blue-150 flex items-center justify-center font-bold text-blue-600 text-sm uppercase overflow-hidden shrink-0 shadow-3xs">
                        {emp.pic ? (
                          <img referrerPolicy="no-referrer" src={emp.pic} alt={emp.name} className="w-full h-full object-cover" />
                        ) : (
                          emp.name.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-900 leading-tight">{emp.name}</div>
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      {(() => {
                        const empOt = db.overtimeEntries.find(o => o.employeeId === emp.id && o.date === attDate);
                        const otHrs = empOt ? empOt.hours : 0;
                        const empFine = db.lateFineEntries.find(f => f.employeeId === emp.id && f.date === attDate);
                        const fineHrs = empFine ? empFine.hours : 0;
                        
                        const statusText = rec.status 
                          ? (rec.status === 'Present' ? t('Present', 'उपस्थित') : rec.status === 'Half Day' ? t('Half Day', 'आधा दिन') : t('Absent', 'अनुपस्थित'))
                          : t('Not Marked', 'बिना चिह्नित');
                          
                        const otStr = otHrs > 0 ? ` [+ ${formatHrsMins(otHrs)}]` : '';
                        const fineStr = fineHrs > 0 ? ` [- ${formatHrsMins(fineHrs)}]` : '';
                        
                        return (
                          <div className={`text-[11px] font-bold leading-tight ${
                            rec.status === 'Present' ? 'text-emerald-700' :
                            rec.status === 'Half Day' ? 'text-amber-700' :
                            rec.status === 'Absent' ? 'text-rose-700' :
                            'text-slate-400'
                          }`}>
                            {statusText}{otStr}{fineStr} {(otHrs > 0 || fineHrs > 0) ? 'Hrs' : ''}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Actions Area with status selections */}
                  <div className="flex gap-2 items-center">
                    {(['Present', 'Half Day', 'Absent'] as const).map(style => {
                      const isSel = rec.status === (style === 'Half Day' ? 'Half Day' : style);
                      const displayTitle = style === 'Present' ? t('Present', 'उपस्थित') : style === 'Half Day' ? t('HD', 'आधा दिन') : t('Absent', 'अनुपस्थित');
                      
                      let selectStyle = 'bg-white border-slate-205 text-slate-650 hover:bg-slate-50 hover:border-slate-350';
                      if (isSel) {
                        if (style === 'Present') selectStyle = 'bg-emerald-50 border-emerald-500 text-emerald-700 font-bold shadow-3xs';
                        else if (style === 'Half Day') selectStyle = 'bg-amber-50 border-amber-500 text-amber-700 font-bold shadow-3xs';
                        else selectStyle = 'bg-rose-50 border-rose-500 text-rose-700 font-bold shadow-3xs';
                      }

                      return (
                        <button
                          key={style}
                          onClick={() => quickMarkSimpleStatus(emp.id, style as any)}
                          className={`h-10 rounded-xl text-xs font-bold border flex-1 cursor-pointer transition-all active:scale-[0.97] ${selectStyle}`}
                        >
                          {displayTitle}
                        </button>
                      );
                    })}

                    <button
                      onClick={() => handleClearRecord(emp.id)}
                      className="w-10 h-10 rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-red-500 hover:bg-rose-50 flex items-center justify-center cursor-pointer transition-all shrink-0 active:scale-[0.95]"
                    >
                      <Icon name="delete" size={16} />
                    </button>

                    <button
                      onClick={() => setExpandedId(isEmpExpanded ? null : emp.id)}
                      className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 cursor-pointer transition-all active:scale-[0.95] ${
                        isEmpExpanded ? 'bg-blue-600 border-blue-600 text-white rotate-180' : 'bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100/50'
                      }`}
                    >
                      <Icon name="keyboard_arrow_down" size={16} />
                    </button>
                  </div>

                  {/* Expanded Sub-drawer */}
                  {isEmpExpanded && (
                    <div className="bg-slate-50/60 p-3 rounded-2xl flex gap-2 border border-slate-100 animate-in slide-in-from-top-2 duration-200">
                      <button
                        onClick={() => {
                          const existing = db.overtimeEntries.find(o => o.employeeId === emp.id && o.date === attDate);
                          setOtForm({
                            isOpen: true,
                            employeeId: emp.id,
                            employeeName: emp.name,
                            date: attDate,
                            hours: existing ? String(existing.hours || '') : '',
                            calcType: existing ? existing.calcType : 'HourlyRate',
                            amount: existing ? String(existing.amount || '') : '',
                            description: existing ? existing.description : 'Overtime'
                          });
                        }}
                        className="flex-1 h-9 rounded-xl border border-blue-200 text-blue-605 bg-blue-50/50 hover:bg-blue-100/50 font-bold text-xs flex items-center justify-center gap-1 active:scale-[0.98] transition cursor-pointer"
                      >
                        <Icon name="schedule" size={14} />
                        <span>{t('+ Overtime', '+ overtime')}</span>
                      </button>
                      <button
                        onClick={() => {
                          const existing = db.lateFineEntries.find(f => f.employeeId === emp.id && f.date === attDate);
                          setFineForm({
                            isOpen: true,
                            employeeId: emp.id,
                            employeeName: emp.name,
                            date: attDate,
                            hours: existing ? String(existing.hours || '') : '',
                            calcType: existing ? existing.calcType : 'HourlyRate',
                            amount: existing ? String(existing.amount || '') : '',
                            description: existing ? existing.description : 'Late arrival'
                          });
                        }}
                        className="flex-1 h-9 rounded-xl border border-rose-200 text-rose-600 bg-rose-50/50 hover:bg-rose-100/50 font-bold text-xs flex items-center justify-center gap-1 active:scale-[0.98] transition cursor-pointer"
                      >
                        <Icon name="warning" size={14} />
                        <span>{t('+ Late Fine', '+ लेट फाइन')}</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Monthly Category Block */}
        {monthlyEmployees.length > 0 && (
          <div className="space-y-2">
            <div className="text-[9px] font-black text-slate-400 tracking-widest uppercase pl-1">
              MONTHLY ({monthlyEmployees.length})
            </div>
            {monthlyEmployees.map(emp => {
              const rec = getRecord(emp.id);
              const isEmpExpanded = expandedId === emp.id;

              return (
                <div key={emp.id} className="bg-white border border-slate-150 rounded-2xl p-4 space-y-4 shadow-2xs hover:border-slate-250 transition-all duration-200">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-50/70 border border-blue-150 flex items-center justify-center font-bold text-blue-600 text-sm uppercase overflow-hidden shrink-0 shadow-3xs">
                        {emp.pic ? (
                          <img referrerPolicy="no-referrer" src={emp.pic} alt={emp.name} className="w-full h-full object-cover" />
                        ) : (
                          emp.name.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-900 leading-tight">{emp.name}</div>
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      {(() => {
                        const empOt = db.overtimeEntries.find(o => o.employeeId === emp.id && o.date === attDate);
                        const otHrs = empOt ? empOt.hours : 0;
                        const empFine = db.lateFineEntries.find(f => f.employeeId === emp.id && f.date === attDate);
                        const fineHrs = empFine ? empFine.hours : 0;
                        
                        const statusText = rec.status 
                          ? (rec.status === 'Present' ? t('Present', 'उपस्थित') : rec.status === 'Half Day' ? t('Half Day', 'आधा दिन') : t('Absent', 'अनुपस्थित'))
                          : t('Not Marked', 'बिना चिह्नित');
                          
                        const otStr = otHrs > 0 ? ` [+ ${formatHrsMins(otHrs)}]` : '';
                        const fineStr = fineHrs > 0 ? ` [- ${formatHrsMins(fineHrs)}]` : '';
                        
                        return (
                          <div className={`text-[11px] font-bold leading-tight ${
                            rec.status === 'Present' ? 'text-emerald-700' :
                            rec.status === 'Half Day' ? 'text-amber-700' :
                            rec.status === 'Absent' ? 'text-rose-700' :
                            'text-slate-400'
                          }`}>
                            {statusText}{otStr}{fineStr} {(otHrs > 0 || fineHrs > 0) ? 'Hrs' : ''}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Actions Area with status selections */}
                  <div className="flex gap-2 items-center">
                    {(['Present', 'Half Day', 'Absent'] as const).map(style => {
                      const isSel = rec.status === (style === 'Half Day' ? 'Half Day' : style);
                      const displayTitle = style === 'Present' ? t('Present', 'उपस्थित') : style === 'Half Day' ? t('HD', 'आधा दिन') : t('Absent', 'अनुपस्थित');
                      
                      let selectStyle = 'bg-white border-slate-205 text-slate-650 hover:bg-slate-50 hover:border-slate-350';
                      if (isSel) {
                        if (style === 'Present') selectStyle = 'bg-emerald-50 border-emerald-500 text-emerald-700 font-bold shadow-3xs';
                        else if (style === 'Half Day') selectStyle = 'bg-amber-50 border-amber-500 text-amber-700 font-bold shadow-3xs';
                        else selectStyle = 'bg-rose-50 border-rose-500 text-rose-700 font-bold shadow-3xs';
                      }

                      return (
                        <button
                          key={style}
                          onClick={() => quickMarkSimpleStatus(emp.id, style as any)}
                          className={`h-10 rounded-xl text-xs font-bold border flex-1 cursor-pointer transition-all active:scale-[0.97] ${selectStyle}`}
                        >
                          {displayTitle}
                        </button>
                      );
                    })}

                    <button
                      onClick={() => handleClearRecord(emp.id)}
                      className="w-10 h-10 rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-red-500 hover:bg-rose-50 flex items-center justify-center cursor-pointer transition-all shrink-0 active:scale-[0.95]"
                    >
                      <Icon name="delete" size={16} />
                    </button>

                    <button
                      onClick={() => setExpandedId(isEmpExpanded ? null : emp.id)}
                      className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 cursor-pointer transition-all active:scale-[0.95] ${
                        isEmpExpanded ? 'bg-blue-600 border-blue-600 text-white rotate-180' : 'bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100/50'
                      }`}
                    >
                      <Icon name="keyboard_arrow_down" size={16} />
                    </button>
                  </div>

                  {/* Expanded Sub-drawer */}
                  {isEmpExpanded && (
                    <div className="bg-slate-50/60 p-3 rounded-2xl flex gap-2 border border-slate-100 animate-in slide-in-from-top-2 duration-200">
                      <button
                        onClick={() => {
                          const existing = db.overtimeEntries.find(o => o.employeeId === emp.id && o.date === attDate);
                          setOtForm({
                            isOpen: true,
                            employeeId: emp.id,
                            employeeName: emp.name,
                            date: attDate,
                            hours: existing ? String(existing.hours || '') : '',
                            calcType: existing ? existing.calcType : 'HourlyRate',
                            amount: existing ? String(existing.amount || '') : '',
                            description: existing ? existing.description : 'Overtime'
                          });
                        }}
                        className="flex-1 h-9 rounded-xl border border-blue-200 text-blue-605 bg-blue-50/50 hover:bg-blue-100/50 font-bold text-xs flex items-center justify-center gap-1 active:scale-[0.98] transition cursor-pointer"
                      >
                        <Icon name="schedule" size={14} />
                        <span>{t('+ Overtime', '+ overtime')}</span>
                      </button>
                      <button
                        onClick={() => {
                          const existing = db.lateFineEntries.find(f => f.employeeId === emp.id && f.date === attDate);
                          setFineForm({
                            isOpen: true,
                            employeeId: emp.id,
                            employeeName: emp.name,
                            date: attDate,
                            hours: existing ? String(existing.hours || '') : '',
                            calcType: existing ? existing.calcType : 'HourlyRate',
                            amount: existing ? String(existing.amount || '') : '',
                            description: existing ? existing.description : 'Late arrival'
                          });
                        }}
                        className="flex-1 h-9 rounded-xl border border-rose-200 text-rose-600 bg-rose-50/50 hover:bg-rose-100/50 font-bold text-xs flex items-center justify-center gap-1 active:scale-[0.98] transition cursor-pointer"
                      >
                        <Icon name="warning" size={14} />
                        <span>{t('+ Late Fine', '+ लेट फाइन')}</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Global Fallback when everything is empty */}
        {allActiveEmployees.length === 0 && (
          <p className="text-center p-8 bg-white border border-slate-150 rounded-2xl text-slate-450 text-xs font-medium">
            {t('No active staff registered.', 'कोई भी सक्रिय कर्मचारी पंजीकृत नहीं है।')}
          </p>
        )}
      </div>

      {/* =========================================================================
                                OVERTIME (OT) RECORD MODAL
         ========================================================================= */}
      {otForm && otForm.isOpen && (() => {
        const numOtHours = parseFloat(otForm.hours) || 0;
        const otH = Math.floor(numOtHours);
        const otM = Math.round((numOtHours - otH) * 60);
        const otHourlyRate = getHourlyRateForDate(otForm.employeeId, otForm.date);
        const computedOtAmount = otHourlyRate * numOtHours;
        const finalOtAmount = otForm.calcType === 'HourlyRate' ? computedOtAmount : (parseFloat(otForm.amount) || 0);

        return (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
            <div className="bg-white/95 border border-slate-100 rounded-3xl w-full max-w-[340px] p-5 shadow-2xl relative space-y-4 max-h-[95vh] overflow-y-auto animate-in zoom-in-95 duration-200">
              
              {/* Header */}
              <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-900 tracking-wider uppercase">
                  {t('OVERTIME (OT) RECORD', 'ओवरटाइम (OT) रिकॉर्ड')}
                </span>
                <button
                  onClick={() => setOtForm(null)}
                  className="text-slate-400 hover:text-slate-600 font-bold text-sm transition cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Employee Name indicator */}
              <div className="bg-slate-50 border border-slate-200/50 rounded-xl px-3.5 py-2.5 flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('STAFF', 'कर्मचारी')}</span>
                <span className="text-xs font-bold text-slate-900">{otForm.employeeName}</span>
              </div>

              {/* Date picker */}
              <div className="space-y-1.5 relative">
                <label className="text-[10px] font-bold text-slate-500 tracking-wider uppercase">{t('DATE *', 'तारीख *')}</label>
                <div className="relative border border-slate-200 rounded-xl px-3 h-10 bg-slate-50/50 flex justify-between items-center cursor-pointer">
                  <span className="text-xs font-bold text-slate-900 font-sans">{otForm.date}</span>
                  <Icon name="calendar_today" size={14} className="text-slate-450" />
                  <input
                    type="date"
                    value={otForm.date}
                    onChange={(e) => setOtForm({ ...otForm, date: e.target.value })}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                </div>
              </div>

              {/* Duration picker inline */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 tracking-wider uppercase">{t('OVERTIME DURATION *', 'ओवरटाइम अवधि *')}</label>
                <InlineDurationPicker 
                  hours={otH}
                  minutes={otM}
                  onChange={(h, m) => {
                    const decimalHours = h + (m / 60);
                    setOtForm({ ...otForm, hours: String(decimalHours) });
                  }}
                />
              </div>

              {/* Calculation Type Toggle */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 tracking-wider uppercase">{t('CALCULATION TYPE *', 'गणना प्रकार *')}</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setOtForm({ ...otForm, calcType: 'HourlyRate' })}
                    className={`h-9 rounded-xl text-xs font-semibold border flex items-center justify-center transition-all cursor-pointer ${
                      otForm.calcType === 'HourlyRate'
                        ? 'bg-blue-600 border-blue-600 text-white shadow-3xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {t('Hourly Rate', 'घंटा दर')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOtForm({ ...otForm, calcType: 'CustomAmount' })}
                    className={`h-9 rounded-xl text-xs font-semibold border flex items-center justify-center transition-all cursor-pointer ${
                      otForm.calcType === 'CustomAmount'
                        ? 'bg-blue-600 border-blue-600 text-white shadow-3xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {t('Custom Cash', 'कस्टम नगद')}
                  </button>
                </div>
              </div>

              {/* Custom Cash Amount field */}
              {otForm.calcType === 'CustomAmount' && (
                <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-150">
                  <label className="text-[10px] font-bold text-slate-500 tracking-wider uppercase">{t('CUSTOM AMOUNT (₹) *', 'कस्टम राशि (₹) *')}</label>
                  <input
                    type="number"
                    value={otForm.amount}
                    onChange={(e) => setOtForm({ ...otForm, amount: e.target.value })}
                    placeholder="e.g. 500"
                    className="w-full h-10 px-3 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 bg-white outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/8 transition-all font-sans"
                  />
                </div>
              )}

              {/* Description Form Group */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 tracking-wider uppercase">{t('DESCRIPTION', 'विवरण')}</label>
                <input
                  type="text"
                  value={otForm.description}
                  onChange={(e) => setOtForm({ ...otForm, description: e.target.value })}
                  placeholder="e.g. Extra evening shift"
                  className="w-full h-10 px-3 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 bg-white outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/8 transition-all font-sans"
                />
              </div>

              {/* Live Preview Card */}
              <div className="bg-blue-50/45 border border-blue-100/60 rounded-2xl p-3 space-y-1.5 my-1">
                <div className="flex justify-between items-center text-[10px] font-black text-blue-805 tracking-wider">
                  <span>{t('LIVE PREVIEW', 'लाइव समीक्षा')}</span>
                  <span>₹{otHourlyRate.toFixed(2)}/hr</span>
                </div>
                <div className="flex justify-between items-center text-[11px] text-slate-600">
                  <span>{t('Overtime Duration :', 'ओवरटाइम अवधि :')}</span>
                  <span className="font-semibold text-slate-800 font-sans">{otH}h {otM}m</span>
                </div>
                <div className="h-[0.5px] bg-blue-100/50 my-1"></div>
                <div className="flex justify-between items-center text-[11px] font-bold pt-0.5">
                  <span className="text-blue-805">{t('Overtime Amount :', 'ओवरटाइम राशि :')}</span>
                   <span className="text-xs text-blue-900 font-extrabold">{formatCurrency(finalOtAmount)}</span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2.5 pt-1 text-xs font-semibold">
                <button
                  onClick={() => setOtForm(null)}
                  className="flex-grow h-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-650 font-bold active:scale-[0.97] transition-all cursor-pointer"
                >
                  {t('Cancel', 'रद्द करें')}
                </button>
                <button
                  onClick={handleSaveOt}
                  className="flex-grow h-10 rounded-xl bg-blue-600 hover:bg-blue-750 text-white font-bold active:scale-[0.97] transition-all cursor-pointer shadow-xs"
                >
                  {t('Save', 'सुरक्षित करें')}
                </button>
              </div>

            </div>
          </div>
        );
      })()}

      {/* =========================================================================
                               LATE FINE RECORD MODAL
         ========================================================================= */}
      {fineForm && fineForm.isOpen && (() => {
        const numLfHours = parseFloat(fineForm.hours) || 0;
        const lfH = Math.floor(numLfHours);
        const lfM = Math.round((numLfHours - lfH) * 60);
        const lfHourlyRate = getHourlyRateForDate(fineForm.employeeId, fineForm.date);
        const computedLfAmount = lfHourlyRate * numLfHours;
        const finalLfAmount = fineForm.calcType === 'HourlyRate' ? computedLfAmount : (parseFloat(fineForm.amount) || 0);

        return (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
            <div className="bg-white/95 border border-slate-100 rounded-3xl w-full max-w-[340px] p-5 shadow-2xl relative space-y-4 max-h-[95vh] overflow-y-auto animate-in zoom-in-95 duration-200">
              
              {/* Header */}
              <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                <span className="text-xs font-bold text-rose-800 tracking-wider uppercase">
                  {t('LATE FINE RECORD', 'लेट फाइन रिकॉर्ड')}
                </span>
                <button
                  onClick={() => setFineForm(null)}
                  className="text-slate-400 hover:text-slate-600 font-bold text-sm transition cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Employee Name Indicator */}
              <div className="bg-slate-50 border border-slate-200/50 rounded-xl px-3.5 py-2.5 flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t('STAFF', 'कर्मचारी')}</span>
                <span className="text-xs font-bold text-slate-900">{fineForm.employeeName}</span>
              </div>

              {/* Date picker */}
              <div className="space-y-1.5 relative">
                <label className="text-[10px] font-bold text-slate-500 tracking-wider uppercase">{t('DATE *', 'तारीख *')}</label>
                <div className="relative border border-slate-200 rounded-xl px-3 h-10 bg-slate-50/50 flex justify-between items-center cursor-pointer">
                  <span className="text-xs font-bold text-slate-900 font-sans">{fineForm.date}</span>
                  <Icon name="calendar_today" size={14} className="text-slate-450" />
                  <input
                    type="date"
                    value={fineForm.date}
                    onChange={(e) => setFineForm({ ...fineForm, date: e.target.value })}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                </div>
              </div>

              {/* Late Hours Picker */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 tracking-wider uppercase">{t('LATE DURATION *', 'देरी अवधि *')}</label>
                <InlineDurationPicker 
                  hours={lfH}
                  minutes={lfM}
                  onChange={(h, m) => {
                    const decimalHours = h + (m / 60);
                    setFineForm({ ...fineForm, hours: String(decimalHours) });
                  }}
                />
              </div>

              {/* Calculation Type Toggle */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 tracking-wider uppercase">{t('CALCULATION TYPE *', 'गणना प्रकार *')}</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFineForm({ ...fineForm, calcType: 'HourlyRate' })}
                    className={`h-9 rounded-xl text-xs font-semibold border flex items-center justify-center transition-all cursor-pointer ${
                      fineForm.calcType === 'HourlyRate'
                        ? 'bg-rose-600 border-rose-600 text-white shadow-3xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {t('Hourly Rate', 'घंटा दर')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFineForm({ ...fineForm, calcType: 'CustomAmount' })}
                    className={`h-9 rounded-xl text-xs font-semibold border flex items-center justify-center transition-all cursor-pointer ${
                      fineForm.calcType === 'CustomAmount'
                        ? 'bg-rose-600 border-rose-600 text-white shadow-3xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {t('Custom Cash', 'कस्टम नगद')}
                  </button>
                </div>
              </div>

              {/* Custom Cash Amount field */}
              {fineForm.calcType === 'CustomAmount' && (
                <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-150">
                  <label className="text-[10px] font-bold text-slate-500 tracking-wider uppercase">{t('CUSTOM AMOUNT (₹) *', 'कस्टम राशि (₹) *')}</label>
                  <input
                    type="number"
                    value={fineForm.amount}
                    onChange={(e) => setFineForm({ ...fineForm, amount: e.target.value })}
                    placeholder="e.g. 100"
                    className="w-full h-10 px-3 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 bg-white outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/8 transition-all font-sans"
                  />
                </div>
              )}

              {/* Description Form Group */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 tracking-wider uppercase">{t('DESCRIPTION', 'विवरण')}</label>
                <input
                  type="text"
                  value={fineForm.description}
                  onChange={(e) => setFineForm({ ...fineForm, description: e.target.value })}
                  placeholder="e.g. Late arrival"
                  className="w-full h-10 px-3 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 bg-white outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/8 transition-all font-sans"
                />
              </div>

              {/* Live Preview Card */}
              <div className="bg-rose-50/45 border border-rose-100/60 rounded-2xl p-3 space-y-1.5 my-1">
                <div className="flex justify-between items-center text-[10px] font-black text-rose-800 tracking-wider">
                  <span>{t('LIVE PREVIEW', 'लाइव समीक्षा')}</span>
                  <span>₹{lfHourlyRate.toFixed(2)}/hr</span>
                </div>
                <div className="flex justify-between items-center text-[11px] text-slate-600">
                  <span>{t('Late Duration :', 'देरी अवधि :')}</span>
                  <span className="font-semibold text-slate-800 font-sans">{lfH}h {lfM}m</span>
                </div>
                <div className="h-[0.5px] bg-rose-100/50 my-1"></div>
                <div className="flex justify-between items-center text-[11px] font-bold pt-0.5">
                  <span className="text-rose-805">{t('Fine Amount :', 'जुर्माना राशि :')}</span>
                   <span className="text-xs text-rose-900 font-extrabold">{formatCurrency(finalLfAmount)}</span>
                </div>
              </div>

              {/* Footer Actions */}
              <div className="flex gap-2 pt-1 text-xs">
                <button
                  onClick={() => setFineForm(null)}
                  className="flex-1 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-bold active:scale-[0.98] transition-all cursor-pointer"
                >
                  {t('Cancel', 'रद्द करें')}
                </button>
                <button
                  onClick={handleSaveFine}
                  className="flex-1 h-9 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold active:scale-[0.98] transition-all cursor-pointer shadow-sm"
                >
                  {t('Save', 'सुरक्षित करें')}
                </button>
              </div>

            </div>
          </div>
        );
      })()}

      {pickerOpen && pickerMeta && (
        <TimeWheelPicker
          isOpen={pickerOpen}
          onClose={() => setPickerOpen(false)}
          title={new Date(attDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          initialValue={pickerMeta.initialVal}
          onSave={saveTimePickerValue}
        />
      )}

    </div>
  );
}
