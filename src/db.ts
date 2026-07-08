import { 
  AppDatabase, Employee, EmployeeType, EmployeeStatus, 
  PaymentMode, CalcType, Payment, Earning, Deduction, 
  OvertimeEntry, LateFineEntry, AttendanceRecord, PunchSession 
} from './types';

// Seed Initial Data
export const DEFAULT_DATABASE: AppDatabase = {
  employees: [],
  attendance: {},
  payments: [],
  earnings: [],
  deductions: [],
  overtimeEntries: [],
  lateFineEntries: [],
  company: {
    name: 'Shree Kamdhenu',
    orgName: 'Kamdhenu Trust',
    ownerName: '',
    mobile: '',
    email: '',
    address: '',
    logo: '',
    gstNumber: '',
    regNumber: '',
    website: 'https://shreekamdhenu.in',
    notes: 'Pious cow shelter and welfare administration.',
    enablePunchIO: true,
    enableLocation: true,
    enableSelfie: false,
    geoRadius: '100 Meter',
    defaultCycle: '1st to End of Month',
    calcMonthlyWage: 'Prorated by attendance days',
    calcDailyWage: 'Present vs Half Day vs Absent',
    calcHourlyWage: 'Hourly rate * Hours logged',
    allowAdvance: true,
    allowExtraEarnings: true,
    allowDeductions: true,
    allowOvertime: true,
    theme: 'Light',
    adminPin: '' // Initialized empty
  }
};


export function loadDatabase(): AppDatabase {
  try {
    const data = localStorage.getItem('skbg_database_v3');
    if (data) {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object' && parsed.employees) {
        // Provide backup defaults if loaded data does not have company
        const loadedCompany = parsed.company || DEFAULT_DATABASE.company;
        return {
          employees: parsed.employees || [],
          attendance: parsed.attendance || {},
          payments: parsed.payments || [],
          earnings: parsed.earnings || [],
          deductions: parsed.deductions || [],
          overtimeEntries: parsed.overtimeEntries || [],
          lateFineEntries: parsed.lateFineEntries || [],
          company: loadedCompany
        };
      }
    }
  } catch (e) {
    console.error('Failed to load local database', e);
  }
  saveDatabase(DEFAULT_DATABASE);
  return DEFAULT_DATABASE;
}

export function saveDatabase(db: AppDatabase) {
  try {
    localStorage.setItem('skbg_database_v3', JSON.stringify(db));
  } catch (e) {
    console.error('Failed to save to localStorage', e);
  }
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function toMin(t: string): number {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function timeToHrs(inT: string, outT: string): number {
  if (!inT || !outT) return 0;
  let diff = toMin(outT) - toMin(inT);
  return diff > 0 ? diff / 60 : 0;
}

export function isOverlap(newIn: string, newOut: string, existing: PunchSession[], currIdx: number): boolean {
  const start = toMin(newIn);
  const end = toMin(newOut);
  for (let i = 0; i < existing.length; i++) {
    if (i === currIdx) continue;
    const s = existing[i];
    if (!s.in || !s.out) continue;
    const sStart = toMin(s.in);
    const sEnd = toMin(s.out);
    if (start < sEnd && end > sStart) {
      return true;
    }
  }
  return false;
}

export function getRateForMonth(emp: Employee, year: number, month: number): number {
  const targetYm = `${year}-${String(month + 1).padStart(2, '0')}`;
  const sorted = [...(emp.salHistory || [])].sort((a, b) => a.ym.localeCompare(b.ym));
  if (!sorted.length) return 0;
  let rate = sorted[0].rate;
  for (const h of sorted) {
    if (h.ym <= targetYm) {
      rate = h.rate;
    }
  }
  return rate;
}

export function getHourlyRate(employee: Employee, baseSalary: number, daysInMonth: number): number {
  const normBaseHours = employee.baseHours || 8;
  if (employee.type === 'Hourly') {
    return baseSalary; // Salary rate for hourly is rate per hour
  } else if (employee.type === 'Daily') {
    return baseSalary / normBaseHours;
  } else { // Monthly
    const dailyWage = baseSalary / 30; // Base rate calculation on exactly 30 days for all months
    return dailyWage / normBaseHours;
  }
}

export interface MonthBreakdown {
  rate: number;
  earnedSalary: number;
  overtime: number;
  extraEarnings: number;
  deductions: number;
  payments: number;
  netPending: number;
  attendanceCounts: {
    present: number;
    absent: number;
    halfDay: number;
    leave: number;
    totalMarked: number;
  };
  details: {
    earningsRows: Array<{ date: string; value: number; label: string }>;
    overtimeRows: Array<{ date: string; amount: number; hours: number; desc: string }>;
    extraEarningsRows: Array<{ date: string; amount: number; desc: string }>;
    deductionsRows: Array<{ date: string; amount: number; desc: string }>;
    paymentsRows: Array<{ date: string; amount: number; mode: PaymentMode; desc: string }>;
  };
}

export function calcMonthMetrics(
  employee: Employee,
  year: number,
  month: number,
  db: AppDatabase
): MonthBreakdown {
  const daysCount = getDaysInMonth(year, month);
  const baseSalary = getRateForMonth(employee, year, month);
  const hourlyRate = getHourlyRate(employee, baseSalary, daysCount);

  let present = 0;
  let absent = 0;
  let halfDay = 0;
  let leave = 0;
  let totalMarked = 0;

  const earningsRows: Array<{ date: string; value: number; label: string }> = [];
  let earnedSalary = 0;

  if (employee.type === 'Hourly') {
    for (let d = 1; d <= daysCount; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const rec = db.attendance[`${employee.id}_${dateStr}`];
      if (rec) {
        totalMarked++;
        const sessions = rec.sessions || [];
        let dayHrs = 0;
        sessions.forEach(s => {
          if (s.in && s.out) dayHrs += timeToHrs(s.in, s.out);
        });
        const dayEarned = dayHrs * baseSalary;
        earnedSalary += dayEarned;
        if (dayHrs > 0) {
          present++;
          earningsRows.push({
            date: dateStr,
            value: dayEarned,
            label: `${dayHrs.toFixed(2)} hrs worked @ ₹${baseSalary}/hr`
          });
        }
      }
    }
  } else if (employee.type === 'Daily') {
    for (let d = 1; d <= daysCount; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const rec = db.attendance[`${employee.id}_${dateStr}`];
      if (rec) {
        totalMarked++;
        if (rec.status === 'Present') {
          present++;
          earnedSalary += baseSalary;
          earningsRows.push({
            date: dateStr,
            value: baseSalary,
            label: `Present @ ₹${baseSalary}/day`
          });
        } else if (rec.status === 'Half Day') {
          halfDay++;
          const hdValue = baseSalary * 0.5;
          earnedSalary += hdValue;
          earningsRows.push({
            date: dateStr,
            value: hdValue,
            label: `Half Day @ ₹${baseSalary}/day`
          });
        } else if (rec.status === 'Absent') {
          absent++;
        }
      }
    }
  } else { // Monthly
    const perDayRate = baseSalary / 30; // standard 30 base days
    let presentDaysCount = 0;
    
    for (let d = 1; d <= daysCount; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

      const rec = db.attendance[`${employee.id}_${dateStr}`];
      if (rec) {
        totalMarked++;
        if (rec.status === 'Present') {
          present++;
          presentDaysCount += 1.0;
        } else if (rec.status === 'Half Day') {
          halfDay++;
          presentDaysCount += 0.5;
        } else if (rec.status === 'Absent') {
          absent++;
        } else if (rec.status === 'Leave') {
          leave++;
        }
      }
    }
    
    earnedSalary = presentDaysCount * perDayRate;
    if (presentDaysCount > 0) {
      earningsRows.push({
        date: `${year}-${String(month + 1).padStart(2, '0')}`,
        value: earnedSalary,
        label: `${presentDaysCount} Earned Days @ ₹${Math.round(perDayRate)}/day (Base: ₹${baseSalary}/mo)`
      });
    }
  }

  // Overtimes
  let overtime = 0;
  const overtimeRows: Array<{ date: string; amount: number; hours: number; desc: string }> = [];
  db.overtimeEntries.forEach(otEntry => {
    if (otEntry.employeeId === employee.id) {
      const oDate = new Date(otEntry.date + 'T00:00:00');
      if (oDate.getFullYear() === year && oDate.getMonth() === month) {
        const amt = otEntry.calcType === 'HourlyRate' 
          ? otEntry.hours * hourlyRate 
          : otEntry.amount;
        overtime += amt;
        overtimeRows.push({
          date: otEntry.date,
          amount: amt,
          hours: otEntry.hours,
          desc: otEntry.description || `Overtime for ${otEntry.hours} hrs`
        });
      }
    }
  });

  // Extra Earnings
  let extraEarnings = 0;
  const extraEarningsRows: Array<{ date: string; amount: number; desc: string }> = [];
  db.earnings.forEach(earn => {
    if (earn.employeeId === employee.id) {
      const eDate = new Date(earn.date + 'T00:00:00');
      if (eDate.getFullYear() === year && eDate.getMonth() === month) {
        extraEarnings += earn.amount;
        extraEarningsRows.push({
          date: earn.date,
          amount: earn.amount,
          desc: earn.description
        });
      }
    }
  });

  // Deductions + Late Fines
  let deductions = 0;
  const deductionsRows: Array<{ date: string; amount: number; desc: string }> = [];
  db.deductions.forEach(ded => {
    if (ded.employeeId === employee.id) {
      const dDate = new Date(ded.date + 'T00:00:00');
      if (dDate.getFullYear() === year && dDate.getMonth() === month) {
        deductions += ded.amount;
        deductionsRows.push({
          date: ded.date,
          amount: ded.amount,
          desc: ded.description
        });
      }
    }
  });

  db.lateFineEntries.forEach(fine => {
    if (fine.employeeId === employee.id) {
      const fDate = new Date(fine.date + 'T00:00:00');
      if (fDate.getFullYear() === year && fDate.getMonth() === month) {
        const amt = fine.calcType === 'HourlyRate' 
          ? fine.hours * hourlyRate 
          : fine.amount;
        deductions += amt;
        deductionsRows.push({
          date: fine.date,
          amount: amt,
          desc: `Late Fine: ${fine.description}`
        });
      }
    }
  });

  // Payments
  let payments = 0;
  const paymentsRows: Array<{ date: string; amount: number; mode: PaymentMode; desc: string }> = [];
  db.payments.forEach(pay => {
    if (pay.employeeId === employee.id) {
      const pDate = new Date(pay.date + 'T00:00:00');
      if (pDate.getFullYear() === year && pDate.getMonth() === month) {
        payments += pay.amount;
        paymentsRows.push({
          date: pay.date,
          amount: pay.amount,
          mode: pay.mode,
          desc: pay.description
        });
      }
    }
  });

  const netPending = earnedSalary + overtime + extraEarnings - deductions - payments;

  return {
    rate: baseSalary,
    earnedSalary,
    overtime,
    extraEarnings,
    deductions,
    payments,
    netPending,
    attendanceCounts: { present, absent, halfDay, leave, totalMarked },
    details: {
      earningsRows,
      overtimeRows,
      extraEarningsRows,
      deductionsRows,
      paymentsRows
    }
  };
}

export function calcPreviousDue(employee: Employee, year: number, month: number, db: AppDatabase): number {
  let startYear = year;
  let startMonth = month;

  if (employee.join) {
    const jd = new Date(employee.join + 'T00:00:00');
    if (!isNaN(jd.getTime())) {
      startYear = jd.getFullYear();
      startMonth = jd.getMonth();
    }
  }

  // Ensure startYear goes back to at least 2024 or 2 years before the target year to prevent skipped months
  const minYear = Math.min(startYear, year - 2, 2024);
  if (minYear < startYear) {
    startYear = minYear;
    startMonth = 0; // January
  }

  const checkDate = (dateStr: string) => {
    if (!dateStr) return;
    const d = new Date(dateStr + 'T00:00:00');
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = d.getMonth();
      if (y < startYear || (y === startYear && m < startMonth)) {
        startYear = y;
        startMonth = m;
      }
    }
  };

  db.payments.forEach(p => {
    if (p.employeeId === employee.id) checkDate(p.date);
  });
  db.earnings.forEach(e => {
    if (e.employeeId === employee.id) checkDate(e.date);
  });
  db.deductions.forEach(d => {
    if (d.employeeId === employee.id) checkDate(d.date);
  });
  db.overtimeEntries.forEach(o => {
    if (o.employeeId === employee.id) checkDate(o.date);
  });
  db.lateFineEntries.forEach(l => {
    if (l.employeeId === employee.id) checkDate(l.date);
  });
  Object.keys(db.attendance).forEach(k => {
    if (k.startsWith(`${employee.id}_`)) {
      const dateStr = k.substring(employee.id.length + 1);
      if (dateStr) checkDate(dateStr);
    }
  });

  if (startYear > year || (startYear === year && startMonth >= month)) {
    return employee.carryForward || 0;
  }

  let accumulatedDue = employee.carryForward || 0;
  let cYear = startYear;
  let cMonth = startMonth;

  while (cYear < year || (cYear === year && cMonth < month)) {
    const metrics = calcMonthMetrics(employee, cYear, cMonth, db);
    accumulatedDue += metrics.netPending;
    cMonth++;
    if (cMonth > 11) {
      cMonth = 0;
      cYear++;
    }
  }

  return accumulatedDue;
}

export interface FullFinancialStatus {
  previousDue: number;
  currentEarnings: number;
  overtime: number;
  extraEarnings: number;
  deductions: number;
  payments: number;
  totalPayable: number;
  totalDue: number;
  metrics: MonthBreakdown;
}

export function calcEmployeeFinancials(
  employee: Employee,
  year: number,
  month: number,
  db: AppDatabase
): FullFinancialStatus {
  const metrics = calcMonthMetrics(employee, year, month, db);
  const previousDue = calcPreviousDue(employee, year, month, db);

  const totalPayable = previousDue + metrics.earnedSalary + metrics.overtime + metrics.extraEarnings - metrics.deductions;
  const totalDue = totalPayable - metrics.payments;

  return {
    previousDue,
    currentEarnings: metrics.earnedSalary,
    overtime: metrics.overtime,
    extraEarnings: metrics.extraEarnings,
    deductions: metrics.deductions,
    payments: metrics.payments,
    totalPayable,
    totalDue,
    metrics
  };
}

export function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export function validateSessions(
  sessions: PunchSession[],
  nextAction: 'in' | 'out'
): { valid: boolean; reason?: string } {
  const count = sessions.length;
  
  if (nextAction === 'in') {
    if (count >= 2) {
      return { valid: false, reason: 'Maximum of 2 punch-ins allowed per day.' };
    }
    // Check if the last session has a missing 'out' time
    if (count > 0 && !sessions[count - 1].out) {
      return { valid: false, reason: 'You must Punch Out of your current session before Punching In again.' };
    }
  } else { // out
    if (count === 0) {
      return { valid: false, reason: 'Cannot Punch Out without a matching Punch In.' };
    }
    const lastSession = sessions[count - 1];
    if (lastSession.out) {
      return { valid: false, reason: 'Duplicate Punch Out. Matching Punch In is required.' };
    }
  }
  
  return { valid: true };
}

export function runPayrollTransaction(
  db: AppDatabase,
  updateFn: (draft: AppDatabase) => void
): AppDatabase {
  // Deep clone database state
  const draft = JSON.parse(JSON.stringify(db)) as AppDatabase;
  try {
    // Run updates
    updateFn(draft);
    
    // Validate salary integrity post-update
    draft.employees.forEach(emp => {
      const today = new Date();
      // Trigger metric checks for current month
      calcEmployeeFinancials(emp, today.getFullYear(), today.getMonth(), draft);
    });

    return draft; // Successful transaction commit
  } catch (error) {
    console.error("Payroll Transaction aborted! Changes rolled back.", error);
    throw error;
  }
}

export function validatePunchRequestRules(
  employeeId: string,
  requestType: 'Punch In' | 'Punch Out',
  dateStr: string,
  db: AppDatabase
): { valid: boolean; reason?: string } {
  // 1. Get approved attendance sessions
  const attRecord = db.attendance[`${employeeId}_${dateStr}`];
  const approvedSessions: PunchSession[] = attRecord?.sessions || [];

  // 2. Get pending and approved approval requests for this employee and date
  const relatedReqs = (db.approvalRequests || [])
    .filter(r => r.employeeId === employeeId && r.date === dateStr && (r.status === 'Pending' || r.status === 'Approved'))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const pendingReqs = relatedReqs.filter(r => r.status === 'Pending');

  const timeline: { type: 'in' | 'out'; status: 'Approved' | 'Pending' }[] = [];

  // Add approved events
  approvedSessions.forEach(s => {
    timeline.push({ type: 'in', status: 'Approved' });
    if (s.out) {
      timeline.push({ type: 'out', status: 'Approved' });
    }
  });

  // Add pending events from pending approval requests
  pendingReqs.forEach(r => {
    if (r.category === 'Punch In') {
      timeline.push({ type: 'in', status: 'Pending' });
    } else if (r.category === 'Punch Out') {
      timeline.push({ type: 'out', status: 'Pending' });
    }
  });

  // Now, append the new proposed request
  const newType = requestType === 'Punch In' ? 'in' : 'out';
  timeline.push({ type: newType, status: 'Pending' });

  // Validate timeline
  let openSession = false;
  let punchInCount = 0;
  let punchOutCount = 0;

  for (let i = 0; i < timeline.length; i++) {
    const event = timeline[i];
    if (event.type === 'in') {
      punchInCount++;
      if (openSession) {
        return { 
          valid: false, 
          reason: 'Cannot Punch In: You already have an open session waiting for approval or active.' 
        };
      }
      if (punchInCount > 2) {
        return { 
          valid: false, 
          reason: 'Maximum limit of 2 working sessions per day reached (max 2 Punch Ins/day).' 
        };
      }
      openSession = true;
    } else { // out
      punchOutCount++;
      if (!openSession) {
        return { 
          valid: false, 
          reason: 'Cannot Punch Out: No matching active/pending Punch In session found.' 
        };
      }
      if (punchOutCount > 2) {
        return { 
          valid: false, 
          reason: 'Maximum limit of 2 working sessions per day reached (max 2 Punch Outs/day).' 
        };
      }
      openSession = false;
    }
  }

  return { valid: true };
}

export function formatHrsMins(h: number): string {
  const hr = Math.floor(h);
  const mn = Math.round((h - hr) * 60);
  return `${String(hr).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
}

export interface DailyAttendanceMetrics {
  punchIn: string;
  punchOut: string;
  workedHrs: number;
  workedHrsStr: string;
  standardHrs: number;
  standardHrsStr: string;
  otHrs: number;
  otHrsStr: string;
  fineHrs: number;
  fineHrsStr: string;
  status: string;
}

export function getDailyAttendanceMetrics(
  employee: Employee,
  dateStr: string,
  record: AttendanceRecord | undefined,
  db: AppDatabase
): DailyAttendanceMetrics {
  const baseHours = employee.baseHours || 8;
  const standardHrsStr = `${String(baseHours).padStart(2, '0')}:00`;
  
  let workedHrs = 0;
  let punchIn = '--:--';
  let punchOut = '--:--';

  if (record && record.sessions && record.sessions.length > 0) {
    record.sessions.forEach((s) => {
      if (s.in && s.out) {
        workedHrs += timeToHrs(s.in, s.out);
      }
    });

    const validSessions = record.sessions.filter(s => s.in);
    if (validSessions.length > 0) {
      const minIn = validSessions.reduce((min, s) => {
        return !min || toMin(s.in) < toMin(min) ? s.in : min;
      }, '');
      punchIn = minIn;

      const allOut = validSessions.every(s => s.out);
      if (allOut) {
        const maxOut = validSessions.reduce((max, s) => {
          return !max || toMin(s.out) > toMin(max) ? s.out : max;
        }, '');
        punchOut = maxOut;
      }
    }
  }

  const dayOts = db.overtimeEntries?.filter(o => o.employeeId === employee.id && o.date === dateStr) || [];
  const otHrs = dayOts.reduce((sum, o) => sum + o.hours, 0);

  const dayFines = db.lateFineEntries?.filter(f => f.employeeId === employee.id && f.date === dateStr) || [];
  const fineHrs = dayFines.reduce((sum, f) => sum + f.hours, 0);

  const workedHrsStr = formatHrsMins(workedHrs);
  const otHrsStr = formatHrsMins(otHrs);
  const fineHrsStr = formatHrsMins(fineHrs);

  let status = 'Not Marked';
  if (record && record.status) {
    status = record.status;
  } else if (workedHrs > 0) {
    status = 'Present';
  }

  if (status === 'Present' || status === 'Half Day' || status === 'Overtime') {
    if (otHrs > 0) {
      status = 'Present + OT';
    } else if (fineHrs > 0) {
      status = 'Present - Late Fine';
    }
  }

  return {
    punchIn,
    punchOut,
    workedHrs,
    workedHrsStr,
    standardHrs: baseHours,
    standardHrsStr,
    otHrs,
    otHrsStr,
    fineHrs,
    fineHrsStr,
    status
  };
}
