import React, { useState } from 'react';
import { 
  AppDatabase, Employee, ApprovalRequest, ApprovalCategory, ApprovalStatus, AttendanceRecord, AuditLogEntry, Payment
} from '../types';
import Icon from './Icon';
import TimeWheelPicker from './TimeWheelPicker';
import { runPayrollTransaction, getDistanceMeters } from '../db';

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
    'Punch In', 'Punch Out', 'Attendance Correction', 'Leave', 'Leave Request',
    'Payment', 'New Payment', 'Manual Attendance', 'GeoFence Attendance', 'Overtime', 'Early Exit', 'Late Entry', 'Device Register'
  ];

  // Filtering (Admin & Employee)
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [filterStatus, setFilterStatus] = useState<ApprovalStatus | 'All'>('Pending');

  // Form states
  const [reqDate, setReqDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [reason, setReason] = useState<string>('');
  
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
  }>>([{ inEnabled: true, inTime: getCurrentTimeHHmm(), outEnabled: false, outTime: getCurrentTimeHHmm() }]);

  // Payment correction form states
  const [selPaymentId, setSelPaymentId] = useState<string>('');
  const [newPaymentDate, setNewPaymentDate] = useState<string>('');
  const [newPaymentAmount, setNewPaymentAmount] = useState<string>('');
  const [newPaymentMode, setNewPaymentMode] = useState<string>('Cash');
  const [newPaymentDesc, setNewPaymentDesc] = useState<string>('');

  // Leave request form states
  const [leaveStartDate, setLeaveStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [leaveDays, setLeaveDays] = useState<number>(1);
  const [leaveReason, setLeaveReason] = useState<string>('');

  // Time Picker states
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMeta, setPickerMeta] = useState<{ sessionIdx: number; field: 'in' | 'out' | 'overtime'; initialVal: string } | null>(null);

  // Edit Request State
  const [editingRequest, setEditingRequest] = useState<ApprovalRequest | null>(null);

  // Admin rejection reason input
  const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [selectedRequestDetails, setSelectedRequestDetails] = useState<ApprovalRequest | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

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
      // Old Value from database
      const key = `${employeeId}_${reqDate}`;
      const existingRec = db.attendance[key];
      if (existingRec) {
        if (employeeType === 'Hourly') {
          const sessions = existingRec.sessions || [];
          oldVal = sessions.map(s => `${s.in || '—'} to ${s.out || '—'}`).join(', ') || t('No Punch', 'कोई पंच नहीं');
        } else {
          oldVal = existingRec.status || t('Not Marked', 'मार्क नहीं है');
        }
      }

      if (employeeType === 'Hourly') {
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
    } else if (requestType === 'leave') {
      category = 'Leave Request';
      oldVal = t('No leave on record', 'कोई छुट्टी नहीं है');
      newVal = JSON.stringify({ startDate: leaveStartDate, days: leaveDays, reason: leaveReason });
    } else if (requestType === 'new_payment') {
      category = 'New Payment';
      oldVal = t('No payment', 'कोई भुगतान नहीं');
      newVal = JSON.stringify({
        amount: parseFloat(newPaymentAmount) || 0,
        date: newPaymentDate,
        mode: newPaymentMode,
        description: newPaymentDesc
      });
    } else {
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
          description: newPaymentDesc
        });
      }
    }

    return { category, oldVal, newVal };
  };

  // Save new request
  const handleSubmitRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      alert(t('Please provide a reason for the request!', 'कृपया इस अनुरोध का कारण दर्ज करें!'));
      return;
    }

    if (requestType === 'attendance') {
      if (employeeType === 'Hourly') {
        const hasAnyCheck = punchSessions.some(s => s.inEnabled || s.outEnabled);
        if (!hasAnyCheck) {
          alert(t('Please select at least one punch time!', 'कम से कम एक पंच टाइम चुनें!'));
          return;
        }
      }
    } else if (requestType === 'leave') {
      if (!leaveReason.trim()) {
        alert(t('Reason is mandatory for leave request!', 'छुट्टी की वजह लिखना जरूरी है!'));
        return;
      }
    } else if (requestType === 'new_payment') {
      const amt = parseFloat(newPaymentAmount);
      if (isNaN(amt) || amt <= 0) {
        alert(t('Please enter a valid amount!', 'सही राशि दर्ज करें!'));
        return;
      }
      if (!newPaymentDate) {
        alert(t('Please select date!', 'तारीख चुनें!'));
        return;
      }
    } else {
      if (!selPaymentId) {
        alert(t('Please select a payment to edit!', 'संपादित करने के लिए भुगतान चुनें!'));
        return;
      }
      const amt = parseFloat(newPaymentAmount);
      if (isNaN(amt) || amt <= 0) {
        alert(t('Please enter a valid amount!', 'सही राशि दर्ज करें!'));
        return;
      }
      if (!newPaymentDate) {
        alert(t('Please select date!', 'तारीख चुनें!'));
        return;
      }
    }

    const { category, oldVal, newVal } = getCorrectionValues();

    // Duplicate Prevention Validation
    const isDuplicate = requestsList.some(r => 
      r.employeeId === employeeId &&
      r.status === 'Pending' &&
      (requestType === 'attendance' ? r.date === reqDate : true) &&
      r.category === category &&
      r.newValue === newVal
    );
    if (isDuplicate) {
      alert(t("An identical approval request is already pending.", "एक समान अनुमोदन अनुरोध पहले से लंबित है।"));
      return;
    }

    const newRequest: ApprovalRequest = {
      id: `_REQ_${Date.now()}`,
      employeeId: employeeId!,
      employeeName: employeeName!,
      employeePic: employeePic || '',
      category,
      date: requestType === 'attendance' ? reqDate : newPaymentDate,
      oldValue: oldVal,
      newValue: newVal,
      reason: reason.trim(),
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
      title: t('New Approval Request', 'नया अनुमोदन अनुरोध'),
      message: `${employeeName} ${t('requested a correction in', 'ने')} ${category} ${t('on', 'पर सुधार का अनुरोध किया है')} ${requestType === 'attendance' ? reqDate : newPaymentDate}`,
      timestamp: new Date().toISOString(),
      read: false
    };
    updatedDb.notifications = [newNotification, ...(db.notifications || [])];

    if (onUpdateDb) onUpdateDb(updatedDb);

    // Reset form
    setReason('');
    setPunchSessions([{ inEnabled: true, inTime: getCurrentTimeHHmm(), outEnabled: false, outTime: getCurrentTimeHHmm() }]);
    setSelPaymentId('');
    setNewPaymentAmount('');
    setNewPaymentDesc('');
    setEmpView('list');
  };

  // Edit/Modify request (Only if pending)
  const handleEditRequestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRequest) return;
    if (!reason.trim()) {
      alert(t('Please provide a reason for the request!', 'कृपया कारण दर्ज करें!'));
      return;
    }

    if (requestType === 'attendance') {
      if (employeeType === 'Hourly') {
        const hasAnyCheck = punchSessions.some(s => s.inEnabled || s.outEnabled);
        if (!hasAnyCheck) {
          alert(t('Please select at least one Punch In or Punch Out time!', 'कृपया कम से कम एक पंच इन या पंच आउट समय चुनें!'));
          return;
        }
      }
    } else {
      const amt = parseFloat(newPaymentAmount);
      if (isNaN(amt) || amt <= 0) {
        alert(t('Please enter a valid amount!', 'कृपया मान्य राशि दर्ज करें!'));
        return;
      }
    }

    const { category, oldVal, newVal } = getCorrectionValues();

    const updatedList = requestsList.map(req => {
      if (req.id === editingRequest.id) {
        return {
          ...req,
          category,
          date: requestType === 'attendance' ? reqDate : newPaymentDate,
          oldValue: oldVal,
          newValue: newVal,
          reason: reason.trim(),
          timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19)
        };
      }
      return req;
    });

    if (onUpdateDb) onUpdateDb({ ...db, approvalRequests: updatedList });

    setEditingRequest(null);
    setReason('');
    setPunchSessions([{ inEnabled: true, inTime: getCurrentTimeHHmm(), outEnabled: false, outTime: getCurrentTimeHHmm() }]);
    setSelPaymentId('');
    setNewPaymentAmount('');
    setNewPaymentDesc('');
    setEmpView('list');
  };

  // Cancel/Delete Request (Only if pending)
  const handleCancelRequest = (reqId: string) => {
    if (!confirm(t('Cancel this pending request?', 'क्या आप इस लंबित अनुरोध को रद्द करना चाहते हैं?'))) return;
    const updatedList = requestsList.filter(req => req.id !== reqId);
    if (onUpdateDb) onUpdateDb({ ...db, approvalRequests: updatedList });
  };

  // Approve Request (Updates DB records atomically via transaction wrapper)
  const handleApprove = (req: ApprovalRequest) => {
    if (!confirm(t('Approve this request?', 'क्या आप इस अनुरोध को स्वीकृत करना चाहते हैं?'))) return;

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
          req.category === 'GeoFence Attendance'
        ) {
          const key = `${req.employeeId}_${req.date}`;
          const existingRec = draft.attendance[key] || {};
          draft.attendance[key] = {
            ...existingRec,
            status: req.newValue as any
          };
        } else if (
          req.category === 'Punch In' || 
          req.category === 'Punch Out' || 
          req.category === 'Early Exit'
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
          }

          draft.attendance[key] = {
            ...existingRec,
            status: 'Present',
            sessions,
            // Save selfie photo from punch request for admin to view
            selfieUrl: req.employeePic || existingRec.selfieUrl
          };
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
              ? { ...p, date: parsed.date, amount: parsed.amount, mode: parsed.mode, description: parsed.description } 
              : p
          );
        } else if (req.category === 'New Payment') {
          // Employee requested a new payment entry — create it
          const parsed = JSON.parse(req.newValue);
          const newPayment = {
            id: `_PAY_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            employeeId: req.employeeId,
            amount: parsed.amount,
            date: parsed.date,
            mode: parsed.mode as any,
            description: parsed.description || '',
            paymentType: 'Employee Request'
          };
          draft.payments = [...draft.payments, newPayment];
        } else if (req.category === 'Leave Request') {
          // Mark leave days in attendance
          let parsed: { startDate: string; days: number; reason: string } | null = null;
          try { parsed = JSON.parse(req.newValue); } catch {}
          if (parsed) {
            const start = new Date(parsed.startDate);
            for (let d = 0; d < parsed.days; d++) {
              const date = new Date(start);
              date.setDate(start.getDate() + d);
              const dateStr = date.toISOString().split('T')[0];
              const key = `${req.employeeId}_${dateStr}`;
              draft.attendance[key] = { ...draft.attendance[key], status: 'Leave' };
            }
          }
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
          action: `${req.category} Approved`,
          targetId: req.employeeId,
          targetName: req.employeeName,
          oldValue: req.oldValue,
          newValue: req.newValue.length > 100 ? req.newValue.substring(0, 100) + '...' : req.newValue,
          timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
          device: navigator.userAgent.includes('Mobile') ? 'Mobile Device' : 'Desktop Panel'
        };
        draft.auditLogs = [newAudit, ...(draft.auditLogs || [])];

        // 4. Add notification for the Employee
        const newNotification = {
          id: `_NTF_${Date.now()}`,
          userId: req.employeeId,
          title: t('Request Approved', 'अनुरोध स्वीकृत'),
          message: `${t('Your request for', 'आपका')} ${req.category} ${t('on', 'पर')} ${req.date} ${t('has been approved.', 'स्वीकृत कर दिया गया है।')}`,
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
      alert(t('Transaction rolled back: ' + err.message, 'सौदा वापस ले लिया गया: ' + err.message));
    }
  };

  // Reject Request
  const handleReject = (reqId: string) => {
    if (!rejectionReason.trim()) {
      alert(t('Please provide a reason for rejection!', 'कृपया अस्वीकृति का कारण लिखें!'));
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
          title: t('Request Rejected', 'अनुरोध अस्वीकृत'),
          message: `${t('Your request for', 'का')} ${targetReq.category} ${t('on', 'पर')} ${targetReq.date} ${t('was rejected.', 'अस्वीकृत कर दिया गया है।')}`,
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
      alert(t('Rejection transaction failed: ' + err.message, 'अस्वीकृति विफलता: ' + err.message));
    }
  };

  const handleReturnForCorrection = (reqId: string) => {
    if (!rejectionReason.trim()) {
      alert(t('Please provide a correction instruction remark!', 'कृपया सुधार निर्देश की टिप्पणी लिखें!'));
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
        }
      } catch (e) {
        console.error('Failed to parse editing request payment:', e);
      }
    } else {
      setRequestType('attendance');
      if (employeeType === 'Hourly') {
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
              inTime: parseTime12to24(s.in) || getCurrentTimeHHmm(),
              outEnabled: s.out !== '',
              outTime: parseTime12to24(s.out) || getCurrentTimeHHmm()
            })));
          }
        } catch (e) {
          console.error('Failed to parse newValue during edit load:', e);
        }
      } else {
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
    if (val.startsWith('[')) {
      try {
        const parsed = JSON.parse(val) as Array<{ in: string; out: string }>;
        return parsed.map((s, i) => {
          const inTxt = s.in ? `In: ${s.in}` : '';
          const outTxt = s.out ? `Out: ${s.out}` : '';
          return `Session ${i + 1} (${[inTxt, outTxt].filter(Boolean).join(' | ')})`;
        }).join(', ');
      } catch (e) {
        return val;
      }
    }
    if (val.startsWith('{')) {
      try {
        const parsed = JSON.parse(val) as { date: string; amount: number; mode: string; description: string };
        return `${parsed.date} | ₹${parsed.amount} | ${parsed.mode} ${parsed.description ? `(${parsed.description})` : ''}`;
      } catch (e) {
        return val;
      }
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
      case 'GeoFence Attendance': return 'जियोफेंस हाजिरी';
      case 'Attendance Correction': return 'हाजिरी सुधार';
      case 'Punch In': return 'पंच इन';
      case 'Punch Out': return 'पंच आउट';
      case 'Payment': return 'भुगतान सुधार';
      case 'New Payment': return 'नया भुगतान';
      case 'Overtime': return 'ओवरटाइम';
      case 'Leave': return 'छुट्टी';
      case 'Leave Request': return 'छुट्टी रिक्वेस्ट';
      case 'Manual Attendance': return 'मैनुअल हाजिरी';
      case 'Device Register': return 'डिवाइस रजिस्ट्रेशन';
      case 'Early Exit': return 'जल्दी निकलना';
      case 'Late Entry': return 'देर से आना';
      default: return cat;
    }
  };

  return (
    <div className="w-full space-y-5 animate-in fade-in duration-200">
      
      {/* HEADER SECTION */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shadow-3xs">
            <Icon name="verified_user" size={18} />
          </div>
          <span className="text-xs font-black text-slate-800 uppercase tracking-wider">
            {isAdmin ? t('Manager Approval Panel', 'अनुमोदन प्रबंधन डेस्क') : t('My Correction Requests', 'मेरे सुधार अनुरोध')}
          </span>
        </div>

        </div>

        <div className="flex gap-2 items-center">
          <button
            onClick={() => window.location.reload()}
            className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 flex items-center justify-center hover:bg-slate-100 active:scale-[0.97] transition cursor-pointer shrink-0"
            title={t('Refresh', 'रीफ्रेश')}
          >
            <Icon name="refresh" size={18} />
          </button>

          {!isAdmin && empView === 'list' && (
            <button
              onClick={() => {
                setRequestType('attendance');
                setEmpView('new_request');
              }}
              className="h-9 px-4 bg-blue-600 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 active:scale-[0.98] transition-all cursor-pointer shadow-sm shadow-blue-500/10 shrink-0 whitespace-nowrap"
            >
              <Icon name="add" size={16} />
              <span>{t('New Request', 'नया अनुरोध')}</span>
            </button>
          )}
        </div>

      {/* FILTER BAR */}
      {(isAdmin || (!isAdmin && empView === 'list')) && (
        <div className="bg-white border border-slate-200/50 p-4 rounded-2xl shadow-3xs flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="text-[10px] text-slate-450 font-bold uppercase tracking-wider shrink-0">
            {t('Filter:', 'फ़िल्टर:')}
          </div>
          
          <div className="flex gap-2 w-full sm:flex-1">
            {/* Category Filter */}
            <select
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
              className="h-9 px-2.5 rounded-lg border border-slate-200 bg-white font-bold text-[10px] text-slate-650 focus:outline-none cursor-pointer flex-1 min-w-0 truncate"
            >
              <option value="All">{t('All Categories', 'सभी श्रेणियां')}</option>
              {categories.map((c, idx) => (
                <option key={idx} value={c}>{c}</option>
              ))}
            </select>

            {/* Status Filter */}
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as any)}
              className="h-9 px-2.5 rounded-lg border border-slate-200 bg-white font-bold text-[10px] text-slate-650 focus:outline-none cursor-pointer flex-1 min-w-0 truncate"
            >
              <option value="Pending">{t('Pending Requests', 'लंबित अनुरोध')}</option>
              <option value="Approved">{t('Approved', 'स्वीकृत')}</option>
              <option value="Rejected">{t('Rejected', 'अस्वीकृत')}</option>
              <option value="All">{t('All', 'सभी')}</option>
            </select>
          </div>
        </div>
      )}

      {/* --- EMPLOYEE FORM: CREATE REQUEST --- */}
      {!isAdmin && empView === 'new_request' && (
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-2xs animate-in slide-in-from-bottom duration-200">
          <div className="text-xs font-black text-slate-900 uppercase tracking-wider mb-4 border-b border-slate-50 pb-2">
            {t('Create Correction Request', 'सुधार हेतु अनुरोध फॉर्म')}
          </div>

          {/* Request Type Toggle Selector */}
          <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-1 mb-4">
            <button
              type="button"
              onClick={() => setRequestType('attendance')}
              className={`h-9 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                requestType === 'attendance' ? 'bg-white text-blue-600 shadow-sm border border-slate-100' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon name="edit_calendar" size={14} />
              <span>{t('Attendance', 'हाजिरी सुधार')}</span>
            </button>
            <button
              type="button"
              onClick={() => setRequestType('leave')}
              className={`h-9 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                requestType === 'leave' ? 'bg-white text-violet-600 shadow-sm border border-slate-100' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon name="beach_access" size={14} />
              <span>{t('Leave', 'छुट्टी')}</span>
            </button>
            <button
              type="button"
              onClick={() => setRequestType('payment')}
              className={`h-9 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                requestType === 'payment' ? 'bg-white text-blue-600 shadow-sm border border-slate-100' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon name="edit_note" size={14} />
              <span>{t('Fix Payment', 'भुगतान सुधार')}</span>
            </button>
            <button
              type="button"
              onClick={() => setRequestType('new_payment')}
              className={`h-9 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                requestType === 'new_payment' ? 'bg-white text-emerald-600 shadow-sm border border-slate-100' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon name="add_card" size={14} />
              <span>{t('New Payment', 'नया भुगतान')}</span>
            </button>
          </div>

          <form onSubmit={handleSubmitRequest} className="space-y-4">
            
            {/* ATTENDANCE CORRECTION FORM */}
            {requestType === 'attendance' && (
              <>
                {/* Target Date Selector */}
                <div className="fld">
                  <label>{t('Target Date', 'सुधार की तारीख')}</label>
                  <input
                    type="date"
                    value={reqDate}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={e => setReqDate(e.target.value)}
                    className="fi"
                    required
                  />
                </div>

                {/* HOURLY EMPLOYEE CORRECTION FORM */}
                {employeeType === 'Hourly' && (
                  <div className="space-y-4 border-t border-slate-100 pt-3">
                    <div className="text-[10px] font-black text-slate-450 uppercase tracking-wide block">
                      {t('Punch Times Sessions Correction', 'पंच समय सुधार विवरण')}
                    </div>

                    {punchSessions.map((session, idx) => (
                      <div key={idx} className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3 relative">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black text-slate-500 uppercase">
                            {t(`Session ${idx + 1}`, `सत्र ${idx + 1}`)}
                          </span>
                          {punchSessions.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveSessionRow(idx)}
                              className="text-rose-600 hover:text-rose-700 text-[10px] font-bold"
                            >
                              {t('Remove', 'हटाएं')}
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
                                className="rounded text-blue-600 focus:ring-blue-500"
                              />
                              <span>{t('Punch In', 'पंच इन')}</span>
                            </label>
                            
                            <button
                              type="button"
                              onClick={() => triggerTimePicker(idx, 'in', session.inTime)}
                              disabled={!session.inEnabled}
                              className="h-9 border border-slate-250 rounded-lg px-2.5 text-xs w-full bg-white flex items-center justify-between disabled:opacity-40 disabled:bg-slate-50 cursor-pointer text-left font-sans text-slate-800"
                            >
                              <span>{session.inTime ? formatTimeForDisplay(session.inTime) : '—'}</span>
                              <Icon name="schedule" size={14} className="text-slate-400" />
                            </button>
                          </div>

                          {/* Punch Out */}
                          <div className="space-y-1.5">
                            <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-650 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={session.outEnabled}
                                onChange={e => handleSessionFieldChange(idx, 'outEnabled', e.target.checked)}
                                className="rounded text-blue-600 focus:ring-blue-500"
                              />
                              <span>{t('Punch Out', 'पंच आउट')}</span>
                            </label>
                            
                            <button
                              type="button"
                              onClick={() => triggerTimePicker(idx, 'out', session.outTime)}
                              disabled={!session.outEnabled}
                              className="h-9 border border-slate-250 rounded-lg px-2.5 text-xs w-full bg-white flex items-center justify-between disabled:opacity-40 disabled:bg-slate-50 cursor-pointer text-left font-sans text-slate-800"
                            >
                              <span>{session.outTime ? formatTimeForDisplay(session.outTime) : '—'}</span>
                              <Icon name="schedule" size={14} className="text-slate-400" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={handleAddSessionRow}
                      className="w-full h-9 border border-blue-200 text-blue-600 bg-white hover:bg-blue-50 border-dashed rounded-xl flex items-center justify-center font-bold text-xs gap-1 cursor-pointer"
                    >
                      <Icon name="add" size={16} />
                      <span>{t('Add Multiple Punch Session', 'नया पंच सत्र जोड़ें')}</span>
                    </button>
                  </div>
                )}

                {/* DAILY / MONTHLY EMPLOYEE CORRECTION FORM */}
                {employeeType !== 'Hourly' && (
                  <div className="fld">
                    <label>{t('Requested Status', 'वांछित उपस्थिति स्थिति')}</label>
                    <select
                      value={statusVal}
                      onChange={e => setStatusVal(e.target.value as any)}
                      className="fi"
                    >
                      <option value="Present">{t('Present (उपस्थित)', 'Present')}</option>
                      <option value="Absent">{t('Absent (अनुपस्थित)', 'Absent')}</option>
                      <option value="Half Day">{t('Half Day (आधा दिन)', 'Half Day')}</option>
                      <option value="Overtime">{t('Overtime (अतिरिक्त समय)', 'Overtime')}</option>
                    </select>
                  </div>
                )}
                
                {employeeType !== 'Hourly' && statusVal === 'Overtime' && (
                  <div className="fld animate-in slide-in-from-top-2 duration-200">
                    <label>{t('Overtime Duration (HH:MM)', 'ओवरटाइम अवधि')}</label>
                    <button
                      type="button"
                      onClick={() => {
                        setPickerMeta({ sessionIdx: 0, field: 'overtime', initialVal: overtimeDuration });
                        setPickerOpen(true);
                      }}
                      className="h-9 border border-slate-250 rounded-lg px-3 text-sm font-bold w-full bg-white flex items-center justify-between cursor-pointer"
                    >
                      <span>{overtimeDuration}</span>
                      <Icon name="schedule" size={16} className="text-slate-400" />
                    </button>
                  </div>
                )}

              </>
            )}

            {/* PAYMENT EDIT REQUEST FORM */}
            {requestType === 'payment' && (
              <div className="space-y-4 border-t border-slate-100 pt-3">
                
                {/* Select payment transaction to edit */}
                <div className="fld">
                  <label>{t('Select Payment to Correct', 'संशोधित करने के लिए भुगतान चुनें')}</label>
                  {myPayments.length === 0 ? (
                    <p className="text-xs text-slate-400 italic p-3 border border-slate-150 rounded-xl bg-slate-50">
                      {t('No payments recorded by administrator yet.', 'प्रशासक द्वारा अभी तक कोई भुगतान दर्ज नहीं किया गया है।')}
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
                      <option value="">{t('-- Choose Payment Transaction --', '-- भुगतान लेनदेन चुनें --')}</option>
                      {myPayments.map(p => {
                        const label = `${p.date} - ₹${p.amount} (${p.mode}) ${p.description ? `- ${p.description}` : ''}`;
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
                  <div className="space-y-4 bg-slate-50 border border-slate-200 rounded-2xl p-4">
                    <div className="text-[10px] font-black text-slate-450 uppercase tracking-wide">
                      {t('New Corrected Values', 'नए संशोधित मान')}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="fld mb-0">
                        <label>{t('Correct Date', 'सही तारीख')}</label>
                        <input
                          type="date"
                          value={newPaymentDate}
                          onChange={e => setNewPaymentDate(e.target.value)}
                          className="fi"
                          required
                        />
                      </div>

                      <div className="fld mb-0">
                        <label>{t('Correct Amount (₹)', 'सही राशि (₹)')}</label>
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
                      <label>{t('Correct Payment Mode', 'सही भुगतान माध्यम')}</label>
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
                      <label>{t('Correct Description', 'सही विवरण/टिप्पणी')}</label>
                      <input
                        type="text"
                        value={newPaymentDesc}
                        onChange={e => setNewPaymentDesc(e.target.value)}
                        placeholder="e.g. Received via GPay"
                        className="fi bg-white"
                      />
                    </div>
                  </div>
                )}

              </div>
            )}

            {/* LEAVE REQUEST FORM */}
            {requestType === 'leave' && (
              <div className="space-y-4 border-t border-slate-100 pt-3 animate-in slide-in-from-top-2 duration-200">
                <div className="grid grid-cols-2 gap-4">
                  <div className="fld mb-0">
                    <label>{t('Leave Start Date', 'छुट्टी शुरू होने की तारीख')}</label>
                    <input type="date" value={leaveStartDate} onChange={e => setLeaveStartDate(e.target.value)} className="fi" required />
                  </div>
                  <div className="fld mb-0">
                    <label>{t('No. of Days', 'कितने दिन')}</label>
                    <select value={leaveDays} onChange={e => setLeaveDays(parseInt(e.target.value))} className="fi">
                      {[1,2,3,4,5,6,7,8,9].map(d => (
                        <option key={d} value={d}>{d} {t('Day', 'दिन')}{d > 1 && lang === 'en' ? 's' : ''}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="fld">
                  <label>{t('Reason for Leave', 'छुट्टी की वजह')} <span className="text-rose-500 ml-1">*</span></label>
                  <textarea
                    value={leaveReason}
                    onChange={e => setLeaveReason(e.target.value)}
                    placeholder={t('e.g. Medical, Family event, Personal work...', 'जैसे: बीमारी, शादी, निजी काम...')}
                    className="fi resize-none h-20"
                    required
                  />
                </div>
              </div>
            )}

            {/* NEW PAYMENT REQUEST FORM */}
            {requestType === 'new_payment' && (
              <div className="space-y-4 border-t border-slate-100 pt-3 animate-in slide-in-from-top-2 duration-200">
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-[10px] text-emerald-700 font-semibold">
                  💡 {t('Request admin to record a payment you received.', 'जो पैसा मिला है उसे दर्ज करने के लिए admin को रिक्वेस्ट भेजें।')}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="fld mb-0">
                    <label>{t('Payment Date', 'भुगतान की तारीख')}</label>
                    <input type="date" value={newPaymentDate} onChange={e => setNewPaymentDate(e.target.value)} className="fi" required />
                  </div>
                  <div className="fld mb-0">
                    <label>{t('Amount (₹)', 'राशि (₹)')}</label>
                    <input type="number" value={newPaymentAmount} onChange={e => setNewPaymentAmount(e.target.value)} placeholder="5000" className="fi" required />
                  </div>
                </div>
                <div className="fld">
                  <label>{t('Payment Mode', 'भुगतान का तरीका')}</label>
                  <select value={newPaymentMode} onChange={e => setNewPaymentMode(e.target.value)} className="fi bg-white">
                    <option value="Cash">Cash (नकद)</option>
                    <option value="UPI">UPI / Online</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Cheque">Cheque</option>
                  </select>
                </div>
                <div className="fld">
                  <label>{t('Description', 'विवरण')} <span className="text-slate-400 text-[9px] ml-1">({t('optional', 'वैकल्पिक')})</span></label>
                  <input type="text" value={newPaymentDesc} onChange={e => setNewPaymentDesc(e.target.value)}
                    placeholder={t('e.g. June salary, Advance...', 'जैसे: जून सैलरी, अग्रिम...')} className="fi bg-white" />
                </div>
              </div>
            )}

            {/* Reason */}
            <div className="fld">
              <label>{t('Reason / Remarks', 'सुधार का कारण')}</label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder={t('Explain why this correction is needed...', 'कारण स्पष्ट करें...')}
                className="fi h-20 py-2.5 resize-none"
                required
              />
            </div>

            <div className="flex gap-4 border-t border-slate-50 pt-4">
              <button
                type="button"
                onClick={() => setEmpView('list')}
                className="flex-1 btn bou text-xs font-semibold"
              >
                {t('Cancel', 'रद्द करें')}
              </button>
              <button
                type="submit"
                disabled={requestType === 'payment' && !selPaymentId}
                className="flex-1 btn bbl text-white font-semibold text-xs shadow-blue-500/10 disabled:opacity-50"
              >
                {t('Submit Request', 'अनुरोध भेजें')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* --- EMPLOYEE FORM: EDIT REQUEST --- */}
      {!isAdmin && empView === 'edit_request' && editingRequest && (
        <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-2xs animate-in slide-in-from-bottom duration-200">
          <div className="text-xs font-black text-slate-900 uppercase tracking-wider mb-4 border-b border-slate-50 pb-2">
            {t('Modify Correction Request', 'अनुरोध संपादित करें')}
          </div>

          <form onSubmit={handleEditRequestSubmit} className="space-y-4">
            
            {requestType === 'attendance' && (
              <>
                <div className="fld">
                  <label>{t('Target Date', 'तारीख')}</label>
                  <input
                    type="date"
                    value={reqDate}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={e => setReqDate(e.target.value)}
                    className="fi"
                    required
                  />
                </div>

                {/* Hourly Edit */}
                {employeeType === 'Hourly' && (
                  <div className="space-y-4 border-t border-slate-100 pt-3">
                    <div className="text-[10px] font-black text-slate-450 uppercase tracking-wide block">
                      {t('Punch Times Sessions Correction', 'पंच समय सुधार विवरण')}
                    </div>

                    {punchSessions.map((session, idx) => (
                      <div key={idx} className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3 relative">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black text-slate-500 uppercase">
                            {t(`Session ${idx + 1}`, `सत्र ${idx + 1}`)}
                          </span>
                          {punchSessions.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveSessionRow(idx)}
                              className="text-rose-600 hover:text-rose-700 text-[10px] font-bold"
                            >
                              {t('Remove', 'हटाएं')}
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
                                className="rounded text-blue-600 focus:ring-blue-500"
                              />
                              <span>{t('Punch In', 'पंच इन')}</span>
                            </label>
                            
                            <button
                              type="button"
                              onClick={() => triggerTimePicker(idx, 'in', session.inTime)}
                              disabled={!session.inEnabled}
                              className="h-9 border border-slate-250 rounded-lg px-2.5 text-xs w-full bg-white flex items-center justify-between disabled:opacity-40 disabled:bg-slate-50 cursor-pointer text-left font-sans text-slate-800"
                            >
                              <span>{session.inTime ? formatTimeForDisplay(session.inTime) : '—'}</span>
                              <Icon name="schedule" size={14} className="text-slate-400" />
                            </button>
                          </div>

                          {/* Punch Out */}
                          <div className="space-y-1.5">
                            <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-650 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={session.outEnabled}
                                onChange={e => handleSessionFieldChange(idx, 'outEnabled', e.target.checked)}
                                className="rounded text-blue-600 focus:ring-blue-500"
                              />
                              <span>{t('Punch Out', 'पंच आउट')}</span>
                            </label>
                            
                            <button
                              type="button"
                              onClick={() => triggerTimePicker(idx, 'out', session.outTime)}
                              disabled={!session.outEnabled}
                              className="h-9 border border-slate-250 rounded-lg px-2.5 text-xs w-full bg-white flex items-center justify-between disabled:opacity-40 disabled:bg-slate-50 cursor-pointer text-left font-sans text-slate-800"
                            >
                              <span>{session.outTime ? formatTimeForDisplay(session.outTime) : '—'}</span>
                              <Icon name="schedule" size={14} className="text-slate-400" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={handleAddSessionRow}
                      className="w-full h-9 border border-blue-200 text-blue-600 bg-white hover:bg-blue-50 border-dashed rounded-xl flex items-center justify-center font-bold text-xs gap-1 cursor-pointer"
                    >
                      <Icon name="add" size={16} />
                      <span>{t('Add Multiple Punch Session', 'नया पंच सत्र जोड़ें')}</span>
                    </button>
                  </div>
                )}

                {/* Daily/Monthly Edit */}
                {employeeType !== 'Hourly' && (
                  <div className="fld">
                    <label>{t('Requested Status', 'वांछित उपस्थिति स्थिति')}</label>
                    <select
                      value={statusVal}
                      onChange={e => setStatusVal(e.target.value as any)}
                      className="fi"
                    >
                      <option value="Present">{t('Present (उपस्थित)', 'Present')}</option>
                      <option value="Absent">{t('Absent (अनुपस्थित)', 'Absent')}</option>
                      <option value="Half Day">{t('Half Day (आधा दिन)', 'Half Day')}</option>
                      <option value="Overtime">{t('Overtime (अतिरिक्त समय)', 'Overtime')}</option>
                    </select>
                  </div>
                )}
                
                {employeeType !== 'Hourly' && statusVal === 'Overtime' && (
                  <div className="fld animate-in slide-in-from-top-2 duration-200">
                    <label>{t('Overtime Duration (HH:MM)', 'ओवरटाइम अवधि')}</label>
                    <button
                      type="button"
                      onClick={() => {
                        setPickerMeta({ sessionIdx: 0, field: 'overtime', initialVal: overtimeDuration });
                        setPickerOpen(true);
                      }}
                      className="h-9 border border-slate-250 rounded-lg px-3 text-sm font-bold w-full bg-white flex items-center justify-between cursor-pointer"
                    >
                      <span>{overtimeDuration}</span>
                      <Icon name="schedule" size={16} className="text-slate-400" />
                    </button>
                  </div>
                )}
              </>
            )}

            {requestType === 'payment' && (
              <div className="space-y-4 bg-slate-50 border border-slate-200 rounded-2xl p-4">
                <div className="text-[10px] font-black text-slate-450 uppercase tracking-wide">
                  {t('Edit Payment Values', 'संशोधित भुगतान विवरण')}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="fld mb-0">
                    <label>{t('Correct Date', 'सही तारीख')}</label>
                    <input
                      type="date"
                      value={newPaymentDate}
                      onChange={e => setNewPaymentDate(e.target.value)}
                      className="fi"
                      required
                    />
                  </div>

                  <div className="fld mb-0">
                    <label>{t('Correct Amount (₹)', 'सही राशि (₹)')}</label>
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
                  <label>{t('Correct Payment Mode', 'सही भुगतान माध्यम')}</label>
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
                  <label>{t('Correct Description', 'सही विवरण/टिप्पणी')}</label>
                  <input
                    type="text"
                    value={newPaymentDesc}
                    onChange={e => setNewPaymentDesc(e.target.value)}
                    className="fi bg-white"
                  />
                </div>
              </div>
            )}

            <div className="fld">
              <label>{t('Reason', 'कारण')}</label>
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
                {t('Cancel', 'पीछे जाएं')}
              </button>
              <button
                type="submit"
                className="flex-1 btn bbl text-white font-semibold text-xs"
              >
                {t('Save Changes', 'बदलाव सुरक्षित करें')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* --- REQUESTS LIST VIEW --- */}
      {((!isAdmin && empView === 'list') || isAdmin) && (
        <div className="space-y-3">
          {filteredList.length === 0 ? (
            <div className="text-center py-10 bg-white border border-slate-150 rounded-2xl text-xs text-slate-400 font-semibold uppercase tracking-wider">
              {t('No correction requests found', 'कोई सुधार अनुरोध नहीं मिला')}
            </div>
          ) : (
            filteredList.map((req) => (
              <div key={req.id} className="bg-white border border-slate-200/70 rounded-2xl p-4 shadow-3xs space-y-3 relative overflow-hidden">
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
                      <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0 shadow-inner">
                        {req.employeePic ? (
                          <img src={req.employeePic} alt={req.employeeName} className="w-full h-full object-cover" />
                        ) : (
                          <Icon name="person" size={18} className="text-slate-400" />
                        )}
                      </div>
                    )}
                    <div>
                      {isAdmin && <div className="text-xs font-extrabold text-slate-900">{req.employeeName}</div>}
                      <div className="text-[10px] text-slate-450 font-bold uppercase tracking-wider flex items-center gap-1.5 flex-wrap">
                        <span>{t(req.category, getCategoryHi(req.category))} · {req.date}</span>
                        {req.gpsAccuracy !== undefined && (
                          req.gpsAccuracy <= 30 ? (
                            <span className="inline-flex items-center gap-0.5 bg-emerald-50 text-emerald-700 border border-emerald-100 text-[8px] font-black px-1.5 py-0.2 rounded-md">
                              GPS Accepted ({req.gpsAccuracy.toFixed(0)}m)
                            </span>
                          ) : req.gpsAccuracy <= 100 ? (
                            <span className="inline-flex items-center gap-0.5 bg-amber-50 text-amber-700 border border-amber-100 text-[8px] font-black px-1.5 py-0.2 rounded-md">
                              ⚠️ GPS Warning ({req.gpsAccuracy.toFixed(0)}m)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 bg-rose-50 text-rose-700 border border-rose-100 text-[8px] font-black px-1.5 py-0.2 rounded-md animate-pulse">
                              🚨 GPS Manual Review ({req.gpsAccuracy.toFixed(0)}m)
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
                    {req.status === 'Pending' ? t('Pending', 'लंबित') : req.status === 'Approved' ? t('Approved', 'स्वीकृत') : t('Rejected', 'अस्वीकृत')}
                  </span>
                </div>

                {/* Request details (Old vs New value) */}
                <div className="relative bg-slate-50/70 border border-slate-100 rounded-xl p-2.5 text-xs">
                  {(req.category === 'Payment' || req.newValue.includes('{') || (req.oldValue && req.oldValue.includes('₹'))) && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); }}
                      className="absolute top-2 right-2 p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-600 transition-colors cursor-pointer select-none"
                      title='Salary'
                    >
                      <Icon name='visibility' size={14} />
                    </button>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-0.5">
                      <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block">{t('Current Value', 'वर्तमान मान')}</span>
                      <span className="font-semibold text-slate-550 line-through">{req.oldValue || '-'}</span>
                    </div>
                    <div className="space-y-0.5 border-l border-slate-150 pl-4">
                      <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block">{t('Requested Value', 'वांचित मान')}</span>
                      <span className="font-black text-blue-650">{renderNewValueText(req.newValue)}</span>
                    </div>
                  </div>
                </div>

                {/* Reason */}
                <div className="text-[10px] text-slate-500 font-semibold leading-relaxed">
                  <span className="text-slate-400 font-bold">{t('Reason:', 'कारण:')}</span> {req.reason}
                </div>

                {/* Rejection remarks if rejected */}
                {req.status === 'Rejected' && req.rejectionReason && (
                  <div className="text-[10px] text-rose-650 font-bold bg-rose-50/50 border border-rose-100 rounded-xl p-2.5">
                    {t('Rejection Reason:', 'अस्वीकृति का कारण:')} {req.rejectionReason}
                  </div>
                )}

                {/* Action panel */}
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 border-t border-slate-50 pt-3">
                  <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">
                    {t('Submitted:', 'भेजा गया:')} {req.timestamp}
                  </span>

                  <div className="flex gap-2 w-full sm:w-auto">
                    {/* Admin actions */}
                    {isAdmin && req.status === 'Pending' && (
                      <>
                        <button
                          onClick={() => setSelectedRequestDetails(req)}
                          className="flex-1 sm:flex-none h-8 px-2 border border-blue-200 text-blue-650 hover:bg-blue-50 rounded-lg text-[10px] font-bold cursor-pointer transition-colors active:scale-[0.97] whitespace-nowrap"
                        >
                          {t('Review', 'विवरण देखें')}
                        </button>
                        <button
                          onClick={() => handleApprove(req)}
                          className="flex-1 sm:flex-none h-8 px-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold cursor-pointer transition-colors active:scale-[0.97] whitespace-nowrap"
                        >
                          {t('Approve', 'स्वीकारें')}
                        </button>
                        <button
                          onClick={() => setRejectingRequestId(req.id)}
                          className="flex-1 sm:flex-none h-8 px-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-bold cursor-pointer transition-colors active:scale-[0.97] whitespace-nowrap"
                        >
                          {t('Reject', 'अस्वीकारें')}
                        </button>
                      </>
                    )}

                    {/* Admin Delete History resolved */}
                    {isAdmin && req.status !== 'Pending' && (
                      <button
                        onClick={() => handleDeleteRequest(req.id)}
                        className="h-8 w-8 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center cursor-pointer transition-colors"
                        title={t('Delete Record', 'रिकॉर्ड हटाएं')}
                      >
                        <Icon name="delete" size={16} />
                      </button>
                    )}

                    {/* Employee Actions */}
                    {!isAdmin && req.status === 'Pending' && (
                      <>
                        <button
                          onClick={() => loadEditRequest(req)}
                          className="flex-1 sm:flex-none h-8 px-3 border border-slate-200 text-slate-655 hover:bg-slate-50 rounded-lg text-[10px] font-bold cursor-pointer transition-colors whitespace-nowrap"
                        >
                          {t('Edit', 'संपादित करें')}
                        </button>
                        <button
                          onClick={() => handleCancelRequest(req.id)}
                          className="flex-1 sm:flex-none h-8 px-3 border border-rose-100 text-rose-600 hover:bg-rose-50 rounded-lg text-[10px] font-bold cursor-pointer transition-colors whitespace-nowrap"
                        >
                          {t('Cancel', 'रद्द करें')}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Reject Input popup banner */}
                {isAdmin && rejectingRequestId === req.id && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mt-3 space-y-3 animate-in fade-in duration-200">
                    <div className="text-[10px] font-black text-slate-700 uppercase tracking-wide">
                      {t('Provide Rejection Remarks', 'अस्वीकृति का कारण दर्ज करें')}
                    </div>
                    <input
                      type="text"
                      value={rejectionReason}
                      onChange={e => setRejectionReason(e.target.value)}
                      placeholder={t('e.g. Incorrect date / invalid claim', 'जैसे: गलत तारीख / अनुचित दावा')}
                      className="w-full h-9 border border-slate-200 rounded-lg px-3 text-xs outline-none bg-white focus:border-blue-500"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleReject(req.id)}
                        className="flex-1 h-8 bg-rose-600 text-white rounded-lg text-[10px] font-bold cursor-pointer"
                      >
                        {t('Confirm Reject', 'अस्वीकृति की पुष्टि करें')}
                      </button>
                      <button
                        onClick={() => {
                          setRejectingRequestId(null);
                          setRejectionReason('');
                        }}
                        className="w-20 h-8 border border-slate-250 bg-white text-slate-655 rounded-lg text-[10px] font-bold cursor-pointer"
                      >
                        {t('Cancel', 'रद्द')}
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
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">{t('Detailed Request Review', 'विस्तृत अनुरोध समीक्षा')}</h3>
              <button 
                onClick={() => { setSelectedRequestDetails(null); setRejectionReason(''); }}
                className="text-slate-400 hover:text-slate-655 cursor-pointer"
              >
                <Icon name="close" size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="space-y-4 text-xs">
              {/* Employee Bio with large selfie */}
              <div className="flex items-center gap-4 bg-slate-50 border border-slate-150 p-3 rounded-2xl">
                {/* Selfie – tap to expand */}
                <div
                  className="w-20 h-20 rounded-2xl overflow-hidden border-2 border-slate-200 bg-slate-100 shrink-0 cursor-pointer shadow-md hover:shadow-lg hover:scale-105 transition-all relative"
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
                    <div className="w-full h-full flex items-center justify-center font-bold text-slate-400 text-2xl">
                      {selectedRequestDetails.employeeName.charAt(0)}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-black text-slate-800 text-sm truncate">{selectedRequestDetails.employeeName}</div>
                  <div className="text-[10px] text-slate-450 font-bold uppercase">{selectedRequestDetails.employeeId}</div>
                  <div className="text-[10px] text-slate-500 font-bold">{db.employees.find(e => e.id === selectedRequestDetails.employeeId)?.type || 'Daily'}</div>
                  {selectedRequestDetails.employeePic && (
                    <button
                      onClick={() => setLightboxSrc(selectedRequestDetails.employeePic!)}
                      className="mt-1 text-[9px] font-bold text-blue-600 hover:underline cursor-pointer flex items-center gap-1"
                    >
                      <Icon name="zoom_in" size={11} /> {t('View Selfie Full Size', 'सेल्फी बड़ी करें')}
                    </button>
                  )}
                </div>
              </div>

              {/* Request Parameters */}
              <div className="grid grid-cols-2 gap-4 border border-slate-150 p-3 rounded-2xl bg-white">
                <div>
                  <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block">{t('Category / Type', 'श्रेणी / प्रकार')}</span>
                  <span className="font-extrabold text-slate-800 text-[11px]">{selectedRequestDetails.category}</span>
                </div>
                <div>
                  <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block">{t('Request Date', 'दिनांक')}</span>
                  <span className="font-bold text-slate-700">{selectedRequestDetails.date}</span>
                </div>
                <div>
                  <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block">{t('Current Value', 'वर्तमान मान')}</span>
                  <span className="font-semibold text-slate-550 line-through">{selectedRequestDetails.oldValue || '—'}</span>
                </div>
                <div>
                  <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block">{t('Requested Value', 'वांचित मान')}</span>
                  <span className="font-black text-blue-650">{selectedRequestDetails.newValue}</span>
                </div>
              </div>

              {/* GPS & Location Diagnostics */}
              {selectedRequestDetails.gpsLat !== undefined && (
                <div className="border border-slate-150 p-3 rounded-2xl bg-white space-y-2">
                  <div className="text-[9px] uppercase tracking-wider text-slate-450 font-black">📍 {t('Proximity & GeoFence Match', 'समीपता एवं जियोफेंस मिलान')}</div>
                  
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
                            <span className="text-[8px] text-slate-400 block">{t('Assigned GeoFence', 'असाइन किया गया जियोफेंस')}</span>
                            <span className="font-black text-slate-700">{assignedFence ? assignedFence.name : '—'}</span>
                          </div>
                          <div>
                            <span className="text-[8px] text-slate-400 block">{t('Distance to Center', 'केन्द्र से दूरी')}</span>
                            <span className="font-black text-slate-700">{distance !== null ? `${Math.round(distance)} meters` : '—'}</span>
                          </div>
                          <div className="col-span-2">
                            <span className="text-[8px] text-slate-400 block">{t('Coordinates', 'स्थान निर्देशांक')}</span>
                            <span className="font-mono text-slate-700 font-bold">{selectedRequestDetails.gpsLat?.toFixed(6)}, {selectedRequestDetails.gpsLng?.toFixed(6)}</span>
                          </div>
                          <div className="col-span-2">
                            <span className="text-[8px] text-slate-400 block">{t('Resolved GPS Address', 'जीपीएस द्वारा पता')}</span>
                            <span className="text-slate-700 leading-normal block font-sans">{selectedRequestDetails.gpsAddress}</span>
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
                                ? t('Inside assigned GeoFence radius boundary.', 'जियोफेंस परिधि के अंदर (सत्यापित)') 
                                : t('Outside assigned GeoFence boundary. Potential location spoof or mismatch!', 'जियोफेंस परिधि से बाहर (स्थान बेमेल)')}
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
                <div className="text-[9px] uppercase tracking-wider text-slate-450 font-black">⚙️ {t('Device Info & Diagnostics', 'डिवाइस विवरण एवं डायग्नोस्टिक्स')}</div>
                <div className="grid grid-cols-2 gap-3 text-[10px] font-semibold text-slate-655">
                  <div>
                    <span className="text-[8px] text-slate-400 block">{t('Device Model / OS', 'डिवाइस मॉडल / ओएस')}</span>
                    <span className="text-slate-700">{selectedRequestDetails.deviceModel || '—'} ({selectedRequestDetails.osVersion || '—'})</span>
                  </div>
                  <div>
                    <span className="text-[8px] text-slate-400 block">{t('Device UUID Locked', 'लॉक्ड डिवाइस UUID')}</span>
                    <span className="font-mono text-slate-700 truncate block max-w-[180px]" title={selectedRequestDetails.deviceId}>{selectedRequestDetails.deviceId || '—'}</span>
                  </div>
                  <div>
                    <span className="text-[8px] text-slate-400 block">{t('GPS Accuracy & Provider', 'जीपीएस सटीकता')}</span>
                    <span className={`font-bold ${selectedRequestDetails.gpsAccuracy && selectedRequestDetails.gpsAccuracy <= 30 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {selectedRequestDetails.gpsAccuracy ? `${selectedRequestDetails.gpsAccuracy.toFixed(0)}m` : '—'} ({selectedRequestDetails.gpsProvider || '—'})
                    </span>
                  </div>
                  <div>
                    <span className="text-[8px] text-slate-400 block">{t('Diagnostic Context', 'अतिरिक्त संदर्भ')}</span>
                    <span className="text-slate-700">
                      {t('Timestamp:', 'समय:')} {selectedRequestDetails.timestamp}
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
                  <div className="bg-slate-50 border border-slate-150 p-3 rounded-2xl grid grid-cols-2 gap-2 text-[10px] font-bold">
                    <div>
                      <span className="text-[8px] text-slate-400 block uppercase">{t('Yesterday Attendance', 'कल की उपस्थिति')}</span>
                      <span className="text-slate-700">{yesterdayStatus}</span>
                    </div>
                    <div>
                      <span className="text-[8px] text-slate-400 block uppercase">{t('Reason for Submission', 'आवेदन का कारण')}</span>
                      <span className="text-slate-700">{selectedRequestDetails.reason}</span>
                    </div>
                  </div>
                );
              })()}

              {/* Remarks/Correction inputs */}
              <div className="space-y-1.5 border-t border-slate-100 pt-3">
                <label className="text-[10px] font-black text-slate-550 uppercase block">{t('Admin Correction Remarks', 'अस्वीकृति या सुधार निर्देश टिप्पणी')}</label>
                <input
                  type="text"
                  value={rejectionReason}
                  onChange={e => setRejectionReason(e.target.value)}
                  placeholder={t('Enter instruction notes or rejection reasons', 'टिप्पणी दर्ज करें (अस्वीकार या सुधार के लिए आवश्यक)')}
                  className="w-full h-10 border border-slate-200 rounded-xl px-3 outline-none bg-slate-50 focus:border-blue-500 text-xs font-semibold"
                />
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex gap-2 border-t border-slate-100 pt-4 flex-wrap">
              <button
                onClick={() => handleApprove(selectedRequestDetails)}
                className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black cursor-pointer shadow-md shadow-emerald-500/10 active:scale-95 transition-all"
              >
                {t('Approve', 'स्वीकारें')}
              </button>
              <button
                onClick={() => handleReturnForCorrection(selectedRequestDetails.id)}
                className="flex-1 h-11 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-black cursor-pointer shadow-md shadow-amber-500/10 active:scale-95 transition-all"
              >
                {t('Return for Correction', 'सुधार के लिए लौटायें')}
              </button>
              <button
                onClick={() => handleReject(selectedRequestDetails.id)}
                className="flex-1 h-11 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black cursor-pointer shadow-md shadow-rose-500/10 active:scale-95 transition-all"
              >
                {t('Reject', 'अस्वीकारें')}
              </button>
              <button
                onClick={() => { setSelectedRequestDetails(null); setRejectionReason(''); }}
                className="w-24 h-11 border border-slate-255 bg-white text-slate-655 rounded-xl text-xs font-bold hover:bg-slate-100 transition-all cursor-pointer"
              >
                {t('Close', 'बंद करें')}
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
              ✕ {lang === 'en' ? 'Close' : 'बंद करें'}
            </button>
            <img
              src={lightboxSrc}
              alt="Employee Selfie"
              className="w-full rounded-2xl shadow-2xl border-2 border-white/10"
              style={{ maxHeight: '80vh', objectFit: 'contain' }}
            />
            <div className="text-center mt-3 text-white/60 text-[10px] font-semibold">
              {lang === 'en' ? 'Tap outside to close' : 'बंद करने के लिए बाहर टैप करें'}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
