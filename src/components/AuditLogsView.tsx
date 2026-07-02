import React, { useState } from 'react';
import { AppDatabase, AuditLogEntry } from '../types';
import Icon from './Icon';

interface AuditLogsViewProps {
  db: AppDatabase;
  lang: 'en' | 'hi';
  onClose: () => void;
}

export default function AuditLogsView({
  db,
  lang,
  onClose
}: AuditLogsViewProps) {
  const t = (en: string, hi: string) => (lang === 'en' ? en : hi);

  const logsList = db.auditLogs || [];

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAction, setFilterAction] = useState('All');

  // Filter actions list
  const actionsList = Array.from(new Set(logsList.map(log => log.action)));

  // Filtered log list
  const filteredLogs = logsList.filter(log => {
    const matchesSearch = 
      log.adminName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.targetName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.action.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesAction = filterAction === 'All' || log.action === filterAction;

    return matchesSearch && matchesAction;
  });

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
      <div className="bg-white rounded-3xl w-full max-w-2xl h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-250">
        
        {/* Header */}
        <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shadow-3xs">
              <Icon name="history" size={18} />
            </div>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">
              {t('System Audit Logs', 'सिस्टम ऑडिट लॉग्स')}
            </h3>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-200 hover:bg-slate-350 text-slate-650 flex items-center justify-center cursor-pointer transition-colors"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Filter controls */}
        <div className="bg-slate-50/50 border-b border-slate-100 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Search */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('Search by admin, employee, action...', 'एडमिन, कर्मचारी, कार्य से खोजें...')}
              className="w-full h-9 border border-slate-200 rounded-xl px-9 text-xs bg-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <Icon name="search" size={16} />
            </div>
          </div>

          {/* Action category filter */}
          <select
            value={filterAction}
            onChange={e => setFilterAction(e.target.value)}
            className="h-9 px-3 rounded-xl border border-slate-200 bg-white font-bold text-xs text-slate-700 focus:outline-none focus:border-blue-500 cursor-pointer shadow-3xs"
          >
            <option value="All">{t('All Operations', 'सभी गतिविधियाँ')}</option>
            {actionsList.map((act, idx) => (
              <option key={idx} value={act}>{act}</option>
            ))}
          </select>
        </div>

        {/* Log rows list */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {filteredLogs.length === 0 ? (
            <div className="text-center py-20 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
              {t('No system audit logs found', 'कोई ऑडिट लॉग नहीं मिला')}
            </div>
          ) : (
            filteredLogs.map((log) => (
              <div key={log.id} className="border border-slate-150 rounded-xl p-3.5 space-y-2 bg-white hover:border-slate-300 transition-colors shadow-3xs">
                
                {/* Meta details */}
                <div className="flex items-center justify-between text-[10px] font-bold">
                  <div className="flex items-center gap-2">
                    <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 font-black">
                      {log.adminName}
                    </span>
                    <span className="text-slate-400">→</span>
                    <span className="text-slate-800 font-black">
                      {log.targetName}
                    </span>
                  </div>
                  <span className="text-slate-400 font-medium">{log.timestamp}</span>
                </div>

                {/* Action details */}
                <div className="text-xs font-black text-slate-900 uppercase tracking-wide">
                  {log.action}
                </div>

                {/* Diff box */}
                <div className="grid grid-cols-2 gap-3 bg-slate-50 border border-slate-100 rounded-lg p-2 text-xs">
                  <div className="space-y-0.5">
                    <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block">{t('Before Value', 'पूर्व मान')}</span>
                    <span className="font-semibold text-slate-550 line-through truncate block">{log.oldValue || '-'}</span>
                  </div>
                  <div className="space-y-0.5 border-l border-slate-150 pl-3">
                    <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block">{t('After Value', 'नया मान')}</span>
                    <span className="font-extrabold text-slate-900 truncate block">{log.newValue || '-'}</span>
                  </div>
                </div>

                {/* Device type */}
                <div className="text-[9px] text-slate-400 font-semibold flex items-center gap-1">
                  <Icon name="devices" size={12} />
                  <span>{log.device}</span>
                </div>

              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex justify-between items-center text-[10px] text-slate-400 font-bold uppercase tracking-wider">
          <span>{t('Logs Count:', 'कुल लॉग्स:')} {filteredLogs.length}</span>
          <button 
            onClick={onClose}
            className="h-8 px-4 border border-slate-250 bg-white text-slate-650 rounded-lg font-bold hover:bg-slate-100 cursor-pointer active:scale-[0.98] transition-all"
          >
            {t('Close Panel', 'बंद करें')}
          </button>
        </div>

      </div>
    </div>
  );
}
