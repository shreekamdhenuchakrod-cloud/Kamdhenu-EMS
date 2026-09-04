import React, { useState, useEffect } from 'react';
import { 
  AppDatabase, Employee, ApprovalRequest, ApprovalCategory, ApprovalStatus, AttendanceRecord, AuditLogEntry, Payment
} from '../types';
import Icon from './Icon';
import TimeWheelPicker from './TimeWheelPicker';
import InlineDurationPicker from './InlineDurationPicker';
import { runPayrollTransaction, getDistanceMeters } from '../db';

function formatLocalTimestamp(ts: string): string {
  if (!ts) return '';
  try {
    let d: Date;
    if (ts.includes('Z') || ts.includes('+') || (ts.includes('T') && !ts.endsWith('Z'))) {
      d = new Date(ts);
    } else {
      const normalized = ts.replace(' ', 'T') + 'Z';
      d = new Date(normalized);
    }
    if (isNaN(d.getTime())) {
      d = new Date(ts);
    }
    if (isNaN(d.getTime())) return ts;
    
    const pad = (n: number) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const min = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
  } catch {
    return ts;
  }
}

interface ApprovalPanelProps {
  employeeId?: string; // defined if employee portal
  employeeName?: string; // defined if employee portal
  employeePic?: string; // defined if employee portal
  db: AppDatabase;
  lang: 'en' | 'hi';
  isAdmin: boolean;
  onUpdateDb?: (updatedDb: AppDatabase) => void;
}

export default function ApprovalPanel({
  employeeId,
  employeeName,
  employeePic,
  db,
  lang,
  isAdmin,
  onUpdateDb
}: ApprovalPanelProps) {
  const t = (en: string, hi: string) => (lang === 'en' ? en : hi);

  // Fetch current employee to check their type
  const employee = db.employees.find(e => e.id === employeeId);
  const employeeType = employee ? employee.type : 'Daily';

  // Lists
  const requestsList = db.approvalRequests || [];

  // Employee-facing views: 'list' | 'new_request' | 'edit_request'
  const [empView, setEmpView] = useState<'list' | 'new_request' | 'edit_request'>('list');

  // Request Type: 'attendance' | 'payment' | 'leave' | 'new_payment'
  const [requestType, setRequestType] = useState<'attendance' | 'payment' | 'leave' | 'new_payment'>('attendance');

  // Categories list
  const categories: ApprovalCategory[] = [
    'Punch In', 'Punch Out', 'Attendance Correction', 'Leave', 
    'Leave Request', 'Payment', 'New Payment', 'Manual Attendance', 'GeoFence Attendance', 'Overtime', 'Early Exit', 'Late Entry', 'Device Register'
  ];

  // Filtering (Admin & Employee)
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [filterStatus, setFilterStatus] = useState<ApprovalStatus | 'All'>('Pending');

  // Form states
  const [reqDate, setReqDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [reason, setReason] = useState<string>('');
  
  // Leave request form states
  const [leaveDays, setLeaveDays] = useState<number>(1);
  const [leaveStartDate, setLeaveStartDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // New Payment Request Form States
  const [payRequestAmount, setPayRequestAmount] = useState<string>('');
  const [payRequestDate, setPayRequestDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [payRequestMode, setPayRequestMode] = useState<string>('Cash');

  // Daily/Monthly Status Form State
  const [statusVal, setStatusVal] = useState<'Present' | 'Absent' | 'Half Day' | 'Overtime'>('Present');
  const [overtimeDuration, setOvertimeDuration] = useState<string>('02:00');

  // Hourly Punch Sessions Form State
  const getCurrentTimeHHmm = () => {
    const d = new Date();
    const hrs = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${hrs}:${mins}`;
  };

  const [punchSessions, setPunchSessions] = useState<Array<{
    inEnabled: boolean;
    inTime: string;
    outEnabled: boolean;
    outTime: string;
  }>>([{ inEnabled: true, inTime: '09:00', outEnabled: false, outTime: '17:00' }]);

  // Payment correction form states
  const [selPaymentId, setSelPaymentId] = useState<string>('');
  const [newPaymentDate, setNewPaymentDate] = useState<string>('');
  const [newPaymentAmount, setNewPaymentAmount] = useState<string>('');
  const [newPaymentMode, setNewPaymentMode] = useState<string>('Cash');
  const [newPaymentDesc, setNewPaymentDesc] = useState<string>('');
  const [newPaymentPaidBy, setNewPaymentPaidBy] = useState<string>('');

  // Time Picker states
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMeta, setPickerMeta] = useState<{ sessionIdx: number; field: 'in' | 'out' | 'overtime'; initialVal: string } | null>(null);

  // Edit Request State
  const [editingRequest, setEditingRequest] = useState<ApprovalRequest | null>(null);

  // Correction type mode: sessions vs simple status
  const [correctionMode, setCorrectionMode] = useState<'sessions' | 'status'>('sessions');

  // Admin rejection reason input
  const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [selectedRequestDetails, setSelectedRequestDetails] = useState<ApprovalRequest | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Load existing punches when target date, requestType or correctionMode changes in new request mode
  useEffect(() => {
    if (empView !== 'new_request') return;
    if (requestType === 'attendance') {
      const key = `${employeeId}_${reqDate}`;
      const existingRec = db.attendance[key];

      if (existingRec) {
        if (existingRec.sessions && existingRec.sessions.length > 0) {
          setCorrectionMode('sessions');
          setPunchSessions(existingRec.sessions.map(s => ({
            inEnabled: !!s.in,
            inTime: s.in || '09:00',
            outEnabled: !!s.out,
            outTime: s.out || '17:00'
          })));
        } else {
          setCorrectionMode('status');
          if (existingRec.status) {
            setStatusVal(existingRec.status as any);
          }
        }
      } else {
        // No record exists
        if (employeeType === 'Hourly') {
          setCorrectionMode('sessions');
          setPunchSessions([{ inEnabled: true, inTime: '09:00', outEnabled: false, outTime: '17:00' }]);
        } else {
          setCorrectionMode('status');
          setStatusVal('Present');
          setPunchSessions([{ inEnabled: true, inTime: '09:00', outEnabled: false, outTime: '17:00' }]);
        }
      }
    }
  }, [reqDate, requestType, empView, employeeId, db.attendance, employeeType]);

  const formatTimeForDisplay = (time24?: string) => {
    if (!time24) return 'ΓÇö';
    const parts = time24.split(':');
    if (parts.length < 2) return time24;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return time24;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  const formatTo12Hour = (time24: string) => {
    return formatTimeForDisplay(time24);
  };

  // Generate Category, Old and New values based on inputs
  const getCorrectionValues = () => {
    let category: ApprovalCategory = 'Attendance Correction';
    let oldVal = t('Not Marked', 'αñ«αñ╛αñ░αÑìαñò αñ¿αñ╣αÑÇαñé αñ╣αÑê');
    let newVal = '';

    if (requestType === 'attendance') {
      const key = `${employeeId}_${reqDate}`;
      const existingRec = db.attendance[key];
      const isSessions = employeeType === 'Hourly' || correctionMode === 'sessions';

      if (existingRec) {
        if (isSessions) {
          const sessions = existingRec.sessions || [];
          oldVal = sessions.map(s => `${s.in || 'ΓÇö'} to ${s.out || 'ΓÇö'}`).join(', ') || t('No Punch', 'αñòαÑïαñê αñ¬αñéαñÜ αñ¿αñ╣αÑÇαñé');
        } else {
          oldVal = existingRec.status || t('Not Marked', 'αñ«αñ╛αñ░αÑìαñò αñ¿αñ╣αÑÇαñé αñ╣αÑê');
        }
      }

      if (isSessions) {
        const enabledSessions = punchSessions.filter(s => s.inEnabled || s.outEnabled);
        const isMultiple = enabledSessions.length > 1;
        const isInOnly = enabledSessions.length === 1 && enabledSessions[0].inEnabled && !enabledSessions[0].outEnabled;
        const isOutOnly = enabledSessions.length === 1 && !enabledSessions[0].inEnabled && enabledSessions[0].outEnabled;

        if (isMultiple) category = 'Punch In';
        else if (isInOnly) category = 'Punch In';
        else if (isOutOnly) category = 'Punch Out';
        else category = 'Punch In';

        newVal = JSON.stringify(punchSessions.map(s => ({
          in: s.inEnabled ? s.inTime : '',
          out: s.outEnabled ? s.outTime : ''
        })));
      } else {
        if (statusVal === 'Overtime') {
          category = 'Overtime';
          newVal = JSON.stringify({ hours: overtimeDuration });
        } else {
          category = 'Attendance Correction';
          newVal = statusVal;
        }
      }
    } else if (requestType === 'payment') {
      // Payment Correction Request
      category = 'Payment';
      const myPayments = db.payments.filter(p => p.employeeId === employeeId);
      const selectedPayment = myPayments.find(p => p.id === selPaymentId);
      if (selectedPayment) {
        oldVal = `${selectedPayment.date} | Γé╣${selectedPayment.amount} | ${selectedPayment.mode} | ${selectedPayment.description || ''}`;
        newVal = JSON.stringify({
          paymentId: selectedPayment.id,
          date: newPaymentDate,
          amount: parseFloat(newPaymentAmount) || 0,
          mode: newPaymentMode,
          description: newPaymentDesc,
          paidBy: newPaymentPaidBy
        });
      }
    } else if (requestType === 'leave') {
      category = 'Leave Request';
      const key = `${employeeId}_${leaveStartDate}`;
      const existingRec = db.attendance ? db.attendance[key] : undefined;
      oldVal = existingRec ? (existingRec.status || 'Not Marked') : 'Not Marked';
      newVal = JSON.stringify({
        startDate: leaveStartDate,
        days: leaveDays,
        description: reason.trim()
      });
    } else if (requestType === 'new_payment') {
      category = 'New Payment';
      oldVal = t('No payment entry', 'αñòαÑïαñê αñ¡αÑüαñùαññαñ╛αñ¿ αñ¬αÑìαñ░αñ╡αñ┐αñ╖αÑìαñƒαñ┐ αñ¿αñ╣αÑÇαñé');
      newVal = JSON.stringify({
        date: payRequestDate,
        amount: parseFloat(payRequestAmount) || 0,
        mode: payRequestMode,
        description: reason.trim(),
        paidBy: newPaymentPaidBy
      });
    }

    return { category, oldVal, newVal };
  };

  // Save new request
  const handleSubmitRequest = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Description/Reason is now completely optional
    const resolvedReason = reason.trim() || t('Self requested via employee portal', 'αñ╕αÑìαñƒαñ╛αñ½ αñ¬αÑïαñ░αÑìαñƒαñ▓ αñªαÑìαñ╡αñ╛αñ░αñ╛ αñ╕αÑìαñ╡αñ»αñé αñàαñ¿αÑüαñ░αÑïαñºαñ┐αññ');

    if (requestType === 'attendance') {
      if (employeeType === 'Hourly') {
        const hasAnyCheck = punchSessions.some(s => s.inEnabled || s.outEnabled);
        if (!hasAnyCheck) {
          alert(t('Please select at least one Punch In or Punch Out time to request correction!', 'αñòαÑâαñ¬αñ»αñ╛ αñ╕αÑüαñºαñ╛αñ░ αñòαñ╛ αñàαñ¿αÑüαñ░αÑïαñº αñòαñ░αñ¿αÑç αñòαÑç αñ▓αñ┐αñÅ αñòαñ« αñ╕αÑç αñòαñ« αñÅαñò αñ¬αñéαñÜ αñçαñ¿ αñ»αñ╛ αñ¬αñéαñÜ αñåαñëαñƒ αñ╕αñ«αñ» αñÜαÑüαñ¿αÑçαñé!'));
          return;
        }
      }
    } else if (requestType === 'payment') {
      if (!selPaymentId) {
        alert(t('Please select a payment record to edit!', 'αñòαÑâαñ¬αñ»αñ╛ αñ╕αñéαñ¬αñ╛αñªαñ┐αññ αñòαñ░αñ¿αÑç αñòαÑç αñ▓αñ┐αñÅ αñÅαñò αñ¡αÑüαñùαññαñ╛αñ¿ αñ░αñ┐αñòαÑëαñ░αÑìαñí αñÜαÑüαñ¿αÑçαñé!'));
        return;
      }
      const amt = parseFloat(newPaymentAmount);
      if (isNaN(amt) || amt <= 0) {
        alert(t('Please enter a valid amount!', 'αñòαÑâαñ¬αñ»αñ╛ αñ«αñ╛αñ¿αÑìαñ» αñ░αñ╛αñ╢αñ┐ αñªαñ░αÑìαñ£ αñòαñ░αÑçαñé!'));
        return;
      }
      if (!newPaymentDate) {
        alert(t('Please select date!', 'αñòαÑâαñ¬αñ»αñ╛ αññαñ╛αñ░αÑÇαñû αñòαñ╛ αñÜαñ»αñ¿ αñòαñ░αÑçαñé!'));
        return;
      }
    } else if (requestType === 'new_payment') {
      const amt = parseFloat(payRequestAmount);
      if (isNaN(amt) || amt <= 0) {
        alert(t('Please enter a valid amount!', 'αñòαÑâαñ¬αñ»αñ╛ αñ«αñ╛αñ¿αÑìαñ» αñ░αñ╛αñ╢αñ┐ αñªαñ░αÑìαñ£ αñòαñ░αÑçαñé!'));
        return;
      }
      if (!payRequestDate) {
        alert(t('Please select date!', 'αñòαÑâαñ¬αñ»αñ╛ αññαñ╛αñ░αÑÇαñû αñòαñ╛ αñÜαñ»αñ¿ αñòαñ░αÑçαñé!'));
        return;
      }
    } else if (requestType === 'leave') {
      if (!leaveStartDate) {
        alert(t('Please select leave start date!', 'αñòαÑâαñ¬αñ»αñ╛ αñ¢αÑüαñƒαÑìαñƒαÑÇ αñ╢αÑüαñ░αÑé αñ╣αÑïαñ¿αÑç αñòαÑÇ αññαñ╛αñ░αÑÇαñû αñÜαÑüαñ¿αÑçαñé!'));
        return;
      }
      if (leaveDays < 1 || leaveDays > 9) {
        alert(t('Leave duration must be between 1 and 9 days!', 'αñ¢αÑüαñƒαÑìαñƒαÑÇ αñòαÑÇ αñàαñ╡αñºαñ┐ 1 αñ╕αÑç 9 αñªαñ┐αñ¿αÑïαñé αñòαÑç αñ¼αÑÇαñÜ αñ╣αÑïαñ¿αÑÇ αñÜαñ╛αñ╣αñ┐αñÅ!'));
        return;
      }
    }

    const { category, oldVal, newVal } = getCorrectionValues();

    const reqDateToUse = 
      requestType === 'attendance' ? reqDate :
      requestType === 'payment' ? newPaymentDate :
      requestType === 'leave' ? leaveStartDate :
      payRequestDate;

    // Duplicate Prevention Validation
    const isDuplicate = requestsList.some(r => 
      r.employeeId === employeeId &&
      r.status === 'Pending' &&
      r.category === category &&
      r.date === reqDateToUse &&
      r.newValue === newVal
    );
    if (isDuplicate) {
      alert(t("An identical request is already pending.", "αñ»αñ╣αÑÇ αñ░αñ┐αñòαÑìαñ╡αÑçαñ╕αÑìαñƒ αñ¬αñ╣αñ▓αÑç αñ╕αÑç αñ¬αÑçαñéαñíαñ┐αñéαñù (αñ¼αñ╛αñòαÑÇ) αñ╣αÑêαÑñ"));
      return;
    }

    const newRequest: ApprovalRequest = {
      id: `_REQ_${Date.now()}`,
      employeeId: employeeId!,
      employeeName: employeeName!,
      employeePic: employeePic || '',
      category,
      date: reqDateToUse,
      oldValue: oldVal,
      newValue: newVal,
      reason: resolvedReason,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      status: 'Pending'
    };

    const updatedDb: AppDatabase = {
      ...db,
      approvalRequests: [newRequest, ...requestsList]
    };

    // Create a notification for admin
    const newNotification = {
      id: `_NTF_${Date.now()}`,
      userId: 'admin',
      title: t('New Approval Request', 'αñ¿αñ»αñ╛ αñ«αñéαñ£αÑéαñ░αÑÇ αñàαñ¿αÑüαñ░αÑïαñº'),
      message: `${employeeName} ${t('requested a correction in', 'αñ¿αÑç')} ${category} ${t('on', 'αñ¬αñ░ αñ╕αÑüαñºαñ╛αñ░ αñòαñ╛ αñàαñ¿αÑüαñ░αÑïαñº αñòαñ┐αñ»αñ╛ αñ╣αÑê')} ${reqDateToUse}`,
      timestamp: new Date().toISOString(),
      read: false
    };
    updatedDb.notifications = [newNotification, ...(db.notifications || [])];

    if (onUpdateDb) onUpdateDb(updatedDb);

    // Reset form
    setReason('');
    setPunchSessions([{ inEnabled: true, inTime: '09:00', outEnabled: false, outTime: '17:00' }]);
    setSelPaymentId('');
    setNewPaymentAmount('');
    setNewPaymentDesc('');
    setNewPaymentPaidBy('');
    setPayRequestAmount('');
    setLeaveDays(1);
    setEmpView('list');
  };

  // Edit/Modify request (Only if pending)
  const handleEditRequestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRequest) return;
    // Description/Reason is now completely optional
    const resolvedReason = reason.trim() || t('Self requested via employee portal', 'αñ╕αÑìαñƒαñ╛αñ½ αñ¬αÑïαñ░αÑìαñƒαñ▓ αñªαÑìαñ╡αñ╛αñ░αñ╛ αñ╕αÑìαñ╡αñ»αñé αñàαñ¿αÑüαñ░αÑïαñºαñ┐αññ');

    if (requestType === 'attendance') {
      if (employeeType === 'Hourly') {
        const hasAnyCheck = punchSessions.some(s => s.inEnabled || s.outEnabled);
        if (!hasAnyCheck) {
          alert(t('Please select at least one Punch In or Punch Out time!', 'αñòαÑâαñ¬αñ»αñ╛ αñòαñ« αñ╕αÑç αñòαñ« αñÅαñò αñ¬αñéαñÜ αñçαñ¿ αñ»αñ╛ αñ¬αñéαñÜ αñåαñëαñƒ αñ╕αñ«αñ» αñÜαÑüαñ¿αÑçαñé!'));
          return;
        }
      }
    } else if (requestType === 'payment') {
      const amt = parseFloat(newPaymentAmount);
      if (isNaN(amt) || amt <= 0) {
        alert(t('Please enter a valid amount!', 'αñòαÑâαñ¬αñ»αñ╛ αñ«αñ╛αñ¿αÑìαñ» αñ░αñ╛αñ╢αñ┐ αñªαñ░αÑìαñ£ αñòαñ░αÑçαñé!'));
        return;
      }
    } else if (requestType === 'new_payment') {
      const amt = parseFloat(payRequestAmount);
      if (isNaN(amt) || amt <= 0) {
        alert(t('Please enter a valid amount!', 'αñòαÑâαñ¬αñ»αñ╛ αñ«αñ╛αñ¿αÑìαñ» αñ░αñ╛αñ╢αñ┐ αñªαñ░αÑìαñ£ αñòαñ░αÑçαñé!'));
        return;
      }
    }

    const { category, oldVal, newVal } = getCorrectionValues();

    const reqDateToUse = 
      requestType === 'attendance' ? reqDate :
      requestType === 'payment' ? newPaymentDate :
      requestType === 'leave' ? leaveStartDate :
      payRequestDate;

    const updatedList = requestsList.map(req => {
      if (req.id === editingRequest.id) {
        return {
          ...req,
          category,
          date: reqDateToUse,
          oldValue: oldVal,
          newValue: newVal,
          reason: resolvedReason,
          timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19)
        };
      }
      return req;
    });

    if (onUpdateDb) onUpdateDb({ ...db, approvalRequests: updatedList });

    setEditingRequest(null);
    setReason('');
    setPunchSessions([{ inEnabled: true, inTime: '09:00', outEnabled: false, outTime: '17:00' }]);
    setSelPaymentId('');
    setNewPaymentAmount('');
    setNewPaymentDesc('');
    setNewPaymentPaidBy('');
    setEmpView('list');
  };

  // Cancel/Delete Request (Only if pending)
  const handleCancelRequest = (reqId: string) => {
    if (!confirm(t('Cancel this pending request?', 'αñòαÑìαñ»αñ╛ αñåαñ¬ αñçαñ╕ αñ¬αÑçαñéαñíαñ┐αñéαñù αñ░αñ┐αñòαÑìαñ╡αÑçαñ╕αÑìαñƒ αñòαÑï αñ░αñªαÑìαñª αñòαñ░αñ¿αñ╛ αñÜαñ╛αñ╣αññαÑç αñ╣αÑêαñé?'))) return;
    const updatedList = requestsList.filter(req => req.id !== reqId);
    if (onUpdateDb) onUpdateDb({ ...db, approvalRequests: updatedList });
  };

  // Approve Request (Updates DB records atomically via transaction wrapper)
  const handleApprove = (req: ApprovalRequest) => {
    // 1. Check for manual punch override
    let wasManualOverride = false;
    let oldOverrideTime = '';
    
    if (['Punch In', 'Punch Out', 'Early Exit', 'Late Entry'].includes(req.category)) {
      const key = `${req.employeeId}_${req.date}`;
      const existingRec = db.attendance[key] || {};
      const sessions = existingRec.sessions || [];
      if (sessions.length > 0) {
        const lastSession = sessions[sessions.length - 1];
        if (['Punch In', 'Late Entry'].includes(req.category) && lastSession.in && lastSession.in !== req.newValue) {
          const confirmed = confirm(t(
            `Do you want to replace the existing Punch-In time ${lastSession.in} with the requested time ${req.newValue} for ${req.employeeName}?`,
            `αñòαÑìαñ»αñ╛ αñåαñ¬ ${req.employeeName} αñªαÑìαñ╡αñ╛αñ░αñ╛ αñàαñ¿αÑüαñ░αÑïαñºαñ┐αññ ${req.newValue} αñòαÑç Punch-In αñ╕αñ«αñ» αñ╕αÑç αñåαñ¬αñòαÑç αñªαÑìαñ╡αñ╛αñ░αñ╛ αñªαñ░αÑìαñ£ ${lastSession.in} αñòαÑç αñ╕αñ«αñ» αñòαÑï αñ¼αñªαñ▓αñ¿αñ╛ αñÜαñ╛αñ╣αññαÑç αñ╣αÑêαñé?`
          ));
          if (!confirmed) return;
          wasManualOverride = true;
          oldOverrideTime = lastSession.in;
        } else if (['Punch Out', 'Early Exit'].includes(req.category) && lastSession.out && lastSession.out !== req.newValue) {
          const confirmed = confirm(t(
            `Do you want to replace the existing Punch-Out time ${lastSession.out} with the requested time ${req.newValue} for ${req.employeeName}?`,
            `αñòαÑìαñ»αñ╛ αñåαñ¬ ${req.employeeName} αñªαÑìαñ╡αñ╛αñ░αñ╛ αñàαñ¿αÑüαñ░αÑïαñºαñ┐αññ ${req.newValue} αñòαÑç Punch-Out αñ╕αñ«αñ» αñ╕αÑç αñåαñ¬αñòαÑç αñªαÑìαñ╡αñ╛αñ░αñ╛ αñªαñ░αÑìαñ£ ${lastSession.out} αñòαÑç αñ╕αñ«αñ» αñòαÑï αñ¼αñªαñ▓αñ¿αñ╛ αñÜαñ╛αñ╣αññαÑç αñ╣αÑêαñé?`
          ));
          if (!confirmed) return;
          wasManualOverride = true;
          oldOverrideTime = lastSession.out;
        }
      }
    }

    if (!confirm(t('Approve this request?', 'αñòαÑìαñ»αñ╛ αñåαñ¬ αñçαñ╕ αñ░αñ┐αñòαÑìαñ╡αÑçαñ╕αÑìαñƒ αñòαÑï αñ«αñéαñ£αÑéαñ░ αñòαñ░αñ¿αñ╛ αñÜαñ╛αñ╣αññαÑç αñ╣αÑêαñé?'))) return;

    try {
      const updatedDb = runPayrollTransaction(db, (draft) => {
        // 1. Mark request status as Approved
        draft.approvalRequests = (draft.approvalRequests || []).map(r => 
          r.id === req.id ? { ...r, status: 'Approved' as const } : r
        );

        // 2. Perform updates based on Category
        if (
          req.category === 'Attendance Correction' || 
          req.category === 'Leave' || 
          req.category === 'Manual Attendance' || 
          req.category === 'GeoFence Attendance' ||
          req.category === 'Punch In' || 
          req.category === 'Punch Out' || 
          req.category === 'Early Exit' ||
          req.category === 'Late Entry'
        ) {
          const key = `${req.employeeId}_${req.date}`;
          const existingRec = draft.attendance[key] || {};
          let sessions = existingRec.sessions ? [...existingRec.sessions] : [];

          if (req.newValue.startsWith('[')) {
            const parsed = JSON.parse(req.newValue);
            sessions = parsed.map((s: any, idx: number) => {
              const exist = sessions[idx] || { in: '', out: '' };
              return {
                in: s.in !== undefined && s.in !== '' ? s.in : (exist.in || ''),
                out: s.out !== undefined && s.out !== '' ? s.out : (exist.out || '')
              };
            });
            draft.attendance[key] = {
              ...existingRec,
              status: 'Present',
              sessions
            };
          } else {
            if (req.category === 'Leave') {
              draft.attendance[key] = {
                ...existingRec,
                status: 'Leave'
              };
            } else if (req.category === 'Attendance Correction' && !req.newValue.includes(':')) {
              draft.attendance[key] = {
                ...existingRec,
                status: req.newValue as any
              };
            } else {
              if (req.category === 'Punch In' || req.category === 'Late Entry') {
                if (sessions.length > 0 && !sessions[sessions.length - 1].out) {
                  sessions[sessions.length - 1].in = req.newValue;
                } else {
                  sessions.push({ in: req.newValue, out: '' });
                }
              } else if (req.category === 'Punch Out' || req.category === 'Early Exit') {
                if (sessions.length > 0 && !sessions[sessions.length - 1].out) {
                  sessions[sessions.length - 1].out = req.newValue;
                } else {
                  sessions.push({ in: '', out: req.newValue });
                }
              } else {
                if (sessions.length > 0) sessions[0].out = req.newValue;
                else sessions.push({ in: '', out: req.newValue });
              }

              draft.attendance[key] = {
                ...existingRec,
                status: 'Present',
                sessions
              };
            }
          }
        } else if (req.category === 'Overtime') {
          let otHours = 0;
          try {
            if (req.newValue.includes('{')) {
              otHours = parseFloat(JSON.parse(req.newValue).hours);
            } else {
              otHours = parseFloat(req.newValue);
            }
          } catch(e) {}
          
          if (otHours > 0) {
            draft.overtimeEntries = draft.overtimeEntries || [];
            draft.overtimeEntries.push({
              id: `_OT_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              employeeId: req.employeeId,
              date: req.date,
              hours: otHours,
              calcType: 'HourlyRate',
              amount: 0,
              description: 'Overtime Request Approved'
            });
          }
        } else if (req.category === 'Payment') {
          const parsed = JSON.parse(req.newValue);
          draft.payments = draft.payments.map(p => 
            p.id === parsed.paymentId 
              ? { ...p, date: parsed.date, amount: parsed.amount, mode: parsed.mode, description: parsed.description, paidBy: parsed.paidBy } 
              : p
          );
        } else if (req.category === 'New Payment') {
          const parsed = JSON.parse(req.newValue);
          draft.payments = draft.payments || [];
          draft.payments.push({
            id: `_PAY_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            employeeId: req.employeeId,
            date: parsed.date,
            amount: parsed.amount,
            mode: parsed.mode,
            description: parsed.description || 'New Payment Request Approved',
            paidBy: parsed.paidBy || ''
          });
        } else if (req.category === 'Device Register') {
          draft.employees = draft.employees.map(emp => 
            emp.id === req.employeeId 
              ? { ...emp, currentDeviceId: req.newValue, deviceApproved: true } 
              : emp
          );
          if (draft.devices) {
            draft.devices = draft.devices.map(d => 
              d.employeeId === req.employeeId && d.id === req.newValue 
                ? { ...d, status: 'Approved' as const } 
                : d
            );
          }
        }

        // 3. Add Audit Log entry
        const newAudit: AuditLogEntry = {
          id: `_AUD_${Date.now()}`,
          adminName: draft.company?.name || 'Admin',
          action: wasManualOverride ? `Manual Time Overwritten (Req ID: ${req.id})` : `${req.category} Approved`,
          targetId: req.employeeId,
          targetName: req.employeeName,
          oldValue: wasManualOverride ? oldOverrideTime : req.oldValue,
          newValue: req.newValue.length > 100 ? req.newValue.substring(0, 100) + '...' : req.newValue,
          timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
          device: navigator.userAgent.includes('Mobile') ? 'Mobile Device' : 'Desktop Panel'
        };
        draft.auditLogs = [newAudit, ...(draft.auditLogs || [])];

        // 4. Add notification for the Employee
        const newNotification = {
          id: `_NTF_${Date.now()}`,
          userId: req.employeeId,
          title: t('Request Approved', 'αñ░αñ┐αñòαÑìαñ╡αÑçαñ╕αÑìαñƒ αñ«αñéαñ£αÑéαñ░ αñ╣αÑüαñê'),
          message: `${t('Your request for', 'αñåαñ¬αñòαñ╛')} ${req.category} ${t('on', 'αñ¬αñ░')} ${req.date} ${t('has been approved.', 'αñ«αñéαñ£αÑéαñ░ αñòαñ░ αñªαñ┐αñ»αñ╛ αñùαñ»αñ╛ αñ╣αÑêαÑñ')}`,
          timestamp: new Date().toISOString(),
          read: false
        };
        draft.notifications = [newNotification, ...(draft.notifications || [])];
      });

      if (onUpdateDb) {
        onUpdateDb(updatedDb);
      }
      setSelectedRequestDetails(null);
    } catch (err: any) {
      alert(t('Transaction rolled back: ' + err.message, 'αñƒαÑìαñ░αñ╛αñéαñ£αÑêαñòαÑìαñ╢αñ¿ αñ½αÑçαñ▓: ' + err.message));
    }
  };

  // Reject Request
  const handleReject = (reqId: string) => {
    if (!rejectionReason.trim()) {
      alert(t('Please provide a reason for rejection!', 'αñòαÑâαñ¬αñ»αñ╛ αñ¿αñ╛αñ«αñéαñ£αÑéαñ░ αñòαñ░αñ¿αÑç αñòαñ╛ αñòαñ╛αñ░αñú αñ▓αñ┐αñûαÑçαñé!'));
      return;
    }

    const targetReq = requestsList.find(r => r.id === reqId);
    if (!targetReq) return;

    const updatedRequests = requestsList.map(r => {
      if (r.id === reqId) {
        return { 
          ...r, 
          status: 'Rejected' as const, 
          rejectionReason: rejectionReason.trim() 
        };
      }
      return r;
    });

    try {
      const updatedDb = runPayrollTransaction(db, (draft) => {
        draft.approvalRequests = updatedRequests;

        const newAudit: AuditLogEntry = {
          id: `_AUD_${Date.now()}`,
          adminName: draft.company?.name || 'Admin',
          action: `${targetReq.category} Rejected`,
          targetId: targetReq.employeeId,
          targetName: targetReq.employeeName,
          oldValue: targetReq.oldValue,
          newValue: targetReq.newValue,
          timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
          device: navigator.userAgent.includes('Mobile') ? 'Mobile Device' : 'Desktop Panel'
        };
        draft.auditLogs = [newAudit, ...(draft.auditLogs || [])];

        const newNotification = {
          id: `_NTF_${Date.now()}`,
          userId: targetReq.employeeId,
          title: t('Request Rejected', 'αñ░αñ┐αñòαÑìαñ╡αÑçαñ╕αÑìαñƒ αñ¿αñ╛αñ«αñéαñ£αÑéαñ░ αñ╣αÑüαñê'),
          message: `${t('Your request for', 'αñåαñ¬αñòαñ╛')} ${targetReq.category} ${t('on', 'αñ¬αñ░')} ${targetReq.date} ${t('was rejected.', 'αñ¿αñ╛αñ«αñéαñ£αÑéαñ░ αñòαñ░ αñªαñ┐αñ»αñ╛ αñùαñ»αñ╛ αñ╣αÑêαÑñ')}`,
          timestamp: new Date().toISOString(),
          read: false
        };
        draft.notifications = [newNotification, ...(draft.notifications || [])];
      });

      if (onUpdateDb) onUpdateDb(updatedDb);
      setSelectedRequestDetails(null);
      setRejectingRequestId(null);
      setRejectionReason('');
    } catch (err: any) {
      alert(t('Rejection transaction failed: ' + err.message, 'αñ░αñ┐αñ£αÑçαñòαÑìαñ╢αñ¿ αñ½αÑçαñ▓: ' + err.message));
    }
  };

  const handleReturnForCorrection = (reqId: string) => {
    if (!rejectionReason.trim()) {
      alert(t('Please provide a correction instruction remark!', 'αñòαÑâαñ¬αñ»αñ╛ αñ╕αÑüαñºαñ╛αñ░ αñòαÑç αñ¿αñ┐αñ░αÑìαñªαÑçαñ╢ αñ▓αñ┐αñûαÑçαñé!'));
      return;
    }

    const targetReq = requestsList.find(r => r.id === reqId);
    if (!targetReq) return;

    const updatedRequests = requestsList.map(r => {
      if (r.id === reqId) {
        return { 
          ...r, 
          status: 'Rejected' as const, 
          rejectionReason: `${t('Returned for Correction:', 'αñ╕αÑüαñºαñ╛αñ░ αñòαÑç αñ▓αñ┐αñÅ αñ▓αÑîαñƒαñ╛αñ»αñ╛ αñùαñ»αñ╛:')} ${rejectionReason.trim()}`
        };
      }
      return r;
    });

    try {
      const updatedDb = runPayrollTransaction(db, (draft) => {
        draft.approvalRequests = updatedRequests;

        const newAudit: AuditLogEntry = {
          id: `_AUD_${Date.now()}`,
          adminName: draft.company?.name || 'Admin',
          action: `Returned for Correction`,
          targetId: targetReq.employeeId,
          targetName: targetReq.employeeName,
          oldValue: targetReq.oldValue,
          newValue: targetReq.newValue,
          timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
          device: navigator.userAgent.includes('Mobile') ? 'Mobile Device' : 'Desktop Panel'
        };
        draft.auditLogs = [newAudit, ...(draft.auditLogs || [])];

        const newNotification = {
          id: `_NTF_${Date.now()}`,
          userId: targetReq.employeeId,
          title: t('Request Returned for Correction', 'αñàαñ¿αÑüαñ░αÑïαñº αñ╕αÑüαñºαñ╛αñ░ αñòαÑç αñ▓αñ┐αñÅ αñ▓αÑîαñƒαñ╛αñ»αñ╛ αñùαñ»αñ╛'),
          message: `${t('Your request for', 'αñòαñ╛')} ${targetReq.category} ${t('on', 'αñ¬αñ░')} ${targetReq.date} ${t('was returned for correction.', 'αñòαÑï αñ╕αÑüαñºαñ╛αñ░ αñòαÑç αñ▓αñ┐αñÅ αñ╡αñ╛αñ¬αñ╕ αñ¡αÑçαñ£αñ╛ αñùαñ»αñ╛ αñ╣αÑêαÑñ')}`,
          timestamp: new Date().toISOString(),
          read: false
        };
        draft.notifications = [newNotification, ...(draft.notifications || [])];
      });

      if (onUpdateDb) onUpdateDb(updatedDb);
      setSelectedRequestDetails(null);
      setRejectingRequestId(null);
      setRejectionReason('');
    } catch (err: any) {
      alert(t('Correction transaction failed: ' + err.message, 'αñ╕αÑüαñºαñ╛αñ░ αñ╡αñ┐αñ½αñ▓αññαñ╛: ' + err.message));
    }
  };

  // Delete Request
  const handleDeleteRequest = (reqId: string) => {
    if (!confirm(t('Permanently delete this request record?', 'αñòαÑìαñ»αñ╛ αñåαñ¬ αñçαñ╕ αñàαñ¿αÑüαñ░αÑïαñº αñ░αñ┐αñòαÑëαñ░αÑìαñí αñòαÑï αñ╣αñ«αÑçαñ╢αñ╛ αñòαÑç αñ▓αñ┐αñÅ αñ╣αñƒαñ╛αñ¿αñ╛ αñÜαñ╛αñ╣αññαÑç αñ╣αÑêαñé?'))) return;
    const updatedList = requestsList.filter(req => req.id !== reqId);
    if (onUpdateDb) onUpdateDb({ ...db, approvalRequests: updatedList });
  };

  // Filter requests lists
  const filteredList = requestsList.filter(req => {
    // Role filter
    if (!isAdmin && req.employeeId !== employeeId) return false;
    // Category filter
    if (filterCategory !== 'All' && req.category !== filterCategory) return false;
    // Status filter
    if (filterStatus !== 'All' && req.status !== filterStatus) return false;

    // HISTORY POLICY: Hide rejected employee requests older than 24 hours (Admin views stay intact)
    if (!isAdmin && req.status === 'Rejected') {
      const hoursDiff = (Date.now() - new Date(req.timestamp.replace(' ', 'T')).getTime()) / 3600000;
      if (hoursDiff > 24) return false;
    }

    return true;
  }).sort((a, b) => new Date(b.timestamp.replace(' ', 'T')).getTime() - new Date(a.timestamp.replace(' ', 'T')).getTime());

  // Load request for editing
  const loadEditRequest = (req: ApprovalRequest) => {
    setEditingRequest(req);
    setReqDate(req.date);
    setReason(req.reason);

    if (req.category === 'Payment') {
      setRequestType('payment');
      try {
        if (req.newValue.startsWith('{')) {
          const parsed = JSON.parse(req.newValue);
          setSelPaymentId(parsed.paymentId);
          setNewPaymentDate(parsed.date);
          setNewPaymentAmount(String(parsed.amount));
          setNewPaymentMode(parsed.mode);
          setNewPaymentDesc(parsed.description);
          setNewPaymentPaidBy(parsed.paidBy || '');
        }
      } catch (e) {
        console.error('Failed to parse editing request payment:', e);
      }
    } else if (req.category === 'New Payment') {
      setRequestType('new_payment');
      try {
        if (req.newValue.startsWith('{')) {
          const parsed = JSON.parse(req.newValue);
          setPayRequestDate(parsed.date);
          setPayRequestAmount(String(parsed.amount));
          setPayRequestMode(parsed.mode);
          setNewPaymentPaidBy(parsed.paidBy || '');
        }
      } catch (e) {
        console.error('Failed to parse editing request new payment:', e);
      }
    } else {
      setRequestType('attendance');
      const isPunchCategory = [
        'Punch In', 'Punch Out', 'Early Exit', 'Late Entry', 
        'GeoFence Attendance', 'Manual Attendance'
      ].includes(req.category);
      const isPunchValue = req.newValue.includes(':');
      const isPunchRequest = isPunchCategory || isPunchValue || req.newValue.startsWith('[');

      if (employeeType === 'Hourly' || isPunchRequest) {
        setCorrectionMode('sessions');
        try {
          if (req.newValue.startsWith('[')) {
            const parsed = JSON.parse(req.newValue) as Array<{ in: string; out: string }>;
            
            const parseTime12to24 = (time12: string) => {
              if (!time12) return '';
              if (!time12.includes(' ')) return time12; // Already 24-hour format
              const [time, ampm] = time12.split(' ');
              let [h, m] = time.split(':').map(Number);
              if (ampm === 'PM' && h !== 12) h += 12;
              if (ampm === 'AM' && h === 12) h = 0;
              return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            };

            setPunchSessions(parsed.map(s => ({
              inEnabled: s.in !== '',
              inTime: parseTime12to24(s.in) || '09:00',
              outEnabled: s.out !== '',
              outTime: parseTime12to24(s.out) || '17:00'
            })));
          } else {
            // Single-punch request time string like "12:19" or "09:15 AM"
            const parseTime12to24 = (time12: string) => {
              if (!time12) return '';
              if (!time12.includes(' ')) return time12;
              const [time, ampm] = time12.split(' ');
              let [h, m] = time.split(':').map(Number);
              if (ampm === 'PM' && h !== 12) h += 12;
              if (ampm === 'AM' && h === 12) h = 0;
              return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            };
            const parsedTime = parseTime12to24(req.newValue.trim());
            const isPunchIn = req.category === 'Punch In' || req.category === 'Late Entry' || req.category === 'GeoFence Attendance' || req.category === 'Manual Attendance';
            const isPunchOut = req.category === 'Punch Out' || req.category === 'Early Exit';
            const inEnabled = isPunchIn || !isPunchOut;
            const outEnabled = isPunchOut;
            setPunchSessions([{
              inEnabled,
              inTime: inEnabled ? parsedTime : '09:00',
              outEnabled,
              outTime: outEnabled ? parsedTime : '17:00'
            }]);
          }
        } catch (e) {
          console.error('Failed to parse newValue during edit load:', e);
        }
      } else {
        setCorrectionMode('status');
        setStatusVal(req.newValue as any);
      }
    }
    setEmpView('edit_request');
  };

  const handleAddSessionRow = () => {
    setPunchSessions([...punchSessions, {
      inEnabled: true,
      inTime: getCurrentTimeHHmm(),
      outEnabled: true,
      outTime: getCurrentTimeHHmm()
    }]);
  };

  const handleRemoveSessionRow = (idx: number) => {
    setPunchSessions(punchSessions.filter((_, i) => i !== idx));
  };

  const handleSessionFieldChange = (idx: number, field: keyof typeof punchSessions[0], val: any) => {
    setPunchSessions(punchSessions.map((s, i) => {
      if (i === idx) {
        return { ...s, [field]: val };
      }
      return s;
    }));
  };

  // Helper to render readable sessions/payment newValue
  const renderNewValueText = (val: string) => {
    if (!val) return 'ΓÇö';
    if (val === 'Active Duty / No Leave' || val === 'αñòαñ░αÑìαññαñ╡αÑìαñ» αñ¬αñ░ αñ╕αñòαÑìαñ░αñ┐αñ» / αñòαÑïαñê αñ¢αÑüαñƒαÑìαñƒαÑÇ αñ¿αñ╣αÑÇαñé' || val === 'Not Marked' || val === 'αñ«αñ╛αñ░αÑìαñò αñ¿αñ╣αÑÇαñé αñ╣αÑê') {
      return t('Not Marked', 'αñ«αñ╛αñ░αÑìαñò αñ¿αñ╣αÑÇαñé αñ╣αÑê');
    }
    if (val === 'Present') return t('Present', 'αñëαñ¬αñ╕αÑìαñÑαñ┐αññ');
    if (val === 'Absent') return t('Absent', 'αñàαñ¿αÑüαñ¬αñ╕αÑìαñÑαñ┐αññ');
    if (val === 'Half Day') return t('Half Day', 'αñåαñºαñ╛ αñªαñ┐αñ¿');
    if (val === 'Leave') return t('Leave', 'αñ¢αÑüαñƒαÑìαñƒαÑÇ');

    if (val.startsWith('[')) {
      try {
        const parsed = JSON.parse(val) as Array<{ in: string; out: string }>;
        return parsed.map((s, i) => {
          const inTxt = s.in ? `In: ${formatTimeForDisplay(s.in)}` : '';
          const outTxt = s.out ? `Out: ${formatTimeForDisplay(s.out)}` : '';
          return `Session ${i + 1} (${[inTxt, outTxt].filter(Boolean).join(' | ')})`;
        }).join(', ');
      } catch (e) {
        return val;
      }
    }
    if (val.startsWith('{')) {
      try {
        const parsed = JSON.parse(val) as { date?: string; amount?: number; mode?: string; description?: string; hours?: string; days?: number; startDate?: string };
        if (parsed.hours) {
          return `${t('Overtime:', 'αñôαñ╡αñ░αñƒαñ╛αñçαñ«:')} ${parsed.hours}`;
        }
        if (parsed.days && parsed.startDate) {
          return `${t('Leave Request:', 'αñ¢αÑüαñƒαÑìαñƒαÑÇ αñàαñ¿αÑüαñ░αÑïαñº:')} ${parsed.startDate} (${parsed.days} ${parsed.days === 1 ? t('Day', 'αñªαñ┐αñ¿') : t('Days', 'αñªαñ┐αñ¿')}) ${parsed.description ? `[${parsed.description}]` : ''}`;
        }
        return `${parsed.date || ''} | Γé╣${parsed.amount || 0} | ${parsed.mode || ''} ${parsed.description ? `(${parsed.description})` : ''}`;
      } catch (e) {
        return val;
      }
    }
    if (/^\d{2}:\d{2}$/.test(val)) {
      return formatTimeForDisplay(val);
    }
    return val;
  };

  const triggerTimePicker = (sessionIdx: number, field: 'in' | 'out', currentVal: string) => {
    setPickerMeta({
      sessionIdx,
      field,
      initialVal: currentVal || (field === 'in' ? '09:00' : '17:00')
    });
    setPickerOpen(true);
  };

  const handleSaveTimePicker = (finalTime24: string) => {
    if (!pickerMeta) return;
    const { sessionIdx, field } = pickerMeta;
    if (field === 'overtime') {
      setOvertimeDuration(finalTime24);
      setPickerOpen(false);
      return;
    }
    setPunchSessions(punchSessions.map((s, idx) => {
      if (idx === sessionIdx) {
        return {
          ...s,
          [field === 'in' ? 'inTime' : 'outTime']: finalTime24
        };
      }
      return s;
    }));
    setPickerOpen(false);
  };

  const myPayments = db.payments.filter(p => p.employeeId === (employeeId || ''));

  const getCategoryHi = (cat: string) => {
    switch(cat) {
      case 'GeoFence Attendance': return 'αñ£αñ┐αñ»αÑïαñ½αÑçαñéαñ╕ αñ╕αÑç αñ╣αñ╛αñ£αñ┐αñ░αÑÇ';
      case 'Attendance Correction': return 'αñ«αÑêαñ¿αÑüαñàαñ▓ αñ╣αñ╛αñ£αñ┐αñ░αÑÇ αñ╕αÑüαñºαñ╛αñ░';
      case 'Punch In': return 'αñ¬αñéαñÜ αñçαñ¿ (αñ╕αÑüαñºαñ╛αñ░)';
      case 'Punch Out': return 'αñ¬αñéαñÜ αñåαñëαñƒ (αñ╕αÑüαñºαñ╛αñ░)';
      case 'Payment': return 'αñ¡αÑüαñùαññαñ╛αñ¿ αñ╕αÑüαñºαñ╛αñ░';
      case 'Overtime': return 'αñôαñ╡αñ░αñƒαñ╛αñçαñ« (αñàαññαñ┐αñ░αñ┐αñòαÑìαññ αñ╕αñ«αñ»)';
      case 'Leave': return 'αñ¢αÑüαñƒαÑìαñƒαÑÇ';
      default: return cat;
    }
  };

  return (
    <div className="w-full space-y-5 animate-in fade-in duration-200">
      
      {/* HEADER SECTION */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#EFF6FF] border border-blue-100 flex items-center justify-center text-[#2563EB] shadow-3xs">
            <Icon name="verified_user" size={18} />
          </div>
          <span className="text-xs font-black text-[#0F172A] uppercase tracking-wider">
            {isAdmin ? t('Manager Approval Panel', 'αñ«αÑêαñ¿αÑçαñ£αñ░ αñ«αñéαñ£αÑéαñ░αÑÇ αñíαÑçαñ╕αÑìαñò') : t('My Correction Requests', 'αñ«αÑçαñ░αÑç αñ╕αÑüαñºαñ╛αñ░ αñ░αñ┐αñòαÑìαñ╡αÑçαñ╕αÑìαñƒ')}
          </span>
        </div>

        </div>

        <div className="flex gap-2 items-center">
          <button
            onClick={() => window.location.reload()}
            className="w-9 h-9 rounded-xl bg-[#F7F9FC] border border-[#E2E8F0] text-[#64748B] flex items-center justify-center hover:bg-slate-100 active:scale-[0.97] transition cursor-pointer shrink-0"
            title={t('Refresh', 'αñ░αÑÇαñ½αÑìαñ░αÑçαñ╢')}
          >
            <Icon name="refresh" size={18} />
          </button>

          {!isAdmin && empView === 'list' && (
            <button
              onClick={() => {
                setRequestType('attendance');
                setEmpView('new_request');
              }}
              className="h-9 px-4 bg-[#2563EB] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 active:scale-[0.98] transition-all cursor-pointer shadow-sm shadow-blue-500/10 shrink-0 whitespace-nowrap"
            >
              <Icon name="add" size={16} />
              <span>{t('New Request', 'αñ¿αñ»αñ╛ αñàαñ¿αÑüαñ░αÑïαñº')}</span>
            </button>
          )}
        </div>

      {/* FILTER BAR */}
      {(isAdmin || (!isAdmin && empView === 'list')) && (
        <div className="bg-white border border-[#E2E8F0]/50 p-4 rounded-2xl shadow-3xs flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="text-[10px] text-slate-450 font-bold uppercase tracking-wider shrink-0">
            {t('Filter:', 'αñ½αñ╝αñ┐αñ▓αÑìαñƒαñ░:')}
          </div>
          
          <div className="flex gap-2 w-full sm:flex-1">
            {/* Category Filter */}
            <select
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
              className="h-9 px-2.5 rounded-lg border border-[#E2E8F0] bg-white font-bold text-[10px] text-slate-650 focus:outline-none cursor-pointer flex-1 min-w-0 truncate"
            >
              <option value="All">{t('All Categories', 'αñ╕αñ¡αÑÇ αñ╢αÑìαñ░αÑçαñúαñ┐αñ»αñ╛αñé')}</option>
              {categories.map((c, idx) => (
                <option key={idx} value={c}>{c}</option>
              ))}
            </select>

            {/* Status Filter */}
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as any)}
              className="h-9 px-2.5 rounded-lg border border-[#E2E8F0] bg-white font-bold text-[10px] text-slate-650 focus:outline-none cursor-pointer flex-1 min-w-0 truncate"
            >
              <option value="Pending">{t('Pending Requests', 'αñ▓αñéαñ¼αñ┐αññ αñàαñ¿αÑüαñ░αÑïαñº')}</option>
              <option value="Approved">{t('Approved', 'αñ╕αÑìαñ╡αÑÇαñòαÑâαññ')}</option>
              <option value="Rejected">{t('Rejected', 'αñàαñ╕αÑìαñ╡αÑÇαñòαÑâαññ')}</option>
              <option value="All">{t('All', 'αñ╕αñ¡αÑÇ')}</option>
            </select>
          </div>
        </div>
      )}

      {/* --- EMPLOYEE FORM: CREATE REQUEST --- */}
      {!isAdmin && empView === 'new_request' && (
        <div className="bg-white border border-[#E2E8F0] rounded-3xl p-5 shadow-2xs animate-in slide-in-from-bottom duration-200">
          <div className="text-xs font-black text-[#0F172A] uppercase tracking-wider mb-4 border-b border-slate-50 pb-2">
            {t('Create Correction Request', 'αñ╕αÑüαñºαñ╛αñ░ αñ╣αÑçαññαÑü αñàαñ¿αÑüαñ░αÑïαñº αñ½αÑëαñ░αÑìαñ«')}
          </div>

          {/* Request Type Toggle Selector */}
          <div className="grid grid-cols-2 md:grid-cols-4 rounded-xl border border-[#E2E8F0] overflow-hidden bg-[#F7F9FC] p-1 mb-4 gap-1.5">
            <button
              type="button"
              onClick={() => setRequestType('attendance')}
              className={`h-9 rounded-lg text-[10px] font-black transition-all flex items-center justify-center gap-1 cursor-pointer ${
                requestType === 'attendance' ? 'bg-white text-[#2563EB] shadow-sm border border-[#E2E8F0]' : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              <Icon name="edit_calendar" size={14} />
              <span>{t('Attendance', 'αñ╣αñ╛αñ£αñ┐αñ░αÑÇ αñ╕αÑüαñºαñ╛αñ░')}</span>
            </button>
            <button
              type="button"
              onClick={() => setRequestType('payment')}
              className={`h-9 rounded-lg text-[10px] font-black transition-all flex items-center justify-center gap-1 cursor-pointer ${
                requestType === 'payment' ? 'bg-white text-[#2563EB] shadow-sm border border-[#E2E8F0]' : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              <Icon name="payments" size={14} />
              <span>{t('Edit Payment', 'αñ¡αÑüαñùαññαñ╛αñ¿ αñ╕αÑüαñºαñ╛αñ░')}</span>
            </button>
            <button
              type="button"
              onClick={() => setRequestType('leave')}
              className={`h-9 rounded-lg text-[10px] font-black transition-all flex items-center justify-center gap-1 cursor-pointer ${
                requestType === 'leave' ? 'bg-white text-[#2563EB] shadow-sm border border-[#E2E8F0]' : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              <Icon name="date_range" size={14} />
              <span>{t('Request Leave', 'αñ¢αÑüαñƒαÑìαñƒαÑÇ αñàαñ¿αÑüαñ░αÑïαñº')}</span>
            </button>
            <button
              type="button"
              onClick={() => setRequestType('new_payment')}
              className={`h-9 rounded-lg text-[10px] font-black transition-all flex items-center justify-center gap-1 cursor-pointer ${
                requestType === 'new_payment' ? 'bg-white text-[#2563EB] shadow-sm border border-[#E2E8F0]' : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              <Icon name="add_circle" size={14} />
              <span>{t('New Payment', 'αñ¿αñ»αñ╛ αñ¡αÑüαñùαññαñ╛αñ¿')}</span>
            </button>
          </div>

          <form onSubmit={handleSubmitRequest} className="space-y-4">
            
            {/* ATTENDANCE CORRECTION FORM */}
            {requestType === 'attendance' && (
              <>
                {/* Target Date Selector */}
                <div className="fld">
                  <label>{t('Target Date', 'αñ╕αÑüαñºαñ╛αñ░ αñòαÑÇ αññαñ╛αñ░αÑÇαñû')}</label>
                  <input
                    type="date"
                    value={reqDate}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={e => setReqDate(e.target.value)}
                    className="fi"
                    required
                  />
                </div>

                {/* Mode Selector for Daily/Monthly */}
                {employeeType !== 'Hourly' && (
                  <div className="flex bg-slate-100 border border-slate-150 rounded-xl p-1 mb-4 gap-1 select-none">
                    <button
                      type="button"
                      onClick={() => setCorrectionMode('sessions')}
                      className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg cursor-pointer transition-all ${correctionMode === 'sessions' ? 'bg-white text-[#2563EB] shadow-3xs' : 'text-[#64748B] hover:text-[#0F172A]'}`}
                    >
                      {t('Punch Times', 'αñ¬αñéαñÜ αñ╕αñ«αñ»')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCorrectionMode('status')}
                      className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg cursor-pointer transition-all ${correctionMode === 'status' ? 'bg-white text-[#2563EB] shadow-3xs' : 'text-[#64748B] hover:text-[#0F172A]'}`}
                    >
                      {t('Simple Status', 'αñ╣αñ╛αñ£αñ┐αñ░αÑÇ αñ╕αÑìαñÑαñ┐αññαñ┐')}
                    </button>
                  </div>
                )}

                {/* HOURLY OR SESSIONS CORRECTION FORM */}
                {(employeeType === 'Hourly' || correctionMode === 'sessions') && (
                  <div className="space-y-4 border-t border-[#E2E8F0] pt-3">
                    <div className="text-[10px] font-black text-slate-450 uppercase tracking-wide block">
                      {t('Punch Times Sessions Correction', 'αñ¬αñéαñÜ αñ╕αñ«αñ» αñ╕αÑüαñºαñ╛αñ░ αñ╡αñ┐αñ╡αñ░αñú')}
                    </div>

                    {punchSessions.map((session, idx) => (
                      <div key={idx} className="bg-[#F7F9FC] border border-[#E2E8F0] rounded-xl p-3.5 space-y-3 relative">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black text-[#64748B] uppercase">
                            {t(`Session ${idx + 1}`, `αñ╕αññαÑìαñ░ ${idx + 1}`)}
                          </span>
                          {punchSessions.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveSessionRow(idx)}
                              className="text-rose-600 hover:text-rose-700 text-[10px] font-bold"
                            >
                              {t('Remove', 'αñ╣αñƒαñ╛αñÅαñé')}
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          {/* Punch In */}
                          <div className="space-y-1.5">
                            <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-650 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={session.inEnabled}
                                onChange={e => handleSessionFieldChange(idx, 'inEnabled', e.target.checked)}
                                className="rounded text-[#2563EB] focus:ring-blue-500"
                              />
                              <span>{t('Punch In', 'αñ¬αñéαñÜ αñçαñ¿')}</span>
                            </label>
                            
                            <button
                              type="button"
                              onClick={() => triggerTimePicker(idx, 'in', session.inTime)}
                              disabled={!session.inEnabled}
                              className="h-9 border border-slate-250 rounded-lg px-2.5 text-xs w-full bg-white flex items-center justify-between disabled:opacity-40 disabled:bg-[#F7F9FC] cursor-pointer text-left font-sans text-[#0F172A]"
                            >
                              <span>{session.inTime ? formatTimeForDisplay(session.inTime) : 'ΓÇö'}</span>
                              <Icon name="schedule" size={14} className="text-[#94A3B8]" />
                            </button>
                          </div>

                          {/* Punch Out */}
                          <div className="space-y-1.5">
                            <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-650 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={session.outEnabled}
                                onChange={e => handleSessionFieldChange(idx, 'outEnabled', e.target.checked)}
                                className="rounded text-[#2563EB] focus:ring-blue-500"
                              />
                              <span>{t('Punch Out', 'αñ¬αñéαñÜ αñåαñëαñƒ')}</span>
                            </label>
                            
                            <button
                              type="button"
                              onClick={() => triggerTimePicker(idx, 'out', session.outTime)}
                              disabled={!session.outEnabled}
                              className="h-9 border border-slate-250 rounded-lg px-2.5 text-xs w-full bg-white flex items-center justify-between disabled:opacity-40 disabled:bg-[#F7F9FC] cursor-pointer text-left font-sans text-[#0F172A]"
                            >
                              <span>{session.outTime ? formatTimeForDisplay(session.outTime) : 'ΓÇö'}</span>
                              <Icon name="schedule" size={14} className="text-[#94A3B8]" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={handleAddSessionRow}
                      className="w-full h-9 border border-blue-200 text-[#2563EB] bg-white hover:bg-[#EFF6FF] border-dashed rounded-xl flex items-center justify-center font-bold text-xs gap-1 cursor-pointer"
                    >
                      <Icon name="add" size={16} />
                      <span>{t('Add Multiple Punch Session', 'αñ¿αñ»αñ╛ αñ¬αñéαñÜ αñ╕αññαÑìαñ░ αñ£αÑïαñíαñ╝αÑçαñé')}</span>
                    </button>
                  </div>
                )}

                {/* DAILY / MONTHLY EMPLOYEE CORRECTION FORM */}
                {employeeType !== 'Hourly' && correctionMode === 'status' && (
                  <div className="fld">
                    <label>{t('Requested Status', 'αñ╡αñ╛αñéαñ¢αñ┐αññ αñëαñ¬αñ╕αÑìαñÑαñ┐αññαñ┐ αñ╕αÑìαñÑαñ┐αññαñ┐')}</label>
                    <select
                      value={statusVal}
                      onChange={e => setStatusVal(e.target.value as any)}
                      className="fi"
                    >
                      <option value="Present">{t('Present (αñëαñ¬αñ╕αÑìαñÑαñ┐αññ)', 'Present')}</option>
                      <option value="Absent">{t('Absent (αñàαñ¿αÑüαñ¬αñ╕αÑìαñÑαñ┐αññ)', 'Absent')}</option>
                      <option value="Half Day">{t('Half Day (αñåαñºαñ╛ αñªαñ┐αñ¿)', 'Half Day')}</option>
                      <option value="Overtime">{t('Overtime (αñàαññαñ┐αñ░αñ┐αñòαÑìαññ αñ╕αñ«αñ»)', 'Overtime')}</option>
                    </select>
                  </div>
                )}
                
                {employeeType !== 'Hourly' && correctionMode === 'status' && statusVal === 'Overtime' && (
                  <div className="fld animate-in slide-in-from-top-2 duration-200">
                    <label className="text-center block mb-2">{t('Overtime Duration (Hours & Minutes)', 'αñôαñ╡αñ░αñƒαñ╛αñçαñ« αñàαñ╡αñºαñ┐ (αñÿαñéαñƒαÑç αñöαñ░ αñ«αñ┐αñ¿αñƒ)')}</label>
                    {(() => {
                      const [otHrs, otMins] = overtimeDuration.split(':').map(Number);
                      return (
                        <InlineDurationPicker
                          hours={isNaN(otHrs) ? 2 : otHrs}
                          minutes={isNaN(otMins) ? 0 : otMins}
                          onChange={(h, m) => {
                            setOvertimeDuration(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
                          }}
                        />
                      );
                    })()}
                  </div>
                )}

              </>
            )}

            {/* PAYMENT EDIT REQUEST FORM */}
            {requestType === 'payment' && (
              <div className="space-y-4 border-t border-[#E2E8F0] pt-3">
                
                {/* Select payment transaction to edit */}
                <div className="fld">
                  <label>{t('Select Payment to Correct', 'αñ╕αñéαñ╢αÑïαñºαñ┐αññ αñòαñ░αñ¿αÑç αñòαÑç αñ▓αñ┐αñÅ αñ¡αÑüαñùαññαñ╛αñ¿ αñÜαÑüαñ¿αÑçαñé')}</label>
                  {myPayments.length === 0 ? (
                    <p className="text-xs text-[#94A3B8] italic p-3 border border-slate-150 rounded-xl bg-[#F7F9FC]">
                      {t('No payments recorded by administrator yet.', 'αñ¬αÑìαñ░αñ╢αñ╛αñ╕αñò αñªαÑìαñ╡αñ╛αñ░αñ╛ αñàαñ¡αÑÇ αññαñò αñòαÑïαñê αñ¡αÑüαñùαññαñ╛αñ¿ αñªαñ░αÑìαñ£ αñ¿αñ╣αÑÇαñé αñòαñ┐αñ»αñ╛ αñùαñ»αñ╛ αñ╣αÑêαÑñ')}
                    </p>
                  ) : (
                    <select
                      value={selPaymentId}
                      onChange={e => {
                        const pId = e.target.value;
                        setSelPaymentId(pId);
                        const pay = myPayments.find(p => p.id === pId);
                        if (pay) {
                          setNewPaymentDate(pay.date);
                          setNewPaymentAmount(String(pay.amount));
                          setNewPaymentMode(pay.mode);
                          setNewPaymentDesc(pay.description || '');
                        }
                      }}
                      className="fi"
                      required
                    >
                      <option value="">{t('-- Choose Payment Transaction --', '-- αñ¡αÑüαñùαññαñ╛αñ¿ αñ▓αÑçαñ¿αñªαÑçαñ¿ αñÜαÑüαñ¿αÑçαñé --')}</option>
                      {myPayments.map(p => {
                        const label = `${p.date} - Γé╣${p.amount} (${p.mode}) ${p.description ? `- ${p.description}` : ''}`;
                        return (
                          <option key={p.id} value={p.id}>
                            {label}
                          </option>
                        );
                      })}
                    </select>
                  )}
                </div>

                {selPaymentId && (
                  <div className="space-y-4 bg-[#F7F9FC] border border-[#E2E8F0] rounded-2xl p-4">
                    <div className="text-[10px] font-black text-slate-450 uppercase tracking-wide">
                      {t('New Corrected Values', 'αñ¿αñÅ αñ╕αñéαñ╢αÑïαñºαñ┐αññ αñ«αñ╛αñ¿')}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="fld mb-0">
                        <label>{t('Correct Date', 'αñ╕αñ╣αÑÇ αññαñ╛αñ░αÑÇαñû')}</label>
                        <input
                          type="date"
                          value={newPaymentDate}
                          onChange={e => setNewPaymentDate(e.target.value)}
                          className="fi"
                          required
                        />
                      </div>

                      <div className="fld mb-0">
                        <label>{t('Correct Amount (Γé╣)', 'αñ╕αñ╣αÑÇ αñ░αñ╛αñ╢αñ┐ (Γé╣)')}</label>
                        <input
                          type="number"
                          value={newPaymentAmount}
                          onChange={e => setNewPaymentAmount(e.target.value)}
                          className="fi"
                          placeholder="e.g. 5000"
                          required
                        />
                      </div>
                    </div>

                    <div className="fld">
                      <label>{t('Correct Payment Mode', 'αñ╕αñ╣αÑÇ αñ¡αÑüαñùαññαñ╛αñ¿ αñ«αñ╛αñºαÑìαñ»αñ«')}</label>
                      <select
                        value={newPaymentMode}
                        onChange={e => setNewPaymentMode(e.target.value)}
                        className="fi bg-white"
                      >
                        <option value="Cash">Cash</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                        <option value="UPI / Online">UPI / Online</option>
                        <option value="Cheque">Cheque</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>

                    <div className="fld">
                      <label>{t('Correct Description', 'αñ╕αñ╣αÑÇ αñ╡αñ┐αñ╡αñ░αñú/αñƒαñ┐αñ¬αÑìαñ¬αñúαÑÇ')}</label>
                      <input
                        type="text"
                        value={newPaymentDesc}
                        onChange={e => setNewPaymentDesc(e.target.value)}
                        placeholder="e.g. Received via GPay"
                        className="fi bg-white"
                      />
                    </div>

                    <div className="fld">
                      <label>{t('Correct Paid By', 'αñ╕αñ╣αÑÇ αñ¡αÑüαñùαññαñ╛αñ¿αñòαñ░αÑìαññαñ╛ (Paid By)')}</label>
                      <select
                        value={newPaymentPaidBy}
                        onChange={e => setNewPaymentPaidBy(e.target.value)}
                        className="fi bg-white"
                      >
                        <option value="">{t('-- Select Paid By --', '-- αñ¡αÑüαñùαññαñ╛αñ¿αñòαñ░αÑìαññαñ╛ αñÜαÑüαñ¿αÑçαñé --')}</option>
                        {(db.company?.paidByNames || ['by Pankaj', 'by Vinod', 'by Babuji', 'by ghar vale']).map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

              </div>
            )}

            {/* LEAVE REQUEST FORM */}
            {requestType === 'leave' && (
              <div className="space-y-4 border-t border-[#E2E8F0] pt-3 animate-in fade-in duration-200">
                <div className="grid grid-cols-2 gap-4">
                  <div className="fld mb-0">
                    <label>{t('Leave Start Date', 'αñ¢αÑüαñƒαÑìαñƒαÑÇ αñ╢αÑüαñ░αÑé αñ╣αÑïαñ¿αÑç αñòαÑÇ αññαñ╛αñ░αÑÇαñû')}</label>
                    <input
                      type="date"
                      value={leaveStartDate}
                      min={new Date().toISOString().split('T')[0]}
                      onChange={e => setLeaveStartDate(e.target.value)}
                      className="fi"
                      required
                    />
                  </div>

                  <div className="fld mb-0">
                    <label>{t('Duration (Days)', 'αñàαñ╡αñºαñ┐ (αñªαñ┐αñ¿)')}</label>
                    <select
                      value={leaveDays}
                      onChange={e => setLeaveDays(parseInt(e.target.value, 10))}
                      className="fi"
                      required
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                        <option key={d} value={d}>
                          {d} {d === 1 ? t('Day', 'αñªαñ┐αñ¿') : t('Days', 'αñªαñ┐αñ¿')}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* NEW PAYMENT REQUEST FORM */}
            {requestType === 'new_payment' && (
              <div className="space-y-4 border-t border-[#E2E8F0] pt-3 animate-in fade-in duration-200">
                <div className="grid grid-cols-2 gap-4">
                  <div className="fld mb-0">
                    <label>{t('Request Date', 'αñàαñ¿αÑüαñ░αÑïαñº αñòαÑÇ αññαñ╛αñ░αÑÇαñû')}</label>
                    <input
                      type="date"
                      value={payRequestDate}
                      onChange={e => setPayRequestDate(e.target.value)}
                      className="fi"
                      required
                    />
                  </div>

                  <div className="fld mb-0">
                    <label>{t('Request Amount (Γé╣)', 'αñàαñ¿αÑüαñ░αÑïαñº αñ░αñ╛αñ╢αñ┐ (Γé╣)')}</label>
                    <input
                      type="number"
                      value={payRequestAmount}
                      onChange={e => setPayRequestAmount(e.target.value)}
                      className="fi"
                      placeholder="e.g. 2000"
                      required
                    />
                  </div>
                </div>

                <div className="fld">
                  <label>{t('Preferred Payment Mode', 'αñ¬αñ╕αñéαñªαÑÇαñªαñ╛ αñ¡αÑüαñùαññαñ╛αñ¿ αñ«αñ╛αñºαÑìαñ»αñ«')}</label>
                  <select
                    value={payRequestMode}
                    onChange={e => setPayRequestMode(e.target.value)}
                    className="fi"
                    required
                  >
                    <option value="Cash">Cash</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="UPI / Online">UPI / Online</option>
                    <option value="Cheque">Cheque</option>
                  </select>
                </div>

                <div className="fld">
                  <label>{t('Paid By Option', 'αñ¡αÑüαñùαññαñ╛αñ¿αñòαñ░αÑìαññαñ╛ (Paid By)')}</label>
                  <select
                    value={newPaymentPaidBy}
                    onChange={e => setNewPaymentPaidBy(e.target.value)}
                    className="fi bg-white"
                  >
                    <option value="">{t('-- Select Paid By --', '-- αñ¡αÑüαñùαññαñ╛αñ¿αñòαñ░αÑìαññαñ╛ αñÜαÑüαñ¿αÑçαñé --')}</option>
                    {(db.company?.paidByNames || ['by Pankaj', 'by Vinod', 'by Babuji', 'by ghar vale']).map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Reason */}
            <div className="fld">
              <label>{t('Reason / Description (Optional)', 'αñ╡αñ┐αñ╡αñ░αñú / αñòαñ╛αñ░αñú (αñ╡αÑêαñòαñ▓αÑìαñ¬αñ┐αñò)')}</label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder={t('Add description or details (optional)...', 'αñòαÑïαñê αñàαññαñ┐αñ░αñ┐αñòαÑìαññ αñ£αñ╛αñ¿αñòαñ╛αñ░αÑÇ αñ»αñ╛ αñòαñ╛αñ░αñú αñ▓αñ┐αñûαÑçαñé (αñ╡αÑêαñòαñ▓αÑìαñ¬αñ┐αñò)...')}
                className="fi h-20 py-2.5 resize-none"
              />
            </div>

            <div className="flex gap-4 border-t border-slate-50 pt-4">
              <button
                type="button"
                onClick={() => setEmpView('list')}
                className="flex-1 btn bou text-xs font-semibold"
              >
                {t('Cancel', 'αñ░αñªαÑìαñª αñòαñ░αÑçαñé')}
              </button>
              <button
                type="submit"
                disabled={requestType === 'payment' && !selPaymentId}
                className="flex-1 btn bbl text-white font-semibold text-xs shadow-blue-500/10 disabled:opacity-50"
              >
                {t('Submit Request', 'αñàαñ¿αÑüαñ░αÑïαñº αñ¡αÑçαñ£αÑçαñé')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* --- EMPLOYEE FORM: EDIT REQUEST --- */}
      {!isAdmin && empView === 'edit_request' && editingRequest && (
        <div className="bg-white border border-[#E2E8F0] rounded-3xl p-5 shadow-2xs animate-in slide-in-from-bottom duration-200">
          <div className="text-xs font-black text-[#0F172A] uppercase tracking-wider mb-4 border-b border-slate-50 pb-2">
            {t('Modify Correction Request', 'αñàαñ¿αÑüαñ░αÑïαñº αñ╕αñéαñ¬αñ╛αñªαñ┐αññ αñòαñ░αÑçαñé')}
          </div>

          <form onSubmit={handleEditRequestSubmit} className="space-y-4">
            
            {requestType === 'attendance' && (
              <>
                <div className="fld">
                  <label>{t('Target Date', 'αññαñ╛αñ░αÑÇαñû')}</label>
                  <input
                    type="date"
                    value={reqDate}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={e => setReqDate(e.target.value)}
                    className="fi"
                    required
                  />
                </div>

                {/* Mode Selector for Daily/Monthly */}
                {employeeType !== 'Hourly' && (
                  <div className="flex bg-slate-100 border border-slate-150 rounded-xl p-1 mb-4 gap-1 select-none">
                    <button
                      type="button"
                      onClick={() => setCorrectionMode('sessions')}
                      className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg cursor-pointer transition-all ${correctionMode === 'sessions' ? 'bg-white text-[#2563EB] shadow-3xs' : 'text-[#64748B] hover:text-[#0F172A]'}`}
                    >
                      {t('Punch Times', 'αñ¬αñéαñÜ αñ╕αñ«αñ»')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCorrectionMode('status')}
                      className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg cursor-pointer transition-all ${correctionMode === 'status' ? 'bg-white text-[#2563EB] shadow-3xs' : 'text-[#64748B] hover:text-[#0F172A]'}`}
                    >
                      {t('Simple Status', 'αñ╣αñ╛αñ£αñ┐αñ░αÑÇ αñ╕αÑìαñÑαñ┐αññαñ┐')}
                    </button>
                  </div>
                )}

                {/* Hourly Edit / Sessions Edit */}
                {(employeeType === 'Hourly' || correctionMode === 'sessions') && (
                  <div className="space-y-4 border-t border-[#E2E8F0] pt-3">
                    <div className="text-[10px] font-black text-slate-450 uppercase tracking-wide block">
                      {t('Punch Times Sessions Correction', 'αñ¬αñéαñÜ αñ╕αñ«αñ» αñ╕αÑüαñºαñ╛αñ░ αñ╡αñ┐αñ╡αñ░αñú')}
                    </div>

                    {punchSessions.map((session, idx) => (
                      <div key={idx} className="bg-[#F7F9FC] border border-[#E2E8F0] rounded-xl p-3.5 space-y-3 relative">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black text-[#64748B] uppercase">
                            {t(`Session ${idx + 1}`, `αñ╕αññαÑìαñ░ ${idx + 1}`)}
                          </span>
                          {punchSessions.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveSessionRow(idx)}
                              className="text-rose-600 hover:text-rose-700 text-[10px] font-bold"
                            >
                              {t('Remove', 'αñ╣αñƒαñ╛αñÅαñé')}
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          {/* Punch In */}
                          <div className="space-y-1.5">
                            <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-650 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={session.inEnabled}
                                onChange={e => handleSessionFieldChange(idx, 'inEnabled', e.target.checked)}
                                className="rounded text-[#2563EB] focus:ring-blue-500"
                              />
                              <span>{t('Punch In', 'αñ¬αñéαñÜ αñçαñ¿')}</span>
                            </label>
                            
                            <button
                              type="button"
                              onClick={() => triggerTimePicker(idx, 'in', session.inTime)}
                              disabled={!session.inEnabled}
                              className="h-9 border border-slate-250 rounded-lg px-2.5 text-xs w-full bg-white flex items-center justify-between disabled:opacity-40 disabled:bg-[#F7F9FC] cursor-pointer text-left font-sans text-[#0F172A]"
                            >
                              <span>{session.inTime ? formatTimeForDisplay(session.inTime) : 'ΓÇö'}</span>
                              <Icon name="schedule" size={14} className="text-[#94A3B8]" />
                            </button>
                          </div>

                          {/* Punch Out */}
                          <div className="space-y-1.5">
                            <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-650 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={session.outEnabled}
                                onChange={e => handleSessionFieldChange(idx, 'outEnabled', e.target.checked)}
                                className="rounded text-[#2563EB] focus:ring-blue-500"
                              />
                              <span>{t('Punch Out', 'αñ¬αñéαñÜ αñåαñëαñƒ')}</span>
                            </label>
                            
                            <button
                              type="button"
                              onClick={() => triggerTimePicker(idx, 'out', session.outTime)}
                              disabled={!session.outEnabled}
                              className="h-9 border border-slate-250 rounded-lg px-2.5 text-xs w-full bg-white flex items-center justify-between disabled:opacity-40 disabled:bg-[#F7F9FC] cursor-pointer text-left font-sans text-[#0F172A]"
                            >
                              <span>{session.outTime ? formatTimeForDisplay(session.outTime) : 'ΓÇö'}</span>
                              <Icon name="schedule" size={14} className="text-[#94A3B8]" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={handleAddSessionRow}
                      className="w-full h-9 border border-blue-200 text-[#2563EB] bg-white hover:bg-[#EFF6FF] border-dashed rounded-xl flex items-center justify-center font-bold text-xs gap-1 cursor-pointer"
                    >
                      <Icon name="add" size={16} />
                      <span>{t('Add Multiple Punch Session', 'αñ¿αñ»αñ╛ αñ¬αñéαñÜ αñ╕αññαÑìαñ░ αñ£αÑïαñíαñ╝αÑçαñé')}</span>
                    </button>
                  </div>
                )}

                {/* Daily/Monthly Edit Status */}
                {employeeType !== 'Hourly' && correctionMode === 'status' && (
                  <div className="fld">
                    <label>{t('Requested Status', 'αñ╡αñ╛αñéαñ¢αñ┐αññ αñëαñ¬αñ╕αÑìαñÑαñ┐αññαñ┐ αñ╕αÑìαñÑαñ┐αññαñ┐')}</label>
                    <select
                      value={statusVal}
                      onChange={e => setStatusVal(e.target.value as any)}
                      className="fi"
                    >
                      <option value="Present">{t('Present (αñëαñ¬αñ╕αÑìαñÑαñ┐αññ)', 'Present')}</option>
                      <option value="Absent">{t('Absent (αñàαñ¿αÑüαñ¬αñ╕αÑìαñÑαñ┐αññ)', 'Absent')}</option>
                      <option value="Half Day">{t('Half Day (αñåαñºαñ╛ αñªαñ┐αñ¿)', 'Half Day')}</option>
                      <option value="Overtime">{t('Overtime (αñàαññαñ┐αñ░αñ┐αñòαÑìαññ αñ╕αñ«αñ»)', 'Overtime')}</option>
                    </select>
                  </div>
                )}
                
                {employeeType !== 'Hourly' && correctionMode === 'status' && statusVal === 'Overtime' && (
                  <div className="fld animate-in slide-in-from-top-2 duration-200">
                    <label>{t('Overtime Duration (HH:MM)', 'αñôαñ╡αñ░αñƒαñ╛αñçαñ« αñàαñ╡αñºαñ┐')}</label>
                    <button
                      type="button"
                      onClick={() => {
                        setPickerMeta({ sessionIdx: 0, field: 'overtime', initialVal: overtimeDuration });
                        setPickerOpen(true);
                      }}
                      className="h-9 border border-slate-250 rounded-lg px-3 text-sm font-bold w-full bg-white flex items-center justify-between cursor-pointer"
                    >
                      <span>{overtimeDuration}</span>
                      <Icon name="schedule" size={16} className="text-[#94A3B8]" />
                    </button>
                  </div>
                )}
              </>
            )}

            {requestType === 'payment' && (
              <div className="space-y-4 bg-[#F7F9FC] border border-[#E2E8F0] rounded-2xl p-4">
                <div className="text-[10px] font-black text-slate-450 uppercase tracking-wide">
                  {t('Edit Payment Values', 'αñ╕αñéαñ╢αÑïαñºαñ┐αññ αñ¡αÑüαñùαññαñ╛αñ¿ αñ╡αñ┐αñ╡αñ░αñú')}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="fld mb-0">
                    <label>{t('Correct Date', 'αñ╕αñ╣αÑÇ αññαñ╛αñ░αÑÇαñû')}</label>
                    <input
                      type="date"
                      value={newPaymentDate}
                      onChange={e => setNewPaymentDate(e.target.value)}
                      className="fi"
                      required
                    />
                  </div>

                  <div className="fld mb-0">
                    <label>{t('Correct Amount (Γé╣)', 'αñ╕αñ╣αÑÇ αñ░αñ╛αñ╢αñ┐ (Γé╣)')}</label>
                    <input
                      type="number"
                      value={newPaymentAmount}
                      onChange={e => setNewPaymentAmount(e.target.value)}
                      className="fi"
                      required
                    />
                  </div>
                </div>

                <div className="fld">
                  <label>{t('Correct Payment Mode', 'αñ╕αñ╣αÑÇ αñ¡αÑüαñùαññαñ╛αñ¿ αñ«αñ╛αñºαÑìαñ»αñ«')}</label>
                  <select
                    value={newPaymentMode}
                    onChange={e => setNewPaymentMode(e.target.value)}
                    className="fi bg-white"
                  >
                    <option value="Cash">Cash</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="UPI / Online">UPI / Online</option>
                    <option value="Cheque">Cheque</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div className="fld">
                  <label>{t('Correct Description', 'αñ╕αñ╣αÑÇ αñ╡αñ┐αñ╡αñ░αñú/αñƒαñ┐αñ¬αÑìαñ¬αñúαÑÇ')}</label>
                  <input
                    type="text"
                    value={newPaymentDesc}
                    onChange={e => setNewPaymentDesc(e.target.value)}
                    className="fi bg-white"
                  />
                </div>

                <div className="fld">
                  <label>{t('Correct Paid By', 'αñ╕αñ╣αÑÇ αñ¡αÑüαñùαññαñ╛αñ¿αñòαñ░αÑìαññαñ╛ (Paid By)')}</label>
                  <select
                    value={newPaymentPaidBy}
                    onChange={e => setNewPaymentPaidBy(e.target.value)}
                    className="fi bg-white"
                  >
                    <option value="">{t('-- Select Paid By --', '-- αñ¡αÑüαñùαññαñ╛αñ¿αñòαñ░αÑìαññαñ╛ αñÜαÑüαñ¿αÑçαñé --')}</option>
                    {(db.company?.paidByNames || ['by Pankaj', 'by Vinod', 'by Babuji', 'by ghar vale']).map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="fld">
              <label>{t('Reason', 'αñòαñ╛αñ░αñú')}</label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="fi h-20 py-2.5 resize-none"
                required
              />
            </div>

            <div className="flex gap-4 border-t border-slate-50 pt-4">
              <button
                type="button"
                onClick={() => {
                  setEditingRequest(null);
                  setEmpView('list');
                }}
                className="flex-1 btn bou text-xs font-semibold"
              >
                {t('Cancel', 'αñ¬αÑÇαñ¢αÑç αñ£αñ╛αñÅαñé')}
              </button>
              <button
                type="submit"
                className="flex-1 btn bbl text-white font-semibold text-xs"
              >
                {t('Save Changes', 'αñ¼αñªαñ▓αñ╛αñ╡ αñ╕αÑüαñ░αñòαÑìαñ╖αñ┐αññ αñòαñ░αÑçαñé')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* --- REQUESTS LIST VIEW --- */}
      {((!isAdmin && empView === 'list') || isAdmin) && (
        <div className="space-y-3">
          {filteredList.length === 0 ? (
            <div className="text-center py-10 bg-white border border-slate-150 rounded-2xl text-xs text-[#94A3B8] font-semibold uppercase tracking-wider">
              {t('No correction requests found', 'αñòαÑïαñê αñ╕αÑüαñºαñ╛αñ░ αñàαñ¿αÑüαñ░αÑïαñº αñ¿αñ╣αÑÇαñé αñ«αñ┐αñ▓αñ╛')}
            </div>
          ) : (
            filteredList.map((req) => (
              <div key={req.id} className="bg-white border border-[#E2E8F0]/70 rounded-2xl p-4 shadow-3xs space-y-3 relative overflow-hidden">
                {/* Status indicator strip */}
                <div className={`absolute top-0 left-0 right-0 h-1.5 ${
                  req.status === 'Pending' ? 'bg-amber-400' :
                  req.status === 'Approved' ? 'bg-emerald-500' :
                  'bg-rose-500'
                }`} />

                {/* Request Header */}
                <div className="flex items-center justify-between gap-4 pt-1">
                  <div className="flex items-center gap-2.5">
                    {isAdmin && (
                      <div 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (req.employeePic) setLightboxSrc(req.employeePic);
                        }}
                        className={`w-8 h-8 rounded-full bg-[#F7F9FC] border border-[#E2E8F0] overflow-hidden flex items-center justify-center shrink-0 shadow-inner transition-all cursor-zoom-in hover:border-blue-400 hover:scale-105 active:scale-95`}
                      >
                        {req.employeePic ? (
                          <img src={req.employeePic} alt={req.employeeName} className="w-full h-full object-cover" />
                        ) : (
                          <Icon name="person" size={18} className="text-[#94A3B8]" />
                        )}
                      </div>
                    )}
                    <div>
                      {isAdmin && <div className="text-xs font-extrabold text-[#0F172A]">{req.employeeName}</div>}
                      <div className="text-[10px] text-slate-450 font-bold uppercase tracking-wider flex items-center gap-1.5 flex-wrap">
                        <span>{t(req.category, getCategoryHi(req.category))} ┬╖ {req.date}</span>
                        {req.gpsAccuracy !== undefined && (
                          req.gpsAccuracy <= 30 ? (
                            <span className="inline-flex items-center gap-0.5 bg-emerald-50 text-emerald-700 border border-emerald-100 text-[8px] font-black px-1.5 py-0.2 rounded-md">
                              GPS Accepted ({req.gpsAccuracy.toFixed(0)}m)
                            </span>
                          ) : req.gpsAccuracy <= 100 ? (
                            <span className="inline-flex items-center gap-0.5 bg-amber-50 text-amber-700 border border-amber-100 text-[8px] font-black px-1.5 py-0.2 rounded-md">
                              ΓÜá∩╕Å GPS Warning ({req.gpsAccuracy.toFixed(0)}m)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 bg-rose-50 text-rose-700 border border-rose-100 text-[8px] font-black px-1.5 py-0.2 rounded-md animate-pulse">
                              ≡ƒÜ¿ GPS Manual Review ({req.gpsAccuracy.toFixed(0)}m)
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  </div>

                  <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wide border ${
                    req.status === 'Pending' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                    req.status === 'Approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                    'bg-rose-50 text-rose-700 border-rose-100'
                  }`}>
                    {req.status === 'Pending' ? t('Pending', 'αñ▓αñéαñ¼αñ┐αññ') : req.status === 'Approved' ? t('Approved', 'αñ╕αÑìαñ╡αÑÇαñòαÑâαññ') : t('Rejected', 'αñàαñ╕αÑìαñ╡αÑÇαñòαÑâαññ')}
                  </span>
                </div>

                {/* Request details (Old vs New value) */}
                <div className="relative text-xs grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="bg-[#F7F9FC] border border-[#E2E8F0] rounded-xl p-2.5 space-y-0.5 flex flex-col justify-center">
                    <span className="text-[8px] uppercase tracking-wider text-[#94A3B8] font-bold block">{t('Old Value', 'αñ¬αÑüαñ░αñ╛αñ¿αñ╛ αñ«αñ╛αñ¿')}</span>
                    <span className="font-semibold text-[#64748B] line-through truncate">{renderNewValueText(req.oldValue || '-')}</span>
                  </div>
                  <div className="bg-[#EFF6FF]/30 border border-blue-100/50 rounded-xl p-2.5 space-y-0.5 flex flex-col justify-center">
                    <span className="text-[8px] uppercase tracking-wider text-blue-500 font-bold block">{t('Requested Value', 'αñàαñ¿αÑüαñ░αÑïαñºαñ┐αññ αñ«αñ╛αñ¿')}</span>
                    <span className="font-black text-blue-700 truncate">{renderNewValueText(req.newValue)}</span>
                  </div>
                </div>

                {/* Reason */}
                <div className="text-[10px] text-[#64748B] font-semibold leading-relaxed">
                  <span className="text-[#94A3B8] font-bold">{t('Reason:', 'αñòαñ╛αñ░αñú:')}</span> {req.reason}
                </div>

                {/* Rejection remarks if rejected */}
                {req.status === 'Rejected' && req.rejectionReason && (
                  <div className="text-[10px] text-rose-650 font-bold bg-rose-50/50 border border-rose-100 rounded-xl p-2.5">
                    {t('Rejection Reason:', 'αñàαñ╕αÑìαñ╡αÑÇαñòαÑâαññαñ┐ αñòαñ╛ αñòαñ╛αñ░αñú:')} {req.rejectionReason}
                  </div>
                )}

                {/* Action panel */}
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 border-t border-slate-50 pt-3">
                  <span className="text-[8px] text-[#94A3B8] font-bold uppercase tracking-wider">
                    {t('Submitted:', 'αñ¡αÑçαñ£αñ╛ αñùαñ»αñ╛:')} {formatLocalTimestamp(req.timestamp)}
                  </span>

                  <div className="flex gap-2 w-full sm:w-auto">
                    {/* Admin actions */}
                    {isAdmin && req.status === 'Pending' && (
                      <>
                        <button
                          onClick={() => setSelectedRequestDetails(req)}
                          className="flex-1 sm:flex-none h-8 px-2 border border-blue-200 text-blue-650 hover:bg-[#EFF6FF] rounded-lg text-[10px] font-bold cursor-pointer transition-colors active:scale-[0.97] whitespace-nowrap"
                        >
                          {t('Review', 'αñ╡αñ┐αñ╡αñ░αñú αñªαÑçαñûαÑçαñé')}
                        </button>
                        <button
                          onClick={() => handleApprove(req)}
                          className="flex-1 sm:flex-none h-8 px-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold cursor-pointer transition-colors active:scale-[0.97] whitespace-nowrap"
                        >
                          {t('Approve', 'αñ╕αÑìαñ╡αÑÇαñòαñ╛αñ░αÑçαñé')}
                        </button>
                        <button
                          onClick={() => setRejectingRequestId(req.id)}
                          className="flex-1 sm:flex-none h-8 px-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-bold cursor-pointer transition-colors active:scale-[0.97] whitespace-nowrap"
                        >
                          {t('Reject', 'αñàαñ╕αÑìαñ╡αÑÇαñòαñ╛αñ░αÑçαñé')}
                        </button>
                      </>
                    )}

                    {/* Admin Delete History resolved */}
                    {isAdmin && req.status !== 'Pending' && (
                      <button
                        onClick={() => handleDeleteRequest(req.id)}
                        className="h-8 w-8 rounded-lg border border-[#E2E8F0] text-[#94A3B8] hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center cursor-pointer transition-colors"
                        title={t('Delete Record', 'αñ░αñ┐αñòαÑëαñ░αÑìαñí αñ╣αñƒαñ╛αñÅαñé')}
                      >
                        <Icon name="delete" size={16} />
                      </button>
                    )}

                    {/* Employee Actions */}
                    {!isAdmin && req.status === 'Pending' && (
                      <>
                        <button
                          onClick={() => loadEditRequest(req)}
                          className="flex-1 sm:flex-none h-8 px-3 border border-[#E2E8F0] text-slate-655 hover:bg-[#F7F9FC] rounded-lg text-[10px] font-bold cursor-pointer transition-colors whitespace-nowrap"
                        >
                          {t('Edit', 'αñ╕αñéαñ¬αñ╛αñªαñ┐αññ αñòαñ░αÑçαñé')}
                        </button>
                        <button
                          onClick={() => handleCancelRequest(req.id)}
                          className="flex-1 sm:flex-none h-8 px-3 border border-rose-100 text-rose-600 hover:bg-rose-50 rounded-lg text-[10px] font-bold cursor-pointer transition-colors whitespace-nowrap"
                        >
                          {t('Cancel', 'αñ░αñªαÑìαñª αñòαñ░αÑçαñé')}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Reject Input popup banner */}
                {isAdmin && rejectingRequestId === req.id && (
                  <div className="bg-[#F7F9FC] border border-[#E2E8F0] rounded-xl p-3 mt-3 space-y-3 animate-in fade-in duration-200">
                    <div className="text-[10px] font-black text-[#0F172A] uppercase tracking-wide">
                      {t('Provide Rejection Remarks', 'αñàαñ╕αÑìαñ╡αÑÇαñòαÑâαññαñ┐ αñòαñ╛ αñòαñ╛αñ░αñú αñªαñ░αÑìαñ£ αñòαñ░αÑçαñé')}
                    </div>
                    <input
                      type="text"
                      value={rejectionReason}
                      onChange={e => setRejectionReason(e.target.value)}
                      placeholder={t('e.g. Incorrect date / invalid claim', 'αñ£αÑêαñ╕αÑç: αñùαñ▓αññ αññαñ╛αñ░αÑÇαñû / αñàαñ¿αÑüαñÜαñ┐αññ αñªαñ╛αñ╡αñ╛')}
                      className="w-full h-9 border border-[#E2E8F0] rounded-lg px-3 text-xs outline-none bg-white focus:border-blue-500"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleReject(req.id)}
                        className="flex-1 h-8 bg-rose-600 text-white rounded-lg text-[10px] font-bold cursor-pointer"
                      >
                        {t('Confirm Reject', 'αñàαñ╕αÑìαñ╡αÑÇαñòαÑâαññαñ┐ αñòαÑÇ αñ¬αÑüαñ╖αÑìαñƒαñ┐ αñòαñ░αÑçαñé')}
                      </button>
                      <button
                        onClick={() => {
                          setRejectingRequestId(null);
                          setRejectionReason('');
                        }}
                        className="w-20 h-8 border border-slate-250 bg-white text-slate-655 rounded-lg text-[10px] font-bold cursor-pointer"
                      >
                        {t('Cancel', 'αñ░αñªαÑìαñª')}
                      </button>
                    </div>
                  </div>
                )}

              </div>
            ))
          )}
        </div>
      )}

      {/* UNIFIED ADMIN APPROVAL REVIEW MODAL OVERLAY */}
      {selectedRequestDetails && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-3xl w-full max-w-xl p-6 shadow-2xl space-y-4 overflow-y-auto max-h-[90vh] animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center border-b border-[#E2E8F0] pb-3">
              <h3 className="text-sm font-black text-[#0F172A] uppercase tracking-wider">{t('Detailed Request Review', 'αñ╡αñ┐αñ╕αÑìαññαÑâαññ αñàαñ¿αÑüαñ░αÑïαñº αñ╕αñ«αÑÇαñòαÑìαñ╖αñ╛')}</h3>
              <button 
                onClick={() => { setSelectedRequestDetails(null); setRejectionReason(''); }}
                className="text-[#94A3B8] hover:text-slate-655 cursor-pointer"
              >
                <Icon name="close" size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="space-y-4 text-xs">
              {/* Employee Bio with large selfie */}
              <div className="flex items-center gap-4 bg-[#F7F9FC] border border-slate-150 p-3 rounded-2xl">
                {/* Selfie ΓÇô tap to expand */}
                <div
                  className="w-20 h-20 rounded-2xl overflow-hidden border-2 border-[#E2E8F0] bg-slate-100 shrink-0 cursor-pointer shadow-md hover:shadow-lg hover:scale-105 transition-all relative"
                  onClick={() => selectedRequestDetails.employeePic && setLightboxSrc(selectedRequestDetails.employeePic)}
                  title={selectedRequestDetails.employeePic ? 'Click to enlarge selfie' : ''}
                >
                  {selectedRequestDetails.employeePic ? (
                    <>
                      <img src={selectedRequestDetails.employeePic} alt={selectedRequestDetails.employeeName} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 transition-all">
                        <Icon name="zoom_in" size={20} className="text-white opacity-0 hover:opacity-100 drop-shadow" />
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center font-bold text-[#94A3B8] text-2xl">
                      {selectedRequestDetails.employeeName.charAt(0)}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-black text-[#0F172A] text-sm truncate">{selectedRequestDetails.employeeName}</div>
                  <div className="text-[10px] text-slate-450 font-bold uppercase">{selectedRequestDetails.employeeId}</div>
                  <div className="text-[10px] text-[#64748B] font-bold">{db.employees.find(e => e.id === selectedRequestDetails.employeeId)?.type || 'Daily'}</div>
                  {selectedRequestDetails.employeePic && (
                    <button
                      onClick={() => setLightboxSrc(selectedRequestDetails.employeePic!)}
                      className="mt-1 text-[9px] font-bold text-[#2563EB] hover:underline cursor-pointer flex items-center gap-1"
                    >
                      <Icon name="zoom_in" size={11} /> {t('View Selfie Full Size', 'αñ╕αÑçαñ▓αÑìαñ½αÑÇ αñ¼αñíαñ╝αÑÇ αñòαñ░αÑçαñé')}
                    </button>
                  )}
                </div>
              </div>

              {/* Request Parameters */}
              <div className="grid grid-cols-2 gap-4 border border-slate-150 p-3 rounded-2xl bg-white">
                <div>
                  <span className="text-[8px] uppercase tracking-wider text-[#94A3B8] font-bold block">{t('Category / Type', 'αñ╢αÑìαñ░αÑçαñúαÑÇ / αñ¬αÑìαñ░αñòαñ╛αñ░')}</span>
                  <span className="font-extrabold text-[#0F172A] text-[11px]">{selectedRequestDetails.category}</span>
                </div>
                <div>
                  <span className="text-[8px] uppercase tracking-wider text-[#94A3B8] font-bold block">{t('Request Date', 'αñªαñ┐αñ¿αñ╛αñéαñò')}</span>
                  <span className="font-bold text-[#0F172A]">{selectedRequestDetails.date}</span>
                </div>
                <div className="bg-[#F7F9FC] border border-[#E2E8F0] rounded-xl p-2.5 space-y-0.5">
                  <span className="text-[8px] uppercase tracking-wider text-[#94A3B8] font-bold block">{t('Old Value', 'αñ¬αÑüαñ░αñ╛αñ¿αñ╛ αñ«αñ╛αñ¿')}</span>
                  <span className="font-semibold text-[#64748B] line-through">{renderNewValueText(selectedRequestDetails.oldValue || 'ΓÇö')}</span>
                </div>
                <div className="bg-[#EFF6FF]/30 border border-blue-100/50 rounded-xl p-2.5 space-y-0.5">
                  <span className="text-[8px] uppercase tracking-wider text-blue-500 font-bold block">{t('Requested Value', 'αñàαñ¿αÑüαñ░αÑïαñºαñ┐αññ αñ«αñ╛αñ¿')}</span>
                  <span className="font-black text-blue-700">{renderNewValueText(selectedRequestDetails.newValue)}</span>
                </div>
              </div>

              {/* GPS & Location Diagnostics */}
              {selectedRequestDetails.gpsLat !== undefined && (
                <div className="border border-slate-150 p-3 rounded-2xl bg-white space-y-2">
                  <div className="text-[9px] uppercase tracking-wider text-slate-450 font-black">≡ƒôì {t('Proximity & GeoFence Match', 'αñ╕αñ«αÑÇαñ¬αññαñ╛ αñÅαñ╡αñé αñ£αñ┐αñ»αÑïαñ½αÑçαñéαñ╕ αñ«αñ┐αñ▓αñ╛αñ¿')}</div>
                  
                  {/* Distance details */}
                  {(() => {
                    const assignedFence = db.geofences?.find(g => g.assignedStaff?.includes(selectedRequestDetails.employeeId));
                    let distance = null;
                    let isInside = false;
                    if (assignedFence && selectedRequestDetails.gpsLat && selectedRequestDetails.gpsLng) {
                      distance = getDistanceMeters(assignedFence.lat, assignedFence.lng, selectedRequestDetails.gpsLat, selectedRequestDetails.gpsLng);
                      isInside = distance <= assignedFence.radius;
                    }

                    return (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-3 text-[10px] font-semibold text-slate-650">
                          <div>
                            <span className="text-[8px] text-[#94A3B8] block">{t('Assigned GeoFence', 'αñàαñ╕αñ╛αñçαñ¿ αñòαñ┐αñ»αñ╛ αñùαñ»αñ╛ αñ£αñ┐αñ»αÑïαñ½αÑçαñéαñ╕')}</span>
                            <span className="font-black text-[#0F172A]">{assignedFence ? assignedFence.name : 'ΓÇö'}</span>
                          </div>
                          <div>
                            <span className="text-[8px] text-[#94A3B8] block">{t('Distance to Center', 'αñòαÑçαñ¿αÑìαñªαÑìαñ░ αñ╕αÑç αñªαÑéαñ░αÑÇ')}</span>
                            <span className="font-black text-[#0F172A]">{distance !== null ? `${Math.round(distance)} meters` : 'ΓÇö'}</span>
                          </div>
                          <div className="col-span-2">
                            <span className="text-[8px] text-[#94A3B8] block">{t('Coordinates', 'αñ╕αÑìαñÑαñ╛αñ¿ αñ¿αñ┐αñ░αÑìαñªαÑçαñ╢αñ╛αñéαñò')}</span>
                            <span className="font-mono text-[#0F172A] font-bold">{selectedRequestDetails.gpsLat?.toFixed(6)}, {selectedRequestDetails.gpsLng?.toFixed(6)}</span>
                          </div>
                          <div className="col-span-2">
                            <span className="text-[8px] text-[#94A3B8] block">{t('Resolved GPS Address', 'αñ£αÑÇαñ¬αÑÇαñÅαñ╕ αñªαÑìαñ╡αñ╛αñ░αñ╛ αñ¬αññαñ╛')}</span>
                            <span className="text-[#0F172A] leading-normal block font-sans">{selectedRequestDetails.gpsAddress}</span>
                          </div>
                        </div>

                        {assignedFence && (
                          <div className={`p-2.5 rounded-xl border font-bold text-[10px] flex items-center gap-2 ${
                            isInside 
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                              : 'bg-rose-50 text-rose-700 border-rose-100 animate-pulse'
                          }`}>
                            <Icon name={isInside ? 'check_circle' : 'warning'} size={15} />
                            <span>
                              {isInside 
                                ? t('Inside assigned GeoFence radius boundary.', 'αñ£αñ┐αñ»αÑïαñ½αÑçαñéαñ╕ αñ¬αñ░αñ┐αñºαñ┐ αñòαÑç αñàαñéαñªαñ░ (αñ╕αññαÑìαñ»αñ╛αñ¬αñ┐αññ)') 
                                : t('Outside assigned GeoFence boundary. Potential location spoof or mismatch!', 'αñ£αñ┐αñ»αÑïαñ½αÑçαñéαñ╕ αñ¬αñ░αñ┐αñºαñ┐ αñ╕αÑç αñ¼αñ╛αñ╣αñ░ (αñ╕αÑìαñÑαñ╛αñ¿ αñ¼αÑçαñ«αÑçαñ▓)')}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Hardware Diagnostics */}
              <div className="border border-slate-150 p-3 rounded-2xl bg-white space-y-2">
                <div className="text-[9px] uppercase tracking-wider text-slate-450 font-black">ΓÜÖ∩╕Å {t('Device Info & Diagnostics', 'αñíαñ┐αñ╡αñ╛αñçαñ╕ αñ╡αñ┐αñ╡αñ░αñú αñÅαñ╡αñé αñíαñ╛αñ»αñùαÑìαñ¿αÑïαñ╕αÑìαñƒαñ┐αñòαÑìαñ╕')}</div>
                <div className="grid grid-cols-2 gap-3 text-[10px] font-semibold text-slate-655">
                  <div>
                    <span className="text-[8px] text-[#94A3B8] block">{t('Device Model / OS', 'αñíαñ┐αñ╡αñ╛αñçαñ╕ αñ«αÑëαñíαñ▓ / αñôαñÅαñ╕')}</span>
                    <span className="text-[#0F172A]">{selectedRequestDetails.deviceModel || 'ΓÇö'} ({selectedRequestDetails.osVersion || 'ΓÇö'})</span>
                  </div>
                  <div>
                    <span className="text-[8px] text-[#94A3B8] block">{t('Device UUID Locked', 'αñ▓αÑëαñòαÑìαñí αñíαñ┐αñ╡αñ╛αñçαñ╕ UUID')}</span>
                    <span className="font-mono text-[#0F172A] truncate block max-w-[180px]" title={selectedRequestDetails.deviceId}>{selectedRequestDetails.deviceId || 'ΓÇö'}</span>
                  </div>
                  <div>
                    <span className="text-[8px] text-[#94A3B8] block">{t('GPS Accuracy & Provider', 'αñ£αÑÇαñ¬αÑÇαñÅαñ╕ αñ╕αñƒαÑÇαñòαññαñ╛')}</span>
                    <span className={`font-bold ${selectedRequestDetails.gpsAccuracy && selectedRequestDetails.gpsAccuracy <= 30 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {selectedRequestDetails.gpsAccuracy ? `${selectedRequestDetails.gpsAccuracy.toFixed(0)}m` : 'ΓÇö'} ({selectedRequestDetails.gpsProvider || 'ΓÇö'})
                    </span>
                  </div>
                  <div>
                    <span className="text-[8px] text-[#94A3B8] block">{t('Diagnostic Context', 'αñàαññαñ┐αñ░αñ┐αñòαÑìαññ αñ╕αñéαñªαñ░αÑìαñ¡')}</span>
                    <span className="text-[#0F172A]">
                      {t('Timestamp:', 'αñ╕αñ«αñ»:')} {formatLocalTimestamp(selectedRequestDetails.timestamp)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Previous Status Info */}
              {(() => {
                const todayStr = selectedRequestDetails.date;
                const d = new Date(todayStr);
                d.setDate(d.getDate() - 1);
                const yesterdayStr = d.toISOString().split('T')[0];
                const yesterdayAtt = db.attendance[`${selectedRequestDetails.employeeId}_${yesterdayStr}`];
                const yesterdayStatus = yesterdayAtt ? yesterdayAtt.status : 'No Record';

                return (
                  <div className="bg-[#F7F9FC] border border-slate-150 p-3 rounded-2xl grid grid-cols-2 gap-2 text-[10px] font-bold">
                    <div>
                      <span className="text-[8px] text-[#94A3B8] block uppercase">{t('Yesterday Attendance', 'αñòαñ▓ αñòαÑÇ αñëαñ¬αñ╕αÑìαñÑαñ┐αññαñ┐')}</span>
                      <span className="text-[#0F172A]">{yesterdayStatus}</span>
                    </div>
                    <div>
                      <span className="text-[8px] text-[#94A3B8] block uppercase">{t('Reason for Submission', 'αñåαñ╡αÑçαñªαñ¿ αñòαñ╛ αñòαñ╛αñ░αñú')}</span>
                      <span className="text-[#0F172A]">{selectedRequestDetails.reason}</span>
                    </div>
                  </div>
                );
              })()}

              {/* Remarks/Correction inputs */}
              <div className="space-y-1.5 border-t border-[#E2E8F0] pt-3">
                <label className="text-[10px] font-black text-slate-550 uppercase block">{t('Admin Correction Remarks', 'αñàαñ╕αÑìαñ╡αÑÇαñòαÑâαññαñ┐ αñ»αñ╛ αñ╕αÑüαñºαñ╛αñ░ αñ¿αñ┐αñ░αÑìαñªαÑçαñ╢ αñƒαñ┐αñ¬αÑìαñ¬αñúαÑÇ')}</label>
                <input
                  type="text"
                  value={rejectionReason}
                  onChange={e => setRejectionReason(e.target.value)}
                  placeholder={t('Enter instruction notes or rejection reasons', 'αñƒαñ┐αñ¬αÑìαñ¬αñúαÑÇ αñªαñ░αÑìαñ£ αñòαñ░αÑçαñé (αñàαñ╕αÑìαñ╡αÑÇαñòαñ╛αñ░ αñ»αñ╛ αñ╕αÑüαñºαñ╛αñ░ αñòαÑç αñ▓αñ┐αñÅ αñåαñ╡αñ╢αÑìαñ»αñò)')}
                  className="w-full h-10 border border-[#E2E8F0] rounded-xl px-3 outline-none bg-[#F7F9FC] focus:border-blue-500 text-xs font-semibold"
                />
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex gap-2 border-t border-[#E2E8F0] pt-4 flex-wrap">
              <button
                onClick={() => handleApprove(selectedRequestDetails)}
                className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black cursor-pointer shadow-md shadow-emerald-500/10 active:scale-95 transition-all"
              >
                {t('Approve', 'αñ╕αÑìαñ╡αÑÇαñòαñ╛αñ░αÑçαñé')}
              </button>
              <button
                onClick={() => handleReturnForCorrection(selectedRequestDetails.id)}
                className="flex-1 h-11 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black cursor-pointer shadow-md shadow-amber-500/10 active:scale-95 transition-all"
              >
                {t('Return for Correction', 'αñ╕αÑüαñºαñ╛αñ░ αñòαÑç αñ▓αñ┐αñÅ αñ▓αÑîαñƒαñ╛αñ»αÑçαñé')}
              </button>
              <button
                onClick={() => handleReject(selectedRequestDetails.id)}
                className="flex-1 h-11 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black cursor-pointer shadow-md shadow-rose-500/10 active:scale-95 transition-all"
              >
                {t('Reject', 'αñàαñ╕αÑìαñ╡αÑÇαñòαñ╛αñ░αÑçαñé')}
              </button>
              <button
                onClick={() => { setSelectedRequestDetails(null); setRejectionReason(''); }}
                className="w-24 h-11 border border-slate-255 bg-white text-slate-655 rounded-xl text-xs font-bold hover:bg-slate-100 transition-all cursor-pointer"
              >
                {t('Close', 'αñ¼αñéαñª αñòαñ░αÑçαñé')}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* CUSTOM TIME WHEEL PICKER OVERLAY */}
      <TimeWheelPicker
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={pickerMeta ? (pickerMeta.field === 'in' ? 'Punch In Time' : 'Punch Out Time') : ''}
        initialValue={pickerMeta ? pickerMeta.initialVal : ''}
        onSave={handleSaveTimePicker}
      />

      {/* SELFIE LIGHTBOX OVERLAY */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 bg-black/90 z-[9999] flex items-center justify-center p-4"
          onClick={() => setLightboxSrc(null)}
        >
          <div className="relative max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setLightboxSrc(null)}
              className="absolute -top-10 right-0 text-white text-xs font-bold bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-full cursor-pointer"
            >
              Γ£ò {lang === 'en' ? 'Close' : 'αñ¼αñéαñª αñòαñ░αÑçαñé'}
            </button>
            <img
              src={lightboxSrc}
              alt="Employee Selfie"
              className="w-full rounded-2xl shadow-2xl border-2 border-white/10"
              style={{ maxHeight: '80vh', objectFit: 'contain' }}
            />
            <div className="text-center mt-3 text-white/60 text-[10px] font-semibold">
              {lang === 'en' ? 'Tap outside to close' : 'αñ¼αñéαñª αñòαñ░αñ¿αÑç αñòαÑç αñ▓αñ┐αñÅ αñ¼αñ╛αñ╣αñ░ αñƒαÑêαñ¬ αñòαñ░αÑçαñé'}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
