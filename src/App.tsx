import React, { useState, useEffect, useMemo, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// ==========================================
// Firebase Initialization
// ==========================================
// @ts-ignore
const firebaseConfigStr = typeof __firebase_config !== 'undefined' ? __firebase_config : null;
const firebaseConfig = firebaseConfigStr ? JSON.parse(firebaseConfigStr) : {};
const isFirebaseEnabled = Object.keys(firebaseConfig).length > 0;
const app = isFirebaseEnabled ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
// @ts-ignore
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

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
export interface Holiday { id?: string; date: string; title: string; isHoliday?: boolean; }
export interface ClassEvent { id: string; classId: string; date: string; period: number; title: string; type: 'exception' | 'extra' | 'replace'; }
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

  // [수정] exception(결강/이동)과 replace(수업내용 변경)는 모두 기존 정규 수업을 가려줍니다.
  const exceptionKeys = new Set(
    classEvents.filter(e => e.type === 'exception' || e.type === 'replace').map(e => `${e.date}-${e.period}`)
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
        if (lessonIndex >= sortedLessons.length && !eventMap.has(`${dateStr}-${period}`)) break;
        const eventKey = `${dateStr}-${period}`;
        const classEvent = eventMap.get(eventKey);

        if (classEvent) {
          if (classEvent.type === 'exception') {
            // 결강/이동된 수업은 scheduledItems에 추가하지 않아 빈 칸으로 표시됨 (밀림 효과)
          } else if (classEvent.type === 'replace') {
            // 내용 변경된 수업은 이벤트로 푸시하되, lessonIndex를 증가시키지 않아 원래 차시가 뒤로 밀림
            scheduledItems.push({ date: dateStr, period, type: 'event', event: classEvent, classId: schedule.classId });
          } else if (classEvent.type === 'extra') {
            // 보강 수업은 기존 진도를 나감
            scheduledItems.push({ date: dateStr, period, type: 'lesson', lesson: sortedLessons[lessonIndex], classId: schedule.classId });
            lessonIndex++;
          }
        } else if (baseSlots.includes(period) && !exceptionKeys.has(eventKey)) {
          // 정상 수업
          if(lessonIndex < sortedLessons.length) {
             scheduledItems.push({ date: dateStr, period, type: 'lesson', lesson: sortedLessons[lessonIndex], classId: schedule.classId });
             lessonIndex++;
          }
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
  { id: '3', order: 3, title: '항등식과 나머지 정리', memo: '조립제법 활용' },
];
const MOCK_SCHEDULES: ClassSchedule[] = [
  { classId: 'c1', className: '2학년 6반', startDate: '2026-05-04', color: 'blue',  weeklySlots: [{ dayOfWeek: 1, period: 2 }, { dayOfWeek: 3, period: 5 }], classScore: 12 },
  { classId: 'c2', className: '2학년 5반', startDate: '2026-05-04', color: 'green', weeklySlots: [{ dayOfWeek: 2, period: 1 }, { dayOfWeek: 5, period: 4 }], classScore: 8 },
];
const MOCK_HOLIDAYS: Holiday[] = [
  { id: 'h-1', date: '2026-05-05', title: '어린이날', isHoliday: true },
  { id: 'h-2', date: '2026-05-28', title: '수행평가(전체)', isHoliday: false }
];
const MOCK_TASKS: Task[] = [{ id: 't-1', title: '중간고사 출제 완료하기', date: '2026-05-15', completed: false }];
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
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-gray-900/40 dark:bg-gray-900/70 backdrop-blur-sm px-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 max-w-xs w-full animate-in zoom-in-95 border border-slate-100 dark:border-slate-700">
        <p className="text-base font-bold text-gray-800 dark:text-gray-100 mb-6 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2.5 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-xl text-sm font-bold hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors focus:outline-none">취소</button>
          <button onClick={onConfirm} className="px-4 py-2.5 bg-rose-600 dark:bg-rose-500 text-white rounded-xl text-sm font-bold hover:bg-rose-700 dark:hover:bg-rose-600 transition-colors focus:outline-none">삭제</button>
        </div>
      </div>
    </div>
  );
}

// --- Icons ---
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
    try { await updateLessons(editData); setIsEditMode(false); addToast('저장되었습니다.', 'success'); } 
    catch { addToast('저장에 실패했습니다. 다시 시도해주세요.'); }
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
      <header className="p-4 md:p-8 shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center bg-white dark:bg-slate-800 border-b border-gray-100 dark:border-slate-700 z-10 sticky top-0 shadow-sm gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">수업 계획서</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 md:mt-2 text-xs md:text-sm">차시별 제목과 간략한 비고를 작성하여 전체 진도를 설계합니다.</p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          {isEditMode ? (
            <>
              <button onClick={handleCancelEdit} className="flex-1 md:flex-none bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 px-5 py-3 md:py-2.5 rounded-xl text-sm font-bold hover:bg-gray-200 transition-colors">취소</button>
              <button onClick={handleSaveAll} className="flex-1 md:flex-none bg-indigo-600 dark:bg-indigo-500 text-white px-5 py-3 md:py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-700 shadow-sm transition-colors">일괄 저장</button>
            </>
          ) : (
            <button onClick={() => { setEditData(lessons); setIsEditMode(true); }} className="flex-1 md:flex-none bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-200 px-5 py-3 md:py-2.5 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors shadow-sm">일괄 수정</button>
          )}
          <button onClick={handleAdd} className="flex-1 md:flex-none bg-slate-800 dark:bg-indigo-600 text-white px-5 py-3 md:py-2.5 rounded-xl text-sm font-bold hover:bg-slate-700 shadow-sm transition-colors">+ 추가</button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="hidden md:block bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 overflow-x-auto">
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
                      <td className="px-6 py-3"><input type="text" value={lesson.title} onChange={e => handleEditChange(lesson.id, 'title', e.target.value)} className="w-full border border-indigo-200 dark:border-indigo-800/60 p-2.5 rounded-lg text-base md:text-sm font-bold bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" placeholder="수업 제목 입력" /></td>
                      <td className="px-6 py-3"><input type="text" value={lesson.memo} onChange={e => handleEditChange(lesson.id, 'memo', e.target.value)} className="w-full border border-indigo-200 dark:border-indigo-800/60 p-2.5 rounded-lg text-base md:text-sm bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" placeholder="교사용 메모 입력" /></td>
                      <td className="px-6 py-3 text-center">
                        <div className="flex justify-center items-center gap-1">
                          <button aria-label="위로 이동" onClick={() => moveLesson(index, -1)} disabled={index === 0} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors disabled:opacity-30 disabled:hover:bg-transparent">▲</button>
                          <button aria-label="아래로 이동" onClick={() => moveLesson(index, 1)} disabled={index === displayData.length - 1} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors disabled:opacity-30 disabled:hover:bg-transparent">▼</button>
                          <button aria-label="수업 삭제" onClick={() => deleteLesson(lesson.id)} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors font-bold ml-1">✕</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-6 py-5 font-bold text-gray-800 dark:text-gray-200">{lesson.title || <span className="text-gray-300 dark:text-slate-600 font-normal italic">제목 없음</span>}</td>
                      <td className="px-6 py-5 text-gray-600 dark:text-slate-400 text-sm whitespace-pre-wrap">{lesson.memo || '-'}</td>
                      <td className="px-6 py-5 text-center">
                        <div className="flex justify-center items-center gap-1 opacity-10 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                          <button aria-label="위로 이동" onClick={() => moveLesson(index, -1)} disabled={index === 0} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md disabled:opacity-30">▲</button>
                          <button aria-label="아래로 이동" onClick={() => moveLesson(index, 1)} disabled={index === displayData.length - 1} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md disabled:opacity-30">▼</button>
                          <button aria-label="수업 삭제" onClick={() => deleteLesson(lesson.id)} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors font-bold ml-1">✕</button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="md:hidden space-y-4">
          {displayData.map((lesson, index) => (
            <div key={lesson.id} className={`bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border ${isEditMode ? 'border-indigo-300 dark:border-indigo-700' : 'border-gray-200 dark:border-slate-700'} flex flex-col gap-4`}>
              <div className="flex justify-between items-center border-b border-gray-100 dark:border-slate-700/50 pb-3">
                <span className="font-black text-xl text-indigo-600 dark:text-indigo-400">{lesson.order}차시</span>
                <div className="flex items-center gap-2">
                  <button aria-label="위로 이동" onClick={() => moveLesson(index, -1)} disabled={index === 0} className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-xl disabled:opacity-30 bg-gray-50 dark:bg-slate-900 text-lg">▲</button>
                  <button aria-label="아래로 이동" onClick={() => moveLesson(index, 1)} disabled={index === displayData.length - 1} className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-xl disabled:opacity-30 bg-gray-50 dark:bg-slate-900 text-lg">▼</button>
                  <button aria-label="수업 삭제" onClick={() => deleteLesson(lesson.id)} className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-xl font-bold ml-1 bg-gray-50 dark:bg-slate-900 text-lg">✕</button>
                </div>
              </div>
              {isEditMode ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">수업 제목</label>
                    <input type="text" value={lesson.title} onChange={e => handleEditChange(lesson.id, 'title', e.target.value)} className="w-full border border-indigo-200 dark:border-indigo-800/60 p-3.5 rounded-xl text-base font-bold bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" placeholder="수업 제목 입력" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">교사용 메모</label>
                    <textarea value={lesson.memo} onChange={e => handleEditChange(lesson.id, 'memo', e.target.value)} className="w-full border border-indigo-200 dark:border-indigo-800/60 p-3.5 rounded-xl text-base bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm min-h-[100px]" placeholder="메모 입력" />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="font-bold text-xl text-gray-800 dark:text-gray-100">{lesson.title || <span className="text-gray-300 dark:text-slate-600 font-normal italic">제목 없음</span>}</div>
                  <div className="text-gray-600 dark:text-slate-400 text-base whitespace-pre-wrap bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl leading-relaxed">{lesson.memo || '메모 없음'}</div>
                </div>
              )}
            </div>
          ))}
          {displayData.length === 0 && (
            <div className="p-10 text-center text-gray-400 dark:text-slate-500 font-bold bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700">
              등록된 수업 계획이 없습니다.
            </div>
          )}
        </div>
      </div>
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
      <header className="p-4 md:p-8 shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center bg-white dark:bg-slate-800 border-b border-gray-100 dark:border-slate-700 z-10 sticky top-0 shadow-sm">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">업무 체크리스트</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 md:mt-2 text-xs md:text-sm">마감일(D-Day)을 설정하면 주간 진도표 화면 상단에 자동으로 표시됩니다.</p>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-4 md:p-8 flex flex-col md:flex-row gap-6 items-start">
        <div className="w-full md:w-1/3 bg-white dark:bg-slate-800 p-5 md:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 shrink-0 md:sticky md:top-6">
          <h3 className="font-bold text-lg text-slate-800 dark:text-white mb-5 flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-indigo-500"></span>새 업무 등록</h3>
          <div className="space-y-5">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-700 pb-3">
              <label className="block text-sm font-bold text-gray-600 dark:text-gray-300">마감일 (D-Day) 지정</label>
              <label className="relative inline-flex items