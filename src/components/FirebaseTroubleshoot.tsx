import React, { useState } from 'react';
import { Cloud, Lock, Settings, KeyRound, Copy, Check, X, ArrowUpRight } from 'lucide-react';

interface FirebaseTroubleshootProps {
  lang: 'en' | 'hi';
  onClose: () => void;
}

export default function FirebaseTroubleshoot({ lang, onClose }: FirebaseTroubleshootProps) {
  const [copied, setCopied] = useState(false);

  const t = (en: string, hi: string) => (lang === 'en' ? en : hi);

  const rulesCode = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(rulesCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-250 flex items-end sm:items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl border border-slate-100 flex flex-col max-h-[90vh] overflow-hidden animate-in slide-in-from-bottom duration-250">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-rose-50 text-rose-600 rounded-lg">
              <Lock size={18} />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight leading-none">
                {t('Firebase Sync Blocked', 'फायरबेस सिंक ब्लॉक है')}
              </h2>
              <span className="text-[10px] text-slate-500 font-bold block mt-1">
                {t('Action Required • Security Rules', 'सुरक्षा नियम • आवश्यक कार्रवाई')}
              </span>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs leading-relaxed text-slate-600">
          
          {/* Explanation */}
          <div className="bg-amber-50/80 border border-amber-100 rounded-xl p-3.5 space-y-1.5">
            <h4 className="font-extrabold text-amber-800 flex items-center gap-1.5 uppercase text-[10px] tracking-wider">
              <Cloud size={14} />
              {t('Why did this happen?', 'यह त्रुटि क्यों आई?')}
            </h4>
            <p className="text-slate-700 leading-relaxed text-[11px]">
              {t(
                "Your Firestore database was created in Production Mode, which blocks external read/write access. Since this app uses local PIN authentication, you must update your security rules to allow central document synchronization.",
                "आपका फायरबेस डेटाबेस प्रॉडक्शन मोड में बनाया गया है, जो बाहरी सिंक को ब्लॉक करता है। सुरक्षित रूप से साझाकरण सिंक को चालू करने के लिए आपको नीचे दिए नियमों को अपने कंसोल में अपडेट करना होगा।"
              )}
            </p>
          </div>

          {/* Steps */}
          <div className="space-y-3">
            <h4 className="font-extrabold text-slate-800 uppercase text-[10px] tracking-wider">
              {t('How to Fix in 2 Minutes:', '२ मिनट में ठीक करने का तरीका:')}
            </h4>

            <ol className="space-y-3 list-decimal list-inside pl-1 text-[11px]">
              <li className="leading-relaxed">
                {t('Open the ', 'अपना ')}
                <a 
                  href="https://console.firebase.google.com/u/0/project/shree-kamdhenu-ems/firestore/rules" 
                  target="_blank" 
                  rel="noreferrer"
                  className="text-blue-600 font-bold underline inline-flex items-center gap-0.5 hover:text-blue-800"
                >
                  {t('Firebase Rules Editor', 'फायरबेस रूल्स कंसोल')}
                  <ArrowUpRight size={12} />
                </a>
                {t(' on your Firebase dashboard.', ' खोलें।')}
              </li>
              
              <li className="leading-relaxed">
                {t('Copy the security rules configuration code from below.', 'नीचे दिए गए सुरक्षा नियमों के कोड को कॉपी करें।')}
              </li>

              <li className="leading-relaxed">
                {t('Paste it over your existing rules, and click ', 'अपने पुराने रूल्स को हटाकर इसे पेस्ट करें और ')}
                <span className="font-extrabold text-slate-800 bg-slate-100 px-1 py-0.5 rounded border border-slate-200">
                  {t('Publish', 'पब्लिश')}
                </span>
                {t('.', ' पर क्लिक करें।')}
              </li>
            </ol>
          </div>

          {/* Code block */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-black uppercase text-slate-400 tracking-wider">
              <span>{t('Firestore Rules Code', 'फायरस्टोर रूल्स कोड')}</span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-2 py-1 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors font-extrabold cursor-pointer text-[10px] uppercase tracking-wider"
              >
                {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                {copied ? t('Copied!', 'कॉपी हो गया!') : t('Copy Code', 'कोड कॉपी करें')}
              </button>
            </div>
            
            <pre className="p-3 bg-slate-900 text-slate-200 font-mono text-[10px] rounded-xl overflow-x-auto border border-slate-800 shadow-inner select-all leading-normal">
              {rulesCode}
            </pre>
          </div>

          {/* Hint */}
          <div className="text-[10px] text-slate-400 font-semibold text-center pt-2 border-t border-slate-100 leading-normal">
            {t(
              "After publishing, refresh this application on all active devices. The sync status badge will turn green.",
              "रूल्स पब्लिश करने के बाद, इस ऐप को अपने सभी फ़ोन/डिवाइस पर रिफ्रेश करें। सिंक स्टेटस हरा हो जाएगा।"
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-extrabold rounded-xl shadow-sm hover:shadow-md transition-all cursor-pointer text-center uppercase tracking-wider"
          >
            {t('Got It, Let\'s Do It', 'ठीक है, समझ गया')}
          </button>
        </div>

      </div>
    </div>
  );
}
