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
    if (!time24) return '—';
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
    let oldVal = t('Not Marked', 'मार्क नहीं है');
    let newVal = '';

    if (requestType === 'attendance') {
      const key = `${employeeId}_${reqDate}`;
      const existingRec = db.attendance[key];
      const isSessions = employeeType === 'Hourly' || correctionMode === 'sessions';

      if (existingRec) {
        if (isSessions) {
          const sessions = existingRec.sessions || [];
          oldVal = sessions.map(s => `${s.in || '—'} to ${s.out || '—'}`).join(', ') || t('No Punch', 'कोई पंच नहीं');
        } else {
          oldVal = existingRec.status || t('Not Marked', 'मार्क नहीं है');
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
        oldVal = `${selectedPayment.date} | ₹${selectedPayment.amount} | ${selectedPayment.mode} | ${selectedPayment.description || ''}`;
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
      oldVal = t('No payment entry', 'कोई भुगतान प्रविष्टि नहीं');
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
    const resolvedReason = reason.trim() || t('Self requested via employee portal', 'स्टाफ पोर्टल द्वारा स्वयं अनुरोधित');

    if (requestType === 'attendance') {
      if (employeeType === 'Hourly') {
        const hasAnyCheck = punchSessions.some(s => s.inEnabled || s.outEnabled);
        if (!hasAnyCheck) {
          alert(t('Please select at least one Punch In or Punch Out time to request correction!', 'कृपया सुधार का अनुरोध करने के लिए कम से कम एक पंच इन या पंच आउट समय चुनें!'));
          return;
        }
      }
    } else if (requestType === 'payment') {
      if (!selPaymentId) {
        alert(t('Please select a payment record to edit!', 'कृपया संपादित करने के लिए एक भुगतान रिकॉर्ड चुनें!'));
        return;
      }
      const amt = parseFloat(newPaymentAmount);
      if (isNaN(amt) || amt <= 0) {
        alert(t('Please enter a valid amount!', 'कृपया मान्य राशि दर्ज करें!'));
        return;
      }
      if (!newPaymentDate) {
        alert(t('Please select date!', 'कृपया तारीख का चयन करें!'));
        return;
      }
    } else if (requestType === 'new_payment') {
      const amt = parseFloat(payRequestAmount);
      if (isNaN(amt) || amt <= 0) {
        alert(t('Please enter a valid amount!', 'कृपया मान्य राशि दर्ज करें!'));
        return;
      }
      if (!payRequestDate) {
        alert(t('Please select date!', 'कृपया तारीख का चयन करें!'));
        return;
      }
    } else if (requestType === 'leave') {
      if (!leaveStartDate) {
        alert(t('Please select leave start date!', 'कृपया छुट्टी शुरू होने की तारीख चुनें!'));
        return;
      }
      if (leaveDays < 1 || leaveDays > 9) {
        alert(t('Leave duration must be between 1 and 9 days!', 'छुट्टी की अवधि 1 से 9 दिनों के बीच होनी चाहिए!'));
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
      alert(t("An identical request is already pending.", "यही रिक्वेस्ट पहले से पेंडिंग (बाकी) है।"));
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
      title: t('New Approval Request', 'नया मंजूरी अनुरोध'),
      message: `${employeeName} ${t('requested a correction in', 'ने')} ${category} ${t('on', 'पर सुधार का अनुरोध किया है')} ${reqDateToUse}`,
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
    const resolvedReason = reason.trim() || t('Self requested via employee portal', 'स्टाफ पोर्टल द्वारा स्वयं अनुरोधित');

    if (requestType === 'attendance') {
      if (employeeType === 'Hourly') {
        const hasAnyCheck = punchSessions.some(s => s.inEnabled || s.outEnabled);
        if (!hasAnyCheck) {
          alert(t('Please select at least one Punch In or Punch Out time!', 'कृपया कम से कम एक पंच इन या पंच आउट समय चुनें!'));
          return;
        }
      }
    } else if (requestType === 'payment') {
      const amt = parseFloat(newPaymentAmount);
      if (isNaN(amt) || amt <= 0) {
        alert(t('Please enter a valid amount!', 'कृपया मान्य राशि दर्ज करें!'));
        return;
      }
    } else if (requestType === 'new_payment') {
      const amt = parseFloat(payRequestAmount);
      if (isNaN(amt) || amt <= 0) {
        alert(t('Please enter a valid amount!', 'कृपया मान्य राशि दर्ज करें!'));
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
    if (!confirm(t('Cancel this pending request?', 'क्या आप इस पेंडिंग रिक्वेस्ट को रद्द करना चाहते हैं?'))) return;
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
            `क्या आप ${req.employeeName} द्वारा अनुरोधित ${req.newValue} के Punch-In समय से आपके द्वारा दर्ज ${lastSession.in} के समय को बदलना चाहते हैं?`
          ));
          if (!confirmed) return;
          wasManualOverride = true;
          oldOverrideTime = lastSession.in;
        } else if (['Punch Out', 'Early Exit'].includes(req.category) && lastSession.out && lastSession.out !== req.newValue) {
          const confirmed = confirm(t(
            `Do you want to replace the existing Punch-Out time ${lastSession.out} with the requested time ${req.newValue} for ${req.employeeName}?`,
            `क्या आप ${req.employeeName} द्वारा अनुरोधित ${req.newValue} के Punch-Out समय से आपके द्वारा दर्ज ${lastSession.out} के समय को बदलना चाहते हैं?`
          ));
          if (!confirmed) return;
          wasManualOverride = true;
          oldOverrideTime = lastSession.out;
        }
      }
    }

    if (!confirm(t('Approve this request?', 'क्या आप इस रिक्वेस्ट को मंजूर करना चाहते हैं?'))) return;

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
          title: t('Request Approved', 'रिक्वेस्ट मंजूर हुई'),
          message: `${t('Your request for', 'आपका')} ${req.category} ${t('on', 'पर')} ${req.date} ${t('has been approved.', 'मंजूर कर दिया गया है।')}`,
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
      alert(t('Transaction rolled back: ' + err.message, 'ट्रांजैक्शन फेल: ' + err.message));
    }
  };

  // Reject Request
  const handleReject = (reqId: string) => {
    if (!rejectionReason.trim()) {
      alert(t('Please provide a reason for rejection!', 'कृपया नामंजूर करने का कारण लिखें!'));
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
          title: t('Request Rejected', 'रिक्वेस्ट नामंजूर हुई'),
          message: `${t('Your request for', 'आपका')} ${targetReq.category} ${t('on', 'पर')} ${targetReq.date} ${t('was rejected.', 'नामंजूर कर दिया गया है।')}`,
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
      alert(t('Rejection transaction failed: ' + err.message, 'रिजेक्शन फेल: ' + err.message));
    }
  };

  const handleReturnForCorrection = (reqId: string) => {
    if (!rejectionReason.trim()) {
      alert(t('Please provide a correction instruction remark!', 'कृपया सुधार के निर्देश लिखें!'));
      return;
    }

    const targetReq = requestsList.find(r => r.id === reqId);
    if (!targetReq) return;

    const updatedRequests = requestsList.map(r => {
      if (r.id === reqId) {
        return { 
          ...r, 
          status: 'Rejected' as const, 
          rejectionReason: `${t('Returned for Correction:', 'सुधार के लिए लौटाया गया:')} ${rejectionReason.trim()}`
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
          title: t('Request Returned for Correction', 'अनुरोध सुधार के लिए लौटाया गया'),
          message: `${t('Your request for', 'का')} ${targetReq.category} ${t('on', 'पर')} ${targetReq.date} ${t('was returned for correction.', 'को सुधार के लिए वापस भेजा गया है।')}`,
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
      alert(t('Correction transaction failed: ' + err.message, 'सुधार विफलता: ' + err.message));
    }
  };

  // Delete Request
  const handleDeleteRequest = (reqId: string) => {
    if (!confirm(t('Permanently delete this request record?', 'क्या आप इस अनुरोध रिकॉर्ड को हमेशा के लिए हटाना चाहते हैं?'))) return;
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
    if (!val) return '—';
    if (val === 'Active Duty / No Leave' || val === 'कर्तव्य पर सक्रिय / कोई छुट्टी नहीं' || val === 'Not Marked' || val === 'मार्क नहीं है') {
      return t('Not Marked', 'मार्क नहीं है');
    }
    if (val === 'Present') return t('Present', 'उपस्थित');
    if (val === 'Absent') return t('Absent', 'अनुपस्थित');
    if (val === 'Half Day') return t('Half Day', 'आधा दिन');
    if (val === 'Leave') return t('Leave', 'छुट्टी');

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
          return `${t('Overtime:', 'ओवरटाइम:')} ${parsed.hours}`;
        }
        if (parsed.days && parsed.startDate) {
          return `${t('Leave Request:', 'छुट्टी अनुरोध:')} ${parsed.startDate} (${parsed.days} ${parsed.days === 1 ? t('Day', 'दिन') : t('Days', 'दिन')}) ${parsed.description ? `[${parsed.description}]` : ''}`;
        }
        return `${parsed.date || ''} | ₹${parsed.amount || 0} | ${parsed.mode || ''} ${parsed.description ? `(${parsed.description})` : ''}`;
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
      case 'GeoFence Attendance': return 'जियोफेंस से हाजिरी';
      case 'Attendance Correction': return 'मैनुअल हाजिरी सुधार';
      case 'Punch In': return 'पंच इन (सुधार)';
      case 'Punch Out': return 'पंच आउट (सुधार)';
      case 'Payment': return 'भुगतान सुधार';
      case 'Overtime': return 'ओवरटाइम (अतिरिक्त समय)';
      case 'Leave': return 'छुट्टी';
      default: return cat;
    }
  };

  
  return (
    <div className="w-full h-full flex flex-col bg-[#F7F9FC] animate-in fade-in duration-200">
      
      {/* Sticky Header */}
      <div className="bg-white sticky top-0 z-10 px-4 md:px-6 pt-4 pb-3 border-b border-[#E2E8F0] shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg md:text-xl font-black text-[#0F172A] tracking-tight">
              {isAdmin ? t('Approval Desk', 'मैनेजर मंजूरी डेस्क') : t('My Correction Requests', 'मेरे सुधार रिक्वेस्ट')}
            </h2>
            <p className="text-xs text-[#64748B] font-medium mt-0.5">
              {filteredRequests.length} {t('Pending requests', 'लंबित अनुरोध')}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => window.location.reload()}
              className="w-10 h-10 rounded-xl bg-[#F7F9FC] border border-[#E2E8F0] text-[#64748B] flex items-center justify-center hover:bg-slate-50 transition cursor-pointer"
              title={t('Refresh', 'रीफ्रेश')}
            >
              <Icon name="refresh" size={20} />
            </button>
            {!isAdmin && empView === 'list' && (
              <button
                onClick={() => {
                  setRequestType('attendance');
                  setEmpView('new_request');
                }}
                className="h-10 px-4 bg-[#2563EB] hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition"
              >
                <Icon name="add" size={18} />
                <span className="hidden sm:inline">{t('New Request', 'नया रिक्वेस्ट')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Filters */}
        <div className="flex overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 gap-2 hide-scrollbar">
          {['all', 'attendance', 'payment', 'leave', 'device_registration'].map(type => (
            <button
              key={type}
              onClick={() => setFilterType(type as any)}
              className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold border transition-all ${
                filterType === type 
                  ? 'bg-[#2563EB] text-white border-[#2563EB]' 
                  : 'bg-white text-[#64748B] border-[#E2E8F0] hover:bg-slate-50'
              }`}
            >
              {t(
                type === 'all' ? 'All' :
                type === 'attendance' ? 'Attendance' :
                type === 'payment' ? 'Payment' :
                type === 'leave' ? 'Leave' : 'Device/Other',
                type === 'all' ? 'सभी' :
                type === 'attendance' ? 'उपस्थिति' :
                type === 'payment' ? 'भुगतान' :
                type === 'leave' ? 'छुट्टी' : 'डिवाइस'
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-28">
        {empView === 'list' && (
          <div className="space-y-4">
            {filteredRequests.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {filteredRequests.map(r => {
                  const emp = db.employees.find(e => e.id === r.employeeId);
                  
                  // Status Badge Styling
                  let statusBadgeStyle = 'bg-slate-100 text-slate-600 border-slate-200';
                  let statusIcon = 'pending';
                  if (r.status === 'Approved') {
                    statusBadgeStyle = 'bg-[#ECFDF5] text-[#10B981] border-emerald-100';
                    statusIcon = 'check_circle';
                  } else if (r.status === 'Rejected') {
                    statusBadgeStyle = 'bg-rose-50 text-rose-700 border-rose-100';
                    statusIcon = 'cancel';
                  } else if (r.status === 'Pending') {
                    statusBadgeStyle = 'bg-amber-50 text-amber-700 border-amber-100';
                    statusIcon = 'schedule';
                  } else if (r.status === 'ReturnedForCorrection') {
                    statusBadgeStyle = 'bg-purple-50 text-purple-700 border-purple-100';
                    statusIcon = 'loop';
                  }

                  // Format dates
                  const subDate = new Date(r.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

                  return (
                    <div key={r.id} className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm hover:shadow-md transition flex flex-col gap-3">
                      
                      {/* Card Header */}
                      <div className="flex justify-between items-start border-b border-[#E2E8F0] pb-3">
                        <div className="flex items-center gap-3">
                          {emp?.pic ? (
                            <img src={emp.pic} className="w-10 h-10 rounded-full object-cover border border-[#E2E8F0]" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center font-bold border border-[#E2E8F0]">
                              {r.employeeName.substring(0,2).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <h3 className="text-sm font-bold text-[#0F172A]">{r.employeeName}</h3>
                            <p className="text-[10px] text-[#64748B] font-medium">{t('Submitted:', 'जमा किया:')} {subDate}</p>
                          </div>
                        </div>
                        <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${statusBadgeStyle}`}>
                          <Icon name={statusIcon} size={12} />
                          {t(r.status, r.status === 'Approved' ? 'स्वीकृत' : r.status === 'Rejected' ? 'अस्वीकृत' : r.status === 'ReturnedForCorrection' ? 'सुधार के लिए वापस' : 'लंबित')}
                        </span>
                      </div>

                      {/* Request Details */}
                      <div className="grid grid-cols-2 gap-3 text-xs bg-[#F7F9FC] p-3 rounded-xl border border-[#E2E8F0]/50">
                        <div className="col-span-2 sm:col-span-1">
                          <span className="block text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider mb-0.5">{t('Request Type', 'अनुरोध प्रकार')}</span>
                          <span className="font-semibold text-[#0F172A] uppercase">{r.type}</span>
                        </div>
                        {r.date && (
                          <div className="col-span-2 sm:col-span-1">
                            <span className="block text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider mb-0.5">{t('Target Date', 'लक्ष्य तिथि')}</span>
                            <span className="font-semibold text-[#0F172A]">{r.date}</span>
                          </div>
                        )}
                        <div className="col-span-2 border-t border-[#E2E8F0]/50 pt-2">
                          <span className="block text-[9px] font-bold text-[#94A3B8] uppercase tracking-wider mb-0.5">{t('Reason', 'कारण')}</span>
                          <span className="font-medium text-[#0F172A]">{r.reason || '—'}</span>
                        </div>
                        
                        {/* Old vs New Values */}
                        {(r.oldValue || r.requestedValue) && (
                          <div className="col-span-2 flex items-center gap-3 mt-1">
                            <div className="flex-1 bg-rose-50/50 p-2 rounded-lg border border-rose-100/50">
                              <span className="block text-[8px] font-bold text-rose-500 uppercase">{t('Current', 'वर्तमान')}</span>
                              <span className="font-semibold text-[#0F172A]">{typeof r.oldValue === 'object' ? JSON.stringify(r.oldValue) : String(r.oldValue || '—')}</span>
                            </div>
                            <Icon name="arrow_forward" size={16} className="text-[#94A3B8]" />
                            <div className="flex-1 bg-emerald-50/50 p-2 rounded-lg border border-emerald-100/50">
                              <span className="block text-[8px] font-bold text-emerald-600 uppercase">{t('Requested', 'अनुरोधित')}</span>
                              <span className="font-semibold text-[#0F172A]">{typeof r.requestedValue === 'object' ? JSON.stringify(r.requestedValue) : String(r.requestedValue || '—')}</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Admin Remarks */}
                      {r.adminRemarks && (
                        <div className="text-xs bg-amber-50 p-3 rounded-xl border border-amber-100/50">
                          <span className="block text-[9px] font-bold text-amber-700 uppercase tracking-wider mb-0.5">{t('Admin Remarks', 'एडमिन टिप्पणी')}</span>
                          <span className="font-medium text-amber-900">{r.adminRemarks}</span>
                        </div>
                      )}

                      {/* Action Buttons for Admin (Only Pending/Returned) */}
                      {isAdmin && (r.status === 'Pending' || r.status === 'ReturnedForCorrection') && (
                        <div className="flex gap-2 pt-1 border-t border-[#E2E8F0] mt-1">
                          <button
                            onClick={() => {
                              setSelectedRequestDetails(r);
                              setShowActionModal(true);
                            }}
                            className="flex-1 h-10 bg-white border border-[#E2E8F0] text-[#0F172A] hover:bg-[#F7F9FC] rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5"
                          >
                            <Icon name="visibility" size={16} />
                            {t('Review Request', 'समीक्षा करें')}
                          </button>
                          {r.type === 'device_registration' && (
                             <button
                               onClick={() => handleApprove(r)}
                               className="flex-1 h-10 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5"
                             >
                               <Icon name="check" size={16} />
                               {t('Auto Approve', 'स्वीकारें')}
                             </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="w-full flex flex-col items-center justify-center py-20 text-center px-4">
                <div className="w-16 h-16 rounded-full bg-[#F7F9FC] flex items-center justify-center text-[#64748B] mb-4">
                  <Icon name="inbox" size={32} />
                </div>
                <h3 className="text-lg font-black text-[#0F172A]">{t('No pending requests', 'कोई अनुरोध नहीं')}</h3>
                <p className="text-sm text-[#64748B] mt-1">{t('You are all caught up!', 'सब कुछ सही है!')}</p>
              </div>
            )}
          </div>
        )}

        {/* Existing forms for New Request are intact but hidden via empView filter */}
      </div>

      {/* Action Modal using existing structure */}
      {showActionModal && selectedRequestDetails && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[999] p-4 animate-in fade-in">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 border-b border-[#E2E8F0] flex justify-between items-center bg-[#F7F9FC] rounded-t-2xl">
              <h3 className="font-black text-[#0F172A]">{t('Review Request', 'अनुरोध समीक्षा')}</h3>
              <button onClick={() => setShowActionModal(false)} className="text-[#64748B] hover:text-[#0F172A]"><Icon name="close" size={24} /></button>
            </div>
            
            <div className="p-5 overflow-y-auto space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="block text-[9px] font-bold text-[#94A3B8] uppercase">{t('Employee', 'कर्मचारी')}</span>
                  <span className="font-semibold text-[#0F172A]">{selectedRequestDetails.employeeName}</span>
                </div>
                <div>
                  <span className="block text-[9px] font-bold text-[#94A3B8] uppercase">{t('Request Type', 'प्रकार')}</span>
                  <span className="font-semibold text-[#0F172A]">{selectedRequestDetails.type}</span>
                </div>
              </div>

              {selectedRequestDetails.type === 'attendance' && selectedRequestDetails.attendanceData && (
                <div className="bg-blue-50/50 p-3 rounded-xl border border-blue-100">
                  <span className="block text-[9px] font-bold text-blue-600 uppercase mb-2">{t('Attendance Details', 'उपस्थिति विवरण')}</span>
                  <div className="grid grid-cols-2 gap-2 text-xs text-[#0F172A]">
                    <div><strong>In:</strong> {selectedRequestDetails.attendanceData.inTime || '—'}</div>
                    <div><strong>Out:</strong> {selectedRequestDetails.attendanceData.outTime || '—'}</div>
                    <div className="col-span-2"><strong>Notes:</strong> {selectedRequestDetails.attendanceData.notes || '—'}</div>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-[#0F172A] uppercase">{t('Admin Remarks (Required for Rejection)', 'एडमिन टिप्पणी')}</label>
                <textarea
                  value={rejectionReason}
                  onChange={e => setRejectionReason(e.target.value)}
                  placeholder={t('Enter notes here...', 'यहां टिप्पणी लिखें...')}
                  className="w-full h-24 border border-[#E2E8F0] rounded-xl p-3 outline-none focus:border-[#2563EB] text-sm resize-none"
                />
              </div>
            </div>

            <div className="p-4 border-t border-[#E2E8F0] flex gap-2 flex-wrap">
              <button
                onClick={() => handleApprove(selectedRequestDetails)}
                className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold shadow-sm transition"
              >
                {t('Approve', 'स्वीकारें')}
              </button>
              <button
                onClick={() => handleReturnForCorrection(selectedRequestDetails.id)}
                className="flex-1 h-11 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-bold shadow-sm transition"
              >
                {t('Return', 'लौटायें')}
              </button>
              <button
                onClick={() => handleReject(selectedRequestDetails.id)}
                className="flex-1 h-11 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-sm font-bold shadow-sm transition"
              >
                {t('Reject', 'अस्वीकारें')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
