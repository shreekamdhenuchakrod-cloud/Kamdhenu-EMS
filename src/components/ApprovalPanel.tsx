import React, { useState } from 'react';
import { 
  AppDatabase, Employee, ApprovalRequest, ApprovalCategory, ApprovalStatus, AttendanceRecord, AuditLogEntry, Payment
} from '../types';
import Icon from './Icon';
import TimeWheelPicker from './TimeWheelPicker';
import { runPayrollTransaction } from '../db';

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

  // Request Type: 'attendance' | 'payment'
  const [requestType, setRequestType] = useState<'attendance' | 'payment'>('attendance');

  // Categories list
  const categories: ApprovalCategory[] = [
    'Punch In', 'Punch Out', 'Attendance Correction', 'Leave', 
    'Payment', 'Manual Attendance', 'GeoFence Attendance', 'Overtime', 'Early Exit', 'Late Entry', 'Device Register'
  ];

  // Filtering (Admin & Employee)
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [filterStatus, setFilterStatus] = useState<ApprovalStatus | 'All'>('Pending');

  // Form states
  const [reqDate, setReqDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [reason, setReason] = useState<string>('');
  
  // Daily/Monthly Status Form State
  const [statusVal, setStatusVal] = useState<'Present' | 'Absent' | 'Half Day'>('Present');

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

  // Time Picker states
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMeta, setPickerMeta] = useState<{ sessionIdx: number; field: 'in' | 'out'; initialVal: string } | null>(null);

  // Edit Request State
  const [editingRequest, setEditingRequest] = useState<ApprovalRequest | null>(null);

  // Admin rejection reason input
  const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');

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
        category = 'Attendance Correction';
        newVal = statusVal;
      }
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
          alert(t('Please select at least one Punch In or Punch Out time to request correction!', 'कृपया सुधार का अनुरोध करने के लिए कम से कम एक पंच इन या पंच आउट समय चुनें!'));
          return;
        }
      }
    } else {
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
          req.category === 'Late Entry' || 
          req.category === 'Early Exit' ||
          req.category === 'Overtime'
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
              if (sessions.length > 0) sessions[0].in = req.newValue;
              else sessions.push({ in: req.newValue, out: '' });
            } else {
              if (sessions.length > 0) sessions[0].out = req.newValue;
              else sessions.push({ in: '', out: req.newValue });
            }
          }

          draft.attendance[key] = {
            ...existingRec,
            status: 'Present',
            sessions
          };
        } else if (req.category === 'Payment') {
          const parsed = JSON.parse(req.newValue);
          draft.payments = draft.payments.map(p => 
            p.id === parsed.paymentId 
              ? { ...p, date: parsed.date, amount: parsed.amount, mode: parsed.mode, description: parsed.description } 
              : p
          );
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

      if (onUpdateDb) onUpdateDb(updatedDb);
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

    const updatedDb: AppDatabase = { ...db, approvalRequests: updatedRequests };

    // Notification for employee
    const newNotification = {
      id: `_NTF_${Date.now()}`,
      userId: targetReq.employeeId,
      title: t('Request Rejected', 'अनुरोध अस्वीकृत'),
      message: `${t('Your request for', 'आपका')} ${targetReq.category} ${t('on', 'पर')} ${targetReq.date} ${t('was rejected.', 'अस्वीकृत कर दिया गया है।')} ${t('Reason', 'कारण')}: ${rejectionReason}`,
      timestamp: new Date().toISOString(),
      read: false
    };
    updatedDb.notifications = [newNotification, ...(db.notifications || [])];

    if (onUpdateDb) onUpdateDb(updatedDb);

    setRejectingRequestId(null);
    setRejectionReason('');
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
  });

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

        {!isAdmin && empView === 'list' && (
          <button
            onClick={() => {
              setRequestType('attendance');
              setEmpView('new_request');
            }}
            className="h-9 px-4 bg-blue-600 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 active:scale-[0.98] transition-all cursor-pointer shadow-sm shadow-blue-500/10"
          >
            <Icon name="add" size={16} />
            <span>{t('New Request', 'नया अनुरोध')}</span>
          </button>
        )}
      </div>

      {/* FILTER BAR */}
      {(isAdmin || (!isAdmin && empView === 'list')) && (
        <div className="bg-white border border-slate-200/50 p-4 rounded-2xl shadow-3xs flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="text-[10px] text-slate-450 font-bold uppercase tracking-wider">{t('Filter:', 'फ़िल्टर:')}</div>
            
            {/* Category Filter */}
            <select
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
              className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white font-bold text-[10px] text-slate-650 focus:outline-none cursor-pointer"
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
              className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white font-bold text-[10px] text-slate-650 focus:outline-none cursor-pointer"
            >
              <option value="Pending">{t('Pending Requests', 'लंबित अनुरोध')}</option>
              <option value="Approved">{t('Approved History', 'स्वीकृत इतिहास')}</option>
              <option value="Rejected">{t('Rejected History', 'अस्वीकृत इतिहास')}</option>
              <option value="All">{t('All History', 'संपूर्ण इतिहास')}</option>
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
          <div className="flex rounded-xl border border-slate-200 overflow-hidden bg-slate-50 p-1 mb-4">
            <button
              type="button"
              onClick={() => setRequestType('attendance')}
              className={`flex-1 h-9 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                requestType === 'attendance' ? 'bg-white text-blue-600 shadow-sm border border-slate-100' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon name="edit_calendar" size={16} />
              <span>{t('Attendance', 'हाजिरी सुधार')}</span>
            </button>
            <button
              type="button"
              onClick={() => setRequestType('payment')}
              className={`flex-1 h-9 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                requestType === 'payment' ? 'bg-white text-blue-600 shadow-sm border border-slate-100' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon name="payments" size={16} />
              <span>{t('Payment Request', 'भुगतान सुधार')}</span>
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
                    </select>
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
                    </select>
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
                        <span>{t(req.category, req.category)} · {req.date}</span>
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
                <div className="flex justify-between items-center border-t border-slate-50 pt-3">
                  <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">
                    {t('Submitted:', 'भेजा गया:')} {req.timestamp}
                  </span>

                  <div className="flex gap-2">
                    {/* Admin actions */}
                    {isAdmin && req.status === 'Pending' && (
                      <>
                        <button
                          onClick={() => handleApprove(req)}
                          className="h-8 px-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold cursor-pointer transition-colors active:scale-[0.97]"
                        >
                          {t('Approve', 'स्वीकारें')}
                        </button>
                        <button
                          onClick={() => setRejectingRequestId(req.id)}
                          className="h-8 px-3.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-bold cursor-pointer transition-colors active:scale-[0.97]"
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
                          className="h-8 px-3 border border-slate-200 text-slate-655 hover:bg-slate-50 rounded-lg text-[10px] font-bold cursor-pointer transition-colors"
                        >
                          {t('Edit', 'संपादित करें')}
                        </button>
                        <button
                          onClick={() => handleCancelRequest(req.id)}
                          className="h-8 px-3 border border-rose-100 text-rose-600 hover:bg-rose-50 rounded-lg text-[10px] font-bold cursor-pointer transition-colors"
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

      {/* CUSTOM TIME WHEEL PICKER OVERLAY */}
      <TimeWheelPicker
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={pickerMeta ? (pickerMeta.field === 'in' ? 'Punch In Time' : 'Punch Out Time') : ''}
        initialValue={pickerMeta ? pickerMeta.initialVal : ''}
        onSave={handleSaveTimePicker}
      />

    </div>
  );
}
