import React, { useState, useEffect, useRef } from 'react';
import { AppDatabase, NotificationItem } from '../types';
import Icon from './Icon';

interface NotificationDeskProps {
  db: AppDatabase;
  onUpdateDb: (updatedDb: AppDatabase) => void;
  userId: string; // 'admin' or employeeId
  lang: 'en' | 'hi';
}

export default function NotificationDesk({ db, onUpdateDb, userId, lang }: NotificationDeskProps) {
  const t = (en: string, hi: string) => (lang === 'en' ? en : hi);
  
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const notificationsList = db.notifications || [];
  
  // Filter notifications relevant to the active user
  const myNotifications = notificationsList.filter(n => n.userId === userId);
  const unreadCount = myNotifications.filter(n => !n.read).length;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMarkAllAsRead = () => {
    const updated = notificationsList.map(n => {
      if (n.userId === userId) return { ...n, read: true };
      return n;
    });
    onUpdateDb({ ...db, notifications: updated });
  };

  const handleClearAll = () => {
    const updated = notificationsList.filter(n => n.userId !== userId);
    onUpdateDb({ ...db, notifications: updated });
  };

  const handleMarkSingleAsRead = (id: string) => {
    const updated = notificationsList.map(n => {
      if (n.id === id) return { ...n, read: true };
      return n;
    });
    onUpdateDb({ ...db, notifications: updated });
  };

  return (
    <div className="relative" ref={dropdownRef} style={{ zIndex: 9999 }}>
      {/* Bell Button Icon */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center relative cursor-pointer active:scale-95 transition-all"
      >
        <Icon name="notifications" size={21} className="text-slate-650" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 bg-rose-500 text-white text-[8px] font-black w-4 h-4 rounded-full flex items-center justify-center border border-white animate-in zoom-in-90 duration-200">
            {unreadCount}
          </span>
        )}
      </button>

      {/* Notification Panel - Full-width on mobile, fixed width on desktop */}
      {isOpen && (
        <>
          {/* Mobile backdrop */}
          <div
            className="fixed inset-0 bg-black/20 md:hidden"
            style={{ zIndex: 9998 }}
            onClick={() => setIsOpen(false)}
          />
          <div
            className="fixed left-0 right-0 top-14 mx-3 md:absolute md:left-auto md:right-0 md:top-auto md:mt-2 md:w-80 md:mx-0"
            style={{ zIndex: 9999 }}
          >
            <div className="bg-white border border-slate-150 rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-top-3 duration-200">
              {/* Header */}
              <div className="flex justify-between items-center px-4 py-3 bg-slate-50 border-b border-slate-150">
                <span className="text-xs font-black text-slate-800 uppercase tracking-wider">
                  {t('Notifications', 'सूचनाएं')}
                  {unreadCount > 0 && (
                    <span className="ml-2 bg-rose-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-full">
                      {unreadCount}
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllAsRead}
                      className="text-[9px] font-black text-blue-600 hover:underline cursor-pointer"
                    >
                      {t('Mark all read', 'सभी पढ़ें')}
                    </button>
                  )}
                  <button
                    onClick={() => setIsOpen(false)}
                    className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-slate-200 text-slate-500 cursor-pointer"
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              </div>

              {/* List items - scrollable, max 60% viewport height */}
              <div
                className="overflow-y-auto divide-y divide-slate-100 hide-scrollbar"
                style={{ maxHeight: 'min(300px, 60vh)' }}
              >
                {myNotifications.length > 0 ? (
                  myNotifications.map(item => (
                    <div
                      key={item.id}
                      onClick={() => handleMarkSingleAsRead(item.id)}
                      className={`p-3.5 space-y-1 transition-all cursor-pointer hover:bg-slate-50 ${
                        item.read ? 'bg-white opacity-70' : 'bg-blue-50/15'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="text-xs font-black text-slate-800 leading-tight flex-1 break-words">{item.title}</div>
                        {!item.read && <span className="w-2 h-2 bg-blue-600 rounded-full shrink-0 mt-1" />}
                      </div>
                      <div className="text-[10px] text-slate-600 leading-relaxed break-words">{item.message}</div>
                      <div className="text-[8px] text-slate-400 font-bold font-mono">
                        {new Date(item.timestamp).toLocaleDateString()} · {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-slate-400 text-[10px] font-semibold space-y-2 flex flex-col items-center">
                    <Icon name="notifications_off" size={24} className="text-slate-300" />
                    <span>{t('All caught up!', 'कोई नई सूचना नहीं है!')}</span>
                  </div>
                )}
              </div>

              {/* Footer controls */}
              {myNotifications.length > 0 && (
                <div className="p-2 border-t border-slate-150 bg-slate-50 flex justify-center">
                  <button
                    onClick={handleClearAll}
                    className="w-full text-center text-[10px] font-bold text-rose-600 py-1.5 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors"
                  >
                    {t('Clear All', 'सभी हटाएं')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
