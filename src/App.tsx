import React, { useState, useEffect, useMemo, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// ==========================================
// Firebase Initialization
// ==========================================
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};
const isFirebaseEnabled = Object.keys(firebaseConfig).every(k => !!firebaseConfig[k as keyof typeof firebaseConfig]);
const app = isFirebaseEnabled ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const appId = 'eduplanner-main';

// ==========================================
// Local Storage Helper
// ==========================================
const saveToLocal = (key: string, data: any) => {
  try { localStorage.setItem(`eduplanner_${key}`, JSON.stringify(data)); } catch (e) {}
};
const loadFromLocal = (key: string, fallback: any) => {
  try {
    const saved = localStorage.getItem(`eduplanner_${key}`);
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return fallback;
};

// ==========================================
// 1. Data Models (TypeScript Interfaces)
// ==========================================
export interface Lesson { id: string; order: number; title: string; memo: string; }
export interface WeeklySlot { dayOfWeek: number; period: number; }
export type ClassColor = 'blue' | 'green' | 'purple' | 'rose' | 'amber' | 'cyan';
export interface ClassSchedule { classId: string; className: string; startDate: string; color: ClassColor; weeklySlots: WeeklySlot[]; classScore?: number; groupScores?: number[]; }
export interface Holiday { id?: string; date: string; title: string; }
export interface ClassEvent { id: string; classId: string; date: string; period: number; title: string; type: 'exception' | 'extra'; }
export interface ClassRecord { id: string; classId: string; date: string; content: string; }
export interface UserProfile { name: string; subject: string; }
export interface Task { id: string; title: string; date?: string; completed: boolean; }

export interface ScheduledItem {
  date: string; period: number; type: 'lesson' | 'event';
  lesson?: Lesson; event?: ClassEvent; classId: string;
}

// ==========================================
// 2. Utility Functions
// ==========================================
const dateUtils = {
  formatDate: (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },
  parseDate: (dateStr: string): Date => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  },
  getStartOfWeek: (dateStr: string): Date => {
    const date = dateUtils.parseDate(dateStr);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(date.setDate(diff));
  },
  addDays: (date: Date, days: number): Date => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  },
  getDDay: (dateStr: string): number => {
    const target = dateUtils.parseDate(dateStr);
    const today = dateUtils.parseDate(dateUtils.formatDate(new Date()));
    const diffTime = target.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
};

const COLOR_MAP: Record<ClassColor, { bg: string; text: string; border: string; hover: string; leftBorder: string; ring: string }> = {
  blue:   { bg: 'bg-blue-50 dark:bg-blue-900/20',   text: 'text-blue-700 dark:text-blue-300',   border: 'border-blue-200 dark:border-blue-800/60',   hover: 'hover:bg-blue-100 dark:hover:bg-blue-900/40 hover:border-blue-400 dark:hover:border-blue-500', leftBorder: 'border-l-blue-500 dark:border-l-blue-400', ring: 'focus-visible:ring-blue-500' },
  green:  { bg: 'bg-green-50 dark:bg-green-900/20',  text: 'text-green-700 dark:text-green-300',  border: 'border-green-200 dark:border-green-800/60',  hover: 'hover:bg-green-100 dark:hover:bg-green-900/40 hover:border-green-400 dark:hover:border-green-500', leftBorder: 'border-l-green-500 dark:border-l-green-400', ring: 'focus-visible:ring-green-500' },
  purple: { bg: 'bg-purple-50 dark:bg-purple-900/20', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-200 dark:border-purple-800/60', hover: 'hover:bg-purple-100 dark:hover:bg-purple-900/40 hover:border-purple-400 dark:hover:border-purple-500', leftBorder: 'border-l-purple-500 dark:border-l-purple-400', ring: 'focus-visible:ring-purple-500' },
  rose:   { bg: 'bg-rose-50 dark:bg-rose-900/20',   text: 'text-rose-700 dark:text-rose-300',   border: 'border-rose-200 dark:border-rose-800/60',   hover: 'hover:bg-rose-100 dark:hover:bg-rose-900/40 hover:border-rose-400 dark:hover:border-rose-500', leftBorder: 'border-l-rose-500 dark:border-l-rose-400', ring: 'focus-visible:ring-rose-500' },
  amber:  { bg: 'bg-amber-50 dark:bg-amber-900/20',  text: 'text-amber-700 dark:text-amber-300',  border: 'border-amber-200 dark:border-amber-800/60',  hover: 'hover:bg-amber-100 dark:hover:bg-amber-900/40 hover:border-amber-400 dark:hover:border-amber-500', leftBorder: 'border-l-amber-500 dark:border-l-amber-400', ring: 'focus-visible:ring-amber-500' },
  cyan:   { bg: 'bg-cyan-50 dark:bg-cyan-900/20',   text: 'text-cyan-700 dark:text-cyan-300',   border: 'border-cyan-200 dark:border-cyan-800/60',   hover: 'hover:bg-cyan-100 dark:hover:bg-cyan-900/40 hover:border-cyan-400 dark:hover:border-cyan-500', leftBorder: 'border-l-cyan-500 dark:border-l-cyan-400', ring: 'focus-visible:ring-cyan-500' },
};

function generateClassLessonSchedule(
  lessons: Lesson[],
  schedule: ClassSchedule,
  holidays: Holiday[],
  events: ClassEvent[],
  viewEndDateStr: string
): ScheduledItem[] {
  const sortedLessons = [...lessons].sort((a, b) => a.order - b.order);
  const holidaySet = new Set(holidays.map(h => h.date));

  const classEvents = events.filter(e => e.classId === schedule.classId);
  const eventMap = new Map<string, ClassEvent>();
  classEvents.forEach(e => eventMap.set(`${e.date}-${e.period}`, e));

  const exceptionKeys = new Set(
    classEvents.filter(e => e.type === 'exception').map(e => `${e.date}-${e.period}`)
  );

  const scheduledItems: ScheduledItem[] = [];
  let currentDate = dateUtils.parseDate(schedule.startDate);
  const endLimitDate = dateUtils.addDays(dateUtils.parseDate(viewEndDateStr), 30);
  let lessonIndex = 0;

  while (lessonIndex < sortedLessons.length && currentDate <= endLimitDate) {
    const dateStr = dateUtils.formatDate(currentDate);
    const dayOfWeek = currentDate.getDay();

    if (dayOfWeek >= 1 && dayOfWeek <= 5 && !holidaySet.has(dateStr)) {
      const baseSlots = schedule.weeklySlots
        .filter(s => s.dayOfWeek === dayOfWeek)
        .map(s => s.period);

      const extraEventsToday = classEvents.filter(
        e => e.date === dateStr && e.type === 'extra'
      );
      const extraSlots = extraEventsToday.map(e => e.period);

      const allPeriodsToday = Array.from(new Set([...baseSlots, ...extraSlots])).sort(
        (a, b) => a - b
      );

      for (const period of allPeriodsToday) {
        if (lessonIndex >= sortedLessons.length) break;
        const eventKey = `${dateStr}-${period}`;
        const classEvent = eventMap.get(eventKey);

        if (classEvent) {
          if (classEvent.type === 'exception') {
            scheduledItems.push({ date: dateStr, period, type: 'event', event: classEvent, classId: schedule.classId });
          } else if (classEvent.type === 'extra') {
            scheduledItems.push({ date: dateStr, period, type: 'lesson', lesson: sortedLessons[lessonIndex], classId: schedule.classId });
            lessonIndex++;
          }
        } else if (baseSlots.includes(period) && !exceptionKeys.has(eventKey)) {
          scheduledItems.push({ date: dateStr, period, type: 'lesson', lesson: sortedLessons[lessonIndex], classId: schedule.classId });
          lessonIndex++;
        }
      }
    }
    currentDate = dateUtils.addDays(currentDate, 1);
  }
  return scheduledItems;
}

// ==========================================
// 3. Initial Mock Data
// ==========================================
const MOCK_LESSONS: Lesson[] = [
  { id: '1', order: 1, title: '오리엔테이션', memo: '수업 규칙 안내 및 모둠 편성' },
  { id: '2', order: 2, title: '1단원: 다항식의 연산', memo: '기본 공식 암기 확인' },
];
const MOCK_SCHEDULES: ClassSchedule[] = [
  { classId: 'c1', className: '2학년 6반', startDate: '2026-05-04', color: 'blue',  weeklySlots: [{ dayOfWeek: 1, period: 2 }, { dayOfWeek: 3, period: 5 }] },
  { classId: 'c2', className: '2학년 5반', startDate: '2026-05-04', color: 'green', weeklySlots: [{ dayOfWeek: 2, period: 1 }, { dayOfWeek: 5, period: 4 }] },
];
const MOCK_HOLIDAYS: Holiday[] = [{ id: 'h-1', date: '2026-05-05', title: '어린이날' }];
const MOCK_TASKS: Task[] = [{ id: 't-1', title: '중간고사 출제', date: '2026-05-15', completed: false }];
const DEFAULT_PROFILE: UserProfile = { name: 'CE 선생님', subject: '수학 담당 (다중 학급)' };
const DEFAULT_MENU_ORDER = ['manage', 'tasks', 'plan', 'records', 'settings'];

// ==========================================
// 4. Context & Global State
// ==========================================
interface AppContextType {
  lessons: Lesson[];       updateLessons: (data: Lesson[]) => Promise<void>;
  classes: ClassSchedule[]; updateClasses: (data: ClassSchedule[]) => Promise<void>;
  holidays: Holiday[];     updateHolidays: (data: Holiday[]) => Promise<void>;
  events: ClassEvent[];    updateEvents: (data: ClassEvent[]) => Promise<void>;
  records: ClassRecord[];  updateRecords: (data: ClassRecord[]) => Promise<void>;
  tasks: Task[];           updateTasks: (data: Task[]) => Promise<void>;
  profile: UserProfile;    updateProfile: (data: UserProfile) => Promise<void>;
  menuOrder: string[];     updateMenuOrder: (data: string[]) => Promise<void>;
  goToPage: (page: 'manage' | 'plan' | 'settings' | 'records' | 'tasks', params?: any) => void;
  pageParams: any;
}
const AppContext = createContext<AppContextType | null>(null);

// ==========================================
// Toast & Modal Components
// ==========================================
interface ToastMsg { id: number; message: string; type: 'error' | 'success'; }
const ToastContext = createContext<(msg: string, type?: 'error' | 'success') => void>(() => {});

function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const addToast = (message: string, type: 'error' | 'success' = 'error') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };
  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map(t => (
          <div key={t.id} className={`px-4 py-3 rounded-xl shadow-lg text-sm font-bold text-white animate-in slide-in-from-bottom-2 ${t.type === 'error' ? 'bg-rose-600 dark:bg-rose-500' : 'bg-green-600 dark:bg-green-500'}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

interface ConfirmModalProps { message: string; onConfirm: () => void; onCancel: () => void; }
function ConfirmModal({ message, onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-gray-900/40 dark:bg-gray-900/70 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 max-w-xs w-full mx-4 animate-in zoom-in-95 border border-slate-100 dark:border-slate-700">
        <p className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-6 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-xl text-sm font-bold hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400">취소</button>
          <button onClick={onConfirm} className="px-4 py-2 bg-rose-600 dark:bg-rose-500 text-white rounded-xl text-sm font-bold hover:bg-rose-700 dark:hover:bg-rose-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800">삭제</button>
        </div>
      </div>
    </div>
  );
}

// --- Icons (Inline SVGs to prevent dependency issues) ---
const IconCalendar   = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
const IconSettings   = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
const IconBook       = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>;
const IconNotebook   = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
const IconChecklist  = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>;

// ==========================================
// LessonPlanPage
// ==========================================
function LessonPlanPage() {
  const { lessons, updateLessons } = useContext(AppContext)!;
  const addToast = useContext(ToastContext);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editData, setEditData] = useState<Lesson[]>([]);

  useEffect(() => { setEditData(lessons); }, [lessons]);

  const handleAdd = () => {
    const base = isEditMode ? editData : lessons;
    const newOrder = base.length > 0 ? Math.max(...base.map(l => l.order)) + 1 : 1;
    const newLesson: Lesson = { id: `l-${Date.now()}`, order: newOrder, title: '', memo: '' };
    setEditData([...base, newLesson]);
    setIsEditMode(true);
  };

  const handleSaveAll = async () => {
    try {
      await updateLessons(editData);
      setIsEditMode(false);
      addToast('저장되었습니다.', 'success');
    } catch {
      addToast('저장에 실패했습니다. 다시 시도해주세요.');
    }
  };

  const handleCancelEdit = () => { setEditData(lessons); setIsEditMode(false); };

  const deleteLesson = async (id: string) => {
    const base = isEditMode ? editData : lessons;
    const newData = base.filter(l => l.id !== id).map((l, i) => ({ ...l, order: i + 1 }));
    if (isEditMode) { setEditData(newData); } else {
      try { await updateLessons(newData); addToast('삭제되었습니다.', 'success'); } catch { addToast('삭제에 실패했습니다.'); }
    }
  };

  const moveLesson = async (index: number, direction: -1 | 1) => {
    const base = isEditMode ? editData : lessons;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= base.length) return;
    const newData = base.map((l, i) => {
      if (i === index) return { ...base[targetIndex], order: index + 1 };
      if (i === targetIndex) return { ...base[index], order: targetIndex + 1 };
      return l;
    });
    if (isEditMode) { setEditData(newData); } else {
      try { await updateLessons(newData); } catch { addToast('순서 변경에 실패했습니다.'); }
    }
  };

  const handleEditChange = (id: string, field: 'title' | 'memo', value: string) => {
    setEditData(editData.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  const displayData = isEditMode ? editData : lessons;

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500 bg-slate-50/30 dark:bg-slate-900/50 relative">
      <header className="p-6 md:p-8 shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center bg-white dark:bg-slate-800 border-b border-gray-100 dark:border-slate-700 z-10 sticky top-0 shadow-sm">
        <div className="mb-4 md:mb-0">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">수업 계획서</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">차시별 제목과 간략한 비고를 작성하여 전체 진도를 설계합니다.</p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          {isEditMode ? (
            <>
              <button onClick={handleCancelEdit} className="flex-1 md:flex-none bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400">취소</button>
              <button onClick={handleSaveAll} className="flex-1 md:flex-none bg-indigo-600 dark:bg-indigo-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-700 dark:hover:bg-indigo-600 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800">일괄 저장</button>
            </>
          ) : (
            <button onClick={() => { setEditData(lessons); setIsEditMode(true); }} className="flex-1 md:flex-none bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-200 px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">일괄 수정</button>
          )}
          <button onClick={handleAdd} className="flex-1 md:flex-none bg-slate-800 dark:bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-slate-700 dark:hover:bg-indigo-500 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800">+ 차시 추가</button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[600px]">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 text-sm border-b border-slate-100 dark:border-slate-700">
                <th className="px-6 py-4 font-semibold w-24">차시</th>
                <th className="px-6 py-4 font-semibold w-1/3">수업 제목</th>
                <th className="px-6 py-4 font-semibold">비고 (교사용 메모)</th>
                <th className="px-6 py-4 font-semibold w-32 text-center">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
              {displayData.map((lesson, index) => (
                <tr key={lesson.id} className={`hover:bg-slate-50/50 dark:hover:bg-slate-700/30 transition-colors group ${isEditMode ? 'bg-indigo-50/10 dark:bg-indigo-900/10' : ''}`}>
                  <td className="px-6 py-5 font-black text-indigo-600 dark:text-indigo-400 whitespace-nowrap">{lesson.order}차시</td>
                  {isEditMode ? (
                    <>
                      <td className="px-6 py-3"><input type="text" value={lesson.title} onChange={e => handleEditChange(lesson.id, 'title', e.target.value)} className="w-full border border-indigo-200 dark:border-indigo-800/60 p-2.5 rounded-lg text-sm font-bold bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm" placeholder="수업 제목 입력" /></td>
                      <td className="px-6 py-3"><input type="text" value={lesson.memo} onChange={e => handleEditChange(lesson.id, 'memo', e.target.value)} className="w-full border border-indigo-200 dark:border-indigo-800/60 p-2.5 rounded-lg text-sm bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm" placeholder="교사용 메모 입력" /></td>
                      <td className="px-6 py-3 text-center">
                        <div className="flex justify-center items-center gap-1">
                          <button aria-label="위로 이동" onClick={() => moveLesson(index, -1)} disabled={index === 0} className="w-7 h-7 flex items-center justify-center text-gray-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-md transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">▲</button>
                          <button aria-label="아래로 이동" onClick={() => moveLesson(index, 1)} disabled={index === displayData.length - 1} className="w-7 h-7 flex items-center justify-center text-gray-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-md transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">▼</button>
                          <button aria-label="수업 삭제" onClick={() => deleteLesson(lesson.id)} className="w-7 h-7 flex items-center justify-center text-gray-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-md transition-colors font-bold ml-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500">✕</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-6 py-5 font-bold text-gray-800 dark:text-gray-200">{lesson.title || <span className="text-gray-300 dark:text-slate-600 font-normal italic">제목 없음</span>}</td>
                      <td className="px-6 py-5 text-gray-600 dark:text-slate-400 text-sm whitespace-pre-wrap">{lesson.memo || '-'}</td>
                      <td className="px-6 py-5 text-center">
                        <div className="flex justify-center items-center gap-1 opacity-10 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                          <button aria-label="위로 이동" onClick={() => moveLesson(index, -1)} disabled={index === 0} className="w-7 h-7 flex items-center justify-center text-gray-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-md disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">▲</button>
                          <button aria-label="아래로 이동" onClick={() => moveLesson(index, 1)} disabled={index === displayData.length - 1} className="w-7 h-7 flex items-center justify-center text-gray-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-md disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">▼</button>
                          <button aria-label="수업 삭제" onClick={() => deleteLesson(lesson.id)} className="w-7 h-7 flex items-center justify-center text-gray-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-md transition-colors font-bold ml-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500">✕</button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {displayData.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-gray-400 dark:text-slate-500 font-medium">등록된 수업 계획이 없습니다. 차시를 추가해보세요.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// ScoreCard
// ==========================================
function ScoreCard({ title, score, onUpdate, colorStyle }: { title: string; score: number; onUpdate: (amount: number) => void; colorStyle: any }) {
  const [customInput, setCustomInput] = useState<number | ''>('');
  const handleApply = () => {
    if (customInput === '' || isNaN(Number(customInput))) return;
    onUpdate(Number(customInput));
    setCustomInput('');
  };

  return (
    <div className="bg-white/80 dark:bg-slate-800/80 p-4 rounded-2xl shadow-sm border border-white dark:border-slate-700 min-w-[140px] flex-1 flex flex-col backdrop-blur-sm">
      <div className={`text-xs font-black ${colorStyle.text} opacity-80 mb-1`}>{title}</div>
      <div className="text-2xl font-black text-gray-800 dark:text-white mb-3">{score}점</div>
      <div className="flex gap-1.5 mb-2">
        <button aria-label={`${title} 1점 추가`} onClick={() => onUpdate(1)} className="flex-1 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-200 rounded-lg text-sm font-black py-1.5 transition-colors shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">+1</button>
        <button aria-label={`${title} 1점 차감`} onClick={() => onUpdate(-1)} className="flex-1 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-200 rounded-lg text-sm font-black py-1.5 transition-colors shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">-1</button>
      </div>
      <div className="flex gap-1.5 mt-auto">
        <input type="number" aria-label={`${title} 사용자 입력 점수`} value={customInput} onChange={e => setCustomInput(e.target.value === '' ? '' : Number(e.target.value))} className="w-full text-xs border border-gray-200 dark:border-slate-600 p-1.5 rounded-lg text-center font-bold outline-none focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 text-gray-900 dark:text-white" placeholder="점수" />
        <button aria-label={`${title} 점수 반영`} onClick={handleApply} className="bg-slate-800 dark:bg-indigo-600 text-white text-[10px] px-3 rounded-lg font-bold hover:bg-slate-700 dark:hover:bg-indigo-500 whitespace-nowrap shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">반영</button>
      </div>
    </div>
  );
}

// ==========================================
// RecordsPage
// ==========================================
function RecordsPage() {
  const { classes, updateClasses, records, updateRecords, pageParams } = useContext(AppContext)!;
  const addToast = useContext(ToastContext);

  const [selectedClassId, setSelectedClassId] = useState<string>(pageParams?.classId || (classes[0]?.classId || ''));
  const [newDate, setNewDate] = useState(dateUtils.formatDate(new Date()));
  const [newContent, setNewContent] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [exportStartDate, setExportStartDate] = useState(dateUtils.formatDate(dateUtils.addDays(new Date(), -30)));
  const [exportEndDate, setExportEndDate] = useState(dateUtils.formatDate(new Date()));

  useEffect(() => { if (pageParams?.classId) setSelectedClassId(pageParams.classId); }, [pageParams]);

  const activeClass = classes.find(c => c.classId === selectedClassId);
  const classRecords = records.filter(r => r.classId === selectedClassId).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const handleSave = async () => {
    if (!newContent.trim() || !selectedClassId) return;
    const newRecord: ClassRecord = { id: `rec-${Date.now()}`, classId: selectedClassId, date: newDate, content: newContent };
    try { await updateRecords([...records, newRecord]); setNewContent(''); addToast('기록이 저장되었습니다.', 'success'); } catch { addToast('저장에 실패했습니다.'); }
  };

  const handleDelete = async (id: string) => {
    try { await updateRecords(records.filter(r => r.id !== id)); addToast('삭제되었습니다.', 'success'); } catch { addToast('삭제에 실패했습니다.'); } finally { setConfirmDeleteId(null); }
  };

  const handleUpdateScore = async (type: 'class' | 'group', amount: number, index?: number) => {
    if (!activeClass) return;
    const updatedClasses = classes.map(c => {
      if (c.classId !== activeClass.classId) return c;
      const currentClassScore = c.classScore ?? 0;
      const currentGroupScores = c.groupScores ?? [0, 0, 0, 0, 0];
      if (type === 'class') return { ...c, classScore: currentClassScore + amount };
      if (type === 'group' && index !== undefined) {
        const newGroups = [...currentGroupScores];
        newGroups[index] = newGroups[index] + amount;
        return { ...c, groupScores: newGroups };
      }
      return c;
    });
    try { await updateClasses(updatedClasses); } catch { addToast('점수 저장에 실패했습니다.'); }
  };

  const handleExportCSV = () => {
    if (!activeClass) return;
    const filteredRecords = classRecords.filter(r => r.date >= exportStartDate && r.date <= exportEndDate);
    if (filteredRecords.length === 0) { addToast('해당 기간에 기록이 없습니다.'); return; }
    let csvContent = '\uFEFF날짜,내용\n';
    filteredRecords.forEach(r => { const escaped = r.content.replace(/"/g, '""'); csvContent += `${r.date},"${escaped}"\n`; });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeClass.className}_학급기록_${exportStartDate}_${exportEndDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const bgStyle = activeClass ? COLOR_MAP[activeClass.color].bg : 'bg-slate-50 dark:bg-slate-900/50';

  return (
    <div className={`p-4 md:p-8 h-full flex flex-col animate-in fade-in duration-500 overflow-y-auto md:overflow-hidden transition-colors ${bgStyle}`}>
      {confirmDeleteId && <ConfirmModal message="정말 이 기록을 삭제하시겠습니까?" onConfirm={() => handleDelete(confirmDeleteId)} onCancel={() => setConfirmDeleteId(null)} />}

      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-4 md:mb-6 shrink-0 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">학급 기록장</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1 md:mt-2 text-sm">선택한 학급의 누적 점수와 특이사항을 기록합니다.</p>
        </div>
        <select aria-label="기록할 학급 선택" value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)} className="w-full sm:w-auto text-sm bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm border border-gray-300 dark:border-slate-600 text-gray-800 dark:text-white px-4 py-2.5 rounded-xl font-bold shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="" disabled>학급을 선택하세요</option>
          {classes.map(c => <option key={c.classId} value={c.classId}>{c.className}</option>)}
        </select>
      </header>

      {activeClass ? (
        <div className="flex-1 flex flex-col min-h-0 gap-4 md:gap-6 pb-4 md:pb-0">
          <div className="flex gap-3 md:gap-4 overflow-x-auto pb-2 shrink-0 scrollbar-hide snap-x">
            <ScoreCard title="🏅 학급 전체 점수" score={activeClass.classScore ?? 0} onUpdate={amt => handleUpdateScore('class', amt)} colorStyle={COLOR_MAP[activeClass.color]} />
            {Array.from({ length: 5 }).map((_, i) => (
              <ScoreCard key={i} title={`👥 ${i + 1}모둠 점수`} score={(activeClass.groupScores ?? [0, 0, 0, 0, 0])[i]} onUpdate={amt => handleUpdateScore('group', amt, i)} colorStyle={COLOR_MAP[activeClass.color]} />
            ))}
          </div>

          <div className="flex-1 flex flex-col md:flex-row gap-4 md:gap-6 min-h-0">
            <div className="w-full md:w-1/3 flex flex-col gap-4 shrink-0 order-1 md:h-full">
              <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm p-5 md:p-6 rounded-2xl shadow-sm border border-white dark:border-slate-700 h-full flex flex-col">
                <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2"><span className={`w-3 h-3 rounded-full ${COLOR_MAP[activeClass.color].bg} border border-gray-300 dark:border-slate-600`}></span>{activeClass.className} 새 기록 작성</h3>
                <div className="space-y-4 flex-1 flex flex-col">
                  <div><label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">날짜</label><input type="date" aria-label="기록 날짜" value={newDate} onChange={e => setNewDate(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-2.5 rounded-xl text-sm font-bold bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" /></div>
                  <div className="flex-1 flex flex-col"><label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">내용</label><textarea aria-label="기록 내용" value={newContent} onChange={e => setNewContent(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-3 rounded-xl text-sm flex-1 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 text-gray-900 dark:text-white min-h-[100px] md:min-h-0" placeholder="이 학급의 오늘 수업 분위기, 특이사항 등을 남겨주세요." /></div>
                  <button onClick={handleSave} className="w-full py-3 bg-slate-800 dark:bg-indigo-600 hover:bg-slate-900 dark:hover:bg-indigo-500 text-white font-bold rounded-xl shadow-sm transition-colors mt-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 dark:focus-visible:ring-indigo-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800">기록 저장하기</button>
                </div>
              </div>
            </div>

            <div className="flex-1 flex flex-col bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-2xl shadow-sm border border-white dark:border-slate-700 p-5 md:p-6 overflow-hidden min-h-[400px] md:min-h-0 order-2">
              <div className="flex flex-col xl:flex-row justify-between items-start xl:items-end mb-4 pb-4 border-b border-gray-200 dark:border-slate-700 gap-3">
                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2"><IconNotebook /> 기록 내역</h3>
                <div className="flex items-center gap-2 bg-white/80 dark:bg-slate-900/80 p-1.5 rounded-xl border border-gray-200 dark:border-slate-600 shadow-sm focus-within:ring-2 focus-within:ring-indigo-500 overflow-x-auto max-w-full scrollbar-hide">
                  <input type="date" aria-label="내보내기 시작 날짜" value={exportStartDate} onChange={e => setExportStartDate(e.target.value)} className="text-xs font-bold bg-transparent border-none outline-none px-2 text-gray-600 dark:text-gray-300 shrink-0" />
                  <span className="text-gray-400 dark:text-gray-500 text-xs font-bold">~</span>
                  <input type="date" aria-label="내보내기 종료 날짜" value={exportEndDate} onChange={e => setExportEndDate(e.target.value)} className="text-xs font-bold bg-transparent border-none outline-none px-2 text-gray-600 dark:text-gray-300 shrink-0" />
                  <button onClick={handleExportCSV} className="bg-green-600 dark:bg-green-500 hover:bg-green-700 dark:hover:bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-colors ml-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 shrink-0">Excel 저장</button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto pr-2 space-y-4">
                {classRecords.length > 0 ? classRecords.map(rec => (
                  <div key={rec.id} className="bg-white dark:bg-slate-900/50 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700/50 group relative">
                    <div className="flex justify-between items-start mb-3">
                      <div className="px-3 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-black tracking-wider">{rec.date}</div>
                      <button aria-label="기록 삭제" onClick={() => setConfirmDeleteId(rec.id)} className="text-rose-500 text-xs font-bold opacity-0 md:opacity-0 group-hover:opacity-100 transition-opacity hover:underline focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 rounded">삭제</button>
                    </div>
                    <div className="text-slate-700 dark:text-slate-200 text-sm whitespace-pre-wrap leading-relaxed font-medium">{rec.content}</div>
                  </div>
                )) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500"><IconNotebook /><p className="mt-2 font-medium text-sm">등록된 기록이 없습니다.</p></div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500 font-medium">학급을 선택해주세요.</div>
      )}
    </div>
  );
}

// ==========================================
// TasksPage
// ==========================================
function TasksPage() {
  const { tasks, updateTasks } = useContext(AppContext)!;
  const addToast = useContext(ToastContext);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState(dateUtils.formatDate(new Date()));
  const [hasDeadline, setHasDeadline] = useState(true);

  const sortedTasks = [...tasks].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  const handleAdd = async () => {
    if (!newTitle.trim() || (hasDeadline && !newDate)) { addToast('업무 내용과 날짜를 확인해주세요.'); return; }
    const newTask: Task = { id: `t-${Date.now()}`, title: newTitle, date: hasDeadline ? newDate : undefined, completed: false };
    try { await updateTasks([...tasks, newTask]); setNewTitle(''); addToast('업무가 등록되었습니다.', 'success'); } catch { addToast('등록에 실패했습니다.'); }
  };

  const toggleTask = async (id: string) => { try { await updateTasks(tasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t)); } catch { addToast('상태 변경에 실패했습니다.'); } };
  const deleteTask = async (id: string) => { try { await updateTasks(tasks.filter(t => t.id !== id)); addToast('삭제되었습니다.', 'success'); } catch { addToast('삭제에 실패했습니다.'); } };

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500 bg-slate-50/30 dark:bg-slate-900/50 relative">
      <header className="p-6 md:p-8 shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center bg-white dark:bg-slate-800 border-b border-gray-100 dark:border-slate-700 z-10 sticky top-0 shadow-sm">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">업무 체크리스트</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">마감일(D-Day)을 설정하면 주간 진도표 화면 상단에 자동으로 표시됩니다.</p>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-6 md:p-8 flex flex-col md:flex-row gap-6 items-start">
        <div className="w-full md:w-1/3 bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 shrink-0 sticky top-6">
          <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-indigo-500"></span>새 업무 등록</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400">마감일 (D-Day)</label>
              <label className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 cursor-pointer">
                <input type="checkbox" checked={hasDeadline} onChange={() => setHasDeadline(!hasDeadline)} className="accent-indigo-600 focus:ring-indigo-500 rounded" />
                마감일 지정
              </label>
            </div>
            {hasDeadline && <input type="date" aria-label="업무 마감일" value={newDate} onChange={e => setNewDate(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-2.5 rounded-xl text-sm font-bold bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all" />}
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">업무 내용</label>
              <input type="text" aria-label="업무 내용" value={newTitle} onChange={e => setNewTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()} className="w-full border border-gray-300 dark:border-slate-600 p-2.5 rounded-xl text-sm bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="예: 수행평가 문제 출제" />
            </div>
            <button onClick={handleAdd} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800">추가하기</button>
          </div>
        </div>
        <div className="w-full md:flex-1 space-y-3">
          {sortedTasks.length > 0 ? sortedTasks.map(task => {
            const isOverdue = !task.completed && task.date && dateUtils.getDDay(task.date) < 0;
            const dday = task.date ? dateUtils.getDDay(task.date) : null;
            const ddayText = dday === null ? '' : dday === 0 ? 'D-Day' : dday > 0 ? `D-${dday}` : `D+${Math.abs(dday)}`;

            return (
              <div key={task.id} className={`flex items-center justify-between p-4 rounded-xl border shadow-sm transition-all group ${task.completed ? 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 opacity-60' : isOverdue ? 'bg-rose-50/50 dark:bg-rose-900/10 border-rose-200 dark:border-rose-800/50' : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700'}`}>
                <div className="flex items-center gap-4 overflow-hidden">
                  <button aria-label="완료 토글" onClick={() => toggleTask(task.id)} className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${task.completed ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-gray-300 dark:border-gray-600 text-transparent hover:border-indigo-400'}`}>✓</button>
                  <div className="flex flex-col min-w-0">
                    <span className={`text-sm font-bold truncate ${task.completed ? 'line-through text-slate-500 dark:text-slate-400' : 'text-slate-800 dark:text-white'}`}>{task.title}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      {task.date ? (
                        <>
                          <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${task.completed ? 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400' : isOverdue ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300' : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'}`}>{task.date}</span>
                          {!task.completed && <span className={`text-[10px] font-bold ${isOverdue ? 'text-rose-600 dark:text-rose-400' : 'text-indigo-600 dark:text-indigo-400'}`}>{ddayText}</span>}
                        </>
                      ) : (
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">마감일 없음</span>
                      )}
                    </div>
                  </div>
                </div>
                <button aria-label="업무 삭제" onClick={() => deleteTask(task.id)} className="shrink-0 text-gray-400 hover:text-rose-500 dark:hover:text-rose-400 p-2 opacity-0 md:opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 rounded-lg">✕</button>
              </div>
            );
          }) : (
            <div className="flex flex-col items-center justify-center p-12 bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-gray-300 dark:border-slate-700 text-slate-400 dark:text-slate-500"><IconChecklist /><p className="mt-2 text-sm font-medium">등록된 업무가 없습니다.</p></div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==========================================
// ManagePage
// ==========================================
function ManagePage() {
  const { lessons, classes, holidays, events, tasks, goToPage, updateEvents } = useContext(AppContext)!;
  const addToast = useContext(ToastContext);
  const [selectedClassId, setSelectedClassId] = useState<string>('all');
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(dateUtils.getStartOfWeek(dateUtils.formatDate(new Date())));
  const [selectedItem, setSelectedItem] = useState<{ item: ScheduledItem; classInfo: ClassSchedule } | null>(null);

  const [isModifying, setIsModifying] = useState(false);
  const [modifyType, setModifyType] = useState<'move' | 'cancel'>('move');
  const [targetDate, setTargetDate] = useState('');
  const [targetPeriod, setTargetPeriod] = useState<number>(1);

  const daysInWeek = Array.from({ length: 5 }, (_, i) => dateUtils.addDays(currentWeekStart, i));
  const weekEndDateStr = dateUtils.formatDate(dateUtils.addDays(currentWeekStart, 4));
  const holidayMap = new Map(holidays.map(h => [h.date, h.title]));

  const schedulesToRender = useMemo(() => {
    const targetClasses = selectedClassId === 'all' ? classes : classes.filter(c => c.classId === selectedClassId);
    const allItems: { item: ScheduledItem; classInfo: ClassSchedule }[] = [];
    targetClasses.forEach(cls => {
      const clsSchedule = generateClassLessonSchedule(lessons, cls, holidays, events, weekEndDateStr);
      clsSchedule.forEach(item => allItems.push({ item, classInfo: cls }));
    });
    return allItems;
  }, [lessons, classes, holidays, events, weekEndDateStr, selectedClassId]);

  const scheduleMap = new Map<string, { item: ScheduledItem; classInfo: ClassSchedule }[]>();
  schedulesToRender.forEach(data => {
    const key = `${data.item.date}-${data.item.period}`;
    if (!scheduleMap.has(key)) scheduleMap.set(key, []);
    scheduleMap.get(key)!.push(data);
  });

  const periods = [1, 2, 3, 4, 5, 6, 7];
  const dayNames = ['월', '화', '수', '목', '금'];

  const handleModifySchedule = async () => {
    if (!selectedItem || selectedItem.item.type !== 'lesson') return;
    const { date, period, classId } = selectedItem.item;
    const newEvents = [...events];
    if (modifyType === 'cancel' || modifyType === 'move') { newEvents.push({ id: `e-${Date.now()}-1`, classId, date, period, title: modifyType === 'move' ? '시간표 변경 (이동)' : '휴강', type: 'exception' }); }
    if (modifyType === 'move') {
      if (!targetDate) { addToast('보강 날짜를 선택해주세요.'); return; }
      newEvents.push({ id: `e-${Date.now()}-2`, classId, date: targetDate, period: targetPeriod, title: '시간표 변경 (보강)', type: 'extra' });
    }
    try { await updateEvents(newEvents); setSelectedItem(null); setIsModifying(false); addToast('일정 변경이 적용되었습니다.', 'success'); } catch { addToast('일정 변경에 실패했습니다.'); }
  };

  const handleDeleteEvent = async (eventId: string) => {
    try { await updateEvents(events.filter(e => e.id !== eventId)); setSelectedItem(null); addToast('변경 사항이 취소되었습니다.', 'success'); } catch { addToast('취소 처리에 실패했습니다.'); }
  };

  return (
    <div className="p-6 h-full flex flex-col animate-in fade-in duration-500 bg-slate-50/50 dark:bg-slate-900/50">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight shrink-0">주간 진도표</h1>
          <select aria-label="진도표 학급 선택" value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)} className="w-full md:w-auto text-sm bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-white px-3 py-1.5 rounded-lg font-bold shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="all">전체 학급 보기</option>
            {classes.map(c => <option key={c.classId} value={c.classId}>{c.className}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1 bg-white dark:bg-slate-800 p-1 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 text-sm w-full md:w-auto justify-between md:justify-start">
          <button aria-label="이전 주" onClick={() => setCurrentWeekStart(d => dateUtils.addDays(d, -7))} className="px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg font-bold text-slate-500 dark:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">이전</button>
          <span className="px-4 font-bold text-gray-700 dark:text-slate-200 min-w-[140px] text-center">{dateUtils.formatDate(daysInWeek[0])} ~ {dateUtils.formatDate(daysInWeek[4])}</span>
          <button aria-label="다음 주" onClick={() => setCurrentWeekStart(d => dateUtils.addDays(d, 7))} className="px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg font-bold text-slate-500 dark:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">다음</button>
        </div>
      </header>

      <div className="flex-1 bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-auto flex flex-col relative min-w-0">
        <div className="min-w-[600px]">
          <div className="grid grid-cols-[50px_repeat(5,minmax(0,1fr))] bg-slate-100/80 dark:bg-slate-800/80 backdrop-blur-sm border-b border-gray-200 dark:border-slate-700 sticky top-0 z-10 shadow-sm min-h-[70px]">
            <div className="p-2 flex items-center justify-center text-[10px] font-bold text-slate-400 dark:text-slate-500 border-r border-gray-200 dark:border-slate-700">교시</div>
            {daysInWeek.map((date, i) => {
              const dateStr = dateUtils.formatDate(date);
              const isHoliday = holidayMap.has(dateStr);
              const dayTasks = tasks.filter(t => t.date === dateStr && !t.completed);

              return (
                <div key={i} className={`p-2 flex flex-col items-center border-r border-gray-200 dark:border-slate-700 last:border-0 ${isHoliday ? 'bg-rose-50/80 dark:bg-rose-900/20' : ''}`}>
                  <div className="text-xs font-bold text-slate-500 dark:text-slate-400">{dayNames[i]}</div>
                  <div className={`text-lg font-black ${isHoliday ? 'text-rose-500' : 'text-slate-800 dark:text-slate-200'}`}>{date.getDate()}</div>
                  {isHoliday && <div className="text-[9px] font-bold text-rose-500 uppercase mt-0.5 text-center">{holidayMap.get(dateStr)}</div>}
                  <div className="mt-1 flex flex-col gap-0.5 w-full">
                    {dayTasks.map(t => (
                      <div key={t.id} title={t.title} className="text-[9px] font-bold text-indigo-700 dark:text-indigo-200 bg-indigo-100 dark:bg-indigo-900/50 px-1 py-0.5 rounded truncate border border-indigo-200 dark:border-indigo-700 w-full text-center">✓ {t.title}</div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="divide-y divide-gray-100 dark:divide-slate-700/50 bg-slate-50/30 dark:bg-slate-900/20">
            {periods.map(period => (
              <div key={period} className="grid grid-cols-[50px_repeat(5,minmax(0,1fr))] min-h-[100px]">
                <div className="flex items-center justify-center border-r border-gray-200 dark:border-slate-700 bg-slate-100/30 dark:bg-slate-800/30 font-black text-slate-300 dark:text-slate-600 text-xl">{period}</div>
                {daysInWeek.map((date) => {
                  const dateStr = dateUtils.formatDate(date);
                  const isHoliday = holidayMap.has(dateStr);
                  const cellItems = scheduleMap.get(`${dateStr}-${period}`) || [];
                  const isTargetSlot = selectedClassId !== 'all' && classes.find(c => c.classId === selectedClassId)?.weeklySlots.some(s => s.dayOfWeek === date.getDay() && s.period === period);

                  return (
                    <div key={dateStr} className={`p-1.5 border-r border-gray-200 dark:border-slate-700 last:border-0 ${isHoliday ? 'bg-slate-100/50 dark:bg-slate-800/50' : ''} flex flex-col gap-1.5`}>
                      {cellItems.length > 0 ? (
                        cellItems.map((data, idx) => {
                          const style = COLOR_MAP[data.classInfo.color];
                          const isSelected = selectedItem?.item.date === data.item.date && selectedItem?.item.period === data.item.period && selectedItem?.classInfo.classId === data.classInfo.classId;
                          
                          if (data.item.type === 'lesson') {
                            return (
                              <button key={idx} aria-label={`${data.classInfo.className} ${data.item.lesson?.title}`} onClick={() => { setSelectedItem(data); setIsModifying(false); }} className={`w-full text-left p-2 rounded-lg shadow-sm transition-all text-xs group focus:outline-none ${style.ring} focus-visible:ring-offset-1 ${style.bg} ${isSelected ? `border-l-[6px] ${style.leftBorder} border-y-transparent border-r-transparent shadow-md` : `border ${style.border} ${style.hover}`}`}>
                                <div className="flex justify-between items-start mb-1">
                                  <span className={`font-black ${style.text} opacity-80`}>{data.classInfo.className}</span>
                                  <span className="text-[9px] bg-white/60 dark:bg-black/20 px-1.5 py-0.5 rounded font-bold dark:text-white/80">{data.item.lesson?.order}차시</span>
                                </div>
                                <div className="font-bold text-gray-800 dark:text-gray-100 leading-snug truncate">{data.item.lesson?.title}</div>
                              </button>
                            );
                          } else {
                            return (
                              <button key={idx} aria-label={`${data.classInfo.className} 예외 일정: ${data.item.event?.title}`} onClick={() => { setSelectedItem(data); setIsModifying(false); }} className={`w-full text-left bg-orange-50/80 dark:bg-orange-900/30 p-2 rounded-lg text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-1 ${isSelected ? 'border-l-[6px] border-l-orange-500 border-y-transparent border-r-transparent shadow-md' : 'border border-orange-200 dark:border-orange-800/60 hover:bg-orange-100 dark:hover:bg-orange-900/50 hover:border-orange-400 dark:hover:border-orange-600'}`}>
                                <div className="flex justify-between items-start mb-1">
                                  <span className="font-black text-orange-700 dark:text-orange-400 opacity-80">{data.classInfo.className}</span>
                                  <span className="text-[9px] bg-orange-100 dark:bg-orange-900/50 px-1 py-0.5 rounded text-orange-600 dark:text-orange-300 font-bold">{data.item.event?.type === 'extra' ? '보강' : '예외'}</span>
                                </div>
                                <div className="font-bold text-gray-800 dark:text-gray-100 leading-snug truncate">{data.item.event?.title}</div>
                              </button>
                            );
                          }
                        })
                      ) : (
                        isTargetSlot && !isHoliday && (
                          <div className="w-full h-full border border-dashed border-gray-300 dark:border-slate-600 rounded-lg flex items-center justify-center opacity-50 min-h-[40px]"><span className="text-[10px] font-bold text-gray-400 dark:text-slate-500">빈 슬롯</span></div>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 dark:bg-gray-900/70 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-100 dark:border-slate-700">
            <div className={`p-6 ${COLOR_MAP[selectedItem.classInfo.color].bg} border-b ${COLOR_MAP[selectedItem.classInfo.color].border}`}>
              <div className="flex justify-between items-start mb-2">
                <span className={`px-2 py-1 bg-white dark:bg-black/20 rounded text-xs font-black shadow-sm ${COLOR_MAP[selectedItem.classInfo.color].text}`}>{selectedItem.classInfo.className}</span>
                <span className="text-xs font-bold text-slate-500 dark:text-slate-300 bg-white/50 dark:bg-black/20 px-2 py-1 rounded">{selectedItem.item.date} ({selectedItem.item.period}교시)</span>
              </div>
              <h2 className="text-lg font-black text-slate-800 dark:text-white mt-2">
                {selectedItem.item.type === 'lesson' ? `[${selectedItem.item.lesson?.order}차시] ${selectedItem.item.lesson?.title}` : `[일정] ${selectedItem.item.event?.title}`}
              </h2>
            </div>
            <div className="p-6 space-y-4 text-sm">
              <div>
                <h4 className="text-[10px] font-black text-slate-400 uppercase mb-2">{selectedItem.item.type === 'lesson' ? '선생님 비고' : '일정 구분'}</h4>
                <div className="text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700 whitespace-pre-wrap leading-relaxed">
                  {selectedItem.item.type === 'lesson' ? (selectedItem.item.lesson?.memo || <span className="text-slate-400 italic font-medium">기록된 비고가 없습니다.</span>) : (selectedItem.item.event?.type === 'extra' ? '추가 보강 수업입니다.' : '정규 수업이 제외되는 행사입니다.')}
                </div>
              </div>

              {selectedItem.item.type === 'lesson' ? (
                isModifying ? (
                  <div className="mt-4 p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800/50 rounded-xl space-y-3 animate-in fade-in zoom-in-95">
                    <div className="flex gap-4 border-b border-orange-200/50 dark:border-orange-800/50 pb-2">
                      <label className="flex items-center gap-1.5 text-xs font-bold text-orange-900 dark:text-orange-300 cursor-pointer"><input type="radio" aria-label="다른 날짜로 이동" checked={modifyType === 'move'} onChange={() => setModifyType('move')} className="text-orange-600 bg-white dark:bg-slate-900 border-orange-300 dark:border-orange-600 focus:ring-orange-500" /> 이동 (결강+보강)</label>
                      <label className="flex items-center gap-1.5 text-xs font-bold text-orange-900 dark:text-orange-300 cursor-pointer"><input type="radio" aria-label="이 시간 단순 결강" checked={modifyType === 'cancel'} onChange={() => setModifyType('cancel')} className="text-orange-600 bg-white dark:bg-slate-900 border-orange-300 dark:border-orange-600 focus:ring-orange-500" /> 단순 결강</label>
                    </div>
                    {modifyType === 'move' && (
                      <div>
                        <label className="block text-[10px] font-black text-orange-700 dark:text-orange-400 mb-1">이동할 날짜 및 교시 (보강)</label>
                        <div className="flex gap-2">
                          <input type="date" aria-label="보강 날짜" value={targetDate} onChange={e => setTargetDate(e.target.value)} className="flex-1 border border-orange-300 dark:border-orange-700 p-2 text-xs font-bold rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500" />
                          <select aria-label="보강 교시" value={targetPeriod} onChange={e => setTargetPeriod(Number(e.target.value))} className="w-20 border border-orange-300 dark:border-orange-700 p-2 text-xs font-bold rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500">
                            {[1,2,3,4,5,6,7].map(p => <option key={p} value={p}>{p}교시</option>)}
                          </select>
                        </div>
                      </div>
                    )}
                    <div className="flex justify-end gap-2 pt-2">
                      <button onClick={() => setIsModifying(false)} className="px-4 py-2 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 text-xs font-bold rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400">취소</button>
                      <button onClick={handleModifySchedule} className="px-4 py-2 bg-orange-600 dark:bg-orange-500 hover:bg-orange-700 dark:hover:bg-orange-600 text-white text-xs font-bold rounded-lg transition-colors shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800">변경 적용</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setIsModifying(true); setTargetDate(''); setTargetPeriod(1); }} className="w-full mt-4 py-2.5 bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-400 font-bold text-xs rounded-xl hover:bg-orange-200 dark:hover:bg-orange-900/50 border border-orange-200 dark:border-orange-800 transition-colors flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">
                    <IconCalendar /> 시간표 변경 (결강/이동)
                  </button>
                )
              ) : (
                <button onClick={() => handleDeleteEvent(selectedItem.item.event!.id)} className="w-full mt-4 py-2.5 bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 font-bold text-xs rounded-xl hover:bg-rose-100 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800 transition-colors flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500">
                  ✕ 이 일정 변경사항 취소 (원상복구)
                </button>
              )}
            </div>
            <div className="p-4 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
              <button onClick={() => { setSelectedItem(null); goToPage('records', { classId: selectedItem.classInfo.classId }); }} className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 text-sm font-bold hover:text-indigo-800 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 px-3 py-2 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                <IconNotebook /> 기록장으로 이동
              </button>
              <button onClick={() => setSelectedItem(null)} className="px-5 py-2 bg-slate-800 dark:bg-slate-700 text-white text-sm font-bold rounded-lg hover:bg-slate-700 dark:hover:bg-slate-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800">닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// SettingsPage — 분리된 서브 컴포넌트들
// ==========================================
interface ClassEditFormProps {
  editClassName: string; setEditClassName: (v: string) => void;
  editClassColor: ClassColor; setEditClassColor: (v: ClassColor) => void;
  editStartDate: string; setEditStartDate: (v: string) => void;
  editSlots: WeeklySlot[]; setEditSlots: (v: WeeklySlot[]) => void;
  onSave: () => void; onCancel: () => void;
  renderColorPicker: (sel: ClassColor, onSel: (c: ClassColor) => void) => React.ReactNode;
  dayNames: string[];
}
function ClassEditForm({ editClassName, setEditClassName, editClassColor, setEditClassColor, editStartDate, setEditStartDate, editSlots, setEditSlots, onSave, onCancel, renderColorPicker, dayNames }: ClassEditFormProps) {
  const [slotDay, setSlotDay] = useState<number>(1);
  const [slotPeriod, setSlotPeriod] = useState<number>(1);

  const addSlotToEditClass = () => {
    if (!editSlots.some(s => s.dayOfWeek === slotDay && s.period === slotPeriod)) {
      setEditSlots([...editSlots, { dayOfWeek: slotDay, period: slotPeriod }]);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border-2 border-indigo-200 dark:border-indigo-500/50 shadow-sm flex flex-col gap-4">
      <div className="flex justify-between items-center border-b border-gray-100 dark:border-slate-700 pb-2">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">학급 정보 수정</h3>
        <div className="flex gap-2">
          <button onClick={onCancel} className="px-3 py-1 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 rounded text-xs font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400">취소</button>
          <button onClick={onSave} className="px-3 py-1 bg-indigo-600 dark:bg-indigo-500 text-white rounded text-xs font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-800">저장</button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div><label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1">학급 이름</label><input type="text" aria-label="수정할 학급 이름" value={editClassName} onChange={e => setEditClassName(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-1.5 rounded text-sm font-bold bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" /></div>
          <div><label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1">라벨 색상</label>{renderColorPicker(editClassColor, setEditClassColor)}</div>
          <div><label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1">학기 시작일</label><input type="date" aria-label="수정할 시작일" value={editStartDate} onChange={e => setEditStartDate(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-1.5 rounded text-sm font-bold bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" /></div>
        </div>
        <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
          <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-2">시간표 편집</label>
          <div className="flex gap-1.5 mb-2">
            <select aria-label="수정할 요일" value={slotDay} onChange={e => setSlotDay(Number(e.target.value))} className="border border-gray-300 dark:border-slate-600 p-1 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-xs font-bold flex-1 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {dayNames.map((d, i) => i > 0 && i < 6 && <option key={i} value={i}>{d}요일</option>)}
            </select>
            <select aria-label="수정할 교시" value={slotPeriod} onChange={e => setSlotPeriod(Number(e.target.value))} className="border border-gray-300 dark:border-slate-600 p-1 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-xs font-bold w-16 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {[1,2,3,4,5,6,7].map(p => <option key={p} value={p}>{p}교시</option>)}
            </select>
            <button aria-label="시간표 슬롯 추가" onClick={addSlotToEditClass} className="bg-slate-300 dark:bg-slate-700 text-slate-800 dark:text-slate-200 px-2 rounded text-xs font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">추가</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {editSlots.map((s, i) => (
              <span key={i} className="bg-white dark:bg-slate-800 text-gray-800 dark:text-gray-200 border border-gray-300 dark:border-slate-600 px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 shadow-sm">
                {dayNames[s.dayOfWeek]} {s.period}교시
                <button aria-label={`${dayNames[s.dayOfWeek]}요일 ${s.period}교시 삭제`} onClick={() => setEditSlots(editSlots.filter((_, idx) => idx !== i))} className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-full w-4 h-4 flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400">✕</button>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface ClassModalProps {
  onClose: () => void;
  onAdd: (cls: ClassSchedule) => void;
  renderColorPicker: (sel: ClassColor, onSel: (c: ClassColor) => void) => React.ReactNode;
  dayNames: string[];
}
function ClassModal({ onClose, onAdd, renderColorPicker, dayNames }: ClassModalProps) {
  const [newClassName, setNewClassName] = useState('');
  const [newClassColor, setNewClassColor] = useState<ClassColor>('blue');
  const [newStartDate, setNewStartDate] = useState('');
  const [newSlots, setNewSlots] = useState<WeeklySlot[]>([]);
  const [slotDay, setSlotDay] = useState<number>(1);
  const [slotPeriod, setSlotPeriod] = useState<number>(1);
  const [classError, setClassError] = useState('');

  const addSlotToNewClass = () => {
    if (!newSlots.some(s => s.dayOfWeek === slotDay && s.period === slotPeriod)) {
      setNewSlots([...newSlots, { dayOfWeek: slotDay, period: slotPeriod }]);
    }
  };

  const handleAdd = () => {
    if (!newClassName.trim() || !newStartDate || newSlots.length === 0) { setClassError('모든 필드를 입력하세요.'); return; }
    const newClass: ClassSchedule = { classId: `c-${Date.now()}`, className: newClassName, startDate: newStartDate, color: newClassColor, weeklySlots: newSlots };
    onAdd(newClass);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 dark:bg-gray-900/70 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-xl p-5 animate-in zoom-in-95 border border-slate-100 dark:border-slate-700">
        <h3 className="text-lg font-bold mb-3 text-gray-900 dark:text-white">새 학급 추가</h3>
        {classError && <div className="mb-2 p-1.5 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-[10px] rounded font-bold">{classError}</div>}
        <div className="space-y-3 text-xs">
          <div><label className="block font-bold text-gray-700 dark:text-gray-300 mb-1">학급 이름</label><input type="text" aria-label="새 학급 이름" value={newClassName} onChange={e => setNewClassName(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-1.5 rounded bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" /></div>
          <div><label className="block font-bold text-gray-700 dark:text-gray-300 mb-1">라벨 색상</label>{renderColorPicker(newClassColor, setNewClassColor)}</div>
          <div><label className="block font-bold text-gray-700 dark:text-gray-300 mb-1">시작일</label><input type="date" aria-label="학기 시작일" value={newStartDate} onChange={e => setNewStartDate(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-1.5 rounded bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" /></div>
          <div className="p-2 bg-slate-50 dark:bg-slate-900/50 rounded border border-slate-200 dark:border-slate-700">
            <label className="block font-bold text-gray-700 dark:text-gray-300 mb-1">시간표 등록</label>
            <div className="flex gap-1 mb-1">
              <select aria-label="새 요일" value={slotDay} onChange={e => setSlotDay(Number(e.target.value))} className="border border-gray-300 dark:border-slate-600 p-1 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-white flex-1 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                {dayNames.map((d, i) => i > 0 && i < 6 && <option key={i} value={i}>{d}요일</option>)}
              </select>
              <select aria-label="새 교시" value={slotPeriod} onChange={e => setSlotPeriod(Number(e.target.value))} className="border border-gray-300 dark:border-slate-600 p-1 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-white w-16 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                {[1,2,3,4,5,6,7].map(p => <option key={p} value={p}>{p}교시</option>)}
              </select>
              <button aria-label="새 슬롯 추가" onClick={addSlotToNewClass} className="bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-2 rounded font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">추가</button>
            </div>
            <div className="flex flex-wrap gap-1">
              {newSlots.map((s, i) => (
                <span key={i} className="bg-white dark:bg-slate-800 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-slate-600 px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1">
                  {dayNames[s.dayOfWeek]} {s.period}교시
                  <button aria-label={`${dayNames[s.dayOfWeek]}요일 ${s.period}교시 새 슬롯 삭제`} onClick={() => setNewSlots(newSlots.filter((_, idx) => idx !== i))} className="text-red-500 font-bold ml-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 rounded">✕</button>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded text-xs font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400">취소</button>
          <button onClick={handleAdd} className="px-3 py-1.5 bg-slate-800 dark:bg-indigo-600 text-white rounded text-xs font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-800">저장</button>
        </div>
      </div>
    </div>
  );
}

interface EventModalProps {
  classId: string;
  className: string;
  onClose: () => void;
  onAdd: (event: ClassEvent) => void;
}
function EventModal({ classId, className, onClose, onAdd }: EventModalProps) {
  const [newEventDate, setNewEventDate] = useState('');
  const [newEventPeriod, setNewEventPeriod] = useState<number>(1);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventType, setNewEventType] = useState<'exception' | 'extra'>('exception');
  const [eventError, setEventError] = useState('');

  const handleAdd = () => {
    if (!newEventDate || (newEventType === 'exception' && !newEventTitle.trim())) { setEventError('모든 필드를 입력하세요.'); return; }
    const newEvent: ClassEvent = {
      id: `e-${Date.now()}`, classId, date: newEventDate, period: newEventPeriod,
      title: newEventType === 'extra' ? '보강 수업' : newEventTitle, type: newEventType,
    };
    onAdd(newEvent);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 dark:bg-gray-900/70 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-xl p-5 animate-in zoom-in-95 border border-slate-100 dark:border-slate-700">
        <h3 className="text-lg font-bold mb-1 text-gray-900 dark:text-white">일정 변경 등록</h3>
        <p className="text-orange-600 dark:text-orange-400 font-bold mb-3 text-[10px]">[{className}] 전용</p>
        {eventError && <div className="mb-2 p-1.5 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-[10px] rounded font-bold">{eventError}</div>}
        <div className="space-y-3 text-xs">
          <div className="flex gap-1 bg-slate-100 dark:bg-slate-900 p-1 rounded-lg">
            <button aria-label="수업 취소 또는 제외 탭" onClick={() => setNewEventType('exception')} className={`flex-1 py-1.5 rounded-md font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 ${newEventType === 'exception' ? 'bg-white dark:bg-slate-800 shadow-sm text-orange-600 dark:text-orange-400' : 'text-slate-500 dark:text-slate-400'}`}>수업 취소/제외</button>
            <button aria-label="보강 수업 추가 탭" onClick={() => setNewEventType('extra')} className={`flex-1 py-1.5 rounded-md font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${newEventType === 'extra' ? 'bg-white dark:bg-slate-800 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`}>보강 수업 추가</button>
          </div>
          <div><label className="block font-bold text-gray-700 dark:text-gray-300 mb-1">{newEventType === 'extra' ? '보강 날짜' : '취소 날짜'}</label><input type="date" aria-label={newEventType === 'extra' ? '보강 날짜' : '취소 날짜'} value={newEventDate} onChange={e => setNewEventDate(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-1.5 rounded bg-white dark:bg-slate-900 text-gray-900 dark:text-white font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500" /></div>
          <div><label className="block font-bold text-gray-700 dark:text-gray-300 mb-1">{newEventType === 'extra' ? '보강 교시' : '취소 교시'}</label><select aria-label={newEventType === 'extra' ? '보강 교시' : '취소 교시'} value={newEventPeriod} onChange={e => setNewEventPeriod(Number(e.target.value))} className="w-full border border-gray-300 dark:border-slate-600 p-1.5 rounded bg-white dark:bg-slate-900 text-gray-900 dark:text-white font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500">{[1,2,3,4,5,6,7].map(p => <option key={p} value={p}>{p}교시</option>)}</select></div>
          {newEventType === 'exception' && <div><label className="block font-bold text-gray-700 dark:text-gray-300 mb-1">취소 사유</label><input type="text" aria-label="취소 사유 입력" value={newEventTitle} onChange={e => setNewEventTitle(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-1.5 rounded bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500" placeholder="행사명, 출장 등" /></div>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded text-xs font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400">취소</button>
          <button onClick={handleAdd} className={`px-3 py-1.5 text-white rounded text-xs font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-800 ${newEventType === 'extra' ? 'bg-indigo-600 focus-visible:ring-indigo-500' : 'bg-orange-500 focus-visible:ring-orange-500'}`}>저장</button>
        </div>
      </div>
    </div>
  );
}

interface HolidayModalProps {
  onClose: () => void;
  onAdd: (holiday: Holiday) => void;
}
function HolidayModal({ onClose, onAdd }: HolidayModalProps) {
  const [newDate, setNewDate] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [error, setError] = useState('');

  const handleAdd = () => {
    if (!newDate || !newTitle.trim()) { setError('날짜와 내용을 입력하세요.'); return; }
    onAdd({ id: `h-${Date.now()}`, date: newDate, title: newTitle });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 dark:bg-gray-900/70 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-xl p-5 animate-in zoom-in-95 border border-slate-100 dark:border-slate-700">
        <h3 className="text-lg font-bold mb-1 text-gray-900 dark:text-white">학교 전체 일정 등록</h3>
        <p className="text-rose-600 dark:text-rose-400 font-bold mb-3 text-[10px]">공휴일, 재량휴업일, 시험 등 전체 학급 공통 휴강 일정</p>
        {error && <div className="mb-2 p-1.5 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-[10px] rounded font-bold">{error}</div>}
        <div className="space-y-3 text-xs">
          <div><label className="block font-bold text-gray-700 dark:text-gray-300 mb-1">날짜</label><input type="date" aria-label="전체 휴무일 날짜" value={newDate} onChange={e => setNewDate(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-1.5 rounded bg-white dark:bg-slate-900 text-gray-900 dark:text-white font-bold focus:outline-none focus:ring-2 focus:ring-rose-500" /></div>
          <div><label className="block font-bold text-gray-700 dark:text-gray-300 mb-1">일정명</label><input type="text" aria-label="전체 일정 이름" value={newTitle} onChange={e => setNewTitle(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-1.5 rounded bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500" placeholder="예: 개교기념일, 1학기 중간고사" /></div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded text-xs font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400">취소</button>
          <button onClick={handleAdd} className="px-3 py-1.5 bg-rose-600 dark:bg-rose-500 text-white rounded text-xs font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-800">저장</button>
        </div>
      </div>
    </div>
  );
}

function SettingsPage() {
  const { classes, updateClasses, holidays, updateHolidays, events, updateEvents } = useContext(AppContext)!;
  const addToast = useContext(ToastContext);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

  const [selectedTabClassId, setSelectedTabClassId] = useState<string>(classes[0]?.classId || '');
  const [isClassModalOpen, setClassModalOpen] = useState(false);
  const [isEventModalOpen, setEventModalOpen] = useState(false);
  const [isHolidayModalOpen, setHolidayModalOpen] = useState(false);

  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [editClassName, setEditClassName] = useState('');
  const [editClassColor, setEditClassColor] = useState<ClassColor>('blue');
  const [editStartDate, setEditStartDate] = useState('');
  const [editSlots, setEditSlots] = useState<WeeklySlot[]>([]);

  useEffect(() => {
    if (classes.length > 0 && !classes.find(c => c.classId === selectedTabClassId)) {
      setSelectedTabClassId(classes[0].classId);
    }
  }, [classes, selectedTabClassId]);

  const activeClass = classes.find(c => c.classId === selectedTabClassId);
  const activeClassEvents = events.filter(e => e.classId === selectedTabClassId).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const handleSaveClassEdit = async (classId: string) => {
    if (!editClassName.trim() || !editStartDate || editSlots.length === 0) { addToast('입력값을 확인해주세요.'); return; }
    try { await updateClasses(classes.map(c => c.classId === classId ? { ...c, className: editClassName, color: editClassColor, startDate: editStartDate, weeklySlots: editSlots } : c)); setEditingClassId(null); addToast('저장되었습니다.', 'success'); } catch { addToast('저장에 실패했습니다.'); }
  };

  const startEditClass = (cls: ClassSchedule) => {
    setEditingClassId(cls.classId); setEditClassName(cls.className); setEditClassColor(cls.color); setEditStartDate(cls.startDate); setEditSlots([...cls.weeklySlots]);
  };

  const handleAddClass = async (newClass: ClassSchedule) => { try { await updateClasses([...classes, newClass]); setSelectedTabClassId(newClass.classId); setClassModalOpen(false); addToast('학급이 추가되었습니다.', 'success'); } catch { addToast('학급 추가에 실패했습니다.'); } };
  const handleAddEvent = async (newEvent: ClassEvent) => { try { await updateEvents([...events, newEvent]); setEventModalOpen(false); addToast('일정이 등록되었습니다.', 'success'); } catch { addToast('일정 등록에 실패했습니다.'); } };
  const handleDeleteEvent = async (id: string) => { try { await updateEvents(events.filter(ev => ev.id !== id)); addToast('삭제되었습니다.', 'success'); } catch { addToast('삭제에 실패했습니다.'); } };
  const handleAddHoliday = async (newHoliday: Holiday) => { try { await updateHolidays([...holidays, newHoliday].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())); setHolidayModalOpen(false); addToast('전체 일정이 등록되었습니다.', 'success'); } catch { addToast('일정 등록에 실패했습니다.'); } };
  const handleDeleteHoliday = async (idOrDate: string) => { try { await updateHolidays(holidays.filter(h => (h.id || h.date) !== idOrDate)); addToast('삭제되었습니다.', 'success'); } catch { addToast('삭제에 실패했습니다.'); } };

  const renderColorPicker = (selCol: ClassColor, onSel: (c: ClassColor) => void) => (
    <div className="flex gap-2">
      {(Object.keys(COLOR_MAP) as ClassColor[]).map(c => (
        <button key={c} type="button" aria-label={`${c} 색상 선택`} onClick={() => onSel(c)} className={`w-6 h-6 rounded-full border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-600 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-800 ${COLOR_MAP[c].bg} ${selCol === c ? 'border-gray-800 dark:border-white scale-110 shadow-sm' : 'border-transparent opacity-70'}`} />
      ))}
    </div>
  );

  return (
    <div className="p-6 h-full flex flex-col animate-in fade-in duration-500 overflow-hidden bg-white dark:bg-slate-900">
      <header className="flex justify-between items-center mb-4 shrink-0 bg-slate-100/50 dark:bg-slate-800/50 p-4 rounded-2xl">
        <div><h1 className="text-xl font-bold text-gray-900 dark:text-white">학급 및 일정 설정</h1><p className="text-xs text-gray-500 dark:text-gray-400 mt-1">운영 학급과 예외 일정을 관리합니다.</p></div>
        <button onClick={() => setClassModalOpen(true)} className="bg-slate-800 dark:bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm font-bold hover:bg-slate-700 dark:hover:bg-indigo-500 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800">+ 학급 추가</button>
      </header>

      <div className="flex gap-2 overflow-x-auto pb-2 mb-3 shrink-0 scrollbar-hide">
        {classes.map(c => {
          const isSel = selectedTabClassId === c.classId;
          const isEdit = editingClassId === c.classId;
          return (
            <div key={c.classId} className="flex items-center group">
              {isEdit ? (
                <button aria-label="수정 취소" onClick={() => setEditingClassId(null)} className="px-3 py-1 rounded-full text-xs font-bold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 animate-pulse focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">수정 중...</button>
              ) : (
                <button aria-label={`${c.className} 설정 보기`} onClick={() => setSelectedTabClassId(c.classId)} className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${isSel ? 'bg-slate-800 dark:bg-indigo-500 text-white shadow-md border border-transparent' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700'}`}>
                  <span className={`w-2 h-2 rounded-full ${COLOR_MAP[c.color].bg} border border-gray-300/50 dark:border-white/20`}></span>
                  {c.className}
                  {isSel && <span aria-label="학급 정보 수정" role="button" tabIndex={0} onClick={e => { e.stopPropagation(); startEditClass(c); }} className="ml-1 opacity-50 hover:opacity-100 cursor-pointer text-[10px] focus:outline-none focus-visible:ring-1 focus-visible:ring-white">✏️</span>}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto pr-2 pb-6 space-y-4">
        {activeClass ? (
          editingClassId === activeClass.classId ? (
            <ClassEditForm editClassName={editClassName} setEditClassName={setEditClassName} editClassColor={editClassColor} setEditClassColor={setEditClassColor} editStartDate={editStartDate} setEditStartDate={setEditStartDate} editSlots={editSlots} setEditSlots={setEditSlots} onSave={() => handleSaveClassEdit(activeClass.classId)} onCancel={() => setEditingClassId(null)} renderColorPicker={renderColorPicker} dayNames={dayNames} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-100 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col">
                <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2 shrink-0"><span className={`w-1.5 h-3.5 rounded-full ${COLOR_MAP[activeClass.color].bg} border border-gray-400 dark:border-gray-500`}></span>{activeClass.className} 기본 시간표</h2>
                <div className="space-y-1.5 flex-1 overflow-y-auto">
                  {activeClass.weeklySlots.map((slot, i) => (
                    <div key={i} className="flex justify-between items-center px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{dayNames[slot.dayOfWeek]}요일</span>
                      <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded border border-indigo-100 dark:border-indigo-800">{slot.period}교시</span>
                    </div>
                  ))}
                  {activeClass.weeklySlots.length === 0 && <p className="text-xs text-gray-500 dark:text-gray-400">설정된 시간표가 없습니다.</p>}
                </div>
                <div className="mt-3 pt-2 border-t border-slate-200 dark:border-slate-700 text-right"><span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 bg-white dark:bg-slate-800 px-2 py-1 rounded border border-slate-100 dark:border-slate-700">학기 시작일: {activeClass.startDate}</span></div>
              </div>

              <div className="bg-slate-100 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col">
                <div className="flex justify-between items-center mb-3 shrink-0">
                  <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2"><span className="w-1.5 h-3.5 rounded-full bg-orange-400"></span>{activeClass.className} 예외 일정</h2>
                  <button onClick={() => setEventModalOpen(true)} className="bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400 px-2 py-1 rounded text-[10px] font-bold shadow-sm hover:bg-orange-200 dark:hover:bg-orange-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400">+ 일정 등록</button>
                </div>
                <div className="space-y-2 flex-1 overflow-y-auto pr-1">
                  {activeClassEvents.length > 0 ? activeClassEvents.map(e => (
                    <div key={e.id} className={`flex flex-col gap-1 p-2.5 rounded-lg border shadow-sm ${e.type === 'extra' ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-100 dark:border-indigo-800/60' : 'bg-white dark:bg-slate-800 border-orange-200 dark:border-orange-800/60'}`}>
                      <div className="flex justify-between items-center">
                        <span className={`text-[10px] font-black ${e.type === 'extra' ? 'text-indigo-800 dark:text-indigo-300' : 'text-orange-800 dark:text-orange-300'}`}>{e.date}</span>
                        <div className="flex gap-1">
                          <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${e.type === 'extra' ? 'bg-indigo-200 dark:bg-indigo-800/60 text-indigo-900 dark:text-indigo-200' : 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200'}`}>{e.period}교시</span>
                          <span className={`text-[9px] font-black px-1 py-0.5 rounded text-white ${e.type === 'extra' ? 'bg-indigo-500' : 'bg-orange-500'}`}>{e.type === 'extra' ? '보강' : '결강'}</span>
                        </div>
                      </div>
                      <span className={`text-xs font-bold ${e.type === 'extra' ? 'text-indigo-900 dark:text-indigo-100' : 'text-slate-700 dark:text-slate-200'}`}>{e.title}</span>
                      <button aria-label="일정 삭제" onClick={() => handleDeleteEvent(e.id)} className="text-[9px] text-gray-400 hover:text-red-500 dark:hover:text-red-400 text-right mt-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-red-400 rounded">삭제</button>
                    </div>
                  )) : (
                    <div className="flex items-center justify-center h-full min-h-[60px] border border-dashed border-slate-300 dark:border-slate-600 rounded-lg"><p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">등록된 예외 일정이 없습니다.</p></div>
                  )}
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="flex items-center justify-center p-10 bg-slate-50 dark:bg-slate-800 rounded-xl"><p className="text-sm text-gray-400 dark:text-slate-500 font-bold">학급을 추가해주세요.</p></div>
        )}

        <section className="bg-rose-50/50 dark:bg-rose-900/10 p-4 rounded-xl border border-rose-100 dark:border-rose-900/30 shrink-0">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-xs font-bold text-rose-700 dark:text-rose-400 flex items-center gap-1.5"><span className="w-1 h-3 bg-rose-400 rounded-full"></span>학교 전체 공휴일 및 행사 (공통)</h2>
            <button onClick={() => setHolidayModalOpen(true)} className="bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 px-2 py-1 rounded text-[10px] font-bold shadow-sm hover:bg-rose-200 dark:hover:bg-rose-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400">+ 일정 등록</button>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {holidays.length > 0 ? holidays.map((h, i) => (
              <div key={h.id || i} className="flex gap-2 items-center bg-white/60 dark:bg-slate-800/60 py-1.5 px-3 rounded-md border border-rose-100 dark:border-rose-900/50 group">
                <span className="font-bold text-rose-800 dark:text-rose-300">{h.date}</span>
                <span className="font-medium text-rose-600 dark:text-rose-400">{h.title}</span>
                <button aria-label="전체 일정 삭제" onClick={() => handleDeleteHoliday(h.id || h.date)} className="text-[10px] text-gray-400 hover:text-red-500 dark:hover:text-red-400 opacity-0 md:opacity-0 group-hover:opacity-100 ml-1 font-black focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 rounded">✕</button>
              </div>
            )) : (
              <span className="text-slate-400 dark:text-slate-500 text-xs font-medium">등록된 전체 일정이 없습니다.</span>
            )}
          </div>
        </section>
      </div>

      {isClassModalOpen && <ClassModal onClose={() => setClassModalOpen(false)} onAdd={handleAddClass} renderColorPicker={renderColorPicker} dayNames={dayNames} />}
      {isEventModalOpen && activeClass && <EventModal classId={activeClass.classId} className={activeClass.className} onClose={() => setEventModalOpen(false)} onAdd={handleAddEvent} />}
      {isHolidayModalOpen && <HolidayModal onClose={() => setHolidayModalOpen(false)} onAdd={handleAddHoliday} />}
    </div>
  );
}

// ==========================================
// Profile Modal Component
// ==========================================
interface ProfileModalProps { currentProfile: UserProfile; onClose: () => void; onSave: (profile: UserProfile) => void; }
function ProfileModal({ currentProfile, onClose, onSave }: ProfileModalProps) {
  const [name, setName] = useState(currentProfile.name);
  const [subject, setSubject] = useState(currentProfile.subject);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 dark:bg-gray-900/70 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-2xl shadow-xl p-6 animate-in zoom-in-95 border border-slate-100 dark:border-slate-700">
        <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">프로필 설정</h3>
        <div className="space-y-4 text-sm">
          <div><label className="block font-bold text-gray-700 dark:text-gray-300 mb-1">선생님 이름</label><input type="text" aria-label="선생님 이름" value={name} onChange={e => setName(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-2.5 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold" /></div>
          <div><label className="block font-bold text-gray-700 dark:text-gray-300 mb-1">담당 과목/역할</label><input type="text" aria-label="담당 과목 또는 역할" value={subject} onChange={e => setSubject(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-2.5 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="예: 국어 담당, 3학년 부장 등" /></div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg text-xs font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400">취소</button>
          <button onClick={() => onSave({ name, subject })} className="px-4 py-2 bg-indigo-600 dark:bg-indigo-500 text-white rounded-lg text-xs font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800">저장</button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// App (Root)
// ==========================================
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const [activePage, setActivePage] = useState<'manage' | 'plan' | 'settings' | 'records' | 'tasks'>('manage');
  const [pageParams, setPageParams] = useState<any>(null);

  const [lessonsState, setLessonsState] = useState<Lesson[]>([]);
  const [classesState, setClassesState] = useState<ClassSchedule[]>([]);
  const [holidaysState, setHolidaysState] = useState<Holiday[]>([]);
  const [eventsState, setEventsState] = useState<ClassEvent[]>([]);
  const [recordsState, setRecordsState] = useState<ClassRecord[]>([]);
  const [tasksState, setTasksState] = useState<Task[]>([]);
  const [profileState, setProfileState] = useState<UserProfile>(DEFAULT_PROFILE);
  const [menuOrderState, setMenuOrderState] = useState<string[]>(DEFAULT_MENU_ORDER);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (!isFirebaseEnabled) {
           setLessonsState(loadFromLocal('lessons', MOCK_LESSONS));
           setClassesState(loadFromLocal('classes', MOCK_SCHEDULES));
           setHolidaysState(loadFromLocal('holidays', MOCK_HOLIDAYS));
           setEventsState(loadFromLocal('events', []));
           setRecordsState(loadFromLocal('records', []));
           setTasksState(loadFromLocal('tasks', MOCK_TASKS));
           setProfileState(loadFromLocal('profile', DEFAULT_PROFILE));
           setMenuOrderState(loadFromLocal('menuOrder', DEFAULT_MENU_ORDER));
           setIsLoaded(true);
           return;
        }

        // @ts-ignore
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          // @ts-ignore
          await signInWithCustomToken(auth!, __initial_auth_token);
        } else {
          await signInAnonymously(auth!);
        }
      } catch (err) {
        setLessonsState(loadFromLocal('lessons', MOCK_LESSONS));
        setClassesState(loadFromLocal('classes', MOCK_SCHEDULES));
        setHolidaysState(loadFromLocal('holidays', MOCK_HOLIDAYS));
        setEventsState(loadFromLocal('events', []));
        setRecordsState(loadFromLocal('records', []));
        setTasksState(loadFromLocal('tasks', MOCK_TASKS));
        setProfileState(loadFromLocal('profile', DEFAULT_PROFILE));
        setMenuOrderState(loadFromLocal('menuOrder', DEFAULT_MENU_ORDER));
        setIsLoaded(true);
      }
    };
    initAuth();
    
    if (isFirebaseEnabled && auth) {
        const unsubscribe = onAuthStateChanged(auth, setUser);
        return () => unsubscribe();
    }
  }, []);

  useEffect(() => {
    if (!user || !isFirebaseEnabled || !db) return;
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'appState', 'shared');

    const unsubscribe = onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setLessonsState(data.lessons || []);
        setClassesState(data.classes || []);
        setHolidaysState(data.holidays || []);
        setEventsState(data.events || []);
        setRecordsState(data.records || []);
        setTasksState(data.tasks || []);
        setProfileState(data.profile || DEFAULT_PROFILE);
        setMenuOrderState(data.menuOrder || DEFAULT_MENU_ORDER);
      } else {
        setDoc(docRef, { lessons: MOCK_LESSONS, classes: MOCK_SCHEDULES, holidays: MOCK_HOLIDAYS, events: [], records: [], tasks: MOCK_TASKS, profile: DEFAULT_PROFILE, menuOrder: DEFAULT_MENU_ORDER }, { merge: true });
      }
      setIsLoaded(true);
    }, () => { setIsLoaded(true); });

    return () => unsubscribe();
  }, [user]);

  const updateFirestoreField = async (field: string, data: any) => {
    if (!user || !isFirebaseEnabled || !db) return;
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'appState', 'shared');
    await setDoc(docRef, { [field]: data }, { merge: true });
  };

  const contextValue: AppContextType = {
    lessons: lessonsState, updateLessons: async (data) => { setLessonsState(data); if (!isFirebaseEnabled) saveToLocal('lessons', data); else await updateFirestoreField('lessons', data); },
    classes: classesState, updateClasses: async (data) => { setClassesState(data); if (!isFirebaseEnabled) saveToLocal('classes', data); else await updateFirestoreField('classes', data); },
    holidays: holidaysState, updateHolidays: async (data) => { setHolidaysState(data); if (!isFirebaseEnabled) saveToLocal('holidays', data); else await updateFirestoreField('holidays', data); },
    events: eventsState, updateEvents: async (data) => { setEventsState(data); if (!isFirebaseEnabled) saveToLocal('events', data); else await updateFirestoreField('events', data); },
    records: recordsState, updateRecords: async (data) => { setRecordsState(data); if (!isFirebaseEnabled) saveToLocal('records', data); else await updateFirestoreField('records', data); },
    tasks: tasksState, updateTasks: async (data) => { setTasksState(data); if (!isFirebaseEnabled) saveToLocal('tasks', data); else await updateFirestoreField('tasks', data); },
    profile: profileState, updateProfile: async (data) => { setProfileState(data); if (!isFirebaseEnabled) saveToLocal('profile', data); else await updateFirestoreField('profile', data); },
    menuOrder: menuOrderState, updateMenuOrder: async (data) => { setMenuOrderState(data); if (!isFirebaseEnabled) saveToLocal('menuOrder', data); else await updateFirestoreField('menuOrder', data); },
    goToPage: (page, params) => { setActivePage(page); setPageParams(params); },
    pageParams,
  };

  const NAV_ITEMS_CONFIG: Record<string, { id: string; label: string; icon: React.ReactNode }> = {
    manage:   { id: 'manage',   label: '주간 진도표',   icon: <IconCalendar /> },
    tasks:    { id: 'tasks',    label: '업무 체크리스트', icon: <IconChecklist /> },
    plan:     { id: 'plan',     label: '수업 계획서',   icon: <IconBook /> },
    records:  { id: 'records',  label: '학급 기록장',   icon: <IconNotebook /> },
    settings: { id: 'settings', label: '일정 설정',     icon: <IconSettings /> },
  };

  const [draggedNavIdx, setDraggedNavIdx] = useState<number | null>(null);

  const handleNavDragStart = (e: React.DragEvent, index: number) => { setDraggedNavIdx(index); e.dataTransfer.effectAllowed = 'move'; };
  const handleNavDragOver = (e: React.DragEvent, _index: number) => { e.preventDefault(); };
  const handleNavDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedNavIdx === null || draggedNavIdx === index) return;
    const newOrder = [...menuOrderState];
    const [draggedItem] = newOrder.splice(draggedNavIdx, 1);
    newOrder.splice(index, 0, draggedItem);
    contextValue.updateMenuOrder(newOrder);
    setDraggedNavIdx(null);
  };

  if (!isLoaded) {
    return (
      <div className="flex h-screen bg-slate-50 dark:bg-slate-900 items-center justify-center selection:bg-indigo-100 dark:selection:bg-indigo-900/50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-indigo-200 dark:border-indigo-800 border-t-indigo-600 dark:border-t-indigo-500 rounded-full animate-spin"></div>
          <div className="text-slate-500 dark:text-slate-400 font-bold text-sm animate-pulse">데이터 로딩 중...</div>
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <AppContext.Provider value={contextValue}>

        {/* ── 데스크탑 레이아웃 (md 이상) ── */}
        <div className="hidden md:flex h-screen bg-white dark:bg-slate-900 font-sans text-slate-900 dark:text-slate-100 overflow-hidden selection:bg-indigo-100 dark:selection:bg-indigo-900/50">
          <aside className="w-60 bg-slate-900 flex flex-col z-20 shrink-0 border-r border-slate-800">
            <div className="p-6">
              <div className="flex items-center gap-3 text-white mb-1">
                <div className="p-1.5 bg-indigo-500 rounded-lg shadow-sm"><IconCalendar /></div>
                <span className="text-lg font-black tracking-tight">에듀플래너</span>
              </div>
              <div className="text-[10px] font-bold text-slate-500 px-1 uppercase tracking-widest flex items-center gap-2">
                Smart Scheduler
                <span className={`w-2 h-2 rounded-full animate-pulse ${isFirebaseEnabled ? 'bg-green-500' : 'bg-orange-500'}`} title={isFirebaseEnabled ? "클라우드 연동됨" : "로컬 스토리지 보관됨"}></span>
              </div>
            </div>

            <nav className="flex-1 px-3 space-y-1 mt-4 overflow-y-auto scrollbar-hide">
              {menuOrderState.map((itemId, index) => {
                const item = NAV_ITEMS_CONFIG[itemId];
                if (!item) return null;
                return (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(e) => handleNavDragStart(e, index)}
                    onDragOver={(e) => handleNavDragOver(e, index)}
                    onDrop={(e) => handleNavDrop(e, index)}
                    className={`cursor-grab active:cursor-grabbing transition-opacity ${draggedNavIdx === index ? 'opacity-30' : 'opacity-100'}`}
                  >
                    <button onClick={() => { setActivePage(item.id as any); setPageParams(null); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${activePage === item.id ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                      <div className="opacity-20 hover:opacity-100 transition-opacity px-1 flex flex-col gap-[2px] items-center justify-center shrink-0" aria-hidden="true" title="드래그하여 순서 변경">
                        <span className="w-1 h-1 bg-current rounded-full"></span><span className="w-1 h-1 bg-current rounded-full"></span><span className="w-1 h-1 bg-current rounded-full"></span>
                      </div>
                      {item.icon}
                      <span className="font-bold text-sm">{item.label}</span>
                    </button>
                  </div>
                );
              })}
            </nav>

            <div className="p-4">
              <button aria-label="프로필 설정 수정" onClick={() => setIsProfileModalOpen(true)} className="w-full text-left bg-slate-800/50 p-3 rounded-xl border border-slate-700/50 flex items-center gap-3 hover:bg-slate-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 group">
                <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-indigo-400 font-bold text-sm shrink-0 uppercase">
                  {profileState.name.charAt(0) || 'U'}
                </div>
                <div className="overflow-hidden flex-1">
                  <div className="text-white text-xs font-bold truncate group-hover:text-indigo-300 transition-colors flex items-center justify-between">
                    <span className="truncate">{profileState.name}</span>
                    <span className="opacity-0 group-hover:opacity-100 text-[10px] shrink-0 ml-1">✏️</span>
                  </div>
                  <div className="text-slate-500 text-[10px] font-medium truncate">{profileState.subject}</div>
                </div>
              </button>
            </div>
          </aside>

          <main className="flex-1 overflow-hidden relative bg-white dark:bg-slate-900 min-w-0">
            <div className="max-w-6xl mx-auto h-full shadow-2xl bg-white dark:bg-slate-900 border-l border-r border-slate-100/50 dark:border-slate-800/50">
              {activePage === 'plan'     && <LessonPlanPage />}
              {activePage === 'settings' && <SettingsPage />}
              {activePage === 'manage'   && <ManagePage />}
              {activePage === 'records'  && <RecordsPage />}
              {activePage === 'tasks'    && <TasksPage />}
            </div>
          </main>
        </div>

        {/* ── 모바일 레이아웃 (md 미만) ── */}
        <div className="flex md:hidden flex-col h-screen bg-white dark:bg-slate-900 font-sans text-slate-900 dark:text-slate-100 selection:bg-indigo-100 dark:selection:bg-indigo-900/50">
          {/* 상단 헤더 */}
          <header className="bg-slate-900 px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 text-white">
              <div className="p-1 bg-indigo-500 rounded-lg"><IconCalendar /></div>
              <span className="text-base font-black tracking-tight">에듀플래너</span>
              <span className={`w-2 h-2 rounded-full animate-pulse ${isFirebaseEnabled ? 'bg-green-500' : 'bg-orange-500'}`}></span>
            </div>
            <button
              aria-label="프로필 설정 수정"
              onClick={() => setIsProfileModalOpen(true)}
              className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-indigo-400 font-bold text-sm uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              {profileState.name.charAt(0) || 'U'}
            </button>
          </header>

          {/* 메인 콘텐츠 */}
          <main className="flex-1 overflow-hidden relative bg-white dark:bg-slate-900 min-w-0">
            {activePage === 'plan'     && <LessonPlanPage />}
            {activePage === 'settings' && <SettingsPage />}
            {activePage === 'manage'   && <ManagePage />}
            {activePage === 'records'  && <RecordsPage />}
            {activePage === 'tasks'    && <TasksPage />}
          </main>

          {/* 하단 탭 바 */}
          <nav className="bg-slate-900 border-t border-slate-800 shrink-0 flex">
            {menuOrderState.map((itemId) => {
              const item = NAV_ITEMS_CONFIG[itemId];
              if (!item) return null;
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => { setActivePage(item.id as any); setPageParams(null); }}
                  className={`flex-1 flex flex-col items-center justify-center py-2 gap-1 transition-colors focus:outline-none ${isActive ? 'text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  <div className={`transition-transform ${isActive ? 'scale-110' : ''}`}>
                    {item.icon}
                  </div>
                  <span className="text-[9px] font-bold leading-none">{item.label}</span>
                  {isActive && <span className="w-1 h-1 rounded-full bg-indigo-400"></span>}
                </button>
              );
            })}
          </nav>
        </div>

        {isProfileModalOpen && (
          <ProfileModal
            currentProfile={profileState}
            onClose={() => setIsProfileModalOpen(false)}
            onSave={(newProfile) => {
              contextValue.updateProfile(newProfile);
              setIsProfileModalOpen(false);
            }}
          />
        )}
      </AppContext.Provider>
    </ToastProvider>
  );
}