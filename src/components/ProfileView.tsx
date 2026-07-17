import React, { useState } from "react";
import {
  AppDatabase,
  Employee,
  Payment,
  Earning,
  Deduction,
  OvertimeEntry,
  LateFineEntry,
  PaymentMode,
  CalcType,
} from "../types";
import {
  calcEmployeeFinancials,
  getRateForMonth,
  getDaysInMonth,
  getHourlyRate,
  DEFAULT_DATABASE,
  toMin,
  timeToHrs,
  getDailyAttendanceMetrics,
} from "../db";
import Icon from "./Icon";
import TimeWheelPicker from "./TimeWheelPicker";
import InlineDurationPicker from "./InlineDurationPicker";
import SalarySlipPDF, { downloadSalarySlipPDF } from "./SalarySlipPDF";
import LocalSalaryDisplay from "./LocalSalaryDisplay";
import { dbService } from "../services/db";
import { optimizeImage } from "../utils/imageOptimizer";

const formatHrsMins = (h: number): string => {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}:${mm.toString().padStart(2, '0')}`;
};

interface ProfileViewProps {
  employeeId: string;
  db: AppDatabase;
  lang: "en" | "hi";
  onUpdateDb: (updatedDb: AppDatabase) => void;
  onGoBack: () => void;
  onDeleteEmployeeFully?: (id: string) => void;
  onChangeStatusToLeft?: (id: string) => void;
}

export default function ProfileView({
  employeeId,
  db,
  lang,
  onUpdateDb,
  onGoBack,
  onDeleteEmployeeFully,
  onChangeStatusToLeft,
}: ProfileViewProps) {
  const [activeTab, setActiveTab] = useState<
    "overview" | "attendance" | "transactions"
  >("overview");
  // Navigation Month YYYY-MM
  const [navYear, setNavYear] = useState(new Date().getFullYear());
  const [navMonth, setNavMonth] = useState(new Date().getMonth());

  // PDF Download Modal states
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [pdfMonth, setPdfMonth] = useState(new Date().getMonth());
  const [pdfYear, setPdfYear] = useState(new Date().getFullYear());

  const getCurrentTimeHHmm = () => {
    const d = new Date();
    const hrs = String(d.getHours()).padStart(2, "0");
    const mins = String(d.getMinutes()).padStart(2, "0");
    return `${hrs}:${mins}`;
  };

  // Clickable card breakdown dialogue state
  const [breakdownModal, setBreakdownModal] = useState<{
    isOpen: boolean;
    title: string;
    type:
      | "earnings"
      | "overtime"
      | "extra"
      | "deductions"
      | "payments"
      | "prevDue";
  } | null>(null);

  // Edit / Input modals
  const [paymentForm, setPaymentForm] = useState<{
    isOpen: boolean;
    id?: string; // set if editing
    amount: string;
    date: string;
    mode: PaymentMode | "";
    description: string;
    paymentType?: string;
    time?: string;
    paidBy?: string;
  } | null>(null);

  const [earningForm, setEarningForm] = useState<{
    isOpen: boolean;
    id?: string;
    amount: string;
    date: string;
    description: string;
    time?: string;
  } | null>(null);

  const [deductionForm, setDeductionForm] = useState<{
    isOpen: boolean;
    id?: string;
    amount: string;
    date: string;
    description: string;
    time?: string;
  } | null>(null);

  const [overtimeForm, setOvertimeForm] = useState<{
    isOpen: boolean;
    id?: string;
    date: string;
    hours: string;
    calcType: CalcType;
    amount: string;
    description: string;
    time?: string;
  } | null>(null);

  const [lateFineForm, setLateFineForm] = useState<{
    isOpen: boolean;
    id?: string;
    date: string;
    hours: string;
    calcType: CalcType;
    amount: string;
    description: string;
    time?: string;
  } | null>(null);

  // Historical Rate Overrides Modal
  const [prevRatesModal, setPrevRatesModal] = useState(false);
  const [rateOption, setRateOption] = useState<"current" | "history">(
    "current",
  );
  const [editRateYm, setEditRateYm] = useState(
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
  );
  const [editRateVal, setEditRateVal] = useState("");

  const [showActionDropdown, setShowActionDropdown] = useState(false);
  const [isEditingEmployee, setIsEditingEmployee] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showLeftConfirm, setShowLeftConfirm] = useState(false);
  const [leftPin, setLeftPin] = useState("");
  const [deletePin, setDeletePin] = useState("");

  const [showFineSettingsModal, setShowFineSettingsModal] = useState(false);
  const [fineSettingsState, setFineSettingsState] = useState<{
    fineEnabled: boolean;
    autoDeductionEnabled: boolean;
    gracePeriodDays: number;
    maxFineAmount: number;
    fiftyPercentRuleEnabled: boolean;
    fineTable: Record<number, number>;
    standardHours: number;
  } | null>(null);

  const openFineSettingsModal = () => {
    const comp = db.company || {};
    const fs = emp.fineSettings;
    setFineSettingsState({
      fineEnabled: fs ? fs.fineEnabled : (comp.attendanceFineEnabled !== false),
      autoDeductionEnabled: fs ? fs.autoDeductionEnabled : (comp.autoDeductionEnabled !== false),
      gracePeriodDays: fs ? fs.gracePeriodDays : (comp.gracePeriodDays ?? 3),
      maxFineAmount: fs ? fs.maxFineAmount : (comp.maxFineAmount ?? 50),
      fiftyPercentRuleEnabled: fs ? fs.fiftyPercentRuleEnabled : (comp.fiftyPercentRuleEnabled !== false),
      fineTable: (fs && fs.fineTable) ? { ...fs.fineTable } : { ...(comp.companyFineTable || { 1: 5, 2: 10, 3: 15, 4: 20, 5: 25, 6: 30, 7: 35, 8: 40, 9: 45, 10: 50, 11: 50, 12: 50 }) },
      standardHours: emp.baseHours || 8
    });
    setShowFineSettingsModal(true);
  };

  const handleSaveFineSettings = () => {
    if (!fineSettingsState) return;
    const empsList = [...db.employees];
    const idx = empsList.findIndex(e => e.id === employeeId);
    if (idx !== -1) {
      empsList[idx] = {
        ...empsList[idx],
        baseHours: fineSettingsState.standardHours,
        fineSettings: {
          fineEnabled: fineSettingsState.fineEnabled,
          autoDeductionEnabled: fineSettingsState.autoDeductionEnabled,
          gracePeriodDays: fineSettingsState.gracePeriodDays,
          maxFineAmount: fineSettingsState.maxFineAmount,
          fiftyPercentRuleEnabled: fineSettingsState.fiftyPercentRuleEnabled,
          fineTable: fineSettingsState.fineTable
        }
      };
      
      const auditLogs = [...(db.auditLogs || [])];
      auditLogs.push({
        id: `_AUDIT_${Date.now()}`,
        adminName: 'Admin',
        action: 'EDIT_FINE_RULES',
        targetId: employeeId,
        targetName: emp.name,
        oldValue: JSON.stringify(emp.fineSettings || {}),
        newValue: JSON.stringify(empsList[idx].fineSettings),
        timestamp: new Date().toISOString(),
        device: 'Admin Portal'
      });

      onUpdateDb({
        ...db,
        employees: empsList,
        auditLogs
      });
      setShowFineSettingsModal(false);
      alert(t('✓ Employee fine settings updated!', '✓ कर्मचारी जुर्माना सेटिंग्स अद्यतन की गईं!'));
    }
  };

  const handleResetFineSettingsToDefault = () => {
    const empsList = [...db.employees];
    const idx = empsList.findIndex(e => e.id === employeeId);
    if (idx !== -1) {
      const { fineSettings, ...rest } = empsList[idx];
      empsList[idx] = {
        ...rest,
        baseHours: 8
      };
      
      const auditLogs = [...(db.auditLogs || [])];
      auditLogs.push({
        id: `_AUDIT_${Date.now()}`,
        adminName: 'Admin',
        action: 'RESET_FINE_RULES',
        targetId: employeeId,
        targetName: emp.name,
        oldValue: JSON.stringify(emp.fineSettings || {}),
        newValue: 'Company Defaults',
        timestamp: new Date().toISOString(),
        device: 'Admin Portal'
      });

      onUpdateDb({
        ...db,
        employees: empsList,
        auditLogs
      });
      setShowFineSettingsModal(false);
      alert(t('✓ Reset to company defaults successful!', '✓ कंपनी डिफ़ॉल्ट सेटिंग्स पर रीसेट सफल!'));
    }
  };

  // Redesigned active sub-tab for Transactions Tab (Payments (Default), Earnings, Deductions, Overtime, Fines)
  const [activeSubTab, setActiveSubTab] = useState<
    "Payments" | "Earnings" | "Deductions" | "Overtime" | "Fines"
  >("Payments");

  // Interactive Bottom Actions Sheet state for Chevron Click
  const [selectedTxAction, setSelectedTxAction] = useState<{
    type: "Payments" | "Earnings" | "Deductions" | "Overtime" | "Fines";
    item: any;
  } | null>(null);

  // Custom Transaction Delete Confirm Modal state
  const [txToDelete, setTxToDelete] = useState<{
    type: "Payments" | "Earnings" | "Deductions" | "Overtime" | "Fines";
    id: string;
  } | null>(null);

  // Attendance history picker/drawer states
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMeta, setPickerMeta] = useState<{
    dateStr: string;
    sessionIdx: number;
    field: "in" | "out";
    initialVal: string;
  } | null>(null);

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

  const formatTxDateTime = (dateStr: string, timeStr?: string) => {
    const monthsStr = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    try {
      const parts = dateStr.split("-");
      if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const d = parseInt(parts[2], 10);
        const formattedDate = `${String(d).padStart(2, "0")} ${monthsStr[m]} ${y}`;
        const formattedTime = timeStr || "09:00 AM";
        return `${formattedDate} • ${formattedTime}`;
      }
    } catch (e) {}
    return `${dateStr} • ${timeStr || "09:00 AM"}`;
  };

  const getCurrentTimeFormatted = () => {
    const now = new Date();
    let hours = now.getHours();
    const minutes = now.getMinutes();
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    const minutesStr = minutes < 10 ? "0" + minutes : minutes;
    const hoursStr = hours < 10 ? "0" + hours : hours;
    return `${hoursStr}:${minutesStr} ${ampm}`;
  };

  const getHistoryRecordForDate = (ds: string) => {
    const attKey = `${employeeId}_${ds}`;
    if (!db.attendance[attKey]) {
      return { sessions: [], status: undefined };
    }
    return db.attendance[attKey];
  };

  const updateHistoryRecordForDate = (ds: string, updatedRecord: any) => {
    const attKey = `${employeeId}_${ds}`;
    const newAttendance = { ...db.attendance };
    newAttendance[attKey] = updatedRecord;
    onUpdateDb({ ...db, attendance: newAttendance });
  };

  const triggerHistoryTimePicker = (
    ds: string,
    sessionIdx: number,
    field: "in" | "out",
    val: string,
  ) => {
    setPickerMeta({
      dateStr: ds,
      sessionIdx,
      field,
      initialVal: val || getCurrentTimeHHmm(),
    });
    setPickerOpen(true);
  };

  const saveHistoryTimePickerValue = (finalTime: string) => {
    if (!pickerMeta) return;
    const { dateStr, sessionIdx, field } = pickerMeta;
    const rec = { ...getHistoryRecordForDate(dateStr) };
    const sessions = [...(rec.sessions || [])];

    if (!sessions[sessionIdx]) {
      sessions[sessionIdx] = { in: "", out: "" };
    }

    const currentSession = { ...sessions[sessionIdx] };
    currentSession[field] = finalTime;

    // Validation
    const proposedIn = field === "in" ? finalTime : currentSession.in;
    const proposedOut = field === "out" ? finalTime : currentSession.out;

    if (proposedIn && proposedOut) {
      if (toMin(proposedOut) <= toMin(proposedIn)) {
        alert(
          t(
            "Punch Out time must be later than Punch In time.",
            "पंच आउट का समय पंच इन से बाद का होना चाहिए।",
          ),
        );
        setPickerOpen(false);
        return;
      }
    }

    sessions[sessionIdx] = currentSession;
    rec.sessions = sessions;
    rec.status = "Present";

    updateHistoryRecordForDate(dateStr, rec);
    setPickerOpen(false);
  };

  const addHistoryPunchSessionRow = (ds: string) => {
    const rec = { ...getHistoryRecordForDate(ds) };
    const sessions = [...(rec.sessions || [])];
    sessions.push({ in: "", out: "" });
    rec.sessions = sessions;
    rec.status = "Present";
    updateHistoryRecordForDate(ds, rec);
  };

  const removeHistoryPunchSessionRow = (ds: string, idx: number) => {
    const rec = { ...getHistoryRecordForDate(ds) };
    const sessions = [...(rec.sessions || [])];
    sessions.splice(idx, 1);
    rec.sessions = sessions;
    if (sessions.length === 0) rec.status = undefined;
    updateHistoryRecordForDate(ds, rec);
  };

  const quickMarkHistorySimpleStatus = (
    ds: string,
    status: "Present" | "Absent" | "Half Day" | "Leave",
  ) => {
    const rec = { ...getHistoryRecordForDate(ds) };
    rec.status = status;
    rec.sessions = [];
    updateHistoryRecordForDate(ds, rec);
  };

  const handleClearHistoryRecord = (ds: string) => {
    const attKey = `${employeeId}_${ds}`;
    const newAttendance = { ...db.attendance };
    delete newAttendance[attKey];

    const newOt = (db.overtimeEntries || []).filter(
      (o) => !(o.employeeId === employeeId && o.date === ds)
    );
    const newLf = (db.lateFineEntries || []).filter(
      (f) => !(f.employeeId === employeeId && f.date === ds)
    );

    onUpdateDb({
      ...db,
      attendance: newAttendance,
      overtimeEntries: newOt,
      lateFineEntries: newLf
    });
  };

  const handlePunchInHistoryClick = (ds: string) => {
    const rec = { ...getHistoryRecordForDate(ds) };
    const s = rec.sessions || [];
    if (s.length === 0) {
      s.push({ in: "", out: "" });
      rec.sessions = s;
      updateHistoryRecordForDate(ds, rec);
    }
    triggerHistoryTimePicker(ds, 0, "in", s[0]?.in || getCurrentTimeHHmm());
  };

  const handlePunchOutHistoryClick = (ds: string) => {
    const rec = { ...getHistoryRecordForDate(ds) };
    const s = rec.sessions || [];
    if (s.length === 0) {
      s.push({ in: "", out: "" });
      rec.sessions = s;
      updateHistoryRecordForDate(ds, rec);
    }
    triggerHistoryTimePicker(ds, 0, "out", s[0]?.out || getCurrentTimeHHmm());
  };

  const t = (en: string, hi: string) => (lang === "en" ? en : hi);

  const getHourlyRateForDate = (dateStr: string) => {
    if (!emp || !dateStr) return 0;
    try {
      const parts = dateStr.split("-");
      if (parts.length < 2) return 0;
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // 0-indexed!
      if (isNaN(year) || isNaN(month)) return 0;
      const baseSalary = getRateForMonth(emp, year, month);
      const daysCount = getDaysInMonth(year, month);
      return getHourlyRate(emp, baseSalary, daysCount);
    } catch {
      return 0;
    }
  };

  const emp = db.employees.find((e) => e.id === employeeId);
  if (!emp) {
    return (
      <div className="p-4 text-center font-bold text-red-500">
        Employee details not found.
      </div>
    );
  }

  // Calculate full dynamic financials for this employee and month
  const financials = calcEmployeeFinancials(emp, navYear, navMonth, db);
  const metrics = financials.metrics;

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

    // Lock forward dating past current calendar month
    const today = new Date();
    if (
      newY < today.getFullYear() ||
      (newY === today.getFullYear() && newM <= today.getMonth())
    ) {
      setNavMonth(newM);
      setNavYear(newY);
    }
  };

  // --- Transactions Save & Mutation Helpers ---
  const savePayment = () => {
    if (!paymentForm) return;
    const { id, amount, date, mode, description, paymentType, time, paidBy } =
      paymentForm;
    const numAmt = parseFloat(amount);

    if (isNaN(numAmt) || numAmt <= 0) {
      alert(t("Please enter valid amount", "कृपया मान्य राशि दर्ज करें"));
      return;
    }
    if (!date) {
      alert(t("Date is required", "तारीख का चयन करें"));
      return;
    }
    if (!mode) {
      alert(t("Choose payment mode", "भुगतान माध्यम का चयन करें"));
      return;
    }

    const payList = [...db.payments];
    if (id) {
      // Edit
      const idx = payList.findIndex((p) => p.id === id);
      if (idx !== -1) {
        payList[idx] = {
          id,
          employeeId,
          amount: numAmt,
          date,
          mode,
          description,
          paymentType: paymentType || "Salary Payment",
          time: time || "09:00 AM",
          paidBy: paidBy || "",
        };
      }
    } else {
      // Create fresh Payment
      payList.push({
        id: `_PAY_${Date.now()}`,
        employeeId,
        amount: numAmt,
        date,
        mode,
        description,
        paymentType: paymentType || "Salary Payment",
        time: time || "09:00 AM",
        paidBy: paidBy || "",
      });
    }

    onUpdateDb({ ...db, payments: payList });
    setPaymentForm(null); // Clean resets (Req 23 & 8)
  };

  const deletePayment = (payId: string) => {
    const filtered = db.payments.filter((p) => p.id !== payId);
    onUpdateDb({ ...db, payments: filtered });
  };

  // Standard Earnings Save
  const saveEarning = () => {
    if (!earningForm) return;
    const { id, amount, date, description, time } = earningForm;
    const numAmt = parseFloat(amount);

    if (isNaN(numAmt) || numAmt <= 0 || !date) {
      alert(
        t("Fill all required earning fields", "कृपया सभी आवश्यक फ़ील्ड भरें"),
      );
      return;
    }

    const earnList = [...db.earnings];
    if (id) {
      const idx = earnList.findIndex((e) => e.id === id);
      if (idx !== -1) {
        earnList[idx] = {
          id,
          employeeId,
          amount: numAmt,
          date,
          description,
          time: time || "09:00 AM",
        };
      }
    } else {
      earnList.push({
        id: `_ERN_${Date.now()}`,
        employeeId,
        amount: numAmt,
        date,
        description,
        time: time || "09:00 AM",
      });
    }

    onUpdateDb({ ...db, earnings: earnList });
    setEarningForm(null);
  };

  const deleteEarning = (earnId: string) => {
    const filtered = db.earnings.filter((e) => e.id !== earnId);
    onUpdateDb({ ...db, earnings: filtered });
  };

  // Standard Deductions Save
  const saveDeduction = () => {
    if (!deductionForm) return;
    const { id, amount, date, description, time } = deductionForm;
    const numAmt = parseFloat(amount);

    if (isNaN(numAmt) || numAmt <= 0 || !date) {
      alert(
        t("Fill all required deduction fields", "कृपया सभी आवश्यक फ़ील्ड भरें"),
      );
      return;
    }

    const dedList = [...db.deductions];
    if (id) {
      const idx = dedList.findIndex((d) => d.id === id);
      if (idx !== -1) {
        dedList[idx] = {
          id,
          employeeId,
          amount: numAmt,
          date,
          description,
          time: time || "09:00 AM",
        };
      }
    } else {
      dedList.push({
        id: `_DED_${Date.now()}`,
        employeeId,
        amount: numAmt,
        date,
        description,
        time: time || "09:00 AM",
      });
    }

    onUpdateDb({ ...db, deductions: dedList });
    setDeductionForm(null);
  };

  const deleteDeduction = (dedId: string) => {
    // Check if it's an auto-generated fine, do soft delete
    const ded = db.deductions.find(d => d.id === dedId);
    if (ded && ded.isAutoGenerated) {
      const reason = prompt(t("Enter deletion reason:", "कटौती हटाने का कारण दर्ज करें:"), "Deleted by Admin") || "Deleted by Admin";
      softDeleteDeduction(dedId, reason);
      return;
    }
    const filtered = db.deductions.filter((d) => d.id !== dedId);
    onUpdateDb({ ...db, deductions: filtered });
  };

  const waiveDeduction = (id: string, reason: string) => {
    const updatedDeductions = db.deductions.map(d => {
      if (d.id === id) {
        return {
          ...d,
          originalAmount: d.originalAmount ?? d.amount,
          amount: 0,
          status: 'Waived' as const,
          waivedBy: 'Admin',
          waivedDate: new Date().toISOString().split('T')[0],
          waivedReason: reason
        };
      }
      return d;
    });

    const oldD = db.deductions.find(d => d.id === id);
    const auditLogs = [...(db.auditLogs || [])];
    auditLogs.push({
      id: `_AUDIT_${Date.now()}`,
      adminName: 'Admin',
      action: 'WAIVE_DEDUCTION',
      targetId: id,
      targetName: emp.name,
      oldValue: String(oldD?.amount ?? 0),
      newValue: '0 (Waived)',
      timestamp: new Date().toISOString(),
      device: 'Admin Portal'
    });

    onUpdateDb({
      ...db,
      deductions: updatedDeductions,
      auditLogs
    });
    alert(t('✓ Deduction waived!', '✓ कटौती माफ कर दी गई!'));
  };

  const softDeleteDeduction = (id: string, reason: string) => {
    const updatedDeductions = db.deductions.map(d => {
      if (d.id === id) {
        return {
          ...d,
          originalAmount: d.originalAmount ?? d.amount,
          amount: 0,
          status: 'Deleted' as const,
          deletedBy: 'Admin',
          deletedDate: new Date().toISOString().split('T')[0],
          deleteReason: reason
        };
      }
      return d;
    });

    const oldD = db.deductions.find(d => d.id === id);
    const auditLogs = [...(db.auditLogs || [])];
    auditLogs.push({
      id: `_AUDIT_${Date.now()}`,
      adminName: 'Admin',
      action: 'SOFT_DELETE_DEDUCTION',
      targetId: id,
      targetName: emp.name,
      oldValue: String(oldD?.amount ?? 0),
      newValue: '0 (Deleted)',
      timestamp: new Date().toISOString(),
      device: 'Admin Portal'
    });

    onUpdateDb({
      ...db,
      deductions: updatedDeductions,
      auditLogs
    });
    alert(t('✓ Deduction soft-deleted!', '✓ कटौती सॉफ्ट-डिलीट कर दी गई!'));
  };

  const convertToLeave = (id: string, attDate: string) => {
    const attKey = `${employeeId}_${attDate}`;
    const updatedAttendance = { ...db.attendance };
    if (updatedAttendance[attKey]) {
      updatedAttendance[attKey] = {
        ...updatedAttendance[attKey],
        status: 'Leave' as const
      };
    }

    const updatedDeductions = db.deductions.map(d => {
      if (d.id === id) {
        return {
          ...d,
          amount: 0,
          status: 'Waived' as const,
          waivedBy: 'Admin',
          waivedDate: new Date().toISOString().split('T')[0],
          waivedReason: 'Converted to Leave'
        };
      }
      return d;
    });

    const updatedReviews = (db.attendanceReviews || []).map(r => {
      if (r.deductionId === id || (r.employeeId === employeeId && r.date === attDate)) {
        return {
          ...r,
          status: 'Converted to Leave' as const,
          actionBy: 'Admin',
          actionDate: new Date().toISOString().split('T')[0]
        };
      }
      return r;
    });

    const auditLogs = [...(db.auditLogs || [])];
    auditLogs.push({
      id: `_AUDIT_${Date.now()}`,
      adminName: 'Admin',
      action: 'CONVERT_TO_LEAVE',
      targetId: id,
      targetName: emp.name,
      oldValue: 'Absent/Under hours',
      newValue: 'Leave (Deduction Waived)',
      timestamp: new Date().toISOString(),
      device: 'Admin Portal'
    });

    onUpdateDb({
      ...db,
      attendance: updatedAttendance,
      deductions: updatedDeductions,
      attendanceReviews: updatedReviews,
      auditLogs
    });
    alert(t('✓ Converted to Approved Leave successfully!', '✓ स्वीकृत छुट्टी में सफलतापूर्वक परिवर्तित किया गया!'));
  };

  // Overtime entries Save
  const saveOvertime = () => {
    if (!overtimeForm) return;
    const { id, date, hours, calcType, amount, description, time } =
      overtimeForm;
    const numHours = parseFloat(hours);
    const numAmt = parseFloat(amount) || 0;

    if (isNaN(numHours) || numHours <= 0 || !date) {
      alert(t("Fill required overtime fields", "ओवरटाइम विवरण प्रविष्ट करें"));
      return;
    }

    const otList = [...db.overtimeEntries];
    if (id) {
      const idx = otList.findIndex((o) => o.id === id);
      if (idx !== -1) {
        otList[idx] = {
          id,
          employeeId,
          date,
          hours: numHours,
          calcType,
          amount: calcType === "HourlyRate" ? 0 : numAmt,
          description,
          time: time || "09:00 AM",
        };
      }
    } else {
      otList.push({
        id: `_OT_${Date.now()}`,
        employeeId,
        date,
        hours: numHours,
        calcType,
        amount: calcType === "HourlyRate" ? 0 : numAmt,
        description,
        time: time || "09:00 AM",
      });
    }

    onUpdateDb({ ...db, overtimeEntries: otList });
    setOvertimeForm(null);
  };

  const deleteOvertime = (otId: string) => {
    const filtered = db.overtimeEntries.filter((o) => o.id !== otId);
    onUpdateDb({ ...db, overtimeEntries: filtered });
  };

  // Late Fine entries Save
  const saveLateFine = () => {
    if (!lateFineForm) return;
    const { id, date, hours, calcType, amount, description, time } =
      lateFineForm;
    const numHours = parseFloat(hours);
    const numAmt = parseFloat(amount) || 0;

    if (isNaN(numHours) || numHours <= 0 || !date) {
      alert(t("Fill required fine fields", "लेट फाइन प्रविष्टि भरें"));
      return;
    }

    const lfList = [...db.lateFineEntries];
    if (id) {
      const idx = lfList.findIndex((f) => f.id === id);
      if (idx !== -1) {
        lfList[idx] = {
          id,
          employeeId,
          date,
          hours: numHours,
          calcType,
          amount: calcType === "HourlyRate" ? 0 : numAmt,
          description,
          time: time || "09:00 AM",
        };
      }
    } else {
      lfList.push({
        id: `_LF_${Date.now()}`,
        employeeId,
        date,
        hours: numHours,
        calcType,
        amount: calcType === "HourlyRate" ? 0 : numAmt,
        description,
        time: time || "09:00 AM",
      });
    }

    onUpdateDb({ ...db, lateFineEntries: lfList });
    setLateFineForm(null);
  };

  const deleteLateFine = (lfId: string) => {
    const filtered = db.lateFineEntries.filter((f) => f.id !== lfId);
    onUpdateDb({ ...db, lateFineEntries: filtered });
  };

  // --- Historical Salary Manager (Requirement 16) ---
  const saveHistoricalRate = () => {
    const numVal = parseFloat(editRateVal);
    if (isNaN(numVal) || numVal <= 0) {
      alert(t("Rate must be positive", "दर प्रविष्ट करें"));
      return;
    }

    const empsList = [...db.employees];
    const targetEmpIdx = empsList.findIndex((e) => e.id === employeeId);
    if (targetEmpIdx === -1) return;

    const targetEmpComp = { ...empsList[targetEmpIdx] };
    const salHistory = [...(targetEmpComp.salHistory || [])];

    if (rateOption === "current") {
      // Updates current and any future entries (chronological override Option A)
      const currentYm = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
      const existing = salHistory.find((h) => h.ym === currentYm);
      if (existing) {
        existing.rate = numVal;
      } else {
        salHistory.push({ ym: currentYm, rate: numVal });
      }
    } else {
      // Increments specific history month individually (Option B)
      const existing = salHistory.find((h) => h.ym === editRateYm);
      if (existing) {
        existing.rate = numVal;
      } else {
        salHistory.push({ ym: editRateYm, rate: numVal });
      }
    }

    targetEmpComp.salHistory = salHistory;
    // Overwrite the current active rate as well
    targetEmpComp.salHistory = salHistory;

    // Sort array
    targetEmpComp.salHistory.sort((a, b) => a.ym.localeCompare(b.ym));

    empsList[targetEmpIdx] = targetEmpComp;
    onUpdateDb({ ...db, employees: empsList });
    setPrevRatesModal(false);
    setEditRateVal("");
    alert(
      t(
        "Salary Rates updated! Carry forwards recalculated across database dues.",
        "दरों को अपडेट कर दिया गया है! संचित पिछला देय पुनः मूल्यांकित किया गया है।",
      ),
    );
  };

  // Months lists
  const MN = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  // Total balance calculations
  const totalBalanceDueNow = financials.totalDue;

  const getSalaryPeriodRangeStr = (
    year: number,
    month: number,
    employeeJoinDateStr?: string,
  ) => {
    const today = new Date();
    const daysInMonth = getDaysInMonth(year, month);

    let startDay = 1;
    if (employeeJoinDateStr) {
      const jd = new Date(employeeJoinDateStr + "T00:00:00");
      if (
        !isNaN(jd.getTime()) &&
        jd.getFullYear() === year &&
        jd.getMonth() === month
      ) {
        startDay = jd.getDate();
      }
    }

    let endDay = daysInMonth;
    if (year === today.getFullYear() && month === today.getMonth()) {
      endDay = Math.min(today.getDate(), daysInMonth);
    }

    const startStr = `${String(startDay).padStart(2, "0")} ${MN[month]}`;
    const endStr = `${String(endDay).padStart(2, "0")} ${MN[month]} ${year}`;

    return `${startStr} – ${endStr}`;
  };

  const getDefaultDateForNavPeriod = () => {
    const today = new Date();
    if (today.getFullYear() === navYear && today.getMonth() === navMonth) {
      return today.toISOString().split("T")[0];
    }
    return `${navYear}-${String(navMonth + 1).padStart(2, "0")}-01`;
  };

  let totalHrsSum = 0;
  if (emp.type === "Hourly") {
    const daysCount = getDaysInMonth(navYear, navMonth);
    for (let d = 1; d <= daysCount; d++) {
      const dateStr = `${navYear}-${String(navMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const rec = db.attendance[`${emp.id}_${dateStr}`];
      if (rec) {
        const sessions = rec.sessions || [];
        sessions.forEach((s) => {
          if (s.in && s.out) totalHrsSum += timeToHrs(s.in, s.out);
        });
      }
    }
  }

  const activeRateValue = getRateForMonth(emp, navYear, navMonth);
  const rateLabelStr =
    emp.type === "Hourly"
      ? "₹ " + activeRateValue + "/hr"
      : emp.type === "Daily"
        ? "₹ " + activeRateValue + "/day"
        : "₹ " + activeRateValue + "/mo";

  const leftCardTitle =
    emp.type === "Hourly"
      ? t("TOTAL HOURS", "कुल घंटे की गणना")
      : t("ATTENDANCE DAYS", "कुल दिन की उपस्थिति");
  const leftCardValue =
    emp.type === "Hourly"
      ? `${totalHrsSum.toFixed(1)} hrs`
      : `${metrics.attendanceCounts.present + metrics.attendanceCounts.halfDay * 0.5} days`;

  const earnedThisMonth = financials.currentEarnings;
  const previousMonthDue = financials.previousDue;
  const alreadyPaid = financials.payments;
  const thisMonthEarnings = previousMonthDue + earnedThisMonth - alreadyPaid;
  const thisMonthOvertime = financials.overtime;
  const extraEarnings = financials.extraEarnings;
  const deductionsAndFines = financials.deductions;
  const paidThisMonth = 0;

  const listItems = [
    {
      label: t("Earned This Month", "इस महीने की वास्तविक कमाई"),
      value: earnedThisMonth,
      prefix: "",
      valueClass: "text-slate-800",
    },
    {
      label: t("Previous Month Due", "पिछले महीने का बकाया देय"),
      value: previousMonthDue,
      prefix: "",
      valueClass: "text-amber-600 font-bold",
    },
    {
      label: t("Already Paid", "पूर्व प्राप्त भुगतान (-)"),
      value: alreadyPaid,
      prefix: "- ",
      valueClass: "text-rose-600",
    },

    {
      label: t("This Month Overtime", "इस महीने का ओवरटाइम (+)"),
      value: thisMonthOvertime,
      prefix: "+ ",
      valueClass: "text-blue-600",
    },
    {
      label: t("Extra Earnings", "अतिरिक्त कमाई / पारितोषिक (+)"),
      value: extraEarnings,
      prefix: "+ ",
      valueClass: "text-emerald-600",
    },
    {
      label: t("Deductions & Fines", "इस महीने की कटौतियां (-)"),
      value: deductionsAndFines,
      prefix: "- ",
      valueClass: "text-rose-600",
    },
    {
      label: t("Paid This Month", "इस महीने भुगतान किया गया (-)"),
      value: paidThisMonth,
      prefix: "- ",
      valueClass: "text-rose-600",
    },
  ];

  // React state for handling live inputs inside profile edit form
  const [editForm, setEditForm] = useState({
    name: emp.name,
    mobile: emp.mobile,
    join: emp.join || new Date().toISOString().split("T")[0],
    pic: emp.pic || "",
    type: emp.type,
    rate: String(
      getRateForMonth(emp, new Date().getFullYear(), new Date().getMonth()),
    ),
    baseHours: String(emp.baseHours || 8),
    status: emp.status,
  });

  const handleEditEmployeeSubmit = () => {
    if (!editForm.name.trim()) {
      alert("Full name is required.");
      return;
    }

    const empsList = [...db.employees];
    const targetEmpIdx = empsList.findIndex((e) => e.id === employeeId);
    if (targetEmpIdx !== -1) {
      const targetEmpComp = { ...empsList[targetEmpIdx] };

      targetEmpComp.name = editForm.name;
      targetEmpComp.mobile = editForm.mobile;
      targetEmpComp.join = editForm.join;
      targetEmpComp.pic = editForm.pic;
      targetEmpComp.type = editForm.type;
      targetEmpComp.baseHours = Number(editForm.baseHours) || 8;
      targetEmpComp.status = editForm.status;

      const currentYm = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
      const updatedHistory = [...(targetEmpComp.salHistory || [])];
      const existingIdx = updatedHistory.findIndex((h) => h.ym === currentYm);
      if (existingIdx !== -1) {
        updatedHistory[existingIdx].rate = Number(editForm.rate) || 0;
      } else {
        updatedHistory.push({
          ym: currentYm,
          rate: Number(editForm.rate) || 0,
        });
      }
      targetEmpComp.salHistory = updatedHistory;

      empsList[targetEmpIdx] = targetEmpComp;
      onUpdateDb({ ...db, employees: empsList });
      setIsEditingEmployee(false);
      alert(
        t(
          "✓ Profile Settings Updated!",
          "✓ कर्मचारी का प्रोफाइल विवरण अपडेट हो गया!",
        ),
      );
    }
  };

  // Inline update handlers for attendance history log
  const handleUpdateHistoryStatus = (ds: string, newStatus: string) => {
    const attKey = `${emp.id}_${ds}`;
    const currentAtt = { ...(db.attendance[attKey] || {}) };

    if (newStatus === "Not Marked") {
      const newAtt = { ...db.attendance };
      delete newAtt[attKey];
      onUpdateDb({ ...db, attendance: newAtt });
    } else {
      currentAtt.status = newStatus as any;
      if (!currentAtt.sessions || currentAtt.sessions.length === 0) {
        if (newStatus === "Present") {
          currentAtt.sessions = [{ in: "09:00", out: "17:00" }];
        } else if (newStatus === "Half Day") {
          currentAtt.sessions = [{ in: "09:00", out: "13:00" }];
        } else {
          currentAtt.sessions = [];
        }
      }

      const newAtt = { ...db.attendance, [attKey]: currentAtt };
      onUpdateDb({ ...db, attendance: newAtt });
    }
  };

  const handleUpdateHistoryHours = (ds: string, hrsVal: string) => {
    const attKey = `${emp.id}_${ds}`;
    const currentAtt = { ...(db.attendance[attKey] || {}) };
    const parsed = parseFloat(hrsVal) || 0;

    currentAtt.status = parsed > 0 ? "Present" : "Absent";

    if (parsed > 0) {
      currentAtt.sessions = [
        {
          in: "09:00",
          out: `${String(9 + Math.floor(parsed)).padStart(2, "0")}:${String(Math.round((parsed % 1) * 60)).padStart(2, "0")}`,
        },
      ];
    } else {
      currentAtt.sessions = [];
    }

    const newAtt = { ...db.attendance, [attKey]: currentAtt };
    onUpdateDb({ ...db, attendance: newAtt });
  };

  if (isEditingEmployee) {
    return (
      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-xs space-y-4 animate-in fade-in duration-300">
        <div className="flex items-center gap-2 mb-2">
          <Icon
            name="arrow_back"
            onClick={() => setIsEditingEmployee(false)}
            className="text-slate-400 cursor-pointer"
            size={18}
          />
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
            {t("Edit Employee Account", "कर्मचारी प्रोफाइल संपादन")}
          </h3>
        </div>

        <div className="space-y-3">
          <div className="fld">
            <label className="text-xs font-bold text-slate-500 mb-1 block">
              {t("Full Name", "पूरा नाम")}
            </label>
            <input
              type="text"
              className="fi font-sans"
              value={editForm.name}
              onChange={(e) =>
                setEditForm({ ...editForm, name: e.target.value })
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="fld">
              <label className="text-xs font-bold text-slate-500 mb-1 block">
                {t("Mobile Number", "मोबाइल फोन")}
              </label>
              <input
                type="text"
                className="fi"
                value={editForm.mobile}
                onChange={(e) =>
                  setEditForm({ ...editForm, mobile: e.target.value })
                }
              />
            </div>
            <div className="fld">
              <label className="text-xs font-bold text-slate-500 mb-1 block">
                {t("Joining Date", "भर्ती तिथि")}
              </label>
              <input
                type="date"
                className="fi"
                value={editForm.join}
                onChange={(e) =>
                  setEditForm({ ...editForm, join: e.target.value })
                }
              />
            </div>
          </div>

          <div className="fld">
            <label className="text-xs font-bold text-slate-500 mb-1 block">
              {t(
                "Profile Photo / Avatar",
                "कर्मचारी प्रोफाइल फोटो (अपलोड करें)",
              )}
            </label>
            <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
              <div className="w-12 h-12 rounded-xl border border-slate-350 bg-white flex items-center justify-center overflow-hidden shrink-0 shadow-3xs">
                {editForm.pic ? (
                  <img
                    src={editForm.pic}
                    alt="Avatar"
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <Icon name="person" size={24} className="text-slate-400" />
                )}
              </div>
              <div className="flex-1">
                <input
                  type="file"
                  accept="image/*"
                  id="profile-pic-uploader-el"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      try {
                        const optimizedBase64 = await optimizeImage(file);
                        setEditForm({ ...editForm, pic: optimizedBase64 });
                      } catch (err: any) {
                        alert("Image optimization failed: " + err.message);
                      }
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() =>
                    document.getElementById("profile-pic-uploader-el")?.click()
                  }
                  className="h-8 px-3 rounded-lg border border-blue-200 bg-blue-50 text-blue-600 text-[10px] font-bold hover:bg-blue-100 transition shadow-2xs cursor-pointer inline-flex items-center gap-1"
                >
                  <Icon name="upload" size={12} />
                  <span>{t("Upload Image", "फोटो चुनें")}</span>
                </button>
                {editForm.pic && (
                  <button
                    type="button"
                    onClick={() => setEditForm({ ...editForm, pic: "" })}
                    className="h-8 px-2.5 ml-2 rounded-lg border border-red-100 bg-red-50 text-red-500 text-[10px] font-extrabold hover:bg-red-100 transition cursor-pointer"
                  >
                    <span>{t("Remove", "हटाएं")}</span>
                  </button>
                )}
              </div>
            </div>
            <input
              type="text"
              className="fi mt-2 font-sans"
              value={editForm.pic}
              onChange={(e) =>
                setEditForm({ ...editForm, pic: e.target.value })
              }
              placeholder={t(
                "Or paste image URL...",
                "या यहाँ फोटो यूआरएल (URL) पेस्ट करें...",
              )}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="fld">
              <label className="text-xs font-bold text-slate-500 mb-1 block">
                {t("Payment Term Type", "वेतन भुगतान प्रकार")}
              </label>
              <select
                className="fi bg-white h-11 border border-slate-200 rounded-xl px-3 w-full animate-none"
                value={editForm.type}
                onChange={(e) =>
                  setEditForm({ ...editForm, type: e.target.value as any })
                }
              >
                <option value="Hourly">Hourly</option>
                <option value="Daily">Daily</option>
                <option value="Monthly">Monthly</option>
              </select>
            </div>
            <div className="fld">
              <label className="text-xs font-bold text-slate-500 mb-1 block">
                {t("Active Rate (₹)", "भुगतान दर (₹)")}
              </label>
              <input
                type="number"
                className="fi"
                value={editForm.rate}
                onChange={(e) =>
                  setEditForm({ ...editForm, rate: e.target.value })
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="fld">
              <label className="text-xs font-bold text-slate-500 mb-1 block">
                {t("Base Work Hours", "साधारण कार्य समय (घंटे)")}
              </label>
              <input
                type="number"
                className="fi"
                value={editForm.baseHours}
                onChange={(e) =>
                  setEditForm({ ...editForm, baseHours: e.target.value })
                }
              />
            </div>
            <div className="fld">
              <label className="text-xs font-bold text-slate-500 mb-1 block">
                {t("Active Roster Status", "खाता संचालन स्थिति")}
              </label>
              <select
                className="fi bg-white h-11 border border-slate-200 rounded-xl px-3 w-full font-bold animate-none"
                value={editForm.status}
                onChange={(e) =>
                  setEditForm({ ...editForm, status: e.target.value as any })
                }
              >
                <option value="Active">Active (सक्रिय)</option>
                <option value="Left Job">Left Job (नौकरी छोड़ दी)</option>
                <option value="Inactive">Deleted / Inactive (निष्क्रिय)</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex gap-2.5 pt-4 text-xs font-bold">
          <button
            onClick={() => setIsEditingEmployee(false)}
            className="flex-1 h-11 border border-slate-200 text-slate-650 rounded-xl cursor-pointer active:scale-[0.98]"
          >
            {t("Cancel", "रद्द करें")}
          </button>
          <button
            onClick={handleEditEmployeeSubmit}
            className="flex-1 h-11 bg-blue-600 text-white rounded-xl cursor-pointer active:scale-[0.98] hover:bg-blue-700 transition-all font-black"
          >
            {t("Save Changes", "विवरण सहेजें")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full select-none">
      {/* Refined Minimalist Profile Info Header with 3-dot Action Trigger */}
      <div className="bg-white border border-slate-150 rounded-2xl p-4 mb-4 flex items-center justify-between shadow-2xs relative">
        <div className="flex items-center gap-3">
          <button
            onClick={onGoBack}
            className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-205 text-slate-550 flex items-center justify-center hover:bg-slate-100 active:scale-[0.97] transition-all cursor-pointer"
          >
            <Icon name="arrow_back" size={16} />
          </button>
          <div className="w-10 h-10 bg-blue-50/70 border border-blue-150 rounded-xl flex items-center justify-center font-bold text-blue-605 text-sm uppercase overflow-hidden shrink-0 shadow-3xs">
            {emp.pic ? (
              <img
                src={emp.pic}
                alt={emp.name}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              emp.name.slice(0, 2).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-xs font-bold text-slate-900 leading-none truncate">
              {emp.name}
            </h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase mt-1.5 tracking-wider leading-none">
              {emp.type} · +91 {emp.mobile}
            </p>
          </div>
        </div>

        <div className="relative">
          <button
            onClick={() => setShowActionDropdown((prev) => !prev)}
            className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-205 text-slate-550 flex items-center justify-center hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer"
          >
            <Icon name="more_vert" size={18} />
          </button>

          {showActionDropdown && (
            <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded-xl shadow-md z-[100] py-1.5 text-[11px] text-slate-700 animate-in fade-in slide-in-from-top-2 duration-150">
              <button
                onClick={() => {
                  setIsEditingEmployee(true);
                  setShowActionDropdown(false);
                }}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-semibold flex items-center gap-2 cursor-pointer transition-colors"
              >
                <Icon name="edit" size={16} className="text-slate-400" />
                <span>{t("Edit Profile", "प्रोफाइल बदलें")}</span>
              </button>

              <button
                onClick={() => {
                  setPrevRatesModal(true);
                  setShowActionDropdown(false);
                }}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-semibold flex items-center gap-2 cursor-pointer transition-colors"
              >
                <Icon name="history" size={16} className="text-slate-400" />
                <span>{t("Salary Rate History", "वेतन सेटिंग्स इतिहास")}</span>
              </button>



              <button
                onClick={() => {
                  openFineSettingsModal();
                  setShowActionDropdown(false);
                }}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-semibold flex items-center gap-2 border-t border-slate-100 cursor-pointer transition-colors"
              >
                <Icon name="gavel" size={16} className="text-slate-400" />
                <span>{t("Fine Settings", "जुर्माना नीतियां")}</span>
              </button>

              <button
                onClick={() => {
                  setShowActionDropdown(false);
                  setLeftPin("");
                  setShowLeftConfirm(true);
                }}
                className="w-full text-left px-4 py-2.5 text-rose-600 hover:bg-rose-50 font-semibold flex items-center gap-2 border-t border-slate-100 cursor-pointer transition-colors"
              >
                <Icon name="exit_to_app" size={16} className="text-rose-500" />
                <span>{t("Mark Job Left", "नौकरी छोड़ दी")}</span>
              </button>

              <button
                onClick={() => {
                  setShowActionDropdown(false);
                  setDeletePin("");
                  setShowDeleteConfirm(true);
                }}
                className="w-full text-left px-4 py-2.5 text-red-600 hover:bg-red-50 font-semibold flex items-center gap-2 border-t border-slate-100 cursor-pointer transition-colors"
              >
                <Icon name="delete_forever" size={16} className="text-red-500" />
                <span>{t("Delete Employee", "कर्मचारी हटाएं")}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Dynamic Month Selector / Period Navigator */}
      {activeTab === "attendance" && (
        <div className="flex items-center justify-between mb-4 bg-white border border-slate-100/80 p-3.5 rounded-2xl shadow-2xs">
          <div>
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider leading-none">
              {t("Salary Overview", "वेतन सारांश")}
            </h3>
            <p className="text-[10px] text-slate-400 font-semibold mt-1.5 leading-none">
              {getSalaryPeriodRangeStr(navYear, navMonth, emp.join)}
            </p>
          </div>
          <div className="flex items-center gap-1 select-none">
            <button
              onClick={() => handleMonthShift(-1)}
              className="w-7 h-7 rounded-lg bg-slate-50 border border-slate-205 text-slate-600 flex items-center justify-center hover:bg-slate-100 transition-all font-bold active:scale-[0.95] cursor-pointer"
            >
              &lt;
            </button>
            <div className="px-3 h-7 flex items-center justify-center rounded-lg bg-slate-55 border border-slate-205 text-[10px] font-bold text-slate-800 uppercase min-w-[85px] text-center font-mono">
              {MN[navMonth]} {navYear}
            </div>
            <button
              onClick={() => handleMonthShift(1)}
              className="w-7 h-7 rounded-lg bg-slate-50 border border-slate-205 text-slate-605 flex items-center justify-center hover:bg-slate-100 transition-all font-bold active:scale-[0.95] cursor-pointer"
            >
              &gt;
            </button>
          </div>
        </div>
      )}

      {/* Segmented Pill Tabs Selector Wrapper */}
      <div className="sticky top-0 bg-white/95 backdrop-blur-xs py-2.5 z-40 -mx-4 px-4 border-b border-slate-150 mb-4">
        <div className="flex bg-slate-100/50 border border-slate-200 rounded-xl p-1 shadow-3xs">
          {(["overview", "attendance", "transactions"] as const).map((tab) => {
            const isSel = activeTab === tab;
            const label =
              tab === "overview"
                ? t("Overview", "प्रदर्शन साराँश")
                : tab === "attendance"
                  ? t("Attendance", "दैनिक हाजिरी")
                  : t("Transactions", "लेनदेन");
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 h-8 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  isSel
                    ? "bg-blue-600 text-white shadow-xs font-semibold"
                    : "text-slate-500 hover:text-slate-800 hover:bg-slate-200/40"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* --- OVERVIEW TAB MODULES --- */}
      {activeTab === "overview" && (
        <div className="animate-in fade-in duration-200">
          {/* Top Summary Row */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            {/* Card 1: Hours / Days Indicator */}
            <div id="summary-card-hours" className="bg-white border border-slate-150 rounded-2xl p-4 shadow-2xs flex items-center justify-between h-[84px]">
              <div className="flex flex-col justify-center min-w-0">
                <span className="text-[9px] uppercase font-bold text-slate-405 tracking-wider truncate">
                  {leftCardTitle}
                </span>
                <span className="text-sm font-bold text-blue-600 mt-1 font-mono truncate leading-none">
                  {leftCardValue}
                </span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-blue-50/70 text-blue-600 flex items-center justify-center">
                <Icon name={emp.type === "Hourly" ? "schedule" : "calendar_today"} size={20} />
              </div>
            </div>

            {/* Card 2: Rate Indicator */}
            <div id="summary-card-rate" className="bg-white border border-slate-150 rounded-2xl p-4 shadow-2xs flex items-center justify-between h-[84px]">
              <div className="flex flex-col justify-center min-w-0">
                <span className="text-[9px] uppercase font-bold text-slate-405 tracking-wider truncate">
                  {t("PAYMENT RATE", "भुगतान दर")}
                </span>
                <LocalSalaryDisplay
                  isPaymentRate
                  value={activeRateValue}
                  format={(val) =>
                    emp.type === "Hourly"
                      ? `₹${val}/hr`
                      : emp.type === "Daily"
                        ? `₹${val}/day`
                        : `₹${val}/mo`
                  }
                  className="text-sm font-bold text-emerald-600 mt-1 font-mono"
                />
              </div>
              <div className="w-10 h-10 rounded-xl bg-emerald-50/70 text-emerald-600 flex items-center justify-center">
                <Icon name="payments" size={20} />
              </div>
            </div>
          </div>

          {/* Section Title: Financial Summary */}
          <h3 id="financial-summary-title" className="text-[10px] font-bold text-slate-450 uppercase tracking-widest mb-2.5 mt-4">
            {t("Financial Summary", "वित्तीय सारांश")}
          </h3>

          {/* Compact 6-Card Grid */}
          <div id="financial-summary-grid" className="grid grid-cols-12 gap-2 mb-4">
            {(() => {
              const miniCards = [
                {
                  id: "card-earnings",
                  label: t("Earnings", "कमाई"),
                  value: earnedThisMonth,
                  prefix: "",
                  color: "green",
                  icon: "trending_up",
                  colSpan: "col-span-3",
                  onClick: () => {
                    setActiveTab("transactions");
                    setActiveSubTab("Earnings");
                  }
                },
                {
                  id: "card-prev-due",
                  label: t("Previous Due", "पिछला बकाया"),
                  value: previousMonthDue,
                  prefix: "",
                  color: "orange",
                  icon: "warning",
                  colSpan: "col-span-3",
                  onClick: () => {
                    setBreakdownModal({
                      isOpen: true,
                      title: t("Previous Carried-Forward Due", "पिछले महीनों का बकाया"),
                      type: "prevDue",
                    });
                  }
                },
                {
                  id: "card-already-paid",
                  label: t("Already Paid", "पहले भुगतान"),
                  value: alreadyPaid,
                  prefix: "-",
                  color: "red",
                  icon: "payments",
                  colSpan: "col-span-3",
                  onClick: () => {
                    setActiveTab("transactions");
                    setActiveSubTab("Payments");
                  }
                },
                {
                  id: "card-overtime",
                  label: t("Overtime", "ओवरटाइम"),
                  value: thisMonthOvertime,
                  prefix: "+",
                  color: "blue",
                  icon: "schedule",
                  colSpan: "col-span-3",
                  onClick: () => {
                    setActiveTab("transactions");
                    setActiveSubTab("Overtime");
                  }
                },
                {
                  id: "card-extra-earnings",
                  label: t("Extra Earnings", "अतिरिक्त कमाई"),
                  value: extraEarnings,
                  prefix: "+",
                  color: "green",
                  icon: "add_circle",
                  colSpan: "col-span-6",
                  onClick: () => {
                    setActiveTab("transactions");
                    setActiveSubTab("Earnings");
                  }
                },
                {
                  id: "card-deductions",
                  label: t("Deductions & Fine", "कटौती व जुर्माना"),
                  value: deductionsAndFines,
                  prefix: "-",
                  color: "red",
                  icon: "trending_down",
                  colSpan: "col-span-6",
                  onClick: () => {
                    setActiveTab("transactions");
                    setActiveSubTab("Deductions");
                  }
                }
              ];

              const getColorStyles = (color: string) => {
                switch (color) {
                  case "green":
                    return {
                      bg: "bg-emerald-50/45 hover:bg-emerald-50/80 border-emerald-100",
                      text: "text-emerald-700",
                      iconBg: "bg-emerald-100/80 text-emerald-700",
                    };
                  case "red":
                    return {
                      bg: "bg-rose-50/45 hover:bg-rose-50/80 border-rose-100",
                      text: "text-rose-700",
                      iconBg: "bg-rose-100/80 text-rose-700",
                    };
                  case "blue":
                    return {
                      bg: "bg-blue-50/45 hover:bg-blue-50/80 border-blue-100",
                      text: "text-blue-700",
                      iconBg: "bg-blue-100/80 text-blue-700",
                    };
                  case "orange":
                  default:
                    return {
                      bg: "bg-amber-50/45 hover:bg-amber-50/80 border-amber-100",
                      text: "text-amber-700",
                      iconBg: "bg-amber-100/80 text-amber-700",
                    };
                }
              };

              return miniCards.map((card) => {
                const styles = getColorStyles(card.color);
                return (
                  <div
                    key={card.id}
                    id={card.id}
                    onClick={card.onClick}
                    className={`cursor-pointer ${card.colSpan} ${styles.bg} border rounded-xl p-3 flex flex-col justify-between h-[86px] transition-all duration-200 active:scale-[0.97] shadow-3xs`}
                  >
                    <div className={`w-6 h-6 rounded-lg ${styles.iconBg} flex items-center justify-center shrink-0`}>
                      <Icon name={card.icon} size={12} />
                    </div>
                    <div className="flex flex-col min-w-0 mt-1">
                      <span className="text-[9px] md:text-[9.5px] font-bold text-slate-500 uppercase tracking-tight leading-tight truncate">
                        {card.label}
                      </span>
                      <LocalSalaryDisplay
                        value={card.value}
                        format={(val) => `${card.prefix}₹${Math.round(val).toLocaleString("en-IN")}`}
                        className={`text-[11.5px] md:text-xs font-black font-mono ${styles.text} leading-none mt-0.5 truncate`}
                      />
                    </div>
                  </div>
                );
              });
            })()}
          </div>

          {/* Total Balance Card Redesigned - Green when positive/due, Red when negative/overpaid */}
          <div
            id="total-balance-card"
            className={`p-4 rounded-xl flex items-center justify-between shadow-xs mb-4 ${
              totalBalanceDueNow >= 0
                ? "bg-emerald-600 text-white"
                : "bg-rose-600 text-white"
            }`}
          >
            <div className="min-w-0">
              <span
                className={`text-[9px] font-black uppercase tracking-wider block ${
                  totalBalanceDueNow >= 0 ? "text-emerald-100" : "text-rose-100"
                }`}
              >
                {totalBalanceDueNow >= 0
                  ? t("TOTAL BALANCE DUE", "कुल देय बकाया")
                  : t(
                      "EMPLOYEE OVERPAID BALANCE",
                      "कर्मचारी द्वारा निकाला गया अग्रिम",
                    )}
              </span>
              <span
                className={`text-[8px] block mt-0.5 font-sans font-bold leading-tight ${
                  totalBalanceDueNow >= 0 ? "text-emerald-200" : "text-rose-200"
                }`}
              >
                {t(
                  "Reflects complete historical cash flows",
                  "सभी महीनों का कुल संचित शेष",
                )}
              </span>
            </div>
            <LocalSalaryDisplay
              value={Math.abs(totalBalanceDueNow)}
              format={(val) => `₹${Math.round(val).toLocaleString("en-IN")}`}
              className="text-lg font-black font-mono text-white shrink-0 ml-2"
            />
          </div>

          {/* Download Salary Slip PDF Button */}
          <button
            onClick={() => setShowPdfModal(true)}
            className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-3xs transition-all active:scale-[0.98] mb-4"
          >
            <Icon name="download_for_offline" size={16} />
            <span>{t("Download Salary Slip (PDF)", "सैलरी स्लिप डाउनलोड करें (PDF)")}</span>
          </button>
        </div>
      )}

      {/* --- ATTENDANCE HISTORY EDIT LIST TAB --- */}
      {activeTab === "attendance" && (
        <div className="animate-in fade-in duration-200">
          <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl mb-3 flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-widest font-mono shadow-xs">
            <span>{t("Calendar Log", "दैनिक कैलेंडर रिकॉर्ड")}</span>
            <span>
              {metrics.attendanceCounts.present} Present /{" "}
              {metrics.attendanceCounts.absent} Absent
            </span>
          </div>

          <div className="max-h-[360px] overflow-y-auto space-y-3 pr-1 hide-scrollbar">
            {(() => {
              const monthName = new Date(navYear, navMonth).toLocaleDateString(
                "en-US",
                { month: "short" },
              );
              const today = new Date();
              const isCurrentMonthAndYear =
                navYear === today.getFullYear() &&
                navMonth === today.getMonth();
              const totalDaysToRender = isCurrentMonthAndYear
                ? today.getDate()
                : getDaysInMonth(navYear, navMonth);
              return Array.from({ length: totalDaysToRender }, (_, i) => {
                const day = totalDaysToRender - i;
                const dateStr = `${navYear}-${String(navMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

                const rec = getHistoryRecordForDate(dateStr);
                const isExpanded = expandedDate === dateStr;

                if (emp.type === "Hourly") {
                  const sessions = rec.sessions || [];
                  const session_0 = sessions[0] || { in: "", out: "" };
                  const totalHrs = sessions.reduce(
                    (sum: number, s: any) =>
                      sum +
                      (s.in && s.out ? (toMin(s.out) - toMin(s.in)) / 60 : 0),
                    0,
                  );

                  return (
                    <div
                      key={day}
                      className="bg-white border border-slate-100 rounded-2xl p-3.5 shadow-xs space-y-3 hover:border-slate-300 transition-all"
                    >
                      <div className="flex justify-between items-center">
                        <div className="text-xs font-black text-slate-800 leading-tight">
                          {day} {monthName} {navYear}
                        </div>
                        <div className="text-right text-[11px] font-black text-slate-500 font-mono">
                          {(() => {
                            const otHrs = db.overtimeEntries.filter(o => o.employeeId === emp.id && o.date === dateStr).reduce((sum, o) => sum + o.hours, 0);
                            const fineHrs = db.lateFineEntries.filter(f => f.employeeId === emp.id && f.date === dateStr).reduce((sum, f) => sum + f.hours, 0);
                            
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
                          onClick={() => handlePunchInHistoryClick(dateStr)}
                          className={`h-9 rounded-lg text-[11px] font-bold border flex-1 transition-all flex-row flex items-center justify-center gap-1 cursor-pointer ${
                            session_0.in
                              ? "bg-emerald-500 border-emerald-500 text-white font-black"
                              : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          <span>
                            {session_0.in
                              ? formatTimeForDisplay(session_0.in)
                              : t("Punch In", "पंच इन")}
                          </span>
                        </button>

                        <button
                          onClick={() => handlePunchOutHistoryClick(dateStr)}
                          className={`h-9 rounded-lg text-[11px] font-bold border flex-1 transition-all flex-row flex items-center justify-center gap-1 cursor-pointer ${
                            session_0.out
                              ? "bg-slate-900 border-slate-900 text-white font-black"
                              : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          <span>
                            {session_0.out
                              ? formatTimeForDisplay(session_0.out)
                              : t("Punch Out", "पंच आउट")}
                          </span>
                        </button>

                        <button
                          onClick={() => handleClearHistoryRecord(dateStr)}
                          className="w-9 h-9 rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-red-500 hover:bg-rose-50 hover:border-red-100 flex items-center justify-center cursor-pointer transition-all shrink-0 active:scale-[0.95]"
                          title={t("Clear Attendance Record", "उपस्थिति हटाएं")}
                        >
                          <Icon name="delete"  size={13}  />
                        </button>

                        <button
                          onClick={() =>
                            setExpandedDate(isExpanded ? null : dateStr)
                          }
                          className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 cursor-pointer transition-all active:scale-[0.95] ${
                            isExpanded
                              ? "bg-blue-600 border-blue-600 text-white rotate-180"
                              : "bg-blue-50 border-blue-200 text-blue-600"
                          }`}
                        >
                          <Icon name="keyboard_arrow_down"  size={13}  />
                        </button>
                      </div>

                      {/* Expanded Sub-drawer: Extra punch slots & OT/Fine Buttons */}
                      {isExpanded && (
                        <div className="bg-slate-50/50 p-2.5 rounded-xl space-y-2.5 border border-slate-100 animate-in slide-in-from-top-1">
                          <button
                            onClick={() => addHistoryPunchSessionRow(dateStr)}
                            className="w-full h-8 border border-blue-200 text-blue-600 bg-white hover:bg-blue-105/10 border-dashed rounded-lg flex items-center justify-center font-black text-[10px] cursor-pointer gap-1 transition-all"
                          >
                            <Icon name="add"  size={11}  />
                            <span>
                              {t("Add Punch Section", "नया punch स्लॉट जोड़ें")}
                            </span>
                          </button>

                          {/* Display subsequent shift slots */}
                          {sessions.length > 1 && (
                            <div className="space-y-1.5 pt-1.5 border-t border-slate-200">
                              {sessions
                                .slice(1)
                                .map((s: any, rawIdx: number) => {
                                  const sIdx = rawIdx + 1;
                                  return (
                                    <div
                                      key={sIdx}
                                      className="flex items-center gap-1.5 bg-white p-1 border border-slate-200 rounded-lg"
                                    >
                                      <div className="w-5 h-5 rounded bg-slate-100 text-slate-500 font-extrabold text-[9px] flex items-center justify-center">
                                        {sIdx + 1}
                                      </div>
                                      <button
                                        onClick={() =>
                                          triggerHistoryTimePicker(
                                            dateStr,
                                            sIdx,
                                            "in",
                                            s.in,
                                          )
                                        }
                                        className={`flex-1 h-8 rounded-md text-[10px] font-black border transition-all ${
                                          s.in
                                            ? "bg-emerald-600 border-emerald-600 text-white"
                                            : "bg-white border-slate-200 text-slate-600"
                                        }`}
                                      >
                                        <span>
                                          {s.in
                                            ? formatTimeForDisplay(s.in)
                                            : t("In Time", "पंच इन")}
                                        </span>
                                      </button>
                                      <button
                                        onClick={() =>
                                          triggerHistoryTimePicker(
                                            dateStr,
                                            sIdx,
                                            "out",
                                            s.out,
                                          )
                                        }
                                        className={`flex-1 h-8 rounded-md text-[10px] font-black border transition-all ${
                                          s.out
                                            ? "bg-slate-800 border-slate-800 text-white"
                                            : "bg-white border-slate-200 text-slate-600"
                                        }`}
                                      >
                                        <span>
                                          {s.out
                                            ? formatTimeForDisplay(s.out)
                                            : t("Out Time", "पंच आउट")}
                                        </span>
                                      </button>
                                      <button
                                        onClick={() =>
                                          removeHistoryPunchSessionRow(
                                            dateStr,
                                            sIdx,
                                          )
                                        }
                                        className="w-8 h-8 rounded-md border border-slate-200 bg-white text-slate-400 hover:text-red-500 flex items-center justify-center shrink-0"
                                      >
                                        <Icon name="delete" size={12} />
                                      </button>
                                    </div>
                                  );
                                })}
                            </div>
                          )}

                          {/* Overtime & Late Fine Buttons */}
                          <div className="flex gap-2 pt-1.5 border-t border-slate-205">
                            <button
                              onClick={() => {
                                const existing = db.overtimeEntries.find(
                                  (o) =>
                                    o.employeeId === emp.id &&
                                    o.date === dateStr,
                                );
                                setOvertimeForm({
                                  isOpen: true,
                                  id: existing?.id,
                                  date: dateStr,
                                  hours: existing
                                    ? String(existing.hours || "")
                                    : "",
                                  calcType: existing
                                    ? existing.calcType
                                    : "HourlyRate",
                                  amount: existing
                                    ? String(existing.amount || "")
                                    : "",
                                  description: existing
                                    ? existing.description
                                    : "Overtime",
                                });
                              }}
                              className="flex-1 h-8 rounded-lg border border-blue-100 text-blue-605 bg-blue-50/45 hover:bg-blue-100/60 font-semibold text-[10px] flex items-center justify-center gap-1 active:scale-[0.98] transition cursor-pointer"
                            >
                              <Icon name="schedule" size={12} />
                              <span>{t("+ Overtime", "+ overtime")}</span>
                            </button>
                            <button
                              onClick={() => {
                                const existing = db.lateFineEntries.find(
                                  (f) =>
                                    f.employeeId === emp.id &&
                                    f.date === dateStr,
                                );
                                setLateFineForm({
                                  isOpen: true,
                                  id: existing?.id,
                                  date: dateStr,
                                  hours: existing
                                    ? String(existing.hours || "")
                                    : "",
                                  calcType: existing
                                    ? existing.calcType
                                    : "HourlyRate",
                                  amount: existing
                                    ? String(existing.amount || "")
                                    : "",
                                  description: existing
                                    ? existing.description
                                    : "Late arrival",
                                });
                              }}
                              className="flex-1 h-8 rounded-lg border border-rose-100 text-rose-600 bg-rose-50/45 hover:bg-rose-100/60 font-black text-[10px] flex items-center justify-center gap-1 active:scale-[0.98] transition cursor-pointer"
                            >
                              <Icon name="delete"  size={11}  />
                              <span>{t("+ Late Fine", "+ लेट फाइन")}</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                } else {
                  let statusClass = "text-slate-400";
                  let displayStatus = t("Not Marked", "दर्ज नहीं");
                  if (rec.status === "Present") {
                    statusClass = "text-emerald-600";
                    displayStatus = t("Present", "उपस्थित");
                  } else if (rec.status === "Half Day") {
                    statusClass = "text-amber-600";
                    displayStatus = t("Half Day", "आधा दिन");
                  } else if (rec.status === "Absent") {
                    statusClass = "text-red-500";
                    displayStatus = t("Absent", "अनुपस्थित");
                  } else if (rec.status === "Leave") {
                    statusClass = "text-blue-500";
                    displayStatus = t("Leave", "छुट्टी");
                  }

                  return (
                    <div
                      key={day}
                      className="bg-white border border-slate-100 rounded-2xl p-3.5 shadow-xs space-y-3 hover:border-slate-300 transition-all"
                    >
                      <div className="flex justify-between items-center">
                        <div className="text-xs font-black text-slate-800 leading-tight">
                          {day} {monthName} {navYear}
                        </div>
                        <div className="text-right font-mono">
                          {(() => {
                            const otHrs = db.overtimeEntries.filter(o => o.employeeId === emp.id && o.date === dateStr).reduce((sum, o) => sum + o.hours, 0);
                            const fineHrs = db.lateFineEntries.filter(f => f.employeeId === emp.id && f.date === dateStr).reduce((sum, f) => sum + f.hours, 0);
                            
                            const otStr = otHrs > 0 ? ` [+ ${formatHrsMins(otHrs)}]` : '';
                            const fineStr = fineHrs > 0 ? ` [- ${formatHrsMins(fineHrs)}]` : '';
                            
                            return (
                              <div className={`text-[11px] font-black leading-tight ${statusClass}`}>
                                {displayStatus}{otStr}{fineStr} {(otHrs > 0 || fineHrs > 0) ? 'Hrs' : ''}
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      {/* Operational Status Actions */}
                      <div className="flex gap-2 items-center">
                        {(["Present", "Half Day", "Absent"] as const).map(
                          (style) => {
                            const isSel =
                              rec.status ===
                              (style === "Half Day" ? "Half Day" : style);
                            const displayTitle =
                              style === "Present"
                                ? t("Present", "उपस्थित")
                                : style === "Half Day"
                                  ? t("HD", "आधा दिन")
                                  : t("Absent", "अनुपस्थित");

                            let selectStyle =
                              "bg-white border-slate-200 text-slate-600 hover:bg-slate-50";
                            if (isSel) {
                              if (style === "Present")
                                selectStyle =
                                  "bg-emerald-500 border-emerald-500 text-white font-extrabold";
                              else if (style === "Half Day")
                                selectStyle =
                                  "bg-amber-500 border-amber-500 text-white font-extrabold";
                              else
                                selectStyle =
                                  "bg-red-500 border-red-500 text-white font-extrabold";
                            }

                            return (
                              <button
                                key={style}
                                onClick={() =>
                                  quickMarkHistorySimpleStatus(
                                    dateStr,
                                    style as any,
                                  )
                                }
                                className={`h-9 rounded-lg text-[11px] font-bold border flex-1 cursor-pointer transition-all active:scale-[0.98] ${selectStyle}`}
                              >
                                {displayTitle}
                              </button>
                            );
                          },
                        )}

                        <button
                          onClick={() => handleClearHistoryRecord(dateStr)}
                          className="w-9 h-9 rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-red-500 hover:bg-rose-50 flex items-center justify-center cursor-pointer transition-all shrink-0 active:scale-[0.95]"
                          title={t("Clear Attendance Record", "उपस्थिति हटाएं")}
                        >
                          <Icon name="delete"  size={13}  />
                        </button>

                        <button
                          onClick={() =>
                            setExpandedDate(isExpanded ? null : dateStr)
                          }
                          className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 cursor-pointer transition-all active:scale-[0.95] ${
                            isExpanded
                              ? "bg-blue-600 border-blue-600 text-white rotate-180"
                              : "bg-blue-50 border-blue-200 text-blue-600"
                          }`}
                        >
                          <Icon name="keyboard_arrow_down"  size={13}  />
                        </button>
                      </div>

                      {/* Expanded drawer for Overtime & Late Fine */}
                      {isExpanded && (
                        <div className="bg-slate-50/50 p-2 rounded-xl flex gap-2 border border-slate-100 animate-in slide-in-from-top-1">
                          <button
                            onClick={() => {
                              const existing = db.overtimeEntries.find(
                                (o) =>
                                  o.employeeId === emp.id && o.date === dateStr,
                              );
                              setOvertimeForm({
                                isOpen: true,
                                id: existing?.id,
                                date: dateStr,
                                hours: existing
                                  ? String(existing.hours || "")
                                  : "",
                                calcType: existing
                                  ? existing.calcType
                                  : "HourlyRate",
                                amount: existing
                                  ? String(existing.amount || "")
                                  : "",
                                description: existing
                                  ? existing.description
                                  : "Overtime",
                              });
                            }}
                            className="flex-1 h-8 rounded-lg border border-blue-100 text-blue-600 bg-blue-50/45 hover:bg-blue-100/60 font-black text-[10px] flex items-center justify-center gap-1 active:scale-[0.98] transition cursor-pointer"
                          >
                            <Icon name="schedule"  size={11}  />
                            <span>{t("+ Overtime", "+ overtime")}</span>
                          </button>
                          <button
                            onClick={() => {
                              const existing = db.lateFineEntries.find(
                                (f) =>
                                  f.employeeId === emp.id && f.date === dateStr,
                              );
                              setLateFineForm({
                                isOpen: true,
                                id: existing?.id,
                                date: dateStr,
                                hours: existing
                                  ? String(existing.hours || "")
                                  : "",
                                calcType: existing
                                  ? existing.calcType
                                  : "HourlyRate",
                                amount: existing
                                  ? String(existing.amount || "")
                                  : "",
                                description: existing
                                  ? existing.description
                                  : "Late arrival",
                              });
                            }}
                            className="flex-1 h-8 rounded-lg border border-rose-100 text-rose-600 bg-rose-50/45 hover:bg-rose-100/60 font-black text-[10px] flex items-center justify-center gap-1 active:scale-[0.98] transition cursor-pointer"
                          >
                            <Icon name="delete"  size={11}  />
                            <span>{t("+ Late Fine", "+ लेट फाइन")}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                }
              });
            })()}
          </div>
        </div>
      )}

      {/* --- TRANSACTIONS TAB SUB MODULES (Requirement 14) --- */}
      {activeTab === "transactions" &&
        (() => {
          const filteredPayments = db.payments.filter(
            (p) =>
              p.employeeId === employeeId &&
              isSameMonth(p.date, navYear, navMonth),
          );
          const filteredEarnings = db.earnings.filter(
            (e) =>
              e.employeeId === employeeId &&
              isSameMonth(e.date, navYear, navMonth),
          );
          const filteredDeductions = db.deductions.filter(
            (d) =>
              d.employeeId === employeeId &&
              isSameMonth(d.date, navYear, navMonth),
          );
          const filteredOvertime = db.overtimeEntries.filter(
            (o) =>
              o.employeeId === employeeId &&
              isSameMonth(o.date, navYear, navMonth),
          );
          const filteredFines = db.lateFineEntries.filter(
            (f) =>
              f.employeeId === employeeId &&
              isSameMonth(f.date, navYear, navMonth),
          );

          const getActiveSubTabListSize = () => {
            switch (activeSubTab) {
              case "Payments":
                return filteredPayments.length;
              case "Earnings":
                return filteredEarnings.length;
              case "Deductions":
                return filteredDeductions.length;
              case "Overtime":
                return filteredOvertime.length;
              case "Fines":
                return filteredFines.length;
            }
          };

          const activeListSize = getActiveSubTabListSize();

          return (
            <div className="animate-in fade-in duration-200 space-y-5">
              {/* Action Cards Segment Header */}
              <div>
                <div className="text-[10px] uppercase font-black tracking-widest text-slate-400 mb-2.5">
                  {t(
                    "Record Financial Movements",
                    "लेन-देन के प्रविष्टि जोड़ें",
                  )}
                </div>

                {/* Compact row/grid action cards */}
                <div className="flex overflow-x-auto gap-3 pb-3 pt-0.5 justify-start snap-x scrollbar-none sm:grid sm:grid-cols-5">
                  {/* 1. Record Payment */}
                  <div
                    onClick={() => {
                      const pNames = db.company?.paidByNames || ['by Pankaj', 'by Vinod', 'by Babuji', 'by ghar vale'];
                      setPaymentForm({
                        isOpen: true,
                        amount: "",
                        date: getDefaultDateForNavPeriod(),
                        mode: "Cash",
                        description: "",
                        paymentType: "Salary Payment",
                        time: getCurrentTimeFormatted(),
                        paidBy: pNames[0] || "",
                      });
                    }}
                    className="bg-white border border-slate-100 rounded-xl p-3 flex items-center gap-2.5 shadow-3xs flex-shrink-0 w-[145px] sm:w-auto h-[58px] cursor-pointer hover:border-slate-200 hover:shadow-2xs active:scale-[0.97] transition-all"
                  >
                    <div className="w-8.5 h-8.5 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                      <Icon name="payments"  size={16}  />
                    </div>
                    <div className="flex flex-col justify-center select-none">
                      <span className="text-[9px] uppercase font-bold text-slate-300 tracking-wider h-3.5 block">
                        {t("Record", "दर्ज करें")}
                      </span>
                      <span className="text-xs font-black text-slate-700 leading-none block">
                        {t("Payment", "भुगतान")}
                      </span>
                    </div>
                  </div>

                  {/* 2. Add Earning */}
                  <div
                    onClick={() =>
                      setEarningForm({
                        isOpen: true,
                        amount: "",
                        date: getDefaultDateForNavPeriod(),
                        description: "",
                        time: getCurrentTimeFormatted(),
                      })
                    }
                    className="bg-white border border-slate-100 rounded-xl p-3 flex items-center gap-2.5 shadow-3xs flex-shrink-0 w-[145px] sm:w-auto h-[58px] cursor-pointer hover:border-slate-200 hover:shadow-2xs active:scale-[0.97] transition-all"
                  >
                    <div className="w-8.5 h-8.5 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                      <Icon name="trending_up"  size={16}  />
                    </div>
                    <div className="flex flex-col justify-center select-none">
                      <span className="text-[9px] uppercase font-bold text-slate-300 tracking-wider h-3.5 block">
                        {t("Add", "जोड़ें")}
                      </span>
                      <span className="text-xs font-black text-slate-700 leading-none block">
                        {t("Earning", "कमाई")}
                      </span>
                    </div>
                  </div>

                  {/* 3. Add Deduction */}
                  <div
                    onClick={() =>
                      setDeductionForm({
                        isOpen: true,
                        amount: "",
                        date: getDefaultDateForNavPeriod(),
                        description: "",
                        time: getCurrentTimeFormatted(),
                      })
                    }
                    className="bg-white border border-slate-100 rounded-xl p-3 flex items-center gap-2.5 shadow-3xs flex-shrink-0 w-[145px] sm:w-auto h-[58px] cursor-pointer hover:border-slate-200 hover:shadow-2xs active:scale-[0.97] transition-all"
                  >
                    <div className="w-8.5 h-8.5 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                      <Icon name="trending_down"  size={16}  />
                    </div>
                    <div className="flex flex-col justify-center select-none">
                      <span className="text-[9px] uppercase font-bold text-slate-300 tracking-wider h-3.5 block">
                        {t("Add", "जोड़ें")}
                      </span>
                      <span className="text-xs font-black text-slate-700 leading-none block">
                        {t("Deduction", "कटौती")}
                      </span>
                    </div>
                  </div>

                  {/* 4. Add Fine */}
                  <div
                    onClick={() =>
                      setLateFineForm({
                        isOpen: true,
                        date: getDefaultDateForNavPeriod(),
                        hours: "",
                        calcType: "HourlyRate",
                        amount: "",
                        description: "",
                        time: getCurrentTimeFormatted(),
                      })
                    }
                    className="bg-white border border-slate-100 rounded-xl p-3 flex items-center gap-2.5 shadow-3xs flex-shrink-0 w-[145px] sm:w-auto h-[58px] cursor-pointer hover:border-slate-200 hover:shadow-2xs active:scale-[0.97] transition-all"
                  >
                    <div className="w-8.5 h-8.5 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                      <Icon name="warning"  size={16}  />
                    </div>
                    <div className="flex flex-col justify-center select-none">
                      <span className="text-[9px] uppercase font-bold text-slate-300 tracking-wider h-3.5 block">
                        {t("Add", "जोड़ें")}
                      </span>
                      <span className="text-xs font-black text-slate-700 leading-none block">
                        {t("Fine", "जुर्माना")}
                      </span>
                    </div>
                  </div>

                  {/* 5. Add Overtime */}
                  <div
                    onClick={() =>
                      setOvertimeForm({
                        isOpen: true,
                        date: getDefaultDateForNavPeriod(),
                        hours: "",
                        calcType: "HourlyRate",
                        amount: "",
                        description: "",
                        time: getCurrentTimeFormatted(),
                      })
                    }
                    className="bg-white border border-slate-100 rounded-xl p-3 flex items-center gap-2.5 shadow-3xs flex-shrink-0 w-[145px] sm:w-auto h-[58px] cursor-pointer hover:border-slate-200 hover:shadow-2xs active:scale-[0.97] transition-all"
                  >
                    <div className="w-8.5 h-8.5 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                      <Icon name="schedule"  size={16}  />
                    </div>
                    <div className="flex flex-col justify-center select-none">
                      <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider h-3.5 block">
                        {t("Add", "जोड़ें")}
                      </span>
                      <span className="text-xs font-black text-slate-700 leading-none block">
                        {t("Overtime", "ओवरटाइम")}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Segment Subtabs and History Section */}
              <div>
                <div className="text-[10px] uppercase font-black tracking-widest text-slate-400 mb-2.5">
                  {t("Transaction History Details", "मासिक लेन-देन इतिहास")}
                </div>

                {/* Polished Sub Tabs Bar */}
                <div className="flex bg-slate-100 border border-slate-150 rounded-xl p-1 shadow-3xs overflow-x-auto scrollbar-none mb-3 gap-1">
                  {(
                    [
                      "Payments",
                      "Earnings",
                      "Deductions",
                      "Overtime",
                      "Fines",
                    ] as const
                  ).map((tab) => {
                    const isSel = activeSubTab === tab;
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setActiveSubTab(tab)}
                        className={`px-3 py-1.5 h-7 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap cursor-pointer flex-1 text-center ${
                          isSel
                            ? "bg-blue-600 text-white shadow-3xs"
                            : "text-slate-500 hover:text-slate-800 hover:bg-slate-100/60"
                        }`}
                      >
                        {t(tab, tab)}
                      </button>
                    );
                  })}
                </div>

                {/* Information Banner */}
                <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-3 flex items-center gap-2.5 mb-4 text-xs text-blue-800 select-none">
                  <Icon name="info"  size={14} className="text-blue-500 shrink-0"  />
                  <span className="font-semibold text-[11px] leading-tight text-blue-950">
                    {activeSubTab === "Payments" &&
                      t(
                        "This section shows only payment records.",
                        "यह अनुभाग केवल भुगतान विवरण दिखाता है।",
                      )}
                    {activeSubTab === "Earnings" &&
                      t(
                        "This section shows only extra earning records.",
                        "यह अनुभाग केवल अतिरिक्त कमाई विवरण दिखाता है।",
                      )}
                    {activeSubTab === "Deductions" &&
                      t(
                        "This section shows only deduction records.",
                        "यह अनुभाग केवल कटौती विवरण दिखाता है।",
                      )}
                    {activeSubTab === "Overtime" &&
                      t(
                        "This section shows only overtime records.",
                        "यह अनुभाग केवल ओवरटाइम विवरण दिखाता है।",
                      )}
                    {activeSubTab === "Fines" &&
                      t(
                        "This section shows only late fine / damage records.",
                        "यह अनुभाग केवल लेट फाइन / नुकसान विवरण दिखाता है।",
                      )}
                  </span>
                </div>

                {/* Standard List Display area */}
                <div className="space-y-2">
                  {activeListSize > 0 ? (
                    <div className="bg-white border border-slate-100 rounded-2xl divide-y divide-slate-50 overflow-hidden shadow-3xs">
                      {activeSubTab === "Payments" &&
                        filteredPayments.map((p) => {
                          const modeLabel = p.mode ? ` (${p.mode})` : "";
                          const payTypeStr =
                            p.paymentType ||
                            (p.description?.includes("Advance")
                              ? "Advance Payment"
                              : p.description?.includes("Bonus")
                                ? "Bonus Payment"
                                : "Salary Payment");
                          return (
                            <div
                              key={p.id}
                              onClick={() =>
                                setSelectedTxAction({
                                  type: "Payments",
                                  item: p,
                                })
                              }
                              className="px-4 py-3.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-50/70 select-none transition-colors"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-9 h-9 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-xs">
                                  <Icon name="payments"  size={16}  />
                                </div>
                                <div className="min-w-0">
                                  <span className="text-xs font-black text-slate-800 truncate block leading-tight">
                                    {t(payTypeStr, payTypeStr)}
                                    {modeLabel}
                                  </span>
                                  <span className="text-[10px] text-slate-400 font-bold block mt-0.5">
                                    {formatTxDateTime(p.date, p.time)}
                                  </span>
                                  {p.description && (
                                    <span className="text-[10px] text-slate-500 font-medium block truncate mt-0.5 max-w-[220px]">
                                      {p.description}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <LocalSalaryDisplay
                                  value={p.amount}
                                  format={(val) => `+ ₹${val.toLocaleString("en-IN")}`}
                                  className="text-xs font-black text-emerald-600 shrink-0 font-sans"
                                />
                                <Icon name="chevron_right" 
                                  size={14}
                                  className="text-slate-300"
                                 />
                              </div>
                            </div>
                          );
                        })}

                      {activeSubTab === "Earnings" &&
                        filteredEarnings.map((e) => (
                          <div
                            key={e.id}
                            onClick={() =>
                              setSelectedTxAction({ type: "Earnings", item: e })
                            }
                            className="px-4 py-3.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-50/70 select-none transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-9 h-9 rounded-full bg-blue-500 text-white flex items-center justify-center shrink-0 shadow-xs">
                                <Icon name="trending_up"  size={16}  />
                              </div>
                              <div className="min-w-0">
                                <span className="text-xs font-black text-slate-800 truncate block leading-tight">
                                  {t("Extra Earning", "अतिरिक्त कमाई")}
                                </span>
                                <span className="text-[10px] text-slate-400 font-bold block mt-0.5">
                                  {formatTxDateTime(e.date, e.time)}
                                </span>
                                <span className="text-[10px] text-slate-500 font-medium block truncate mt-0.5 max-w-[220px]">
                                  {e.description}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <LocalSalaryDisplay
                                value={e.amount}
                                format={(val) => `+ ₹${val.toLocaleString("en-IN")}`}
                                className="text-xs font-black text-blue-600 shrink-0 font-sans"
                              />
                              <Icon name="chevron_right" 
                                size={14}
                                className="text-slate-300"
                               />
                            </div>
                          </div>
                        ))}

                      {activeSubTab === "Deductions" &&
                        filteredDeductions.map((d) => (
                          <div
                            key={d.id}
                            onClick={() =>
                              setSelectedTxAction({
                                type: "Deductions",
                                item: d,
                              })
                            }
                            className="px-4 py-3.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-50/70 select-none transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-9 h-9 rounded-full bg-rose-500 text-white flex items-center justify-center shrink-0 shadow-xs">
                                <Icon name="trending_down"  size={16}  />
                              </div>
                              <div className="min-w-0">
                                <span className="text-xs font-black text-slate-800 truncate block leading-tight">
                                  {t("Deduction", "कटौती")}
                                </span>
                                <span className="text-[10px] text-slate-400 font-bold block mt-0.5">
                                  {formatTxDateTime(d.date, d.time)}
                                </span>
                                <span className="text-[10px] text-slate-500 font-medium block truncate mt-0.5 max-w-[220px]">
                                  {d.description}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <LocalSalaryDisplay
                                value={d.amount}
                                format={(val) => `- ₹${val.toLocaleString("en-IN")}`}
                                className="text-xs font-black text-rose-600 shrink-0 font-sans"
                              />
                              <Icon name="chevron_right" 
                                size={14}
                                className="text-slate-300"
                               />
                            </div>
                          </div>
                        ))}

                      {activeSubTab === "Overtime" &&
                        filteredOvertime.map((o) => {
                          const hourlyRate = getHourlyRateForDate(o.date);
                          const displayAmt =
                            o.calcType === "HourlyRate"
                              ? hourlyRate * o.hours
                              : o.amount;
                          return (
                            <div
                              key={o.id}
                              onClick={() =>
                                setSelectedTxAction({
                                  type: "Overtime",
                                  item: o,
                                })
                              }
                              className="px-4 py-3.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-50/70 select-none transition-colors"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-9 h-9 rounded-full bg-purple-500 text-white flex items-center justify-center shrink-0 shadow-xs">
                                  <Icon name="schedule"  size={16}  />
                                </div>
                                <div className="min-w-0">
                                  <span className="text-xs font-black text-slate-800 truncate block leading-tight">
                                    {o.hours.toFixed(1)} Hrs Overtime
                                    {o.calcType === "HourlyRate" && (
                                      <span className="text-[10px] font-bold text-slate-400 ml-1">
                                        ({t("Hourly Rate", "प्रति घंटा दर")})
                                      </span>
                                    )}
                                  </span>
                                  <span className="text-[10px] text-slate-400 font-bold block mt-0.5">
                                    {formatTxDateTime(o.date, o.time)}
                                  </span>
                                  {o.description && (
                                    <span className="text-[10px] text-slate-500 font-medium block truncate mt-0.5 max-w-[220px]">
                                      {o.description}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <LocalSalaryDisplay
                                  value={displayAmt}
                                  format={(val) => `+ ₹${Math.round(val).toLocaleString("en-IN")}`}
                                  className="text-xs font-black text-purple-600 shrink-0 font-sans"
                                />
                                <Icon name="chevron_right" 
                                  size={14}
                                  className="text-slate-300"
                                 />
                              </div>
                            </div>
                          );
                        })}

                      {activeSubTab === "Fines" &&
                        filteredFines.map((f) => {
                          const hourlyRate = getHourlyRateForDate(f.date);
                          const displayAmt =
                            f.calcType === "HourlyRate"
                              ? hourlyRate * f.hours
                              : f.amount;
                          return (
                            <div
                              key={f.id}
                              onClick={() =>
                                setSelectedTxAction({ type: "Fines", item: f })
                              }
                              className="px-4 py-3.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-50/70 select-none transition-colors"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-9 h-9 rounded-full bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs">
                                  <Icon name="warning"  size={16}  />
                                </div>
                                <div className="min-w-0">
                                  <span className="text-xs font-black text-slate-800 truncate block leading-tight">
                                    Late Fine ({f.hours.toFixed(1)} Hrs)
                                  </span>
                                  <span className="text-[10px] text-slate-400 font-bold block mt-0.5">
                                    {formatTxDateTime(f.date, f.time)}
                                  </span>
                                  {f.description && (
                                    <span className="text-[10px] text-slate-500 font-medium block truncate mt-0.5 max-w-[220px]">
                                      {f.description}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <LocalSalaryDisplay
                                  value={displayAmt}
                                  format={(val) => `- ₹${Math.round(val).toLocaleString("en-IN")}`}
                                  className="text-xs font-black text-amber-600 shrink-0 font-sans"
                                />
                                <Icon name="chevron_right" 
                                  size={14}
                                  className="text-slate-300"
                                 />
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  ) : (
                    /* No records found graphic states */
                    <div className="bg-white border border-slate-100 rounded-2xl p-8 text-center flex flex-col items-center justify-center shadow-3xs py-12 select-none">
                      <div className="w-14 h-14 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 mb-3 border border-slate-100">
                        <Icon name="payments"  size={24}  />
                      </div>
                      <p className="text-xs font-black text-slate-700 uppercase tracking-widest leading-loose">
                        {activeSubTab === "Payments" &&
                          t(
                            "No payment history found",
                            "कोई भुगतान इतिहास नहीं मिला",
                          )}
                        {activeSubTab === "Earnings" &&
                          t(
                            "No earning history found",
                            "कोई अतिरिक्त कमाई इतिहास नहीं मिला",
                          )}
                        {activeSubTab === "Deductions" &&
                          t(
                            "No deduction history found",
                            "कोई कटौती इतिहास नहीं मिला",
                          )}
                        {activeSubTab === "Overtime" &&
                          t(
                            "No overtime history found",
                            "कोई ओवरटाइम इतिहास नहीं मिला",
                          )}
                        {activeSubTab === "Fines" &&
                          t(
                            "No fine history found",
                            "कोई लेट फाइन इतिहास नहीं मिला",
                          )}
                      </p>
                      <p className="text-[10px] text-slate-400 font-semibold mt-1 max-w-xs leading-normal">
                        {t(
                          "Add transactions easily using the action cards above or start recording details below.",
                          "ऊपर दिए गए एक्शन कार्ड का उपयोग करके लेनदेन आसानी से जोड़ें।",
                        )}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          if (activeSubTab === "Payments") {
                            const pNames = db.company?.paidByNames || ['by Pankaj', 'by Vinod', 'by Babuji', 'by ghar vale'];
                            setPaymentForm({
                              isOpen: true,
                              amount: "",
                              date: getDefaultDateForNavPeriod(),
                              mode: "Cash",
                              description: "",
                              paymentType: "Salary Payment",
                              time: getCurrentTimeFormatted(),
                              paidBy: pNames[0] || "",
                            });
                          } else if (activeSubTab === "Earnings") {
                            setEarningForm({
                              isOpen: true,
                              amount: "",
                              date: getDefaultDateForNavPeriod(),
                              description: "",
                              time: getCurrentTimeFormatted(),
                            });
                          } else if (activeSubTab === "Deductions") {
                            setDeductionForm({
                              isOpen: true,
                              amount: "",
                              date: getDefaultDateForNavPeriod(),
                              description: "",
                              time: getCurrentTimeFormatted(),
                            });
                          } else if (activeSubTab === "Overtime") {
                            setOvertimeForm({
                              isOpen: true,
                              date: getDefaultDateForNavPeriod(),
                              hours: "",
                              calcType: "HourlyRate",
                              amount: "",
                              description: "",
                              time: getCurrentTimeFormatted(),
                            });
                          } else if (activeSubTab === "Fines") {
                            setLateFineForm({
                              isOpen: true,
                              date: getDefaultDateForNavPeriod(),
                              hours: "",
                              calcType: "HourlyRate",
                              amount: "",
                              description: "",
                              time: getCurrentTimeFormatted(),
                            });
                          }
                        }}
                        className="mt-4 px-4 h-8.5 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-black rounded-xl text-[10px] uppercase shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Icon name="add"  size={12}  />
                        <span>
                          {activeSubTab === "Payments" &&
                            t("Record First Payment", "पहला भुगतान दर्ज करें")}
                          {activeSubTab === "Earnings" &&
                            t("Add First Earning", "पहली कमाई जोड़ें")}
                          {activeSubTab === "Deductions" &&
                            t("Add First Deduction", "पहली कटौती जोड़ें")}
                          {activeSubTab === "Overtime" &&
                            t("Add First Overtime", "पहला ओवरटाइम जोड़ें")}
                          {activeSubTab === "Fines" &&
                            t("Add First Fine", "पहला लेट फाइन जोड़ें")}
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

      {/* --- CLICKABLE CARD DETAILED BREAKDOWN MODAL OVERLAYS (Requirement 15) --- */}
      {breakdownModal?.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-end sm:items-center justify-center z-150 p-4 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl pb-6 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden animate-in slide-in-from-bottom duration-300">
            <div className="m-hnd mt-3 mb-1 sm:hidden" />
            <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-slate-900 font-sans tracking-wide uppercase">
                  {breakdownModal.title}
                </h3>
                <p className="text-[10px] text-slate-400 font-bold font-sans uppercase mt-0.5">
                  {MN[navMonth]} {navYear}
                </p>
              </div>
              <button
                onClick={() => setBreakdownModal(null)}
                className="w-8 h-8 rounded-full bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            {/* Scrollable listing box */}
            <div className="p-6 overflow-y-auto space-y-3 hide-scrollbar flex-1">
              {/* Previous Month Carry Over Breakdown listings */}
              {breakdownModal.type === "prevDue" && (
                <div className="text-xs font-semibold text-slate-600 pr-1 select-none">
                  <div className="bg-amber-50 text-amber-805 border border-amber-200 rounded-xl p-3 mb-4 leading-relaxed font-sans font-medium text-xs">
                    {t(
                      "Previous month carry forward is dynamically calculated sequentially month-by-month starting from joining date.",
                      "पिछले महीनों का बकाया ज्वाइनिंग तिथि से लेकर लगातार क्रमिक रूप से संचित किया जाता है।",
                    )}
                  </div>
                  <div className="flex justify-between font-extrabold text-sm border-b border-slate-100 pb-2 mb-2 text-slate-800 select-all">
                    <span>
                      {t("Calculated Accrued Dues", "प्राप्त बकाया राशि")}
                    </span>
                    <LocalSalaryDisplay
                      value={financials.previousDue}
                      format={(val) => `₹${Math.round(val).toLocaleString("en-IN")}`}
                      className="font-mono text-amber-600 font-bold"
                    />
                  </div>
                </div>
              )}

              {/* Earnings Breakdown */}
              {breakdownModal.type === "earnings" && (
                <div className="space-y-2 select-text">
                  {metrics.details.earningsRows.length > 0 ? (
                    metrics.details.earningsRows.map((row, idx) => (
                      <div
                        key={idx}
                        className="border border-slate-50 rounded-xl p-3 bg-slate-50/50 flex justify-between gap-3 shadow-xs"
                      >
                        <div>
                          <span className="text-xs font-extrabold text-slate-800 font-mono block">
                            {row.date}
                          </span>
                          <span className="text-[11px] text-slate-405 font-semibold">
                            {row.label}
                          </span>
                        </div>
                        <LocalSalaryDisplay
                          value={row.value}
                          format={(val) => `₹${Math.round(val).toLocaleString("en-IN")}`}
                          className="text-xs font-black text-slate-800 font-mono"
                        />
                      </div>
                    ))
                  ) : (
                    <p className="text-center text-xs text-slate-400 py-6">
                      {t(
                        "No attendance wage earned.",
                        "कोई उपस्थिति/हाजिरी मजदूरी अर्जित नहीं की गई।",
                      )}
                    </p>
                  )}
                </div>
              )}

              {/* Overtime (OT) Breakdown */}
              {breakdownModal.type === "overtime" && (
                <div className="space-y-2">
                  {metrics.details.overtimeRows.length > 0 ? (
                    metrics.details.overtimeRows.map((row, idx) => (
                      <div
                        key={idx}
                        className="border border-slate-50 rounded-xl p-3 bg-blue-50/20 flex justify-between gap-3"
                      >
                        <div>
                          <span className="text-xs font-extrabold text-slate-800 font-mono block">
                            {row.date}
                          </span>
                          <span className="text-[11px] text-slate-405 font-semibold leading-tight">
                            {row.desc}
                          </span>
                        </div>
                        <LocalSalaryDisplay
                          value={row.amount}
                          format={(val) => `+₹${Math.round(val).toLocaleString("en-IN")}`}
                          className="text-xs font-black text-blue-600 font-mono"
                        />
                      </div>
                    ))
                  ) : (
                    <p className="text-center text-xs text-slate-405 py-6">
                      {t(
                        "No overtime wages registered.",
                        "कोई अतिरिक्त समय वेतन दर्ज नहीं है।",
                      )}
                    </p>
                  )}
                </div>
              )}

              {/* Extra Earnings Breakdown */}
              {breakdownModal.type === "extra" && (
                <div className="space-y-2">
                  {metrics.details.extraEarningsRows.length > 0 ? (
                    metrics.details.extraEarningsRows.map((row, idx) => (
                      <div
                        key={idx}
                        className="border border-slate-50 rounded-xl p-3 bg-emerald-50/20 flex justify-between gap-3"
                      >
                        <div>
                          <span className="text-xs font-extrabold text-slate-800 font-mono block">
                            {row.date}
                          </span>
                          <span className="text-[11px] text-slate-405 font-semibold leading-tight">
                            {row.desc}
                          </span>
                        </div>
                        <LocalSalaryDisplay
                          value={row.amount}
                          format={(val) => `+₹${Math.round(val).toLocaleString("en-IN")}`}
                          className="text-xs font-black text-emerald-600 font-mono"
                        />
                      </div>
                    ))
                  ) : (
                    <p className="text-center text-xs text-slate-405 py-6">
                      {t(
                        "No extra bonuses or incentives listed.",
                        "कोई अतिरिक्त इंसेंटिव या बोनस नहीं है।",
                      )}
                    </p>
                  )}
                </div>
              )}

              {/* Deductions Breakdown */}
              {breakdownModal.type === "deductions" && (
                <div className="space-y-2">
                  {metrics.details.deductionsRows.length > 0 ? (
                    metrics.details.deductionsRows.map((row, idx) => (
                      <div
                        key={idx}
                        className="border border-slate-50 rounded-xl p-3 bg-rose-50/20 flex justify-between gap-3 animate-in"
                      >
                        <div>
                          <span className="text-xs font-extrabold text-slate-805 font-mono block">
                            {row.date}
                          </span>
                          <span className="text-[11px] text-slate-405 font-semibold leading-tight">
                            {row.desc}
                          </span>
                        </div>
                        <LocalSalaryDisplay
                          value={row.amount}
                          format={(val) => `-₹${Math.round(val).toLocaleString("en-IN")}`}
                          className="text-xs font-black text-rose-600 font-mono"
                        />
                      </div>
                    ))
                  ) : (
                    <p className="text-center text-xs text-slate-405 py-6">
                      {t(
                        "No monthly penalties or fine deductions listed.",
                        "कोई दण्ड या कटौती दर्ज नहीं है।",
                      )}
                    </p>
                  )}
                </div>
              )}

              {/* Payments Breakdown */}
              {breakdownModal.type === "payments" && (
                <div className="space-y-2">
                  {metrics.details.paymentsRows.length > 0 ? (
                    metrics.details.paymentsRows.map((row, idx) => (
                      <div
                        key={idx}
                        className="border border-slate-50 rounded-xl p-3 bg-slate-50 flex justify-between gap-3"
                      >
                        <div>
                          <span className="text-xs font-extrabold text-slate-805 font-mono block">
                            {row.date} ({row.mode})
                          </span>
                          <span className="text-[11px] text-slate-405 font-semibold leading-tight">
                            {row.desc}
                          </span>
                        </div>
                        <LocalSalaryDisplay
                          value={row.amount}
                          format={(val) => `-₹${Math.round(val).toLocaleString("en-IN")}`}
                          className="text-xs font-black text-slate-805 font-mono"
                        />
                      </div>
                    ))
                  ) : (
                    <p className="text-center text-xs text-slate-405 py-6">
                      {t(
                        "No payment entries recorded.",
                        "किया गया कोई भी अग्रिम भुगतान दर्ज नहीं है।",
                      )}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- PAYMENT POP_ENTRY DIALOG REBUILD (Requirements 8 & 23) --- */}
      {paymentForm?.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-end sm:items-center justify-center z-150 p-4 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-t-2xl sm:rounded-2xl pb-6 shadow-2xl animate-in slide-in-from-bottom duration-300">
            <div className="m-hnd mt-3 mb-1 sm:hidden" />
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-800 font-sans tracking-wide uppercase">
                {paymentForm.id
                  ? t("Edit Recorded Payment", "भुगतान प्रविष्टि संपादन")
                  : t("Record Fresh Payment", "नया भुगतान दर्ज करें")}
              </h3>
              <button
                onClick={() => setPaymentForm(null)}
                className="w-8 h-8 rounded-full bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <div className="px-6 pt-4 space-y-4">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs">
                <div className="font-extrabold text-slate-900">{emp.name}</div>
                <div className="text-slate-655 font-semibold mt-1">
                  {t("Accrued master balance:", "कुल बकाया देय शेष:")}{" "}
                  <LocalSalaryDisplay
                    value={totalBalanceDueNow}
                    format={(val) => `₹${Math.round(val).toLocaleString("en-IN")}`}
                    className="font-bold text-blue-700"
                  />
                </div>
              </div>

              {/* Amount - Default to empty! (Requirement 8) */}
              <div className="fld">
                <label className="text-xs font-bold text-slate-600 block mb-1">
                  {t("Payment Amount (₹)", "भुगतान राशि")}{" "}
                  <span className="text-red-500">*</span>
                </label>
                <div className="rw">
                  <span className="rs">₹</span>
                  <input
                    type="number"
                    value={paymentForm.amount}
                    onChange={(e) =>
                      setPaymentForm({ ...paymentForm, amount: e.target.value })
                    }
                    placeholder="Enter amount"
                    className="fi"
                    inputMode="numeric"
                  />
                </div>
              </div>

              {/* Date */}
              <div className="fld">
                <label className="text-xs font-bold text-slate-600 block mb-1">
                  {t("Payment Date", "भुगतान प्राप्त तारीख")}{" "}
                  <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={paymentForm.date}
                  onChange={(e) =>
                    setPaymentForm({ ...paymentForm, date: e.target.value })
                  }
                  className="fi"
                />
              </div>

              {/* Time */}
              <div className="fld">
                <label className="text-xs font-bold text-slate-600 block mb-1">
                  {t("Payment Time", "समय")}{" "}
                  <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={paymentForm.time || "09:00 AM"}
                  onChange={(e) =>
                    setPaymentForm({ ...paymentForm, time: e.target.value })
                  }
                  placeholder="e.g. 09:00 AM"
                  className="fi"
                />
              </div>

              {/* Payment Mode options (Cash, UPI, Bank Transfer, Cheque) */}
              <div className="fld">
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  {t("Payment Mode", "भुगतान माध्यम")}{" "}
                  <span className="text-red-500">*</span>
                </label>
                <div className="pchips select-none">
                  {(
                    ["Cash", "UPI", "Bank Transfer", "Cheque"] as PaymentMode[]
                  ).map((m) => (
                    <div
                      key={m}
                      onClick={() =>
                        setPaymentForm({ ...paymentForm, mode: m })
                      }
                      className={`pch ${paymentForm.mode === m ? "sel" : ""}`}
                    >
                      {m}
                    </div>
                  ))}
                </div>
              </div>

              {/* Paid By Selection */}
              <div className="fld">
                <label className="text-xs font-bold text-slate-600 block mb-1">
                  {t("Paid By", "भुगतानकर्ता (Paid By)")} <span className="text-red-500">*</span>
                </label>
                <select
                  value={paymentForm.paidBy || ""}
                  onChange={(e) =>
                    setPaymentForm({ ...paymentForm, paidBy: e.target.value })
                  }
                  className="fi bg-white"
                >
                  {(db.company?.paidByNames || ['by Pankaj', 'by Vinod', 'by Babuji', 'by ghar vale']).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Notes - blank initially */}
              <div className="fld">
                <label className="text-xs font-bold text-slate-600 block mb-1">
                  {t("Notes (optional)", "टिप्पणी / विवरण")}
                </label>
                <input
                  type="text"
                  value={paymentForm.description}
                  onChange={(e) =>
                    setPaymentForm({
                      ...paymentForm,
                      description: e.target.value,
                    })
                  }
                  placeholder={t(
                    "e.g. Salary advance",
                    "जैसे: जून अग्रिम या बोनस",
                  )}
                  className="fi"
                />
              </div>
            </div>

            <div className="px-6 pt-4 flex gap-3 text-xs">
              <button
                onClick={() => setPaymentForm(null)}
                className="flex-1 btn bou font-bold"
              >
                {t("Cancel", "रद्द करें")}
              </button>
              <button
                onClick={savePayment}
                className="flex-1 btn bbl font-bold text-white shadow-xs"
              >
                {t("Save", "सुरक्षित करें")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- STANDARD EARNINGS DIALOG MODAL --- */}
      {earningForm?.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-end sm:items-center justify-center z-150 p-4 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-t-2xl sm:rounded-2xl pb-6 shadow-2xl animate-in slide-in-from-bottom duration-300">
            <div className="m-hnd mt-3 mb-1 sm:hidden" />
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-800 font-sans tracking-wide uppercase">
                {earningForm.id
                  ? t("Edit Extra Earning", "अतिरिक्त कमाई संपादित करें")
                  : t("Add Extra Earning", "अतिरिक्त कमाई दर्ज करें")}
              </h3>
              <button
                onClick={() => setEarningForm(null)}
                className="w-8 h-8 rounded-full bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="fld">
                <label className="text-xs font-bold block mb-1">
                  {t("Amount (₹) *", "राशि (₹) *")}
                </label>
                <div className="rw">
                  <span className="rs">₹</span>
                  <input
                    type="number"
                    value={earningForm.amount}
                    onChange={(e) =>
                      setEarningForm({ ...earningForm, amount: e.target.value })
                    }
                    className="fi"
                  />
                </div>
              </div>
              <div className="fld">
                <label className="text-xs font-bold block mb-1">{t("Date *", "तारीख *")}</label>
                <input
                  type="date"
                  value={earningForm.date}
                  onChange={(e) =>
                    setEarningForm({ ...earningForm, date: e.target.value })
                  }
                  className="fi"
                />
              </div>
              <div className="fld">
                <label className="text-xs font-bold block mb-1">
                  {t("Time *", "समय *")}
                </label>
                <input
                  type="text"
                  value={earningForm.time || "09:00 AM"}
                  onChange={(e) =>
                    setEarningForm({ ...earningForm, time: e.target.value })
                  }
                  placeholder="e.g. 09:00 AM"
                  className="fi"
                />
              </div>
              <div className="fld">
                <label className="text-xs font-bold block mb-1">
                  {t("Description (Bonus, Extra Work, Cow Dung Work, Incentive)", "विवरण (बोनस, अतिरिक्त कार्य, गोबर कार्य, आदि)")}
                </label>
                <input
                  type="text"
                  value={earningForm.description}
                  onChange={(e) =>
                    setEarningForm({
                      ...earningForm,
                      description: e.target.value,
                    })
                  }
                  placeholder="e.g. Cow Dung Work Incentive"
                  className="fi"
                />
              </div>
            </div>
            <div className="px-6 flex gap-3 text-xs">
              <button
                onClick={() => setEarningForm(null)}
                className="flex-1 btn bou font-bold"
              >
                {t("Cancel", "रद्द करें")}
              </button>
              <button
                onClick={saveEarning}
                className="flex-1 btn bbl font-bold text-white shadow-xs"
              >
                {t("Save", "सुरक्षित करें")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- STANDARD DEDUCTION DIALOG MODAL --- */}
      {deductionForm?.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-end sm:items-center justify-center z-150 p-4 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-t-2xl sm:rounded-2xl pb-6 shadow-2xl animate-in slide-in-from-bottom duration-300">
            <div className="m-hnd mt-3 mb-1 sm:hidden" />
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-800 font-sans tracking-wide uppercase">
                {deductionForm.id
                  ? t("Edit Deduction Entry", "कटौती प्रविष्टि संपादित करें")
                  : t("Add Deduction Entry", "कटौती दर्ज करें")}
              </h3>
              <button
                onClick={() => setDeductionForm(null)}
                className="w-8 h-8 rounded-full bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="fld">
                <label className="text-xs font-bold block mb-1">
                  {t("Amount (₹) *", "राशि (₹) *")}
                </label>
                <div className="rw">
                  <span className="rs">₹</span>
                  <input
                    type="number"
                    value={deductionForm.amount}
                    onChange={(e) =>
                      setDeductionForm({
                        ...deductionForm,
                        amount: e.target.value,
                      })
                    }
                    className="fi"
                  />
                </div>
              </div>
              <div className="fld">
                <label className="text-xs font-bold block mb-1">{t("Date *", "तारीख *")}</label>
                <input
                  type="date"
                  value={deductionForm.date}
                  onChange={(e) =>
                    setDeductionForm({ ...deductionForm, date: e.target.value })
                  }
                  className="fi"
                />
              </div>
              <div className="fld">
                <label className="text-xs font-bold block mb-1">
                  {t("Time *", "समय *")}
                </label>
                <input
                  type="text"
                  value={deductionForm.time || "09:00 AM"}
                  onChange={(e) =>
                    setDeductionForm({ ...deductionForm, time: e.target.value })
                  }
                  placeholder="e.g. 09:00 AM"
                  className="fi"
                />
              </div>
              <div className="fld">
                <label className="text-xs font-bold block mb-1">
                  {t("Description (Damage, Penalty, Advance Recovery)", "विवरण (नुकसान, जुर्माना, अग्रिम वसूली)")}
                </label>
                <input
                  type="text"
                  value={deductionForm.description}
                  onChange={(e) =>
                    setDeductionForm({
                      ...deductionForm,
                      description: e.target.value,
                    })
                  }
                  placeholder="e.g. Damage recovery fine"
                  className="fi"
                />
              </div>
            </div>
            <div className="px-6 flex gap-3 text-xs">
              <button
                onClick={() => setDeductionForm(null)}
                className="flex-1 btn bou font-bold"
              >
                {t("Cancel", "रद्द करें")}
              </button>
              <button
                onClick={saveDeduction}
                className="flex-1 btn bbl font-bold text-white shadow-xs"
              >
                {t("Save", "सुरक्षित करें")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- OVERTIME MODULE POP DIALOGS (Requirement 17) --- */}
      {overtimeForm?.isOpen &&
        (() => {
          const numOtHours = parseFloat(overtimeForm.hours) || 0;
          const otH = Math.floor(numOtHours);
          const otM = Math.round((numOtHours - otH) * 60);
          const otHourlyRate = getHourlyRateForDate(overtimeForm.date);
          const computedOtAmount = otHourlyRate * numOtHours;
          const finalOtAmount =
            overtimeForm.calcType === "HourlyRate"
              ? computedOtAmount
              : parseFloat(overtimeForm.amount) || 0;

          return (
            <div className="fixed inset-0 bg-slate-900/60 flex items-end sm:items-center justify-center z-150 p-4 backdrop-blur-xs animate-in fade-in duration-200">
              <div className="bg-white w-full max-w-sm rounded-t-2xl sm:rounded-2xl pb-6 shadow-2xl animate-in slide-in-from-bottom duration-300">
                <div className="m-hnd mt-3 mb-1 sm:hidden animate-in" />
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-sm font-extrabold text-slate-800 font-sans tracking-wide uppercase">
                    {t("Overtime (OT) Record", "अतिरिक्त समय (OT) प्रविष्टि")}
                  </h3>
                  <button
                    onClick={() => setOvertimeForm(null)}
                    className="w-8 h-8 rounded-full bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
                  >
                    <Icon name="close" size={18} />
                  </button>
                </div>

                <div className="px-6 pt-4 space-y-4">
                  <div className="fld">
                    <label className="text-xs font-bold block mb-1">
                      {t("Date *", "तारीख *")}
                    </label>
                    <input
                      type="date"
                      value={overtimeForm.date}
                      onChange={(e) =>
                        setOvertimeForm({
                          ...overtimeForm,
                          date: e.target.value,
                        })
                      }
                      className="fi"
                    />
                  </div>

                  <div className="fld">
                    <label className="text-xs font-bold block mb-1">
                      {t("Time *", "समय *")}
                    </label>
                    <input
                      type="text"
                      value={overtimeForm.time || "09:00 AM"}
                      onChange={(e) =>
                        setOvertimeForm({
                          ...overtimeForm,
                          time: e.target.value,
                        })
                      }
                      placeholder="e.g. 09:00 AM"
                      className="fi"
                    />
                  </div>

                  <div className="fld">
                    <label className="text-xs font-bold block mb-2">
                      {t("Overtime Duration *", "अतिरिक्त समय अवधि *")}
                    </label>
                    <InlineDurationPicker
                      hours={otH}
                      minutes={otM}
                      onChange={(h, m) => {
                        const decimalHours = h + m / 60;
                        setOvertimeForm({
                          ...overtimeForm,
                          hours: String(decimalHours),
                        });
                      }}
                    />
                  </div>

                  <div className="fld">
                    <label className="text-xs font-bold block mb-2.5">
                      {t("Calculation Type *", "गणना प्रकार *")}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setOvertimeForm({
                            ...overtimeForm,
                            calcType: "HourlyRate",
                          })
                        }
                        className="h-10 rounded-xl text-xs font-extrabold transition-all border bg-blue-600 text-white border-blue-600 shadow-xs"
                      >
                        {t("Hourly Rate", "घंटे की दर")}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setOvertimeForm({
                            ...overtimeForm,
                            calcType: "CustomAmount",
                          })
                        }
                        className="h-10 rounded-xl text-xs font-extrabold transition-all border bg-white border-slate-200 text-slate-600"
                      >
                        {t("Custom Cash", "कस्टम राशि")}
                      </button>
                    </div>
                  </div>

                  {overtimeForm.calcType === "CustomAmount" && (
                    <div className="fld animate-in slide-in-from-top-1">
                      <label className="text-xs font-bold block mb-1">
                        {t("Custom Amount (₹) *", "कस्टम राशि (₹) *")}
                      </label>
                      <div className="rw">
                        <span className="rs">₹</span>
                        <input
                          type="number"
                          value={overtimeForm.amount}
                          onChange={(e) =>
                            setOvertimeForm({
                              ...overtimeForm,
                              amount: e.target.value,
                            })
                          }
                          className="fi"
                        />
                      </div>
                    </div>
                  )}

                  <div className="fld">
                    <label className="text-xs font-bold block mb-1">
                      {t("Description", "विवरण")}
                    </label>
                    <input
                      type="text"
                      value={overtimeForm.description}
                      onChange={(e) =>
                        setOvertimeForm({
                          ...overtimeForm,
                          description: e.target.value,
                        })
                      }
                      placeholder="Extra evening shift"
                      className="fi"
                    />
                  </div>

                  {/* Live Preview Card */}
                  <div className="bg-blue-50/50 border border-blue-100/60 rounded-2xl p-4 space-y-2 my-2">
                    <div className="flex justify-between items-center text-[10px] font-extrabold text-blue-800 tracking-wider">
                      <span>{t("LIVE PREVIEW", "लाइव पूर्वावलोकन")}</span>
                      <span className="font-mono font-bold">₹{otHourlyRate.toFixed(2)}/hr</span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-slate-600">
                      <span>{t("Duration:", "अवधि:")}</span>
                      <span className="font-bold text-slate-800 font-mono">
                        {otH}h {otM}m
                      </span>
                    </div>
                    <div className="h-[1px] bg-blue-100/60"></div>
                    <div className="flex justify-between items-center text-xs font-bold pt-1">
                      <span className="text-blue-800 font-bold">
                        {t("Total OT Pay:", "कुल अतिरिक्त वेतन:")}
                      </span>
                      <span className="text-sm text-blue-900 font-extrabold font-mono">
                        ₹{finalOtAmount.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="px-6 pt-4 flex gap-3 text-xs">
                  <button
                    onClick={() => setOvertimeForm(null)}
                    className="flex-1 btn bou font-bold"
                  >
                    {t("Cancel", "रद्द करें")}
                  </button>
                  <button
                    onClick={saveOvertime}
                    className="flex-1 btn bbl font-bold text-white shadow-xs"
                  >
                    {t("Save", "सुरक्षित करें")}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* --- LATE FINE MODULE POP DIALOGS (Requirement 18) --- */}
      {lateFineForm?.isOpen &&
        (() => {
          const numLfHours = parseFloat(lateFineForm.hours) || 0;
          const lfH = Math.floor(numLfHours);
          const lfM = Math.round((numLfHours - lfH) * 60);
          const lfHourlyRate = getHourlyRateForDate(lateFineForm.date);
          const computedLfAmount = lfHourlyRate * numLfHours;
          const finalLfAmount =
            lateFineForm.calcType === "HourlyRate"
              ? computedLfAmount
              : parseFloat(lateFineForm.amount) || 0;

          return (
            <div className="fixed inset-0 bg-slate-900/60 flex items-end sm:items-center justify-center z-150 p-4 backdrop-blur-xs animate-in fade-in duration-200">
              <div className="bg-white w-full max-w-sm rounded-t-2xl sm:rounded-2xl pb-6 shadow-2xl animate-in slide-in-from-bottom duration-300">
                <div className="m-hnd mt-3 mb-1 sm:hidden animate-in" />
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-sm font-extrabold text-slate-800 font-sans tracking-wide uppercase">
                    {t("Late Fine Record", "विलंब जुर्माना (Fine) प्रविष्टि")}
                  </h3>
                  <button
                    onClick={() => setLateFineForm(null)}
                    className="w-8 h-8 rounded-full bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
                  >
                    <Icon name="close" size={18} />
                  </button>
                </div>

                <div className="px-6 pt-4 space-y-4">
                  <div className="fld">
                    <label className="text-xs font-bold block mb-1">
                      {t("Date *", "तारीख *")}
                    </label>
                    <input
                      type="date"
                      value={lateFineForm.date}
                      onChange={(e) =>
                        setLateFineForm({
                          ...lateFineForm,
                          date: e.target.value,
                        })
                      }
                      className="fi"
                    />
                  </div>

                  <div className="fld animate-in slide-in-from-top-1 duration-150">
                    <label className="text-xs font-bold block mb-1">
                      {t("Time *", "समय *")}
                    </label>
                    <input
                      type="text"
                      value={lateFineForm.time || "09:00 AM"}
                      onChange={(e) =>
                        setLateFineForm({
                          ...lateFineForm,
                          time: e.target.value,
                        })
                      }
                      placeholder="e.g. 09:00 AM"
                      className="fi"
                    />
                  </div>

                  <div className="fld">
                    <label className="text-xs font-bold block mb-2">
                      {t("Late Duration *", "विलंब अवधि *")}
                    </label>
                    <InlineDurationPicker
                      hours={lfH}
                      minutes={lfM}
                      onChange={(h, m) => {
                        const decimalHours = h + m / 60;
                        setLateFineForm({
                          ...lateFineForm,
                          hours: String(decimalHours),
                        });
                      }}
                    />
                  </div>

                  <div className="fld">
                    <label className="text-xs font-bold block mb-2.5">
                      {t("Calculation Type *", "गणना प्रकार *")}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setLateFineForm({
                            ...lateFineForm,
                            calcType: "HourlyRate",
                          })
                        }
                        className="h-10 rounded-xl text-xs font-extrabold transition-all border bg-rose-600 text-white border-rose-600 shadow-xs"
                      >
                        {t("Hourly Rate", "घंटे की दर")}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setLateFineForm({
                            ...lateFineForm,
                            calcType: "CustomAmount",
                          })
                        }
                        className="h-10 rounded-xl text-xs font-extrabold transition-all border bg-white border-slate-200 text-slate-605"
                      >
                        {t("Custom Cash", "कस्टम राशि")}
                      </button>
                    </div>
                  </div>

                  {lateFineForm.calcType === "CustomAmount" && (
                    <div className="fld animate-in slide-in-from-top-1">
                      <label className="text-xs font-bold block mb-1">
                        {t("Custom Amount (₹) *", "कस्टम राशि (₹) *")}
                      </label>
                      <div className="rw">
                        <span className="rs">₹</span>
                        <input
                          type="number"
                          value={lateFineForm.amount}
                          onChange={(e) =>
                            setLateFineForm({
                              ...lateFineForm,
                              amount: e.target.value,
                            })
                          }
                          className="fi"
                        />
                      </div>
                    </div>
                  )}

                  <div className="fld">
                    <label className="text-xs font-bold block mb-1">
                      {t("Description", "विवरण")}
                    </label>
                    <input
                      type="text"
                      value={lateFineForm.description}
                      onChange={(e) =>
                        setLateFineForm({
                          ...lateFineForm,
                          description: e.target.value,
                        })
                      }
                      placeholder="Late arrival deduction"
                      className="fi"
                    />
                  </div>

                  {/* Live Preview Card */}
                  <div className="bg-rose-50/50 border border-rose-100/60 rounded-2xl p-4 space-y-2 my-2">
                    <div className="flex justify-between items-center text-[10px] font-extrabold text-rose-800 tracking-wider">
                      <span>{t("LIVE PREVIEW", "लाइव पूर्वावलोकन")}</span>
                      <span className="font-mono font-bold font-sans">₹{lfHourlyRate.toFixed(2)}/hr</span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-slate-650">
                      <span>{t("Late Duration:", "विलंब अवधि:")}</span>
                      <span className="font-bold text-slate-800 font-mono">
                        {lfH}h {lfM}m
                      </span>
                    </div>
                    <div className="h-[1px] bg-rose-100/60"></div>
                    <div className="flex justify-between items-center text-xs font-bold pt-1">
                      <span className="text-rose-800 font-bold">
                        {t("Total Late Fine:", "कुल जुर्माना:")}
                      </span>
                      <span className="text-sm text-rose-900 font-extrabold font-mono">
                        ₹{finalLfAmount.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="px-6 pt-4 flex gap-3 text-xs">
                  <button
                    onClick={() => setLateFineForm(null)}
                    className="flex-1 btn bou font-bold"
                  >
                    {t("Cancel", "रद्द करें")}
                  </button>
                  <button
                    onClick={saveLateFine}
                    className="flex-1 btn bg-rose-600 hover:bg-rose-700 text-white font-bold shadow-xs transition-all"
                  >
                    {t("Save", "सुरक्षित करें")}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* --- SALARY HISTORY RATE OVERRIDES MODAL (Requirement 16) --- */}
      {prevRatesModal && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-end sm:items-center justify-center z-150 p-4 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-t-2xl sm:rounded-2xl pb-6 shadow-2xl animate-in slide-in-from-bottom duration-300">
            <div className="m-hnd mt-3 mb-1 sm:hidden animate-in" />
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-800 font-sans tracking-wide uppercase">
                {t(
                  "Salary Rates Configurations",
                  "वेतन दरों का सुधारात्मक ढाँचा",
                )}
              </h3>
              <button
                onClick={() => setPrevRatesModal(false)}
                className="w-8 h-8 rounded-full bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {/* Option toggle choices */}
              <div className="fld">
                <label className="text-xs font-bold text-slate-500 block mb-1.5">
                  {t("Rates Scops Selection", "दर परिवर्तन का क्षेत्र")}
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setRateOption("current")}
                    className="flex-1 h-10 border rounded-xl text-xs font-extrabold transition-all"
                  >
                    {t("Current & Future", "वर्तमान और भविष्य में")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRateOption("history")}
                    className="flex-1 h-10 border rounded-xl text-xs font-extrabold transition-all"
                  >
                    {t("Historical Salaries", "इतिहास/पीछे के महीने")}
                  </button>
                </div>
              </div>

              {rateOption === "history" && (
                <div className="fld animate-in">
                  <label className="text-xs font-bold block text-slate-600 mb-1">
                    {t("Select Month YYYY-MM", "महीना चुनें और वर्ष")}
                  </label>
                  <input
                    type="month"
                    value={editRateYm}
                    onChange={(e) => setEditRateYm(e.target.value)}
                    className="fi"
                  />
                </div>
              )}

              {/* Rate Value */}
              <div className="fld">
                <label className="text-xs font-bold block text-slate-605 mb-1">
                  {t("Modified Wage Amount (₹)", "परिवर्तित दर/वेतन का मूल्य")}
                </label>
                <div className="rw">
                  <span className="rs">₹</span>
                  <input
                    type="number"
                    value={editRateVal}
                    onChange={(e) => setEditRateVal(e.target.value)}
                    placeholder="Enter rates value"
                    className="fi"
                    inputMode="numeric"
                  />
                </div>
              </div>

              {/* Dynamic calculations notice */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs leading-relaxed text-blue-855 font-sans font-medium">
                {t(
                  "Option B (Historical Rates) modifies ONLY the targeted month sequentially, instantly updating all carrying balance carry forward computations sequentially across next months.",
                  "विकल्प B के तहत किसी भी पिछले महीने की दर बदलने पर उससे जुड़े हुए आगे के सभी महीनों के संचित बकाया तथा शेष का पुनर्गणना स्वतः सुधर जाती है।",
                )}
              </div>
            </div>

            <div className="px-6 flex gap-3 text-xs">
              <button
                onClick={() => setPrevRatesModal(false)}
                className="flex-1 btn bou font-bold"
              >
                {t("Cancel", "रद्द करें")}
              </button>
              <button
                onClick={saveHistoricalRate}
                className="flex-1 btn bbl text-white font-bold shadow-xs"
              >
                {t("Apply Updates", "लागू करें")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1. Custom Delete Confirm Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-200 animate-in fade-in duration-200">
          <div className="bg-white border border-slate-100 rounded-3xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mb-4 mx-auto animate-in zoom-in duration-300">
              <Icon name="warning" size={24} className="text-rose-600" />
            </div>
            <h3 className="text-sm font-black text-slate-900 text-center uppercase tracking-tight">
              {t("PERMANENT DELETE WARNING", "स्थायी विलोपन चेतावनी")}
            </h3>
            <p className="text-xs text-slate-500 font-sans font-medium text-center leading-relaxed mt-2">
              {t(
                "This will permanently purge this employee plus ALL their transaction logs, attendance entries, and historical balances. This action is IRREVERSIBLE. Proceed?",
                "यह इस कर्मचारी और उनके सभी भुगतान प्रविष्टियों, दैनिक इतिहास, और पिछले शेष को मिटा देगा। यह कार्रवाई अपरिवर्तनीय है। क्या आप जारी रखना चाहते हैं?",
              )}
            </p>
            {/* PIN Input Field */}
            <div className="mt-4 space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block">
                {t("Enter 4-Digit Admin PIN", "4-अंकीय एडमिन पिन दर्ज करें")}
              </label>
              <input
                type="password"
                maxLength={4}
                value={deletePin}
                onChange={(e) => setDeletePin(e.target.value.replace(/\D/g, ""))}
                placeholder="••••"
                className="w-full h-10 border border-slate-200 rounded-xl text-center font-mono font-black text-lg tracking-widest bg-slate-50 outline-none focus:border-blue-500 focus:bg-white transition-all"
              />
            </div>
            <div className="flex gap-3 mt-6 text-xs font-bold font-sans">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 btn bou font-bold"
              >
                {t("No, Cancel", "नहीं, रद्द करें")}
              </button>
              <button
                onClick={() => {
                  const correctPin = db.company?.adminPin || "1234";
                  if (deletePin !== correctPin) {
                    alert(t("Incorrect Admin PIN!", "गलत एडमिन पिन!"));
                    return;
                  }
                  setShowDeleteConfirm(false);

                  // Filter all tables
                  const employees = db.employees.filter(
                    (e) => e.id !== employeeId,
                  );
                  const payments = db.payments.filter(
                    (p) => p.employeeId !== employeeId,
                  );
                  const earnings = db.earnings.filter(
                    (e) => e.employeeId !== employeeId,
                  );
                  const deductions = db.deductions.filter(
                    (d) => d.employeeId !== employeeId,
                  );
                  const overtimeEntries = db.overtimeEntries.filter(
                    (o) => o.employeeId !== employeeId,
                  );
                  const lateFineEntries = db.lateFineEntries.filter(
                    (f) => f.employeeId !== employeeId,
                  );

                  const attendance = { ...db.attendance };
                  Object.keys(attendance).forEach((k) => {
                    if (k.startsWith(`${employeeId}_`)) {
                      delete attendance[k];
                    }
                  });

                  onUpdateDb({
                    ...db,
                    employees,
                    attendance,
                    payments,
                    earnings,
                    deductions,
                    overtimeEntries,
                    lateFineEntries,
                  });

                  onGoBack();
                }}
                className="flex-1 btn bg-rose-600 hover:bg-rose-700 text-white font-bold shadow-xs active:scale-[0.98] transition-all"
              >
                {t("Yes, Delete", "हाँ, हटाएँ")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Custom Mark Job Left Modal */}
      {showLeftConfirm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-200 animate-in fade-in duration-200">
          <div className="bg-white border border-slate-100 rounded-3xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mb-4 mx-auto animate-in zoom-in duration-300">
              <Icon name="logout" size={24} className="text-amber-600" />
            </div>
            <h3 className="text-sm font-black text-slate-900 text-center uppercase tracking-tight">
              {t("MARK JOB LEFT", "नौकरी कार्यमुक्त चिह्नित करें")}
            </h3>
            <p className="text-xs text-slate-500 font-sans font-medium text-center leading-relaxed mt-2">
              {t(
                "Mark this employee status as LEFT JOB? This terminates active rosters.",
                "क्या आप इस कर्मचारी को कार्य मुक्त (Left Job) के रूप में चिह्नित करना चाहते हैं? इससे उनका नाम दैनिक सूची में सक्रिय रूप से बंद हो जायेगा।",
              )}
            </p>
            {/* PIN Input Field */}
            <div className="mt-4 space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block">
                {t("Enter 4-Digit Admin PIN", "4-अंकीय एडमिन पिन दर्ज करें")}
              </label>
              <input
                type="password"
                maxLength={4}
                value={leftPin}
                onChange={(e) => setLeftPin(e.target.value.replace(/\D/g, ""))}
                placeholder="••••"
                className="w-full h-10 border border-slate-200 rounded-xl text-center font-mono font-black text-lg tracking-widest bg-slate-50 outline-none focus:border-blue-500 focus:bg-white transition-all"
              />
            </div>
            <div className="flex gap-3 mt-6 text-xs font-bold font-sans">
              <button
                onClick={() => setShowLeftConfirm(false)}
                className="flex-1 btn bou font-bold"
              >
                {t("No, Cancel", "नहीं, रद्द करें")}
              </button>
              <button
                onClick={() => {
                  const correctPin = db.company?.adminPin || "1234";
                  if (leftPin !== correctPin) {
                    alert(t("Incorrect Admin PIN!", "गलत एडमिन पिन!"));
                    return;
                  }
                  setShowLeftConfirm(false);
                  const empsList = db.employees.map((e) =>
                    e.id === employeeId
                      ? { ...e, status: "Inactive" as const }
                      : e,
                  );
                  onUpdateDb({ ...db, employees: empsList });
                  onGoBack();
                }}
                className="flex-1 btn bg-amber-500 hover:bg-amber-600 text-white font-bold shadow-xs active:scale-[0.98] transition-all"
              >
                {t("Yes, Mark Left", "हाँ, कार्यमुक्त करें")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2.5 Custom Employee Attendance Fine Settings Modal */}
      {showFineSettingsModal && fineSettingsState && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-200 animate-in fade-in duration-200 overflow-y-auto">
          <div className="bg-white border border-slate-100 rounded-3xl p-6 w-full max-w-lg shadow-2xl animate-in zoom-in-95 duration-150 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                <Icon name="gavel" size={20} className="text-blue-600" />
                <span>{t("Fine Settings Override", "जुर्माना सेटिंग्स नियम")}</span>
              </h3>
              <button
                onClick={() => setShowFineSettingsModal(false)}
                className="w-7 h-7 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 hover:bg-slate-100 cursor-pointer"
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl">
                  <div>
                    <span className="text-[10px] font-bold text-slate-800 block leading-tight">{t('Attendance Fine', 'उपस्थिति जुर्माना')}</span>
                    <span className="text-[8px] text-slate-400 uppercase tracking-wider">{t('Fine Active', 'जुर्माना सक्रिय')}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={fineSettingsState.fineEnabled}
                    onChange={(e) => setFineSettingsState({ ...fineSettingsState, fineEnabled: e.target.checked })}
                    className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer"
                  />
                </div>


              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl">
                  <div>
                    <span className="text-[10px] font-bold text-slate-800 block leading-tight">{t('50% Safe Rule', '50% सुरक्षित नियम')}</span>
                    <span className="text-[8px] text-slate-400 uppercase tracking-wider">{t('No fine if >=50% work', '>=50% कार्य पर छूट')}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={fineSettingsState.fiftyPercentRuleEnabled}
                    onChange={(e) => setFineSettingsState({ ...fineSettingsState, fiftyPercentRuleEnabled: e.target.checked })}
                    className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 cursor-pointer"
                  />
                </div>

                <div className="fld mb-0">
                  <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block mb-1">{t('Grace Period (Days)', 'अनुग्रह अवधि (दिन)')}</label>
                  <select
                    value={fineSettingsState.gracePeriodDays}
                    onChange={(e) => setFineSettingsState({ ...fineSettingsState, gracePeriodDays: parseInt(e.target.value, 10) })}
                    className="fi bg-white font-sans text-xs"
                  >
                    {[0, 1, 2, 3, 5, 7, 15, 30].map(d => (
                      <option key={d} value={d}>{d} {t('Days', 'दिन')}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="fld mb-0">
                  <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block mb-1">{t('Standard Hours', 'मानक कार्य घंटे')}</label>
                  <input
                    type="number"
                    className="fi font-sans font-semibold text-slate-800"
                    value={fineSettingsState.standardHours}
                    onChange={(e) => setFineSettingsState({ ...fineSettingsState, standardHours: parseInt(e.target.value, 10) || 8 })}
                  />
                </div>

                <div className="fld mb-0">
                  <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block mb-1">{t('Max Fine Amount (₹)', 'अधिकतम जुर्माना राशि (₹)')}</label>
                  <input
                    type="number"
                    className="fi font-sans font-semibold text-slate-800"
                    value={fineSettingsState.maxFineAmount}
                    onChange={(e) => setFineSettingsState({ ...fineSettingsState, maxFineAmount: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>

              {/* Editable Fine Table mapping */}
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3.5 space-y-2.5">
                <span className="text-[9px] font-black uppercase text-slate-500 tracking-wider block">{t('Employee Fine Table (Missing Hours → ₹)', 'कर्मचारी जुर्माना तालिका (कम घंटे → ₹)')}</span>
                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: fineSettingsState.standardHours }).map((_, idx) => {
                    const hrs = idx + 1;
                    return (
                      <div key={hrs} className="bg-white border border-slate-100 rounded-lg p-2 flex items-center justify-between gap-1.5 shadow-3xs">
                        <span className="text-[10px] font-extrabold text-slate-600 shrink-0">{hrs} {t('hrs', 'घंटे')}</span>
                        <input
                          type="number"
                          className="w-12 h-6 border-b border-slate-200 text-right font-sans font-bold text-[10px] text-blue-600 focus:outline-none focus:border-blue-500"
                          value={fineSettingsState.fineTable[hrs] ?? ''}
                          placeholder={`${Math.round((hrs / fineSettingsState.standardHours) * fineSettingsState.maxFineAmount)}`}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setFineSettingsState({
                              ...fineSettingsState,
                              fineTable: { ...fineSettingsState.fineTable, [hrs]: val }
                            });
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 mt-6 text-xs font-bold font-sans">
              <button
                onClick={handleResetFineSettingsToDefault}
                className="btn bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold order-2 sm:order-1"
              >
                {t("Reset to Company Default", "कंपनी डिफ़ॉल्ट पर रीसेट")}
              </button>
              <div className="flex gap-2 flex-1 order-1 sm:order-2">
                <button
                  onClick={() => setShowFineSettingsModal(false)}
                  className="flex-1 btn bou font-bold"
                >
                  {t("Cancel", "रद्द करें")}
                </button>
                <button
                  onClick={handleSaveFineSettings}
                  className="flex-1 btn bbl font-bold text-white bg-blue-600 hover:bg-blue-700"
                >
                  {t("Save Override", "नियम सहेजें")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Transaction Delete Confirm Modal */}
      {txToDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-250 animate-in fade-in duration-200">
          <div className="bg-white border border-slate-100 rounded-3xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mb-4 mx-auto animate-in zoom-in duration-300">
              <Icon name="delete_forever" size={24} className="text-rose-600 animate-pulse" />
            </div>
            <h3 className="text-sm font-black text-slate-900 text-center uppercase tracking-tight">
              {t("DELETE TRANSACTION", "लेन-देने मिटाएं")}
            </h3>
            <p className="text-xs text-slate-500 font-sans font-medium text-center leading-relaxed mt-2">
              {t(
                "Are you sure you want to permanently delete this transaction record? This action cannot be undone.",
                "क्या आप वास्तव में इस लेन-देन को स्थायी रूप से हटाना चाहते हैं? यह कार्रवाई वापस नहीं ली जा सकती।",
              )}
            </p>
            <div className="flex gap-3 mt-6 text-xs font-bold font-sans">
              <button
                onClick={() => setTxToDelete(null)}
                className="flex-1 btn bou font-bold"
              >
                {t("No, Cancel", "नहीं, रद्द करें")}
              </button>
              <button
                onClick={() => {
                  const { type, id } = txToDelete;
                  if (type === "Payments") deletePayment(id);
                  else if (type === "Earnings") deleteEarning(id);
                  else if (type === "Deductions") deleteDeduction(id);
                  else if (type === "Overtime") deleteOvertime(id);
                  else if (type === "Fines") deleteLateFine(id);
                  setTxToDelete(null);
                  setSelectedTxAction(null);
                }}
                className="flex-1 btn bg-rose-600 hover:bg-rose-700 text-white font-bold shadow-xs active:scale-[0.98] transition-all"
              >
                {t("Yes, Delete", "हाँ, हटाएँ")}
              </button>
            </div>
          </div>
        </div>
      )}

      {pickerOpen && pickerMeta && (
        <TimeWheelPicker
          isOpen={pickerOpen}
          onClose={() => setPickerOpen(false)}
          title={new Date(pickerMeta.dateStr + "T00:00:00").toLocaleDateString(
            "en-GB",
            { day: "numeric", month: "short", year: "numeric" },
          )}
          initialValue={pickerMeta.initialVal}
          onSave={saveHistoryTimePickerValue}
        />
      )}

      {/* 3. Bottom Actions Sheet for Transaction Records (Edit/Delete options with smooth sheet design) */}
      {selectedTxAction &&
        (() => {
          const { type, item } = selectedTxAction;

          let title = "";
          let amountStr = "";
          let dateStr = "";
          let descStr = "";

          if (type === "Payments") {
            const modeLabel = item.mode ? ` (${item.mode})` : "";
            const payTypeStr =
              item.paymentType ||
              (item.description?.includes("Advance")
                ? "Advance Payment"
                : item.description?.includes("Bonus")
                  ? "Bonus Payment"
                  : "Salary Payment");
            title = `${t(payTypeStr, payTypeStr)}${modeLabel}`;
            amountStr = `+ ₹${item.amount.toLocaleString("en-IN")}`;
            dateStr = formatTxDateTime(item.date, item.time);
            descStr = item.description || "";
          } else if (type === "Earnings") {
            title = t("Extra Earning", "अतिरिक्त कमाई");
            amountStr = `+ ₹${item.amount.toLocaleString("en-IN")}`;
            dateStr = formatTxDateTime(item.date, item.time);
            descStr = item.description || "";
          } else if (type === "Deductions") {
            title = t("Deduction", "कटौती");
            amountStr = `- ₹${item.amount.toLocaleString("en-IN")}`;
            dateStr = formatTxDateTime(item.date, item.time);
            descStr = item.description || "";
          } else if (type === "Overtime") {
            const hourlyRate = getHourlyRateForDate(item.date);
            const valAmt =
              item.calcType === "HourlyRate"
                ? hourlyRate * item.hours
                : item.amount;
            title = `${item.hours.toFixed(1)} Hrs Overtime`;
            amountStr = `+ ₹${Math.round(valAmt).toLocaleString("en-IN")}`;
            dateStr = formatTxDateTime(item.date, item.time);
            descStr = item.description || "";
          } else if (type === "Fines") {
            const hourlyRate = getHourlyRateForDate(item.date);
            const valAmt =
              item.calcType === "HourlyRate"
                ? hourlyRate * item.hours
                : item.amount;
            title = `Late Fine (${item.hours.toFixed(1)} Hrs)`;
            amountStr = `- ₹${Math.round(valAmt).toLocaleString("en-IN")}`;
            dateStr = formatTxDateTime(item.date, item.time);
            descStr = item.description || "";
          }

          return (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-end justify-center p-0 z-200 animate-in fade-in duration-200">
              {/* Click outside to close */}
              <div
                className="absolute inset-0"
                onClick={() => setSelectedTxAction(null)}
              />

              <div className="bg-white rounded-t-3xl w-full max-w-sm shadow-2xl p-6 relative animate-in slide-in-from-bottom duration-300 z-10 space-y-5">
                {/* Draggable indicator bar */}
                <div className="w-12 h-1 bg-slate-200 rounded-full mx-auto" />

                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">
                      {t("Transaction Details", "लेन-देन का विवरण")}
                    </h4>
                    <h3 className="text-sm font-black text-slate-900 mt-0.5">
                      {title}
                    </h3>
                  </div>
                  <button
                    onClick={() => setSelectedTxAction(null)}
                    className="w-8 h-8 rounded-full bg-slate-55 hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
                  >
                    <Icon name="close" size={18} />
                  </button>
                </div>

                {/* Detail Content Row */}
                <div className="bg-slate-50 rounded-xl p-3.5 flex justify-between items-center border border-slate-100/60 font-sans">
                  <div className="min-w-0">
                    <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                      {t("Date & Time", "दिनांक और समय")}
                    </div>
                    <div className="text-xs font-bold text-slate-700 mt-1">
                      {dateStr}
                    </div>

                    {descStr && (
                      <div className="mt-2.5">
                        <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                          {t("Description / Note", "टिप्पणी / विवरण")}
                        </div>
                        <div className="text-xs font-semibold text-slate-600 mt-0.5 truncate max-w-[200px]">
                          {descStr}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                      {t("Flow Amount", "लेन-देन राशि")}
                    </div>
                    <span className={`text-base font-black font-sans mt-0.5 ${
                        amountStr.startsWith("+")
                          ? "text-emerald-600"
                          : "text-rose-600"
                      }`}
                    >{amountStr}</span>
                  </div>
                </div>

                {/* Action Buttons Row */}
                {type === "Deductions" && item.isAutoGenerated ? (
                  <div className="space-y-2 pb-2.5 font-sans w-full">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const reason = prompt(t("Enter waive reason:", "माफ करने का कारण दर्ज करें:"), "Waived by Admin") || "Waived by Admin";
                          waiveDeduction(item.id, reason);
                          setSelectedTxAction(null);
                        }}
                        className="btn bg-blue-50 hover:bg-blue-100 text-blue-600 font-bold border border-blue-100/50 cursor-pointer text-[10px] py-2 flex items-center justify-center gap-1"
                      >
                        <Icon name="gavel" size={13} />
                        <span>{t("Waive Fine", "माफ करें")}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const reason = prompt(t("Enter deletion reason:", "सॉफ्ट-डिलीट करने का कारण दर्ज करें:"), "Deleted by Admin") || "Deleted by Admin";
                          softDeleteDeduction(item.id, reason);
                          setSelectedTxAction(null);
                        }}
                        className="btn bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold border border-rose-100/50 cursor-pointer text-[10px] py-2 flex items-center justify-center gap-1"
                      >
                        <Icon name="delete" size={13} />
                        <span>{t("Soft Delete", "हटाएं (सॉफ्ट)")}</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(t("Convert this day's attendance to Approved Leave and waive the fine?", "क्या आप इस दिन की उपस्थिति को स्वीकृत छुट्टी में बदलकर जुर्माना माफ करना चाहते हैं?"))) {
                            convertToLeave(item.id, item.date);
                            setSelectedTxAction(null);
                          }
                        }}
                        className="btn bg-emerald-50 hover:bg-emerald-100 text-emerald-600 font-bold border border-emerald-100/50 cursor-pointer text-[10px] py-2 flex items-center justify-center gap-1"
                      >
                        <Icon name="beach_access" size={13} />
                        <span>{t("Convert to Leave", "छुट्टी में बदलें")}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setDeductionForm({
                            isOpen: true,
                            id: item.id,
                            amount: String(item.amount),
                            date: item.date,
                            description: item.description,
                            time: item.time || getCurrentTimeFormatted(),
                          });
                          setSelectedTxAction(null);
                        }}
                        className="btn bbl text-white font-bold cursor-pointer text-[10px] py-2 flex items-center justify-center gap-1"
                      >
                        <Icon name="edit" size={13} />
                        <span>{t("Edit Amount", "संपादित करें")}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 pb-2.5">
                  {/* Delete button option */}
                  <button
                    type="button"
                    onClick={() => {
                      setTxToDelete({ type, id: item.id });
                    }}
                    className="flex-1 btn bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold border border-rose-100/50 cursor-pointer transition-all"
                  >
                    <Icon name="delete" size={13} />
                    <span>{t("Delete Record", "हटाएं")}</span>
                  </button>

                  {/* Edit button option */}
                  <button
                    type="button"
                    onClick={() => {
                      if (type === "Payments") {
                        setPaymentForm({
                          isOpen: true,
                          id: item.id,
                          amount: String(item.amount),
                          date: item.date,
                          mode: item.mode,
                          description: item.description,
                          paymentType: item.paymentType || "Salary Payment",
                          time: item.time || getCurrentTimeFormatted(),
                          paidBy: item.paidBy || "",
                        });
                      } else if (type === "Earnings") {
                        setEarningForm({
                          isOpen: true,
                          id: item.id,
                          amount: String(item.amount),
                          date: item.date,
                          description: item.description,
                          time: item.time || getCurrentTimeFormatted(),
                        });
                      } else if (type === "Deductions") {
                        setDeductionForm({
                          isOpen: true,
                          id: item.id,
                          amount: String(item.amount),
                          date: item.date,
                          description: item.description,
                          time: item.time || getCurrentTimeFormatted(),
                        });
                      } else if (type === "Overtime") {
                        setOvertimeForm({
                          isOpen: true,
                          id: item.id,
                          date: item.date,
                          hours: String(item.hours),
                          calcType: item.calcType,
                          amount: String(item.amount),
                          description: item.description,
                          time: item.time || getCurrentTimeFormatted(),
                        });
                      } else if (type === "Fines") {
                        setLateFineForm({
                          isOpen: true,
                          id: item.id,
                          date: item.date,
                          hours: String(item.hours),
                          calcType: item.calcType,
                          amount: String(item.amount),
                          description: item.description,
                          time: item.time || getCurrentTimeFormatted(),
                        });
                      }
                      setSelectedTxAction(null);
                    }}
                    className="flex-1 btn bbl text-white font-bold shadow-xs cursor-pointer"
                  >
                    <Icon name="edit" size={13} />
                    <span>{t("Edit Record", "संपादित करें")}</span>
                  </button>
                </div>
              )}
              </div>
            </div>
          );
        })()}

      {/* Admin Salary Slip PDF Modal */}
      {showPdfModal && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-3xl h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <Icon name="picture_as_pdf" className="text-red-500" size={20} />
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">
                  {t("Print Salary Slip", "सैलरी स्लिप प्रिंट करें")}
                </h3>
              </div>
              <button 
                onClick={() => setShowPdfModal(false)}
                className="w-8 h-8 rounded-full bg-slate-200 hover:bg-slate-350 text-slate-650 flex items-center justify-center cursor-pointer transition-colors"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            {/* Select month & year parameters panel */}
            <div className="bg-white px-6 py-3 border-b border-slate-100 flex gap-4 flex-shrink-0">
              <div className="flex-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1">
                  {t("Select Month", "महीना चुनें")}
                </label>
                <select
                  value={pdfMonth}
                  onChange={(e) => setPdfMonth(parseInt(e.target.value))}
                  className="fi bg-white h-9 border border-slate-200 rounded-lg px-2 text-xs w-full"
                >
                  {MN.map((m, idx) => {
                    const today = new Date();
                    if (pdfYear === today.getFullYear() && idx > today.getMonth()) return null;
                    return <option key={idx} value={idx}>{m}</option>;
                  })}
                </select>
              </div>

              <div className="flex-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1">
                  {t("Select Year", "वर्ष चुनें")}
                </label>
                <select
                  value={pdfYear}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setPdfYear(val);
                    const today = new Date();
                    if (val === today.getFullYear() && pdfMonth > today.getMonth()) {
                      setPdfMonth(today.getMonth());
                    }
                  }}
                  className="fi bg-white h-9 border border-slate-200 rounded-lg px-2 text-xs w-full"
                >
                  {Array.from({ length: new Date().getFullYear() - 2024 + 1 }, (_, i) => 2024 + i).map((yr) => (
                    <option key={yr} value={yr}>{yr}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* PDF Slip container for rendering and printing */}
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50" id="salary-slip-print-box">
              <SalarySlipPDF
                employee={emp}
                year={pdfYear}
                month={pdfMonth}
                db={db}
                lang={lang}
              />
            </div>

            {/* Modal Footer with Download and Close Triggers */}
            <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex gap-4 flex-shrink-0">
              <button
                onClick={async () => {
                  const monthsEn = [
                    "January", "February", "March", "April", "May", "June",
                    "July", "August", "September", "October", "November", "December"
                  ];
                  const period = `${monthsEn[pdfMonth]}_${pdfYear}`;
                  await downloadSalarySlipPDF(emp.name, period);
                }}
                className="flex-1 h-12 btn bbl text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-blue-500/10"
              >
                <Icon name="download" size={18} />
                <span>{t("Download PDF", "पीडीएफ डाउनलोड करें")}</span>
              </button>
              
              <button
                onClick={() => setShowPdfModal(false)}
                className="w-32 h-12 border border-slate-250 text-slate-650 bg-white rounded-xl font-bold text-xs hover:bg-slate-100 active:scale-[0.98] transition-all cursor-pointer"
              >
                {t("Close", "बंद करें")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helpers for months matching checks
function isSameMonth(dateStr: string, year: number, month: number): boolean {
  try {
    const dt = new Date(dateStr + "T00:00:00");
    return dt.getFullYear() === year && dt.getMonth() === month;
  } catch {
    return false;
  }
}
