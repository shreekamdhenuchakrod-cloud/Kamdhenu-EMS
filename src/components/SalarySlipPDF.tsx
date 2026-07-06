import React, { useState, useEffect } from 'react';
import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import { AppDatabase, Employee, Payment, Earning, Deduction, OvertimeEntry, LateFineEntry } from '../types';
import { calcEmployeeFinancials, getDaysInMonth, timeToHrs } from '../db';
import Icon from './Icon';

interface SalarySlipPDFProps {
  employee: Employee;
  year: number;
  month: number;
  db: AppDatabase;
  lang: 'en' | 'hi';
  onReady?: () => void;
}

// Helper to convert number to Indian Rupees words
function numberToWords(num: number): string {
  const a = [
    '', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ',
    'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '
  ];
  const b = ['', '', 'Twenty ', 'Thirty ', 'Forty ', 'Fifty ', 'Sixty ', 'Seventy ', 'Eighty ', 'Ninety '];

  function numToWords(n: number, s: string): string {
    let str = '';
    if (n > 19) {
      str += b[Math.floor(n / 10)] + a[n % 10];
    } else {
      str += a[n];
    }
    if (n) {
      str += s;
    }
    return str;
  }

  if (num === 0) return 'Zero Rupees Only';
  
  let rounded = Math.round(num);
  let out = '';
  out += numToWords(Math.floor(rounded / 10000000), 'Crore ');
  out += numToWords(Math.floor((rounded / 100000) % 100), 'Lakh ');
  out += numToWords(Math.floor((rounded / 1000) % 100), 'Thousand ');
  out += numToWords(Math.floor((rounded / 100) % 10), 'Hundred ');
  if (rounded > 100 && rounded % 100) {
    out += 'and ';
  }
  out += numToWords(Math.floor(rounded % 100), '');
  return out + 'Rupees Only';
}

export default function SalarySlipPDF({
  employee,
  year,
  month,
  db,
  lang,
  onReady
}: SalarySlipPDFProps) {
  const t = (en: string, hi: string) => (lang === 'en' ? en : hi);

  const financials = calcEmployeeFinancials(employee, year, month, db);
  const metrics = financials.metrics;
  const company = db.company || { name: 'Shree Kamdhenu' };

  const [imagesLoaded, setImagesLoaded] = useState(false);

  const formatCurrency = (amt: number) => {
    return `₹${Math.round(amt).toLocaleString('en-IN')}`;
  };

  const renderValue = (val: number, isCurrency = true) => {
    const formatted = isCurrency ? formatCurrency(val) : String(val);
    return (
      <>
        <span className="print:hidden font-mono">{formatted}</span>
        <span className="hidden print:inline font-mono">{formatted}</span>
      </>
    );
  };

  const renderWords = (num: number) => {
    const words = numberToWords(num);
    return (
      <>
        <span className="print:hidden">{words}</span>
        <span className="hidden print:inline">{words}</span>
      </>
    );
  };

  const monthsEn = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const periodStr = `${t('01', '०१')} ${t(monthsEn[month], monthsEn[month])} ${year} - ${getDaysInMonth(year, month)} ${t(monthsEn[month], monthsEn[month])} ${year}`;

  // Calendar setup for Page 2
  const daysInMonth = getDaysInMonth(year, month);
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Generate calendar grid
  const calendarCells: Array<{ dateNum: number; status?: string; inOut?: string; hours?: string }> = [];
  
  // Find weekday index of the first day (0=Mon, 6=Sun)
  let firstDay = new Date(year, month, 1).getDay();
  // Adjust JS getDay() [0=Sun, 1=Mon...] to [0=Mon, 6=Sun]
  let startIdx = firstDay === 0 ? 6 : firstDay - 1;

  // Empty padding cells before first day
  for (let i = 0; i < startIdx; i++) {
    calendarCells.push({ dateNum: 0 });
  }

  // Actual days
  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const rec = db.attendance[`${employee.id}_${dStr}`];
    
    let status = rec?.status || '';
    let inOut = '';
    let hoursStr = '';

    if (employee.type === 'Hourly') {
      const activeHrs = (rec?.sessions || []).reduce((acc, s) => acc + timeToHrs(s.in, s.out), 0);
      status = activeHrs > 0 ? 'Present' : '';
      if (activeHrs > 0) hoursStr = `${activeHrs.toFixed(1)} Hrs`;
    } else {
      if (rec?.sessions && rec.sessions[0]) {
        inOut = `${rec.sessions[0].in} - ${rec.sessions[0].out || '...'}`;
      }
    }

    calendarCells.push({
      dateNum: d,
      status,
      inOut,
      hours: hoursStr
    });
  }

  // QR Code URL encoding
  const qrDataStr = encodeURIComponent(
    `EmpID: ${employee.id} | Month: ${monthsEn[month]}-${year} | NetSalary: ₹${Math.round(financials.totalDue)} | Verified: Shree Kamdhenu EMS`
  );
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=90x90&data=${qrDataStr}`;

  useEffect(() => {
    setImagesLoaded(false);
    const logoUrl = company.logo || '';
    const qrUrl = qrCodeUrl;
    
    let active = true;
    const promises: Promise<void>[] = [];
    
    if (logoUrl) {
      promises.push(new Promise<void>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = logoUrl;
        img.onload = () => resolve();
        img.onerror = () => resolve();
      }));
    }
    
    promises.push(new Promise<void>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = qrUrl;
      img.onload = () => resolve();
      img.onerror = () => resolve();
    }));
    
    Promise.all(promises).then(() => {
      if (active) {
        setImagesLoaded(true);
        if (onReady) onReady();
      }
    });
    
    return () => {
      active = false;
    };
  }, [company.logo, qrCodeUrl]);

  if (!imagesLoaded) {
    return (
      <div className="w-full flex flex-col items-center justify-center py-16 gap-3 text-slate-500 font-sans">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-bold uppercase tracking-wider">{t('Generating PDF...', 'पीडीएफ तैयार की जा रही है...')}</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[210mm] bg-white font-sans text-slate-900 mx-auto select-none p-1 text-[11px] leading-normal print:p-0 salary-slip-pdf-container">
      
      {/* Styles to inject print specifics */}
      <style dangerouslySetInnerHTML={{__html: `
        @media print {
          @page {
            size: A4 portrait;
            margin: 15mm !important;
          }
          body {
            background-color: white !important;
            color: black !important;
            font-size: 10px !important;
            height: auto !important;
            overflow: visible !important;
          }
          
          #root > *:not(:has(.salary-slip-pdf-container)) {
            display: none !important;
          }
          #root {
            display: block !important;
            height: auto !important;
            min-height: 0 !important;
            overflow: visible !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          main, sidebar, header, nav, aside, footer, button, .no-print-button {
            display: none !important;
          }
          
          .fixed {
            position: static !important;
            display: block !important;
            background: transparent !important;
            backdrop-filter: none !important;
            padding: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
            width: auto !important;
            height: auto !important;
          }
          .fixed > div {
            display: block !important;
            max-width: none !important;
            width: 100% !important;
            height: auto !important;
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
            margin: 0 !important;
            transform: none !important;
            animation: none !important;
            background: transparent !important;
          }
          .fixed > div > *:not(#salary-slip-print-box) {
            display: none !important;
          }
          #salary-slip-print-box {
            display: block !important;
            overflow: visible !important;
            max-height: none !important;
            height: auto !important;
            padding: 0 !important;
            margin: 0 !important;
            background: transparent !important;
          }

          .salary-slip-pdf-container {
            width: 100% !important;
            max-width: none !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          
          .print-page {
            width: 100% !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 0 15mm 0 !important;
            padding: 0 !important;
            box-sizing: border-box;
            page-break-after: always !important;
            break-after: page !important;
            position: relative;
            background: white !important;
            border: none !important;
            box-shadow: none !important;
          }
          
          .print-page:last-child {
            margin-bottom: 0 !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
          
          .print-no-break, tr, table, .border, .rounded-xl, .rounded-2xl, .rounded-3xl {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        }
      `}} />

      {/* --- PAGE 1: SALARY SLIP DETAILS --- */}
      <div id="salary-slip-page-1" className="print-page border border-slate-200 rounded-3xl p-6 mb-8 bg-white shadow-2xs relative print:border-0 print:p-0 print:m-0 print:shadow-none">
        
        {/* Header branding */}
        <div className="flex justify-between items-center gap-6 mb-4">
          <div className="flex items-center gap-3">
            {company.logo ? (
              <img src={company.logo} crossOrigin="anonymous" alt="Company Logo" className="w-14 h-14 rounded-xl object-cover border border-slate-100 shadow-3xs" />
            ) : (
              <div className="w-14 h-14 bg-slate-50 border border-slate-200 text-slate-500 rounded-xl flex items-center justify-center font-bold">
                LOGO
              </div>
            )}
            <div>
              <h1 className="text-lg font-black tracking-tight text-slate-900 leading-none">{company.orgName || company.name}</h1>
              <p className="text-[9px] font-bold uppercase text-blue-600 tracking-wider mt-1">{t('SALARY STATEMENT', 'वेतन पत्रक')}</p>
            </div>
          </div>
          
          <div className="text-right text-[9px] text-slate-400 font-semibold space-y-0.5 leading-relaxed">
            <div>{company.address}</div>
            <div>{t('Mobile', 'मोबाइल')}: +91 {company.mobile || '-'} · {t('Email', 'ईमेल')}: {company.email || '-'}</div>
            <div>{t('GSTIN', 'जीएसटी')}: {company.gstNumber || '-'} · {t('PAN', 'पैन')}: {company.regNumber || '-'}</div>
          </div>
        </div>

        <hr className="border-slate-200 mb-4" />

        {/* Slip Period Title */}
        <div className="text-center mb-5">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider">{t('Monthly Pay Slip', 'मासिक वेतन पर्ची')}</h2>
          <p className="text-[10px] text-slate-400 font-bold mt-1">{periodStr}</p>
        </div>

        {/* 1. Employee Info Table */}
        <div className="border border-slate-250 rounded-xl overflow-hidden mb-5">
          <div className="bg-slate-50 border-b border-slate-200 px-4 py-2 text-[9px] font-black text-slate-800 uppercase tracking-wider">
            {t('Employee Placement & Info', 'कर्मचारी और खाता विवरण')}
          </div>
          
          <div className="grid grid-cols-3 gap-6 p-4">
            {/* Left Column */}
            <div className="space-y-1.5">
              <div className="flex justify-between"><span className="text-slate-450 font-bold">{t('Name', 'नाम')}:</span> <span className="font-extrabold text-slate-850">{employee.name}</span></div>
              <div className="flex justify-between"><span className="text-slate-450 font-bold">{t('Staff ID', 'आईडी')}:</span> <span className="font-bold">{employee.id}</span></div>
              <div className="flex justify-between"><span className="text-slate-450 font-bold">{t('Employment', 'प्रकार')}:</span> <span className="font-bold">{employee.type}</span></div>
            </div>

            {/* Middle Column */}
            <div className="space-y-1.5 border-l border-slate-100 pl-6">
              <div className="flex justify-between"><span className="text-slate-450 font-bold">{t('Mobile', 'मोबाइल')}:</span> <span className="font-bold">+91 {employee.mobile}</span></div>
              <div className="flex justify-between"><span className="text-slate-450 font-bold">{t('Address', 'पता')}:</span> <span className="font-bold truncate max-w-[120px]">{employee.address || '-'}</span></div>
              <div className="flex justify-between"><span className="text-slate-450 font-bold">{t('Join Date', 'ज्वाइनिंग')}:</span> <span className="font-bold">{employee.join}</span></div>
            </div>

            {/* Right Column */}
            <div className="space-y-1.5 border-l border-slate-100 pl-6">
              <div className="flex justify-between"><span className="text-slate-450 font-bold">{t('Salary Rate', 'वेतन दर')}:</span> <span className="font-bold">{renderValue(calcEmployeeFinancials(employee, year, month, db).metrics.rate)}</span></div>
              <div className="flex justify-between"><span className="text-slate-450 font-bold">{t('Base Hours', 'मानक घंटे')}:</span> <span className="font-bold">{employee.baseHours || 9} Hrs</span></div>
              <div className="flex justify-between"><span className="text-slate-450 font-bold">{t('Payable Days', 'देय दिन')}:</span> <span className="font-bold">{metrics.attendanceCounts.present + metrics.attendanceCounts.halfDay * 0.5}</span></div>
            </div>
          </div>
        </div>

        {/* 2. Salary Breakdown (Earnings vs Deductions) */}
        <div className="grid grid-cols-2 gap-4 mb-5">
          {/* Earnings Table */}
          <div className="border border-slate-250 rounded-xl overflow-hidden flex flex-col justify-between">
            <div>
              <div className="bg-slate-50 border-b border-slate-200 px-4 py-2 text-[9px] font-black text-slate-800 uppercase tracking-wider">
                {t('Salary & Earnings', 'अर्जित राशि')}
              </div>
              <table className="w-full text-left text-[10px]">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-bold">
                    <th className="px-4 py-1.5">{t('Description', 'विवरण')}</th>
                    <th className="px-4 py-1.5 text-right">{t('Amount', 'राशि')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr className="font-medium text-slate-650">
                    <td className="px-4 py-1.5">{t('Basic Earned Salary', 'अर्जित मूल वेतन')}</td>
                    <td className="px-4 py-1.5 text-right text-slate-800">{renderValue(metrics.earnedSalary)}</td>
                  </tr>
                  {metrics.overtime > 0 && (
                    <tr className="font-medium text-slate-650">
                      <td className="px-4 py-1.5">{t('Overtime Pay', 'ओवरटाइम भुगतान')}</td>
                      <td className="px-4 py-1.5 text-right text-slate-800">{renderValue(metrics.overtime)}</td>
                    </tr>
                  )}
                  {metrics.extraEarnings > 0 && (
                    <tr className="font-medium text-slate-650">
                      <td className="px-4 py-1.5">{t('Incentive & Bonus', 'इंसेंटिव और बोनस')}</td>
                      <td className="px-4 py-1.5 text-right text-slate-800">{renderValue(metrics.extraEarnings)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="bg-slate-50 border-t border-slate-200 px-4 py-2 flex justify-between font-black text-slate-800">
              <span>{t('Total Earnings (A)', 'कुल कमाई (A)')}</span>
              <span>{renderValue(metrics.earnedSalary + metrics.overtime + metrics.extraEarnings)}</span>
            </div>
          </div>

          {/* Deductions Table */}
          <div className="border border-slate-250 rounded-xl overflow-hidden flex flex-col justify-between">
            <div>
              <div className="bg-slate-50 border-b border-slate-200 px-4 py-2 text-[9px] font-black text-slate-800 uppercase tracking-wider">
                {t('Fines & Deductions', 'कटौती एवं जुर्माना')}
              </div>
              <table className="w-full text-left text-[10px]">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-bold">
                    <th className="px-4 py-1.5">{t('Description', 'विवरण')}</th>
                    <th className="px-4 py-1.5 text-right">{t('Amount', 'राशि')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {metrics.details.deductionsRows.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="px-4 py-6 text-center text-slate-400 font-bold uppercase tracking-wider text-[9px]">
                        {t('No Deductions', 'कोई कटौती नहीं')}
                      </td>
                    </tr>
                  ) : (
                    metrics.details.deductionsRows.map((row, idx) => (
                      <tr key={idx} className="font-medium text-slate-655">
                        <td className="px-4 py-1.5 truncate max-w-[120px]">{row.desc}</td>
                        <td className="px-4 py-1.5 text-right text-slate-800">{renderValue(row.amount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="bg-slate-50 border-t border-slate-200 px-4 py-2 flex justify-between font-black text-slate-800">
              <span>{t('Total Deductions (B)', 'कुल कटौती (B)')}</span>
              <span>{renderValue(metrics.deductions)}</span>
            </div>
          </div>
        </div>

        {/* 3. Received Payments Ledger */}
        <div className="border border-slate-250 rounded-xl overflow-hidden mb-5">
          <div className="bg-slate-50 border-b border-slate-200 px-4 py-2 text-[9px] font-black text-slate-800 uppercase tracking-wider">
            {t('Payment ledger transactions this month', 'प्राप्त भुगतान रसीद विवरण')}
          </div>
          <table className="w-full text-left text-[10px]">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400 font-bold">
                <th className="px-4 py-1.5">{t('Date', 'तारीख')}</th>
                <th className="px-4 py-1.5">{t('Reference / Mode', 'माध्यम')}</th>
                <th className="px-4 py-1.5">{t('Description', 'विवरण')}</th>
                <th className="px-4 py-1.5 text-right">{t('Paid Amount', 'प्राप्त राशि')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {metrics.details.paymentsRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-center text-slate-400 font-bold uppercase tracking-wider text-[9px]">
                    {t('No Payment Transactions Received', 'कोई भुगतान प्राप्त नहीं हुआ')}
                  </td>
                </tr>
              ) : (
                metrics.details.paymentsRows.map((row, idx) => (
                  <tr key={`payment-${idx}`} className="font-medium text-slate-650">
                    <td className="px-4 py-1.5">{row.date}</td>
                    <td className="px-4 py-1.5"><span className="bg-slate-100 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase">{row.mode}</span></td>
                    <td className="px-4 py-1.5 truncate max-w-[150px]">{row.desc}</td>
                    <td className="px-4 py-1.5 text-right font-bold text-slate-850">{renderValue(row.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="bg-slate-50 border-t border-slate-200 px-4 py-2 flex justify-between font-black text-slate-800 text-[10px]">
            <span>{t('Total Paid (C)', 'कुल प्राप्त भुगतान (C)')}</span>
            <span>{renderValue(metrics.payments)}</span>
          </div>
        </div>

        {/* 4. Salary Summary Card */}
        <div className="bg-slate-50 border border-slate-250 rounded-2xl p-4 mb-4 flex justify-between items-center">
          <div className="space-y-1">
            <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold block">{t('Net Salary Disbursed (Pending due)', 'बकाया शुद्ध देय राशि')}</span>
            <div className="text-xl font-black text-emerald-600 leading-none">
              {renderValue(financials.totalDue)}
            </div>
            <div className="text-[9px] font-semibold text-slate-450 italic mt-1.5">
              {t('In Words', 'शब्दों में')}: {renderWords(financials.totalDue)}
            </div>
          </div>

          {/* QR Code */}
          <div className="w-[84px] h-[84px] bg-white border border-slate-200 rounded-xl p-1 shadow-3xs flex items-center justify-center overflow-hidden">
            <img src={qrCodeUrl} crossOrigin="anonymous" alt="Verify QR" className="w-full h-full object-cover" />
          </div>
        </div>

        {/* Notes */}
        {company.notes && (
          <div className="text-[9px] text-slate-400 italic mb-6">
            * {t('Note', 'नोट')}: {company.notes}
          </div>
        )}

        {/* Signatures */}
        <div className="grid grid-cols-3 gap-6 pt-8 text-center text-[10px] font-bold text-slate-500">
          <div>
            <div className="border-t border-slate-200 pt-1.5 mx-8">{t("Employee's Signature", 'कर्मचारी के हस्ताक्षर')}</div>
          </div>
          <div>
            <div className="border-t border-slate-200 pt-1.5 mx-8">{t('HR Department', 'मानव संसाधन विभाग')}</div>
          </div>
          <div>
            <div className="border-t border-slate-200 pt-1.5 mx-8">{t('Authorized Signature', 'अधिकृत हस्ताक्षर')}</div>
          </div>
        </div>

        {/* Page Footer */}
        <div className="absolute bottom-6 left-6 right-6 flex justify-between text-[8px] text-slate-400 font-semibold border-t border-slate-100 pt-3 print:bottom-0 print:left-0 print:right-0">
          <div>{t('Generated by: Kamdhenu EMS', 'द्वारा निर्मित: कामधेनु ईएमएस')} · {new Date().toLocaleDateString()}</div>
          <div>{t('Page 1 of 2', 'पृष्ठ १ का २')}</div>
        </div>

      </div>

      {/* --- PAGE 2: ATTENDANCE CALENDAR --- */}
      <div id="salary-slip-page-2" className="print-page border border-slate-200 rounded-3xl p-6 bg-white shadow-2xs relative print:border-0 print:p-0 print:m-0 print:shadow-none">
        
        {/* Header branding */}
        <div className="flex justify-between items-center gap-6 mb-4">
          <div className="flex items-center gap-3">
            {company.logo ? (
              <img src={company.logo} crossOrigin="anonymous" alt="Company Logo" className="w-10 h-10 rounded-xl object-cover border border-slate-100 shadow-3xs" />
            ) : (
              <div className="w-10 h-10 bg-slate-50 border border-slate-200 text-slate-500 rounded-xl flex items-center justify-center font-bold">
                LOGO
              </div>
            )}
            <div>
              <h1 className="text-sm font-black tracking-tight text-slate-900 leading-none">{company.orgName || company.name}</h1>
              <p className="text-[8px] font-bold uppercase text-blue-600 tracking-wider mt-1">{t('ATTENDANCE LEDGER', 'उपस्थिति बहीखाता')}</p>
            </div>
          </div>
          <div className="text-right text-[8px] text-slate-400 font-bold uppercase tracking-wider">
            {t('Employee ID', 'कर्मचारी आईडी')}: {employee.id}
          </div>
        </div>

        <hr className="border-slate-200 mb-4" />

        {/* Title */}
        <div className="text-center mb-5">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider">{t('Monthly Attendance Calendar', 'मासिक उपस्थिति कैलेंडर')}</h2>
          <p className="text-[10px] text-slate-450 font-bold mt-1">{monthsEn[month]} {year}</p>
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-1.5 border border-slate-200 rounded-2xl p-3 bg-slate-50/50 mb-5">
          {/* Weekday headers */}
          {weekdays.map((w, idx) => (
            <div key={idx} className="text-center text-[9px] font-black text-slate-400 uppercase tracking-wider py-1">
              {t(w, w)}
            </div>
          ))}

          {/* Calendar cells */}
          {calendarCells.map((cell, idx) => {
            if (cell.dateNum === 0) {
              return <div key={idx} className="bg-transparent h-12 rounded-xl" />;
            }

            let cellBg = 'bg-white text-slate-800 border-slate-150';
            if (cell.status === 'Present') cellBg = 'bg-emerald-50 text-emerald-800 border-emerald-200';
            else if (cell.status === 'Absent') cellBg = 'bg-rose-50 text-rose-800 border-rose-200';
            else if (cell.status === 'Half Day') cellBg = 'bg-amber-50 text-amber-800 border-amber-200';
            else if (cell.status === 'Leave') cellBg = 'bg-violet-50 text-violet-800 border-violet-200';

            return (
              <div 
                key={idx} 
                className={`h-12 border rounded-xl p-1.5 flex flex-col justify-between transition-all ${cellBg}`}
              >
                <div className="text-[10px] font-black leading-none">{String(cell.dateNum).padStart(2, '0')}</div>
                <div className="space-y-0.5">
                  {cell.status && (
                    <div className="text-[7px] font-extrabold uppercase tracking-wide leading-none">
                      {cell.status === 'Present' ? t('P', 'उपस्थित') : cell.status === 'Absent' ? t('A', 'अनुपस्थित') : cell.status === 'Half Day' ? t('HD', 'आधा दिन') : t('L', 'छुट्टी')}
                    </div>
                  )}
                  {cell.inOut && (
                    <div className="text-[6.5px] text-slate-450 font-semibold tracking-tighter truncate leading-none">
                      {cell.inOut}
                    </div>
                  )}
                  {cell.hours && (
                    <div className="text-[6.5px] text-slate-500 font-extrabold tracking-tighter leading-none">
                      {cell.hours}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-5">
          <div className="text-[8px] font-black uppercase text-slate-400 tracking-wider mb-2">{t('Attendance Legends', 'उपस्थिति संकेत चिह्न')}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[9px] font-bold text-slate-650">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-emerald-500 border border-emerald-600 block" /> {t('P: Present', 'P: उपस्थित')}</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-rose-500 border border-rose-600 block" /> {t('A: Absent', 'A: अनु.')}</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-amber-500 border border-amber-600 block" /> {t('HD: Half Day', 'HD: आधा दिन')}</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-violet-500 border border-violet-600 block" /> {t('L: Leave', 'L: छुट्टी')}</span>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="border border-slate-200 rounded-xl p-3 text-center space-y-0.5">
            <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block">{t('Present Days', 'उपस्थित दिन')}</span>
            <span className="text-sm font-black text-emerald-600 block">{metrics.attendanceCounts.present}</span>
          </div>
          <div className="border border-slate-200 rounded-xl p-3 text-center space-y-0.5">
            <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block">{t('Half Days', 'आधे दिन')}</span>
            <span className="text-sm font-black text-amber-600 block">{metrics.attendanceCounts.halfDay}</span>
          </div>
          <div className="border border-slate-200 rounded-xl p-3 text-center space-y-0.5">
            <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block">{t('Absent Days', 'अनुपस्थित दिन')}</span>
            <span className="text-sm font-black text-rose-600 block">{metrics.attendanceCounts.absent}</span>
          </div>
          <div className="border border-slate-200 rounded-xl p-3 text-center space-y-0.5">
            <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block">{t('Total Leaves', 'कुल छुट्टियां')}</span>
            <span className="text-sm font-black text-violet-600 block">{metrics.attendanceCounts.leave}</span>
          </div>
        </div>

        {/* System verification declaration */}
        <div className="text-[8px] text-slate-450 italic mt-6 leading-relaxed text-center">
          * {t('This is a system generated printout from Shree Krishna Balram Gaushala Payroll engine and does not require signatures.', 'यह श्री कृष्ण बलराम गौशाला पेरोल सिस्टम द्वारा स्वचालित रूप से तैयार किया गया दस्तावेज है और इसमें हस्तलिखित हस्ताक्षर की आवश्यकता नहीं है।')}
        </div>

        {/* Page Footer */}
        <div className="absolute bottom-6 left-6 right-6 flex justify-between text-[8px] text-slate-400 font-semibold border-t border-slate-100 pt-3 print:bottom-0 print:left-0 print:right-0">
          <div>{t('System Verification Code: ', 'सत्यापन कोड: ')}{employee.id}-{year}-{month+1}</div>
          <div>{t('Page 2 of 2', 'पृष्ठ २ का २')}</div>
        </div>

      </div>

    </div>
  );
}

export async function downloadSalarySlipPDF(employeeName: string, periodStr: string): Promise<boolean> {
  const page1 = document.getElementById('salary-slip-page-1');
  const page2 = document.getElementById('salary-slip-page-2');

  if (!page1 || !page2) {
    console.error('PDF elements not found!');
    alert('Error: PDF elements not found. Please try opening the Generate PDF modal again.');
    return false;
  }

  try {
    const { generateA4PDF } = await import('../utils/pdfGenerator');
    const filename = `SalarySlip_${employeeName.replace(/\s+/g, '_')}_${periodStr.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

    return await generateA4PDF(
      [page1, page2],
      filename,
      {
        employeeName,
        generatedBy: 'Kamdhenu EMS System',
        title: `Official Salary Slip - Period: ${periodStr}`
      }
    );
  } catch (error: any) {
    console.error('Error generating PDF', error);
    alert('Error generating PDF: ' + (error?.message || error));
    return false;
  }
}
