import React from 'react';
import { AppDatabase, RecycleBinItem, Employee } from '../types';
import Icon from './Icon';

interface RecycleBinViewProps {
  db: AppDatabase;
  lang: 'en' | 'hi';
  onClose: () => void;
  onRestore: (item: RecycleBinItem) => void;
  onPermanentDelete: (itemId: string) => void;
}

export default function RecycleBinView({
  db,
  lang,
  onClose,
  onRestore,
  onPermanentDelete
}: RecycleBinViewProps) {
  const t = (en: string, hi: string) => (lang === 'en' ? en : hi);

  const binItems = db.recycleBin || [];

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
      <div className="bg-white rounded-3xl w-full max-w-xl h-[80vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-250">
        
        {/* Header */}
        <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shadow-3xs">
              <Icon name="delete_sweep" size={18} />
            </div>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">
              {t('Recycle Bin', 'रीसायकल बिन')}
            </h3>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-200 hover:bg-slate-350 text-slate-650 flex items-center justify-center cursor-pointer transition-colors"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Info label */}
        <div className="bg-amber-50 border-b border-amber-100 p-4 text-[10px] text-amber-800 font-medium leading-normal flex items-start gap-2">
          <Icon name="info" size={14} className="shrink-0 mt-0.5" />
          <span>
            {t(
              'Deleting staff moves them here along with all their records (attendance, overtime, payments). You can restore them anytime or delete them permanently.',
              'स्टाफ को हटाने पर वे सभी रिकॉर्ड (हाजिरी, ओवरटाइम, भुगतान) के साथ यहां आ जाते हैं। आप उन्हें पुनः प्राप्त या स्थायी रूप से हटा सकते हैं।'
            )}
          </span>
        </div>

        {/* List of deleted items */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3.5">
          {binItems.length === 0 ? (
            <div className="text-center py-20 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
              {t('Recycle bin is empty', 'रीसायकल बिन खाली है')}
            </div>
          ) : (
            binItems.map((item) => (
              <div key={item.id} className="border border-slate-150 rounded-xl p-4 bg-white hover:border-slate-300 transition-colors shadow-3xs flex items-center justify-between gap-4">
                
                {/* Employee Info */}
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center">
                    {item.employee.pic ? (
                      <img src={item.employee.pic} alt={item.employee.name} className="w-full h-full object-cover" />
                    ) : (
                      <Icon name="person" size={22} className="text-slate-400" />
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-black text-slate-900">{item.employee.name}</div>
                    <div className="text-[9px] text-slate-450 font-bold uppercase tracking-wider mt-0.5">
                      {t('ID:', 'आईडी:')} {item.employee.id} · {t('Deleted on:', 'हटाया गया:')} {item.deletedAt.slice(0, 10)}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => onRestore(item)}
                    className="h-8 px-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold cursor-pointer transition-all active:scale-[0.97]"
                  >
                    {t('Restore', 'पुनः प्राप्त करें')}
                  </button>
                  <button
                    onClick={() => onPermanentDelete(item.id)}
                    className="h-8 px-3.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-bold cursor-pointer transition-all active:scale-[0.97]"
                  >
                    {t('Purge', 'नष्ट करें')}
                  </button>
                </div>

              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex justify-between items-center text-[10px] text-slate-400 font-bold uppercase tracking-wider">
          <span>{t('Total Items:', 'कुल आइटम:')} {binItems.length}</span>
          <button 
            onClick={onClose}
            className="h-8 px-4 border border-slate-250 bg-white text-slate-650 rounded-lg font-bold hover:bg-slate-100 cursor-pointer active:scale-[0.98] transition-all"
          >
            {t('Close', 'बंद करें')}
          </button>
        </div>

      </div>
    </div>
  );
}
