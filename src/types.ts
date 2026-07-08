export type EmployeeType = 'Hourly' | 'Daily' | 'Monthly';
export type EmployeeStatus = 'Active' | 'Inactive' | 'Left Job';
export type PaymentMode = 'Cash' | 'UPI' | 'Bank Transfer' | 'Cheque';
export type CalcType = 'HourlyRate' | 'CustomAmount';

export interface SalaryHistory {
  ym: string; // YYYY-MM
  rate: number; // rate for this month
}

export interface Employee {
  id: string; // e.g., 'EMP001'
  name: string;
  mobile: string;
  type: EmployeeType;
  pic: string; // base64 or empty
  status: EmployeeStatus;
  join: string; // YYYY-MM-DD
  address: string;
  dob?: string; // YYYY-MM-DD
  gender?: string;
  baseHours: number; // 8, 9, 10, or 12
  salHistory: SalaryHistory[];
  carryForward?: number;
  loginPin?: string; // 4-6 digit employee login PIN
  currentDeviceId?: string; // locked device ID
  deviceApproved?: boolean; // device registration status
}

export interface PunchSession {
  in: string; // HH:mm
  out: string; // HH:mm
}

export interface AttendanceRecord {
  status?: 'Present' | 'Absent' | 'Half Day' | 'Leave';
  sessions?: PunchSession[];
}

// Flat Transactions Structure
export interface Payment {
  id: string;
  employeeId: string;
  amount: number;
  date: string; // YYYY-MM-DD
  mode: PaymentMode;
  description: string;
  paymentType?: string; // e.g. Salary Payment, Advance Payment, Bonus Payment
  time?: string; // e.g. 09:00 AM
}

export interface Earning {
  id: string;
  employeeId: string;
  amount: number;
  date: string; // YYYY-MM-DD
  description: string; // Bonus, Cow Dung Work, Extra Work, Incentive, etc.
  time?: string;
}

export interface Deduction {
  id: string;
  employeeId: string;
  amount: number;
  date: string; // YYYY-MM-DD
  description: string; // Damage, Penalty, Advance Recovery, etc.
  time?: string;
}

export interface OvertimeEntry {
  id: string;
  employeeId: string;
  date: string; // YYYY-MM-DD
  hours: number;
  calcType: CalcType;
  amount: number; // calculated or custom amount
  description: string;
  time?: string;
}

export interface LateFineEntry {
  id: string;
  employeeId: string;
  date: string; // YYYY-MM-DD
  hours: number;
  calcType: CalcType;
  amount: number; // calculated or custom amount
  description: string;
  time?: string;
}

export interface AttendanceMap {
  [employeeAndDate: string]: AttendanceRecord; // Key = employeeId + '_' + date (YYYY-MM-DD)
}

// Enterprise Features
export interface AuditLogEntry {
  id: string;
  adminName: string;
  action: string;
  targetId: string;
  targetName: string;
  oldValue: string;
  newValue: string;
  timestamp: string; // YYYY-MM-DD HH:mm:ss
  device: string;
}

export interface RecycleBinItem {
  id: string; // unique ID
  deletedAt: string;
  employee: Employee;
  attendance: AttendanceMap;
  payments: Payment[];
  earnings: Earning[];
  deductions: Deduction[];
  overtimeEntries: OvertimeEntry[];
  lateFineEntries: LateFineEntry[];
}

export type ApprovalCategory = 
  | 'Punch In' 
  | 'Punch Out' 
  | 'Attendance Correction' 
  | 'Leave' 
  | 'Payment' 
  | 'Manual Attendance' 
  | 'GeoFence Attendance' 
  | 'Overtime' 
  | 'Early Exit' 
  | 'Late Entry'
  | 'Device Register';
export type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected';

export interface ApprovalRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeePic?: string;
  category: ApprovalCategory;
  date: string; // YYYY-MM-DD
  oldValue: string;
  newValue: string;
  reason: string;
  timestamp: string; // YYYY-MM-DD HH:mm:ss
  status: ApprovalStatus;
  rejectionReason?: string;
  gpsAccuracy?: number;
  gpsProvider?: string;
  gpsLat?: number;
  gpsLng?: number;
  gpsAddress?: string;
  deviceId?: string;
  deviceModel?: string;
  osVersion?: string;
}

export interface NotificationItem {
  id: string;
  userId: string; // employeeId or 'admin'
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

export interface GeoFence {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius: number; // in meters (50, 100, 200, 500)
  assignedStaff: string[]; // employee IDs
  activeHours: { start: string; end: string }; // HH:mm
  weekdays: number[]; // 0=Sun, 1=Mon, etc.
}

export interface LiveLocation {
  employeeId: string;
  lat: number;
  lng: number;
  battery: number;
  speed: number;
  accuracy: number;
  timestamp: string;
  isMock: boolean;
  network?: string;
  address?: string;
}

export interface RouteStop {
  lat: number;
  lng: number;
  startTime: string;
  endTime: string;
  duration: number; // minutes
}

export interface RouteHistory {
  id: string; // employeeId_YYYY-MM-DD
  employeeId: string;
  date: string;
  path: { lat: number; lng: number; timestamp: string }[];
  stops: RouteStop[];
}

export interface CompanySettings {
  name: string;
  orgName?: string;
  ownerName?: string;
  mobile?: string;
  email?: string;
  address?: string;
  logo?: string; // base64 logo string
  gstNumber?: string;
  regNumber?: string;
  website?: string;
  notes?: string;
  enablePunchIO?: boolean;
  enableLocation?: boolean;
  enableSelfie?: boolean;
  geoRadius?: string; // e.g. '50 Meter' - legacy fallback
  defaultCycle?: string;
  calcMonthlyWage?: string;
  calcDailyWage?: string;
  calcHourlyWage?: string;
  allowAdvance?: boolean;
  allowExtraEarnings?: boolean;
  allowDeductions?: boolean;
  allowOvertime?: boolean;
  theme?: string; // 'Light' | 'Dark' | 'System'
  adminPin?: string; // Sync admin PIN to Firestore
}

export interface AppDatabase {
  employees: Employee[];
  attendance: AttendanceMap;
  payments: Payment[];
  earnings: Earning[];
  deductions: Deduction[];
  overtimeEntries: OvertimeEntry[];
  lateFineEntries: LateFineEntry[];
  company?: CompanySettings;
  auditLogs?: AuditLogEntry[];
  recycleBin?: RecycleBinItem[];
  approvalRequests?: ApprovalRequest[];
  notifications?: NotificationItem[];
  geofences?: GeoFence[];
  liveLocations?: Record<string, LiveLocation>;
  routeHistories?: RouteHistory[];
  devices?: DeviceRegistration[];
  offlineQueue?: SyncQueueItem[];
}

export interface DeviceRegistration {
  id: string; // request/device ID
  employeeId: string;
  employeeName: string;
  deviceModel: string;
  osVersion: string;
  appVersion: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  timestamp: string;
}

export interface SyncQueueItem {
  id: string;
  action: string;
  payload: any;
  timestamp: string;
  retryCount: number;
  failureReason?: string;
  status: 'Pending' | 'Failed' | 'Synced';
}
