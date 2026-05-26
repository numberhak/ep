import React, { useState, useEffect, useMemo, useRef, createContext, useContext } from 'react';
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
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};
const isFirebaseEnabled = !!firebaseConfig.apiKey && !!firebaseConfig.projectId;
const app = isFirebaseEnabled ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const appId = firebaseConfig.projectId || 'default-app-id';

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
export interface LessonPlan { id: string; name: string; classIds: string[]; lessons: Lesson[]; }
export interface WeeklySlot { dayOfWeek: number; period: number; }
export type ClassColor = 'blue' | 'green' | 'purple' | 'rose' | 'amber' | 'cyan';
export interface ClassSchedule { classId: string; className: string; startDate: string; color: ClassColor; weeklySlots: WeeklySlot[]; classScore?: number; groupScores?: number[]; }
export interface Holiday { id?: string; date: string; title: string; isHoliday?: boolean; }
export interface ClassEvent { id: string; classId: string; date: string; period: number; title: string; type: 'exception' | 'extra' | 'replace'; }
export interface ClassRecord { id: string; classId: string; date: string; content: string; important?: boolean; }
export interface UserProfile { name: string; subject: string; }
export interface Task { id: string; title: string; date?: string; completed: boolean; }

export interface ScoreLog { id: string; classId: string; date: string; time: string; type: 'class' | 'group'; groupIndex?: number; amount: number; label: string; }

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
        if (lessonIndex >= sortedLessons.length && !eventMap.has(`${dateStr}-${period}`)) break;
        const eventKey = `${dateStr}-${period}`;
        const classEvent = eventMap.get(eventKey);

        if (classEvent) {
          if (classEvent.type === 'exception') {
          } else if (classEvent.type === 'replace') {
            scheduledItems.push({ date: dateStr, period, type: 'event', event: classEvent, classId: schedule.classId });
          } else if (classEvent.type === 'extra') {
            if (lessonIndex < sortedLessons.length) {
              scheduledItems.push({ date: dateStr, period, type: 'lesson', lesson: sortedLessons[lessonIndex], classId: schedule.classId });
              lessonIndex++;
            }
          }
        } else if (baseSlots.includes(period) && !exceptionKeys.has(eventKey)) {
          if (lessonIndex < sortedLessons.length) {
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
const DEFAULT_LESSON_PLANS: LessonPlan[] = [
  { id: 'plan-default', name: '기본 수업계획서', classIds: [], lessons: MOCK_LESSONS },
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
  lessonPlans: LessonPlan[]; updateLessonPlans: (data: LessonPlan[]) => Promise<void>;
  classes: ClassSchedule[]; updateClasses: (data: ClassSchedule[]) => Promise<void>;
  holidays: Holiday[];     updateHolidays: (data: Holiday[]) => Promise<void>;
  events: ClassEvent[];    updateEvents: (data: ClassEvent[]) => Promise<void>;
  records: ClassRecord[];  updateRecords: (data: ClassRecord[]) => Promise<void>;
  tasks: Task[];           updateTasks: (data: Task[]) => Promise<void>;
  profile: UserProfile;    updateProfile: (data: UserProfile) => Promise<void>;
  menuOrder: string[];     updateMenuOrder: (data: string[]) => Promise<void>;
  scoreLogs: ScoreLog[];   updateScoreLogs: (data: ScoreLog[]) => Promise<void>;
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
        <p className="text-base font-bold text-gray-800 dark:text-gray-100 mb-6 leading-relaxed whitespace-pre-line">{message}</p>
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
const IconLeft       = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>;
const IconRight      = () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>;

// ==========================================
// LessonPlanPage
// ==========================================
function LessonPlanPage() {
  const { lessons, updateLessons, lessonPlans, updateLessonPlans, classes } = useContext(AppContext)!;
  const addToast = useContext(ToastContext);
  const fallbackPlans: LessonPlan[] = lessonPlans.length > 0 ? lessonPlans : [
    { id: 'plan-default', name: '기본 수업계획서', classIds: [], lessons }
  ];

  const [selectedPlanId, setSelectedPlanId] = useState<string>(fallbackPlans[0]?.id || '');
  const [isEditMode, setIsEditMode] = useState(false);
  const [editData, setEditData] = useState<Lesson[]>([]);
  const [editPlanName, setEditPlanName] = useState('');
  const [editClassIds, setEditClassIds] = useState<string[]>([]);
  const [planToDelete, setPlanToDelete] = useState<LessonPlan | null>(null);

  const activePlan = fallbackPlans.find(p => p.id === selectedPlanId) || fallbackPlans[0];

  useEffect(() => {
    if (fallbackPlans.length > 0 && !fallbackPlans.some(p => p.id === selectedPlanId)) {
      setSelectedPlanId(fallbackPlans[0].id);
    }
  }, [fallbackPlans, selectedPlanId]);

  useEffect(() => {
    if (!activePlan) return;
    setEditData([...(activePlan.lessons || [])].sort((a, b) => a.order - b.order));
    setEditPlanName(activePlan.name);
    setEditClassIds([...(activePlan.classIds || [])]);
  }, [activePlan]);

  const getAssignedClassNames = (plan: LessonPlan) => {
    const ids = plan.classIds || [];
    if (ids.length === 0) {
      return plan.id === fallbackPlans[0]?.id ? '미배정 학급 기본 적용' : '적용 학급 없음';
    }
    return ids
      .map(id => classes.find(c => c.classId === id)?.className)
      .filter(Boolean)
      .join(', ');
  };

  const persistPlans = async (nextPlans: LessonPlan[]) => {
    await updateLessonPlans(nextPlans);
    if (nextPlans[0]) await updateLessons(nextPlans[0].lessons);
  };

  const startEditCurrentPlan = () => {
    if (!activePlan) return;
    setEditData([...(activePlan.lessons || [])].sort((a, b) => a.order - b.order));
    setEditPlanName(activePlan.name);
    setEditClassIds([...(activePlan.classIds || [])]);
    setIsEditMode(true);
  };

  const handleSelectPlan = (planId: string) => {
    setIsEditMode(false);
    setSelectedPlanId(planId);
  };

  const handleAddPlan = async () => {
    const newPlan: LessonPlan = {
      id: `plan-${Date.now()}`,
      name: `새 수업계획서 ${fallbackPlans.length + 1}`,
      classIds: [],
      lessons: [{ id: `l-${Date.now()}`, order: 1, title: '', memo: '' }]
    };
    try {
      await persistPlans([...fallbackPlans, newPlan]);
      setSelectedPlanId(newPlan.id);
      setEditPlanName(newPlan.name);
      setEditClassIds([]);
      setEditData(newPlan.lessons);
      setIsEditMode(true);
      addToast('새 수업계획서를 추가했습니다.', 'success');
    } catch {
      addToast('수업계획서 추가에 실패했습니다.');
    }
  };

  const handleDeletePlan = async (planId: string) => {
    if (fallbackPlans.length <= 1) { addToast('수업계획서는 최소 1개가 필요합니다.'); return; }
    const nextPlans = fallbackPlans.filter(p => p.id !== planId);
    try {
      await persistPlans(nextPlans);
      setSelectedPlanId(nextPlans[0]?.id || '');
      setIsEditMode(false);
      setPlanToDelete(null);
      addToast('수업계획서를 삭제했습니다.', 'success');
    } catch {
      addToast('수업계획서 삭제에 실패했습니다.');
    }
  };

  const handleSaveAll = async () => {
    if (!activePlan) return;
    if (!editPlanName.trim()) { addToast('수업계획서 이름을 입력해주세요.'); return; }
    const normalizedLessons = editData.map((l, i) => ({ ...l, order: i + 1 }));
    const selectedClassSet = new Set(editClassIds);
    const nextPlans = fallbackPlans.map(plan => {
      if (plan.id === activePlan.id) {
        return { ...plan, name: editPlanName.trim(), classIds: editClassIds, lessons: normalizedLessons };
      }
      return { ...plan, classIds: (plan.classIds || []).filter(id => !selectedClassSet.has(id)) };
    });

    try {
      await persistPlans(nextPlans);
      setIsEditMode(false);
      addToast('저장되었습니다.', 'success');
    } catch {
      addToast('저장에 실패했습니다. 다시 시도해주세요.');
    }
  };

  const handleCancelEdit = () => {
    if (activePlan) {
      setEditData([...(activePlan.lessons || [])].sort((a, b) => a.order - b.order));
      setEditPlanName(activePlan.name);
      setEditClassIds([...(activePlan.classIds || [])]);
    }
    setIsEditMode(false);
  };

  const saveActivePlanLessons = async (nextLessons: Lesson[]) => {
    if (!activePlan) return;
    const nextPlans = fallbackPlans.map(plan => plan.id === activePlan.id ? { ...plan, lessons: nextLessons } : plan);
    await persistPlans(nextPlans);
  };

  const handleAdd = () => {
    const base = isEditMode ? editData : (activePlan?.lessons || []);
    const newOrder = base.length > 0 ? Math.max(...base.map(l => l.order)) + 1 : 1;
    const newLesson: Lesson = { id: `l-${Date.now()}`, order: newOrder, title: '', memo: '' };
    setEditData([...base, newLesson]);
    if (activePlan) setEditPlanName(activePlan.name);
    if (activePlan) setEditClassIds([...(activePlan.classIds || [])]);
    setIsEditMode(true);
  };

  const deleteLesson = async (id: string) => {
    const base = isEditMode ? editData : (activePlan?.lessons || []);
    const newData = base.filter(l => l.id !== id).map((l, i) => ({ ...l, order: i + 1 }));
    if (isEditMode) {
      setEditData(newData);
    } else {
      try { await saveActivePlanLessons(newData); addToast('삭제되었습니다.', 'success'); } catch { addToast('삭제에 실패했습니다.'); }
    }
  };

  const moveLesson = async (index: number, direction: -1 | 1) => {
    const base = isEditMode ? editData : (activePlan?.lessons || []);
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= base.length) return;
    const newData = base.map((l, i) => {
      if (i === index) return { ...base[targetIndex], order: index + 1 };
      if (i === targetIndex) return { ...base[index], order: targetIndex + 1 };
      return l;
    });
    if (isEditMode) {
      setEditData(newData);
    } else {
      try { await saveActivePlanLessons(newData); } catch { addToast('순서 변경에 실패했습니다.'); }
    }
  };

  const handleEditChange = (id: string, field: 'title' | 'memo', value: string) => {
    setEditData(editData.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  const toggleClassAssignment = (classId: string) => {
    setEditClassIds(prev => prev.includes(classId) ? prev.filter(id => id !== classId) : [...prev, classId]);
  };

  const displayData = (isEditMode ? editData : (activePlan?.lessons || [])).slice().sort((a, b) => a.order - b.order);

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500 bg-slate-50/30 dark:bg-slate-900/50 relative">
      <header className="p-4 md:p-8 shrink-0 flex flex-col gap-4 bg-white dark:bg-slate-800 border-b border-gray-100 dark:border-slate-700 z-10 sticky top-0 shadow-sm">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">수업 계획서</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1 md:mt-2 text-xs md:text-sm">수업계획서를 여러 개 만들고, 학급별로 서로 다른 계획을 적용합니다.</p>
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            {isEditMode ? (
              <>
                <button onClick={handleCancelEdit} className="flex-1 md:flex-none bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 px-5 py-3 md:py-2.5 rounded-xl text-sm font-bold hover:bg-gray-200 transition-colors">취소</button>
                <button onClick={handleSaveAll} className="flex-1 md:flex-none bg-indigo-600 dark:bg-indigo-500 text-white px-5 py-3 md:py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-700 shadow-sm transition-colors">일괄 저장</button>
              </>
            ) : (
              <button onClick={startEditCurrentPlan} className="flex-1 md:flex-none bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-200 px-5 py-3 md:py-2.5 rounded-xl text-sm font-bold hover:bg-gray-50 transition-colors shadow-sm">계획서 수정</button>
            )}
            <button onClick={handleAdd} className="flex-1 md:flex-none bg-slate-800 dark:bg-indigo-600 text-white px-5 py-3 md:py-2.5 rounded-xl text-sm font-bold hover:bg-slate-700 shadow-sm transition-colors">+ 차시 추가</button>
            <button onClick={handleAddPlan} className="flex-1 md:flex-none bg-violet-600 dark:bg-violet-500 text-white px-5 py-3 md:py-2.5 rounded-xl text-sm font-bold hover:bg-violet-700 shadow-sm transition-colors">+ 계획서 추가</button>
          </div>
        </div>

        <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
          {fallbackPlans.map(plan => {
            const isSelected = activePlan?.id === plan.id;
            return (
              <button
                key={plan.id}
                onClick={() => handleSelectPlan(plan.id)}
                className={`min-w-[220px] text-left p-4 rounded-2xl border transition-all ${isSelected ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-600 shadow-sm' : 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className={`text-sm font-black truncate ${isSelected ? 'text-indigo-800 dark:text-indigo-200' : 'text-slate-800 dark:text-slate-200'}`}>{plan.name}</div>
                    <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mt-1 truncate">{getAssignedClassNames(plan)}</div>
                  </div>
                  <span className="text-[10px] font-black px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 shrink-0">{plan.lessons.length}차시</span>
                </div>
              </button>
            );
          })}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-4">
        {activePlan && (
          <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 p-4 md:p-5">
            {isEditMode ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-[minmax(240px,360px)_1fr] gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5">수업계획서 이름</label>
                    <input value={editPlanName} onChange={e => setEditPlanName(e.target.value)} className="w-full border border-indigo-200 dark:border-indigo-800/60 p-3 rounded-xl text-sm font-bold bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="예: 2학년 정규 수업" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5">적용 학급</label>
                    <div className="flex flex-wrap gap-2">
                      {classes.length > 0 ? classes.map(cls => (
                        <button
                          key={cls.classId}
                          type="button"
                          onClick={() => toggleClassAssignment(cls.classId)}
                          className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${editClassIds.includes(cls.classId) ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                        >
                          {cls.className}
                        </button>
                      )) : <span className="text-xs font-bold text-slate-400">등록된 학급이 없습니다.</span>}
                    </div>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2">한 학급은 하나의 수업계획서에만 배정됩니다. 선택한 학급은 다른 계획서 배정에서 자동으로 제외됩니다.</p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button onClick={() => setPlanToDelete(activePlan)} disabled={fallbackPlans.length <= 1} className="px-3 py-2 rounded-xl text-xs font-bold bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-300 border border-rose-100 dark:border-rose-900/40 hover:bg-rose-100 disabled:opacity-40 disabled:hover:bg-rose-50">현재 계획서 삭제</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-black text-slate-900 dark:text-white">{activePlan.name}</h2>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-1">적용 학급: {getAssignedClassNames(activePlan)}</p>
                </div>
                <div className="text-xs font-bold text-slate-400 dark:text-slate-500">미배정 학급은 첫 번째 수업계획서를 기본으로 사용합니다.</div>
              </div>
            )}
          </section>
        )}

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
                  <td className="px-6 py-5 font-black text-indigo-600 dark:text-indigo-400 whitespace-nowrap">{index + 1}차시</td>
                  {isEditMode ? (
                    <>
                      <td className="px-6 py-3"><input type="text" value={lesson.title} onChange={e => handleEditChange(lesson.id, 'title', e.target.value)} className="w-full border border-indigo-200 dark:border-indigo-800/60 p-2.5 rounded-lg text-base md:text-sm font-bold bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" placeholder="수업 제목 입력" /></td>
                      <td className="px-6 py-3"><input type="text" value={lesson.memo} onChange={e => handleEditChange(lesson.id, 'memo', e.target.value)} className="w-full border border-indigo-200 dark:border-indigo-800/60 p-2.5 rounded-lg text-base md:text-sm bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm" placeholder="교사용 메모 입력" /></td>
                      <td className="px-6 py-3 text-center">
                        <div className="flex justify-center items-center gap-1">
                          <button aria-label="위로 이동" onClick={() => moveLesson(index, -1)} disabled={index === 0} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors disabled:opacity-30 disabled:hover:bg-transparent">▲</button>
                          <button aria-label="아래로 이동" onClick={() => moveLesson(index, 1)} disabled={index === displayData.length - 1} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors disabled:opacity-30 disabled:hover:bg-transparent">▼</button>
                          <button aria-label="차시 삭제" onClick={() => deleteLesson(lesson.id)} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors font-bold">×</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-6 py-5 font-bold text-gray-900 dark:text-gray-100">{lesson.title || '제목 없음'}</td>
                      <td className="px-6 py-5 text-gray-500 dark:text-gray-400 text-sm">{lesson.memo}</td>
                      <td className="px-6 py-5 text-center">
                        <div className="flex justify-center items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button aria-label="위로 이동" onClick={() => moveLesson(index, -1)} disabled={index === 0} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md disabled:opacity-30">▲</button>
                          <button aria-label="아래로 이동" onClick={() => moveLesson(index, 1)} disabled={index === displayData.length - 1} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md disabled:opacity-30">▼</button>
                          <button aria-label="차시 삭제" onClick={() => deleteLesson(lesson.id)} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md font-bold">×</button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {displayData.length === 0 && (
                <tr><td colSpan={4} className="px-6 py-12 text-center text-slate-400 font-bold">등록된 차시가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="md:hidden space-y-3">
          {displayData.map((lesson, index) => (
            <div key={lesson.id} className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm">
              <div className="flex justify-between items-start gap-3 mb-3">
                <span className="text-sm font-black text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1 rounded-lg">{index + 1}차시</span>
                <div className="flex gap-1">
                  <button aria-label="위로 이동" onClick={() => moveLesson(index, -1)} disabled={index === 0} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-indigo-600 disabled:opacity-30">▲</button>
                  <button aria-label="아래로 이동" onClick={() => moveLesson(index, 1)} disabled={index === displayData.length - 1} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-indigo-600 disabled:opacity-30">▼</button>
                  <button aria-label="차시 삭제" onClick={() => deleteLesson(lesson.id)} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-600 font-bold">×</button>
                </div>
              </div>
              {isEditMode ? (
                <div className="space-y-2">
                  <input type="text" value={lesson.title} onChange={e => handleEditChange(lesson.id, 'title', e.target.value)} className="w-full border border-indigo-200 dark:border-indigo-800/60 p-3 rounded-xl text-base font-bold bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="수업 제목 입력" />
                  <input type="text" value={lesson.memo} onChange={e => handleEditChange(lesson.id, 'memo', e.target.value)} className="w-full border border-indigo-200 dark:border-indigo-800/60 p-3 rounded-xl text-base bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="교사용 메모 입력" />
                </div>
              ) : (
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-gray-100 mb-1">{lesson.title || '제목 없음'}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{lesson.memo}</p>
                </div>
              )}
            </div>
          ))}
          {displayData.length === 0 && (
            <div className="bg-white dark:bg-slate-800 p-10 rounded-2xl border border-gray-100 dark:border-slate-700 text-center text-slate-400 font-bold">
              등록된 차시가 없습니다.
            </div>
          )}
        </div>
      </div>

      {planToDelete && (
        <ConfirmModal
          message={`${planToDelete.name} 수업계획서를 삭제하시겠습니까?\n이 계획서에 배정된 학급은 첫 번째 수업계획서를 기본으로 사용합니다.`}
          onConfirm={() => handleDeletePlan(planToDelete.id)}
          onCancel={() => setPlanToDelete(null)}
        />
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
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={hasDeadline} onChange={() => setHasDeadline(!hasDeadline)} className="sr-only peer" />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-600"></div>
              </label>
            </div>
            {hasDeadline && <input type="date" aria-label="업무 마감일" value={newDate} onChange={e => setNewDate(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-3.5 rounded-xl text-base font-bold bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all" />}
            <div>
              <label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">업무 내용</label>
              <input type="text" aria-label="업무 내용" value={newTitle} onChange={e => setNewTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()} className="w-full border border-gray-300 dark:border-slate-600 p-3.5 rounded-xl text-base bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="예: 수행평가 문제 출제" />
            </div>
            <button onClick={handleAdd} className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-base rounded-xl shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800">추가하기</button>
          </div>
        </div>
        <div className="w-full md:flex-1 space-y-3 pb-10">
          {sortedTasks.length > 0 ? sortedTasks.map(task => {
            const isOverdue = !task.completed && task.date && dateUtils.getDDay(task.date) < 0;
            const dday = task.date ? dateUtils.getDDay(task.date) : null;
            const ddayText = dday === null ? '' : dday === 0 ? 'D-Day' : dday > 0 ? `D-${dday}` : `D+${Math.abs(dday)}`;

            return (
              <div key={task.id} className={`flex items-center justify-between p-4 md:p-5 rounded-2xl border shadow-sm transition-all group ${task.completed ? 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 opacity-60' : isOverdue ? 'bg-rose-50/50 dark:bg-rose-900/10 border-rose-200 dark:border-rose-800/50' : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700'}`}>
                <div className="flex items-center gap-3 md:gap-5 overflow-hidden w-full">
                  <button aria-label="완료 토글" onClick={() => toggleTask(task.id)} className={`shrink-0 w-10 h-10 md:w-8 md:h-8 rounded-full border-2 flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${task.completed ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-gray-300 dark:border-gray-600 text-transparent hover:border-indigo-400 bg-white dark:bg-slate-900'}`}>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
                  </button>
                  <div className="flex flex-col min-w-0 flex-1 gap-1.5">
                    <span className={`text-base md:text-lg font-bold truncate ${task.completed ? 'line-through text-slate-500 dark:text-slate-400' : 'text-slate-800 dark:text-white'}`}>{task.title}</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      {task.date ? (
                        <>
                          <span className={`text-xs font-black px-2.5 py-1 rounded-lg ${task.completed ? 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400' : isOverdue ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300' : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'}`}>{task.date}</span>
                          {!task.completed && <span className={`text-lg md:text-xl font-black tracking-tight ${isOverdue ? 'text-rose-600 dark:text-rose-400' : 'text-indigo-600 dark:text-indigo-400'}`}>{ddayText}</span>}
                        </>
                      ) : (
                        <span className="text-xs font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700">마감일 없음</span>
                      )}
                    </div>
                  </div>
                </div>
                <button aria-label="업무 삭제" onClick={() => deleteTask(task.id)} className="shrink-0 text-gray-400 hover:text-rose-500 dark:hover:text-rose-400 p-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 rounded-lg">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
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
// ScoreLogTab Component
// ==========================================
function ScoreLogTab({
  classScoreLogs, scoreLogs, selectedClassId, activeClass, updateScoreLogs, addToast
}: {
  classScoreLogs: ScoreLog[];
  scoreLogs: ScoreLog[];
  selectedClassId: string;
  activeClass: ClassSchedule | undefined;
  updateScoreLogs: (data: ScoreLog[]) => Promise<void>;
  addToast: (msg: string, type?: 'error' | 'success') => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const remaining = scoreLogs.filter(l => !selectedIds.has(l.id));
    try {
      await updateScoreLogs(remaining);
      addToast(`${selectedIds.size}개의 이력을 삭제했습니다.`, 'success');
      setSelectedIds(new Set());
      setIsSelecting(false);
    } catch { addToast('삭제에 실패했습니다.'); }
  };

  const handleDeleteAll = async () => {
    const remaining = scoreLogs.filter(l => l.classId !== selectedClassId);
    try {
      await updateScoreLogs(remaining);
      addToast('이 학급의 점수 이력을 모두 삭제했습니다.', 'success');
      setSelectedIds(new Set());
      setIsSelecting(false);
    } catch { addToast('삭제에 실패했습니다.'); }
  };

  const colorStyle = activeClass ? COLOR_MAP[activeClass.color] : COLOR_MAP['blue'];

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-5 md:p-6">
      {/* 헤더 */}
      <div className="flex justify-between items-center mb-4 pb-4 border-b border-gray-200 dark:border-slate-700 shrink-0 gap-3 flex-wrap">
        <span className="text-sm font-bold text-slate-500 dark:text-slate-400">
          {classScoreLogs.length}개의 점수 변경 이력
          <span className="ml-2 text-xs text-slate-400 dark:text-slate-500 font-normal">(2주 이내)</span>
        </span>
        {classScoreLogs.length > 0 && (
          <div className="flex items-center gap-2">
            {isSelecting ? (
              <>
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                  {selectedIds.size}개 선택됨
                </span>
                <button
                  onClick={handleDeleteSelected}
                  disabled={selectedIds.size === 0}
                  className="text-xs font-bold text-white bg-rose-500 hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg transition-colors"
                >
                  선택 삭제
                </button>
                <button
                  onClick={() => { setIsSelecting(false); setSelectedIds(new Set()); }}
                  className="text-xs font-bold text-slate-500 dark:text-slate-400 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  취소
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setIsSelecting(true)}
                  className="text-xs font-bold text-indigo-600 dark:text-indigo-400 px-3 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800/50 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                >
                  선택 삭제
                </button>
                <button
                  onClick={handleDeleteAll}
                  className="text-xs font-bold text-rose-500 hover:text-rose-600 px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800/50 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                >
                  전체 삭제
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 전체 선택 체크박스 */}
      {isSelecting && classScoreLogs.length > 0 && (
        <div className="flex items-center gap-2 mb-3 px-1 shrink-0">
          <input
            type="checkbox"
            id="select-all-logs"
            checked={selectedIds.size === classScoreLogs.length}
            onChange={e => {
              if (e.target.checked) setSelectedIds(new Set(classScoreLogs.map(l => l.id)));
              else setSelectedIds(new Set());
            }}
            className="w-4 h-4 rounded accent-indigo-500"
          />
          <label htmlFor="select-all-logs" className="text-xs font-bold text-slate-500 dark:text-slate-400 cursor-pointer">
            전체 선택
          </label>
        </div>
      )}

      {/* 이력 목록 */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {classScoreLogs.length > 0 ? classScoreLogs.map(log => {
          const isPlus = log.amount > 0;
          const isSelected = selectedIds.has(log.id);
          return (
            <div
              key={log.id}
              onClick={() => isSelecting && toggleSelect(log.id)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-sm transition-colors ${
                isSelecting ? 'cursor-pointer' : ''
              } ${
                isSelected
                  ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-300 dark:border-indigo-700'
                  : 'bg-white dark:bg-slate-900/50 border-slate-100 dark:border-slate-700/50'
              }`}
            >
              {/* 선택 모드 체크박스 */}
              {isSelecting && (
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(log.id)}
                  onClick={e => e.stopPropagation()}
                  className="w-4 h-4 rounded accent-indigo-500 shrink-0"
                />
              )}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-base font-black shrink-0 ${isPlus ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400'}`}>
                {isPlus ? '+' : '−'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-black px-2 py-0.5 rounded-md ${colorStyle.bg} ${colorStyle.text}`}>{log.label}</span>
                  <span className={`text-base font-black ${isPlus ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {isPlus ? `+${log.amount}점` : `${log.amount}점`}
                  </span>
                </div>
                <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{log.date} {log.time}</div>
              </div>
              {/* 선택 모드 아닐 때 단건 삭제 */}
              {!isSelecting && (
                <button
                  aria-label="이 이력 삭제"
                  onClick={async e => {
                    e.stopPropagation();
                    try {
                      await updateScoreLogs(scoreLogs.filter(l => l.id !== log.id));
                      addToast('삭제되었습니다.', 'success');
                    } catch { addToast('삭제에 실패했습니다.'); }
                  }}
                  className="shrink-0 text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 p-1.5 rounded-lg transition-colors focus:outline-none"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              )}
            </div>
          );
        }) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 pt-12">
            <span className="text-4xl mb-3">🏅</span>
            <p className="font-bold text-base">아직 점수 변경 이력이 없습니다.</p>
            <p className="text-sm mt-1">위의 점수 카드에서 점수를 변경해보세요.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// RecordsPage
// ==========================================
function ScoreCard({ title, score, onUpdate, colorStyle }: { title: string; score: number; onUpdate: (amount: number) => void; colorStyle: any }) {
  const [customInput, setCustomInput] = useState<number | ''>('');
  const handleApply = () => {
    if (customInput === '' || isNaN(Number(customInput))) return;
    onUpdate(Number(customInput));
    setCustomInput('');
  };

  return (
    <div className="bg-white/80 dark:bg-slate-800/80 p-4 md:p-5 rounded-2xl shadow-sm border border-white dark:border-slate-700 min-w-[160px] flex-1 flex flex-col backdrop-blur-sm shrink-0 snap-center">
      <div className={`text-sm md:text-sm font-black ${colorStyle.text} opacity-80 mb-1`}>{title}</div>
      <div className="text-4xl md:text-3xl font-black text-gray-800 dark:text-white mb-4">{score}점</div>
      <div className="flex gap-2 mb-3">
        <button aria-label={`${title} 1점 추가`} onClick={() => onUpdate(1)} className="flex-1 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-200 rounded-xl text-lg md:text-base font-black py-3 md:py-2 transition-colors shadow-sm">+1</button>
        <button aria-label={`${title} 1점 차감`} onClick={() => onUpdate(-1)} className="flex-1 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-200 rounded-xl text-lg md:text-base font-black py-3 md:py-2 transition-colors shadow-sm">-1</button>
      </div>
      <div className="flex gap-2 mt-auto">
        <input type="number" aria-label={`${title} 사용자 입력 점수`} value={customInput} onChange={e => setCustomInput(e.target.value === '' ? '' : Number(e.target.value))} className="w-full text-base border border-gray-200 dark:border-slate-600 p-3 rounded-xl text-center font-bold outline-none focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 text-gray-900 dark:text-white" placeholder="점수" />
        <button aria-label={`${title} 점수 반영`} onClick={handleApply} className="bg-slate-800 dark:bg-indigo-600 text-white text-sm px-4 rounded-xl font-bold hover:bg-slate-700 dark:hover:bg-indigo-500 whitespace-nowrap shadow-sm">반영</button>
      </div>
    </div>
  );
}

function RecordsPage() {
  const { classes, updateClasses, records, updateRecords, scoreLogs, updateScoreLogs, pageParams } = useContext(AppContext)!;
  const addToast = useContext(ToastContext);

  const [selectedClassId, setSelectedClassId] = useState<string>(pageParams?.classId || (classes[0]?.classId || ''));
  const [newDate, setNewDate] = useState(dateUtils.formatDate(new Date()));
  const [newContent, setNewContent] = useState('');
  const [newImportant, setNewImportant] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'records' | 'scorelog'>('records');

  const [exportStartDate, setExportStartDate] = useState(dateUtils.formatDate(dateUtils.addDays(new Date(), -30)));
  const [exportEndDate, setExportEndDate] = useState(dateUtils.formatDate(new Date()));

  useEffect(() => { if (pageParams?.classId) setSelectedClassId(pageParams.classId); }, [pageParams]);

  const activeClass = classes.find(c => c.classId === selectedClassId);
  const classRecords = records.filter(r => r.classId === selectedClassId).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const importantRecords = classRecords.filter(r => r.important);
  // 2주 이내 이력만 표시 (오래된 건 자동 제외)
  const twoWeeksAgo = dateUtils.formatDate(dateUtils.addDays(new Date(), -14));
  const classScoreLogs = scoreLogs
    .filter(l => l.classId === selectedClassId && l.date >= twoWeeksAgo)
    .sort((a, b) => (`${b.date}${b.time}` < `${a.date}${a.time}` ? -1 : 1));

  const handleSave = async () => {
    if (!newContent.trim() || !selectedClassId) return;
    const newRecord: ClassRecord = { id: `rec-${Date.now()}`, classId: selectedClassId, date: newDate, content: newContent, important: newImportant };
    try { await updateRecords([...records, newRecord]); setNewContent(''); setNewImportant(false); addToast('기록이 저장되었습니다.', 'success'); } catch { addToast('저장에 실패했습니다.'); }
  };

  const handleDelete = async (id: string) => {
    try { await updateRecords(records.filter(r => r.id !== id)); addToast('삭제되었습니다.', 'success'); } catch { addToast('삭제에 실패했습니다.'); } finally { setConfirmDeleteId(null); }
  };

  // 점수 디바운스: pending 상태를 ref로 관리해 빠른 연속 클릭을 1회 저장으로 묶음
  const pendingScoreRef = useRef<{
    classScore: number;
    groupScores: number[];
    logs: ScoreLog[];
  } | null>(null);
  const scoreDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // scoreLogs의 최신값을 항상 참조하기 위한 ref (클로저 stale 문제 방지)
  const scoreLogsRef = useRef<ScoreLog[]>(scoreLogs);
  useEffect(() => { scoreLogsRef.current = scoreLogs; }, [scoreLogs]);

  const handleUpdateScore = (type: 'class' | 'group', amount: number, index?: number) => {
    if (!activeClass) return;
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const label = type === 'class' ? '학급 전체' : `${(index ?? 0) + 1}모둠`;

    // pending이 없으면 현재 값으로 초기화
    if (!pendingScoreRef.current) {
      pendingScoreRef.current = {
        classScore: activeClass.classScore ?? 0,
        groupScores: [...(activeClass.groupScores ?? [0,0,0,0,0])],
        logs: [],
      };
    }

    // pending에 누적
    if (type === 'class') {
      pendingScoreRef.current.classScore += amount;
    } else if (type === 'group' && index !== undefined) {
      pendingScoreRef.current.groupScores[index] += amount;
    }
    const newLog: ScoreLog = {
      id: `sl-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      classId: activeClass.classId,
      date: dateUtils.formatDate(now),
      time: timeStr,
      type,
      groupIndex: index,
      amount,
      label,
    };
    pendingScoreRef.current.logs.unshift(newLog);

    // UI는 즉시 반영 (낙관적 업데이트)
    const optimisticClasses = classes.map(c => {
      if (c.classId !== activeClass.classId) return c;
      if (type === 'class') return { ...c, classScore: pendingScoreRef.current!.classScore };
      if (type === 'group' && index !== undefined) {
        return { ...c, groupScores: [...pendingScoreRef.current!.groupScores] };
      }
      return c;
    });
    updateClasses(optimisticClasses);

    // 2주 이내 기존 이력을 누적 보존 (scoreLogsRef로 최신값 참조)
    const twoWeeksAgo = dateUtils.formatDate(dateUtils.addDays(new Date(), -14));
    const freshLogs = scoreLogsRef.current.filter(l => l.date >= twoWeeksAgo);
    updateScoreLogs([...pendingScoreRef.current.logs, ...freshLogs.filter(l => l.classId !== activeClass.classId || !pendingScoreRef.current!.logs.find(pl => pl.id === l.id))]);

    // 1.2초 후 Firestore에 실제 저장 (디바운스)
    if (scoreDebounceTimer.current) clearTimeout(scoreDebounceTimer.current);
    scoreDebounceTimer.current = setTimeout(async () => {
      try {
        const finalClasses = classes.map(c => {
          if (c.classId !== activeClass.classId) return c;
          return {
            ...c,
            classScore: pendingScoreRef.current!.classScore,
            groupScores: [...pendingScoreRef.current!.groupScores],
          };
        });
        // 디바운스 실행 시점의 최신 scoreLogs를 ref로 참조해 기존 이력 보존
        const allFreshLogs = scoreLogsRef.current.filter(l => l.date >= twoWeeksAgo);
        const merged = [
          ...pendingScoreRef.current!.logs,
          ...allFreshLogs.filter(l => !pendingScoreRef.current!.logs.find(pl => pl.id === l.id))
        ];
        await updateClasses(finalClasses);
        await updateScoreLogs(merged);
        pendingScoreRef.current = null;
      } catch { addToast('점수 저장에 실패했습니다.'); }
    }, 1200);
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
          <p className="text-gray-600 dark:text-gray-400 mt-1 md:mt-2 text-xs md:text-sm">선택한 학급의 누적 점수와 특이사항을 기록합니다.</p>
        </div>
        <select aria-label="기록할 학급 선택" value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)} className="w-full sm:w-auto text-base bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm border border-gray-300 dark:border-slate-600 text-gray-800 dark:text-white px-4 py-3.5 rounded-xl font-bold shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="" disabled>학급을 선택하세요</option>
          {classes.map(c => <option key={c.classId} value={c.classId}>{c.className}</option>)}
        </select>
      </header>

      {activeClass ? (
        <div className="flex-1 flex flex-col min-h-0 gap-4 md:gap-6 pb-4 md:pb-0">
          {/* 점수 카드 */}
          <div className="flex gap-4 overflow-x-auto pb-4 shrink-0 scrollbar-hide snap-x md:snap-none">
            <ScoreCard title="🏅 학급 전체 점수" score={activeClass.classScore ?? 0} onUpdate={amt => handleUpdateScore('class', amt)} colorStyle={COLOR_MAP[activeClass.color]} />
            {Array.from({ length: 5 }).map((_, i) => (
              <ScoreCard key={i} title={`👥 ${i + 1}모둠 점수`} score={(activeClass.groupScores ?? [0, 0, 0, 0, 0])[i]} onUpdate={amt => handleUpdateScore('group', amt, i)} colorStyle={COLOR_MAP[activeClass.color]} />
            ))}
          </div>

          {/* 중요 기록 핀 영역 */}
          {importantRecords.length > 0 && (
            <div className="shrink-0 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-2xl p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base">⭐</span>
                <span className="text-xs font-black text-amber-700 dark:text-amber-400 uppercase tracking-widest">중요 기록</span>
              </div>
              <div className="flex flex-col gap-2">
                {importantRecords.map(rec => (
                  <div key={rec.id} className="flex items-start gap-3 bg-white dark:bg-slate-800/60 rounded-xl px-4 py-3 border border-amber-100 dark:border-amber-800/40 shadow-sm">
                    <span className="text-xs font-black text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 px-2 py-1 rounded-lg shrink-0 mt-0.5">{rec.date}</span>
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed flex-1">{rec.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex-1 flex flex-col md:flex-row gap-4 md:gap-6 min-h-0">
            {/* 왼쪽: 기록 작성 */}
            <div className="w-full md:w-1/3 flex flex-col gap-4 shrink-0 order-1 md:h-full">
              <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm p-5 md:p-6 rounded-3xl shadow-sm border border-white dark:border-slate-700 h-full flex flex-col">
                <h3 className="font-bold text-lg text-slate-800 dark:text-white mb-5 flex items-center gap-2"><span className={`w-3 h-3 rounded-full ${COLOR_MAP[activeClass.color].bg} border border-gray-300 dark:border-slate-600`}></span>{activeClass.className} 새 기록 작성</h3>
                <div className="space-y-5 flex-1 flex flex-col">
                  <div><label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">날짜</label><input type="date" aria-label="기록 날짜" value={newDate} onChange={e => setNewDate(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-3.5 rounded-xl text-base font-bold bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" /></div>
                  <div className="flex-1 flex flex-col"><label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">내용</label><textarea aria-label="기록 내용" value={newContent} onChange={e => setNewContent(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-4 rounded-xl text-base flex-1 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 text-gray-900 dark:text-white min-h-[140px] md:min-h-0" placeholder="이 학급의 오늘 수업 분위기, 특이사항 등을 남겨주세요." /></div>
                  <label className={`flex items-center gap-3 cursor-pointer select-none px-4 py-3 rounded-xl border transition-colors ${newImportant ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-600' : 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700 hover:border-amber-300 dark:hover:border-amber-600'}`}>
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${newImportant ? 'bg-amber-400 border-amber-400' : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'}`}>
                      {newImportant && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                    </div>
                    <input type="checkbox" className="sr-only" checked={newImportant} onChange={e => setNewImportant(e.target.checked)} />
                    <span className={`text-sm font-bold ${newImportant ? 'text-amber-700 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>⭐ 중요 기록으로 표시</span>
                  </label>
                  <button onClick={handleSave} className="w-full py-4 bg-slate-800 dark:bg-indigo-600 hover:bg-slate-900 dark:hover:bg-indigo-500 text-white text-base font-bold rounded-xl shadow-sm transition-colors mt-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 dark:focus-visible:ring-indigo-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800">기록 저장하기</button>
                </div>
              </div>
            </div>

            {/* 오른쪽: 탭 (기록 내역 / 점수 이력) */}
            <div className="flex-1 flex flex-col bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-3xl shadow-sm border border-white dark:border-slate-700 overflow-hidden min-h-[400px] md:min-h-0 order-2">
              {/* 탭 헤더 */}
              <div className="flex border-b border-gray-200 dark:border-slate-700 shrink-0">
                <button
                  onClick={() => setActiveTab('records')}
                  className={`flex-1 py-4 px-5 text-sm font-bold transition-colors focus:outline-none ${activeTab === 'records' ? 'text-slate-800 dark:text-white border-b-2 border-indigo-500' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}
                >
                  <span className="flex items-center justify-center gap-2"><IconNotebook /> 기록 내역</span>
                </button>
                <button
                  onClick={() => setActiveTab('scorelog')}
                  className={`flex-1 py-4 px-5 text-sm font-bold transition-colors focus:outline-none ${activeTab === 'scorelog' ? 'text-slate-800 dark:text-white border-b-2 border-indigo-500' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}
                >
                  <span className="flex items-center justify-center gap-2">🏅 점수 이력</span>
                </button>
              </div>

              {activeTab === 'records' ? (
                <div className="flex-1 flex flex-col overflow-hidden p-5 md:p-6">
                  <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-4 pb-4 border-b border-gray-200 dark:border-slate-700 gap-3 shrink-0">
                    <span className="text-sm font-bold text-slate-500 dark:text-slate-400">{classRecords.length}개의 기록</span>
                    <div className="flex items-center gap-2 bg-white/80 dark:bg-slate-900/80 p-2 rounded-xl border border-gray-200 dark:border-slate-600 shadow-sm overflow-x-auto max-w-full scrollbar-hide">
                      <input type="date" aria-label="내보내기 시작 날짜" value={exportStartDate} onChange={e => setExportStartDate(e.target.value)} className="text-xs md:text-sm font-bold bg-transparent border-none outline-none px-2 text-gray-600 dark:text-gray-300 shrink-0" />
                      <span className="text-gray-400 dark:text-gray-500 text-xs font-bold">~</span>
                      <input type="date" aria-label="내보내기 종료 날짜" value={exportEndDate} onChange={e => setExportEndDate(e.target.value)} className="text-xs md:text-sm font-bold bg-transparent border-none outline-none px-2 text-gray-600 dark:text-gray-300 shrink-0" />
                      <button onClick={handleExportCSV} className="bg-green-600 dark:bg-green-500 hover:bg-green-700 dark:hover:bg-green-600 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-sm transition-colors ml-1 shrink-0">Excel 저장</button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto pr-2 space-y-4">
                    {classRecords.length > 0 ? classRecords.map(rec => (
                      <div key={rec.id} className={`p-5 rounded-2xl shadow-sm border group relative transition-colors ${rec.important ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-700/50' : 'bg-white dark:bg-slate-900/50 border-slate-100 dark:border-slate-700/50'}`}>
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg text-sm font-black tracking-wider">{rec.date}</div>
                            {rec.important && <span className="text-xs font-black text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 px-2.5 py-1 rounded-lg border border-amber-200 dark:border-amber-700/50">⭐ 중요</span>}
                          </div>
                          <div className="flex items-center gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
                            <button
                              aria-label={rec.important ? '중요 해제' : '중요로 표시'}
                              onClick={async () => {
                                const updated = records.map(r => r.id === rec.id ? { ...r, important: !r.important } : r);
                                try { await updateRecords(updated); } catch { addToast('변경에 실패했습니다.'); }
                              }}
                              className={`text-sm px-2.5 py-1 rounded-lg font-bold transition-colors focus:outline-none ${rec.important ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30' : 'text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20'}`}
                            >
                              {rec.important ? '★' : '☆'}
                            </button>
                            <button aria-label="기록 삭제" onClick={() => setConfirmDeleteId(rec.id)} className="text-rose-500 text-base font-bold hover:underline focus:outline-none p-1">삭제</button>
                          </div>
                        </div>
                        <div className="text-slate-700 dark:text-slate-200 text-base whitespace-pre-wrap leading-relaxed font-medium">{rec.content}</div>
                      </div>
                    )) : (
                      <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500"><IconNotebook /><p className="mt-4 font-bold text-base">등록된 기록이 없습니다.</p></div>
                    )}
                  </div>
                </div>
              ) : (
                <ScoreLogTab
                  classScoreLogs={classScoreLogs}
                  scoreLogs={scoreLogs}
                  selectedClassId={selectedClassId}
                  activeClass={activeClass}
                  updateScoreLogs={updateScoreLogs}
                  addToast={addToast}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500 font-bold text-lg">학급을 선택해주세요.</div>
      )}
    </div>
  );
}

// ==========================================
// ManagePage
// ==========================================
function ManagePage() {
  const { lessons, lessonPlans, classes, holidays, events, tasks, goToPage, updateEvents } = useContext(AppContext)!;
  const addToast = useContext(ToastContext);
  const [selectedClassId, setSelectedClassId] = useState<string>('all');
  
  // 날짜 선택 기준을 현재 날짜로 유지하기 위한 상태 추가
  const [selectedDate, setSelectedDate] = useState<string>(dateUtils.formatDate(new Date()));
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(dateUtils.getStartOfWeek(dateUtils.formatDate(new Date())));
  const [selectedItem, setSelectedItem] = useState<{ item: ScheduledItem; classInfo: ClassSchedule } | null>(null);

  useEffect(() => {
    if (selectedClassId !== 'all' && !classes.some(c => c.classId === selectedClassId)) {
      setSelectedClassId('all');
    }
  }, [classes, selectedClassId]);

  const [isModifying, setIsModifying] = useState(false);
  const [modifyType, setModifyType] = useState<'move' | 'cancel' | 'replace'>('move');
  const [targetDate, setTargetDate] = useState('');
  const [targetPeriod, setTargetPeriod] = useState<number>(1);
  const [replaceTitle, setReplaceTitle] = useState('');

  const daysInWeek = Array.from({ length: 5 }, (_, i) => dateUtils.addDays(currentWeekStart, i));
  const weekEndDateStr = dateUtils.formatDate(dateUtils.addDays(currentWeekStart, 4));

  const todayStr = dateUtils.formatDate(new Date());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const todayColRef = useRef<HTMLDivElement>(null);
  const periodRowRefs = useRef<(HTMLDivElement | null)[]>([]);
  // 주 이동 방향: 'next' = 다음 주(월요일로), 'prev' = 이전 주(금요일로), 'today' = 오늘 열로
  const weekNavDirectionRef = useRef<'next' | 'prev' | 'today'>('today');

  // 터치 스크롤 방향 고정을 위한 refs
  const touchStartXRef = useRef<number>(0);
  const touchStartYRef = useRef<number>(0);
  const touchDirectionRef = useRef<'horizontal' | 'vertical' | null>(null);
  const scrollLeftAtStartRef = useRef<number>(0);
  const scrollTopAtStartRef = useRef<number>(0);

  // 교시별 수업 시간 정의 (시작 HH*60+MM ~ 종료 HH*60+MM)
  const PERIOD_TIMES: { period: number; start: number; end: number }[] = [
    { period: 1, start: 8*60+50,  end: 9*60+35  },
    { period: 2, start: 9*60+45,  end: 10*60+30 },
    { period: 3, start: 10*60+40, end: 11*60+25 },
    { period: 4, start: 11*60+35, end: 12*60+20 },
    { period: 5, start: 13*60+20, end: 14*60+5  },
    { period: 6, start: 14*60+15, end: 15*60+0  },
    { period: 7, start: 15*60+10, end: 15*60+55 },
  ];

  const getCurrentPeriod = (): number | null => {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    for (const pt of PERIOD_TIMES) {
      if (nowMinutes >= pt.start && nowMinutes <= pt.end) return pt.period;
    }
    return null;
  };

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const direction = weekNavDirectionRef.current;

    // 세로 스크롤: 현재 교시 행으로 이동 (수업 시간 외에는 최상단)
    const currentPeriod = getCurrentPeriod();
    const periodRow = currentPeriod !== null ? periodRowRefs.current[currentPeriod - 1] : null;
    const scrollTop = periodRow ? Math.max(0, periodRow.offsetTop - 80) : 0;

    if (direction === 'next') {
      container.scrollTo({ left: 0, top: scrollTop, behavior: 'smooth' });
    } else if (direction === 'prev') {
      container.scrollTo({ left: container.scrollWidth, top: scrollTop, behavior: 'smooth' });
    } else {
      const todayCol = todayColRef.current;
      if (todayCol) {
        const colLeft = todayCol.offsetLeft;
        const scrollLeft = Math.max(0, colLeft - 76);
        container.scrollTo({ left: scrollLeft, top: scrollTop, behavior: 'smooth' });
      } else {
        container.scrollTo({ left: 0, top: scrollTop, behavior: 'smooth' });
      }
    }
  }, [currentWeekStart]);

  // iOS Safari용 non-passive 터치 스크롤 제어
  // scrollContainerRef가 준비된 뒤 리스너를 붙이고, 언마운트 시 정리
  useEffect(() => {
    // ref가 붙을 때까지 기다림 (분할화면 레이아웃 재계산 대응)
    let container: HTMLDivElement | null = null;
    let rafId: number;

    const attach = () => {
      container = scrollContainerRef.current;
      if (!container) {
        rafId = requestAnimationFrame(attach);
        return;
      }

      const onTouchStart = (e: TouchEvent) => {
        if (!container) return;
        touchStartXRef.current = e.touches[0].clientX;
        touchStartYRef.current = e.touches[0].clientY;
        scrollLeftAtStartRef.current = container.scrollLeft;
        scrollTopAtStartRef.current = container.scrollTop;
        touchDirectionRef.current = null;
      };

      const onTouchMove = (e: TouchEvent) => {
        if (!container) return;
        const dx = e.touches[0].clientX - touchStartXRef.current;
        const dy = e.touches[0].clientY - touchStartYRef.current;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        if (!touchDirectionRef.current && (absDx > 6 || absDy > 6)) {
          touchDirectionRef.current = absDx >= absDy ? 'horizontal' : 'vertical';
        }

        // 방향이 결정되면 무조건 preventDefault — iOS 바운스/양방향 이동 원천 차단
        if (touchDirectionRef.current) {
          e.preventDefault();
        }

        if (touchDirectionRef.current === 'horizontal') {
          const maxLeft = container.scrollWidth - container.clientWidth;
          container.scrollLeft = Math.max(0, Math.min(scrollLeftAtStartRef.current - dx, maxLeft));
        } else if (touchDirectionRef.current === 'vertical') {
          const maxTop = container.scrollHeight - container.clientHeight;
          container.scrollTop = Math.max(0, Math.min(scrollTopAtStartRef.current - dy, maxTop));
        }
      };

      // touchstart: passive:true (스크롤 시작 지연 없음)
      // touchmove: passive:false 필수 — iOS Safari에서 preventDefault 실제 작동
      container.addEventListener('touchstart', onTouchStart, { passive: true });
      container.addEventListener('touchmove', onTouchMove, { passive: false });

      // cleanup 함수 저장
      (container as any).__touchCleanup = () => {
        container!.removeEventListener('touchstart', onTouchStart);
        container!.removeEventListener('touchmove', onTouchMove);
      };
    };

    rafId = requestAnimationFrame(attach);

    return () => {
      cancelAnimationFrame(rafId);
      if (container && (container as any).__touchCleanup) {
        (container as any).__touchCleanup();
      }
    };
  }, []);

  const schedulesToRender = useMemo(() => {
    const targetClasses = selectedClassId === 'all' ? classes : classes.filter(c => c.classId === selectedClassId);
    const allItems: { item: ScheduledItem; classInfo: ClassSchedule }[] = [];
    const plans = lessonPlans.length > 0 ? lessonPlans : [{ id: 'plan-default', name: '기본 수업계획서', classIds: [], lessons }];
    const fallbackPlan = plans[0];

    targetClasses.forEach(cls => {
      const assignedPlan = plans.find(plan => (plan.classIds || []).includes(cls.classId)) || fallbackPlan;
      const clsLessons = assignedPlan?.lessons || lessons;
      const clsSchedule = generateClassLessonSchedule(clsLessons, cls, holidays, events, weekEndDateStr);
      clsSchedule.forEach(item => allItems.push({ item, classInfo: cls }));
    });
    return allItems;
  }, [lessons, lessonPlans, classes, holidays, events, weekEndDateStr, selectedClassId]);

  const scheduleMap = new Map<string, { item: ScheduledItem; classInfo: ClassSchedule }[]>();
  schedulesToRender.forEach(data => {
    const key = `${data.item.date}-${data.item.period}`;
    if (!scheduleMap.has(key)) scheduleMap.set(key, []);
    scheduleMap.get(key)!.push(data);
  });

  const periods = [1, 2, 3, 4, 5, 6, 7];
  const dayNames = ['월', '화', '수', '목', '금'];

  const handleModifySchedule = async () => {
    if (!selectedItem) return;

    const { date, period, classId } = selectedItem.item;
    let filteredEvents = [...events];

    if (selectedItem.item.type === 'event' && selectedItem.item.event) {
      filteredEvents = filteredEvents.filter(e => e.id !== selectedItem.item.event!.id);
    }

    if (modifyType === 'cancel' || modifyType === 'move') { 
      filteredEvents.push({ id: `e-${Date.now()}-1`, classId, date, period, title: modifyType === 'move' ? '시간표 변경 (이동)' : '휴강', type: 'exception' }); 
    }
    if (modifyType === 'move') {
      if (!targetDate) { addToast('보강 날짜를 선택해주세요.'); return; }
      filteredEvents.push({ id: `e-${Date.now()}-2`, classId, date: targetDate, period: targetPeriod, title: '시간표 변경 (보강)', type: 'extra' });
    }
    if (modifyType === 'replace') {
      if (!replaceTitle.trim()) { addToast('변경할 수업 내용을 입력해주세요.'); return; }
      filteredEvents = filteredEvents.filter(e => !(e.classId === classId && e.date === date && e.period === period && e.type === 'replace'));
      filteredEvents.push({ id: `e-${Date.now()}`, classId, date, period, title: replaceTitle, type: 'replace' });
    }

    try { 
      await updateEvents(filteredEvents); 
      setSelectedItem(null); 
      setIsModifying(false); 
      addToast('일정 변경이 적용되었습니다.', 'success'); 
    } catch { 
      addToast('일정 변경에 실패했습니다.'); 
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    try { await updateEvents(events.filter(e => e.id !== eventId)); setSelectedItem(null); setIsModifying(false); addToast('변경 사항이 취소되었습니다.', 'success'); } catch { addToast('취소 처리에 실패했습니다.'); }
  };

  const noDeadlineTasks = tasks.filter(t => !t.completed && !t.date);
  const deadlinedWeekTasks = tasks.filter(t => !t.completed && t.date);

  return (
    <div className="p-4 md:p-6 h-full flex flex-col animate-in fade-in duration-500 bg-slate-50/50 dark:bg-slate-900/50">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4 shrink-0">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white tracking-tight shrink-0">주간 진도표</h1>
          <select aria-label="진도표 학급 선택" value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)} className="w-full md:w-auto text-base md:text-sm bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-white px-4 py-2.5 md:py-1.5 rounded-lg font-bold shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="all">전체 학급 보기</option>
            {classes.map(c => <option key={c.classId} value={c.classId}>{c.className}</option>)}
          </select>
        </div>
      </header>

      {/* 진행중 업무 배너 */}
      {(noDeadlineTasks.length > 0 || deadlinedWeekTasks.length > 0) && (
        <div className="mb-3 bg-white dark:bg-slate-800 border border-indigo-100 dark:border-indigo-900/50 rounded-xl px-4 py-3 shadow-sm flex flex-wrap gap-2 items-center shrink-0">
          <span className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest shrink-0 mr-1">진행중</span>
          {noDeadlineTasks.map(t => (
            <span key={t.id} title={t.title} className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 max-w-[180px]">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0"></span>
              <span className="truncate">{t.title}</span>
            </span>
          ))}
          {deadlinedWeekTasks.map(t => {
            const dday = dateUtils.getDDay(t.date!);
            const ddayText = dday === 0 ? 'D-Day' : dday > 0 ? `D-${dday}` : `D+${Math.abs(dday)}`;
            const isToday = dday === 0;
            const isOverdue = dday < 0;
            const colorCls = isToday
              ? 'bg-rose-50 dark:bg-rose-900/30 border-rose-300 dark:border-rose-700/60 text-rose-700 dark:text-rose-200'
              : isOverdue
              ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800/40 text-rose-600 dark:text-rose-300'
              : 'bg-indigo-50 dark:bg-indigo-900/40 border-indigo-200 dark:border-indigo-700/60 text-indigo-700 dark:text-indigo-200';
            const ddayColorCls = isToday
              ? 'text-rose-600 dark:text-rose-400 font-black'
              : isOverdue
              ? 'text-rose-500 dark:text-rose-400 font-black'
              : 'text-indigo-600 dark:text-indigo-400 font-black';
            return (
              <span key={t.id} title={t.title} className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border max-w-[200px] ${colorCls}`}>
                <span className={`shrink-0 ${ddayColorCls}`}>{ddayText}</span>
                <span className="truncate">{t.title}</span>
              </span>
            );
          })}
        </div>
      )}

      <div ref={scrollContainerRef} className="flex-1 bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-auto flex flex-col relative min-w-0" style={{ overscrollBehavior: 'none', WebkitOverflowScrolling: 'auto' } as React.CSSProperties}>
        <div className="min-w-[700px]">
          {/* Header Row */}
          <div className="grid grid-cols-[60px_repeat(5,minmax(0,1fr))] bg-slate-100/80 dark:bg-slate-800/80 backdrop-blur-sm border-b border-gray-200 dark:border-slate-700 sticky top-0 z-10 shadow-sm min-h-[80px]">
            <div className="p-2 flex items-center justify-center text-[11px] font-bold text-slate-400 dark:text-slate-500 border-r border-gray-200 dark:border-slate-700 sticky left-0 z-20 bg-slate-100/80 dark:bg-slate-800/80 backdrop-blur-sm">교시</div>
            {daysInWeek.map((date, i) => {
              const dateStr = dateUtils.formatDate(date);
              const isToday = dateStr === todayStr;
              const dayHolidays = holidays.filter(h => h.date === dateStr && h.isHoliday !== false);
              const dayEvents = holidays.filter(h => h.date === dateStr && h.isHoliday === false);
              const isHolidayDay = dayHolidays.length > 0;
              const dayTasksForCell = tasks.filter(t => !t.completed && t.date && t.date === dateStr);

              return (
                <div
                  key={i}
                  ref={isToday ? todayColRef : undefined}
                  className={`p-2 flex flex-col items-center border-r border-gray-200 dark:border-slate-700 last:border-0 ${isHolidayDay ? 'bg-rose-50/80 dark:bg-rose-900/20' : isToday ? 'bg-indigo-50/80 dark:bg-indigo-900/20' : ''}`}
                >
                  <div className={`text-xs font-bold flex items-center justify-center gap-1 w-full ${isToday ? 'text-indigo-500 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`}>
                    {i === 0 && (
                      <button onClick={() => {
                        weekNavDirectionRef.current = 'prev';
                        const newWeekStart = dateUtils.addDays(currentWeekStart, -7);
                        setCurrentWeekStart(newWeekStart);
                        setSelectedDate(dateUtils.formatDate(newWeekStart));
                      }} className="p-1 -ml-2 text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 focus:outline-none" title="이전 주">
                        <IconLeft />
                      </button>
                    )}
                    {dayNames[i]}
                    {i === 4 && (
                      <button onClick={() => {
                        weekNavDirectionRef.current = 'next';
                        const newWeekStart = dateUtils.addDays(currentWeekStart, 7);
                        setCurrentWeekStart(newWeekStart);
                        setSelectedDate(dateUtils.formatDate(newWeekStart));
                      }} className="p-1 -mr-2 text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 focus:outline-none" title="다음 주">
                        <IconRight />
                      </button>
                    )}
                  </div>
                  <div className={`text-base md:text-xl font-black leading-tight ${isHolidayDay ? 'text-rose-500' : isToday ? 'text-white bg-indigo-500 rounded-full w-8 h-8 flex items-center justify-center text-base mt-0.5' : 'text-slate-800 dark:text-slate-200'}`}>{date.getDate()}</div>
                  {dayHolidays.map(h => <div key={h.id} className="text-[10px] font-bold text-rose-500 mt-0.5 text-center break-keep leading-tight">{h.title}</div>)}
                  {dayEvents.map(e => <div key={e.id} className="text-[10px] font-bold text-blue-600 dark:text-blue-400 mt-1 text-center bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded-md break-keep leading-tight">{e.title}</div>)}
                  
                  <div className="mt-1.5 flex flex-col gap-1 w-full">
                    {dayTasksForCell.map(t => {
                      const dday = dateUtils.getDDay(t.date!);
                      const ddayText = dday === 0 ? 'D-Day' : dday > 0 ? `D-${dday}` : `D+${Math.abs(dday)}`;
                      const isOverdue = dday < 0;
                      return (
                        <div key={t.id} title={t.title} className={`flex flex-col items-center gap-0.5 text-xs px-1.5 py-1.5 rounded-lg border w-full shadow-sm overflow-hidden ${isOverdue ? 'bg-rose-50 dark:bg-rose-900/30 border-rose-200 dark:border-rose-800/50' : 'bg-indigo-50 dark:bg-indigo-900/50 border-indigo-200 dark:border-indigo-700/80'}`}>
                          <span className={`text-sm font-black leading-none ${isOverdue ? 'text-rose-600 dark:text-rose-400' : 'text-indigo-600 dark:text-indigo-400'}`}>{ddayText}</span>
                          <span className={`w-full text-center text-[10px] font-bold leading-tight line-clamp-2 break-keep ${isOverdue ? 'text-rose-800 dark:text-rose-200' : 'text-indigo-800 dark:text-indigo-200'}`}>{t.title}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Time Slots */}
          <div className="divide-y divide-gray-100 dark:divide-slate-700/50 bg-slate-50/30 dark:bg-slate-900/20">
            {periods.map((period, pIdx) => (
              <div key={period} ref={el => { periodRowRefs.current[pIdx] = el; }} className="grid grid-cols-[60px_repeat(5,minmax(0,1fr))] min-h-[110px]">
                <div className="flex items-center justify-center border-r border-gray-200 dark:border-slate-700 bg-slate-100/80 dark:bg-slate-800/80 font-black text-slate-300 dark:text-slate-600 text-xl sticky left-0 z-10 backdrop-blur-sm shadow-[1px_0_0_0_rgba(0,0,0,0.05)]">{period}</div>
                {daysInWeek.map((date) => {
                  const dateStr = dateUtils.formatDate(date);
                  const isToday = dateStr === todayStr;
                  const isHoliday = holidays.some(h => h.date === dateStr && h.isHoliday !== false);
                  const cellItems = scheduleMap.get(`${dateStr}-${period}`) || [];

                  let isTargetSlot = false;
                  if (selectedClassId !== 'all') {
                    isTargetSlot = classes.find(c => c.classId === selectedClassId)?.weeklySlots.some(s => s.dayOfWeek === date.getDay() && s.period === period) || false;
                  } else {
                    isTargetSlot = classes.some(c => c.weeklySlots.some(s => s.dayOfWeek === date.getDay() && s.period === period));
                  }
                  
                  const shadingClass = !isTargetSlot && !isHoliday && !isToday ? 'bg-gray-100/80 dark:bg-slate-800/40 opacity-70' : '';
                  const todayClass = isToday && !isHoliday ? 'bg-indigo-50/40 dark:bg-indigo-900/10' : '';

                  return (
                    <div key={dateStr} className={`p-2 border-r border-gray-200 dark:border-slate-700 last:border-0 ${isHoliday ? 'bg-rose-50/80 dark:bg-rose-900/20' : todayClass || shadingClass} flex flex-col gap-1.5`}>
                      {cellItems.length > 0 ? (
                        cellItems.map((data, idx) => {
                          const style = COLOR_MAP[data.classInfo.color];
                          const isSelected = selectedItem?.item.date === data.item.date && selectedItem?.item.period === data.item.period && selectedItem?.classInfo.classId === data.classInfo.classId;
                          
                          if (data.item.type === 'lesson') {
                            return (
                              <button key={idx} aria-label={`${data.classInfo.className} ${data.item.lesson?.order}차시 ${data.item.lesson?.title}`} onClick={() => { setSelectedItem(data); setIsModifying(false); }} className={`w-full text-left p-2.5 rounded-lg shadow-sm transition-all text-xs group focus:outline-none ${style.ring} focus-visible:ring-offset-1 ${style.bg} ${isSelected ? `border-l-[6px] ${style.leftBorder} border-y-transparent border-r-transparent shadow-md` : `border ${style.border} ${style.hover}`}`}>
                                <div className={`font-black ${style.text} opacity-90 leading-tight truncate`}>
                                  {data.classInfo.className}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                  <span className="shrink-0 text-[11px] font-bold opacity-80 bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded-md dark:text-white/80">{data.classInfo.classScore || 0}점</span>
                                  <span className="shrink-0 text-[10px] bg-white/60 dark:bg-black/20 px-1.5 py-0.5 rounded font-bold dark:text-white/80">{data.item.lesson?.order}차시</span>
                                </div>
                                <div className="mt-1.5 font-bold text-gray-800 dark:text-gray-100 leading-snug line-clamp-2 break-keep text-sm">{data.item.lesson?.title}</div>
                              </button>
                            );
                          } else {
                            const isReplace = data.item.event?.type === 'replace';
                            
                            if (isReplace) {
                              return (
                                <button key={idx} aria-label={`${data.classInfo.className} 내용변경 일정: ${data.item.event?.title}`} onClick={() => { setSelectedItem(data); setIsModifying(false); }} className={`w-full text-left p-2.5 rounded-lg shadow-sm transition-all text-xs group focus:outline-none ${style.ring} focus-visible:ring-offset-1 ${style.bg} ${isSelected ? `border-l-[6px] ${style.leftBorder} border-y-transparent border-r-transparent shadow-md` : `border ${style.border} ${style.hover}`}`}>
                                  <div className={`font-black ${style.text} opacity-90 leading-tight truncate`}>
                                    {data.classInfo.className}
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-1">
                                    <span className="shrink-0 text-[11px] font-bold opacity-80 bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded-md dark:text-white/80">{data.classInfo.classScore || 0}점</span>
                                    <span className="shrink-0 text-[10px] bg-white/60 dark:bg-black/20 px-1.5 py-0.5 rounded font-bold dark:text-white/80">내용변경</span>
                                  </div>
                                  <div className="mt-1.5 font-bold text-gray-800 dark:text-gray-100 leading-snug line-clamp-2 break-keep text-sm">{data.item.event?.title}</div>
                                </button>
                              );
                            } else {
                              const typeText = '보강';
                              const eventBgClass = 'bg-indigo-50/80 dark:bg-indigo-900/30';
                              const eventBorderClass = isSelected ? 'border-l-[6px] border-l-indigo-500 border-y-transparent border-r-transparent shadow-md' : 'border border-indigo-200 dark:border-indigo-800/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 hover:border-indigo-400 dark:hover:border-indigo-600';
                              const eventTextClass = 'text-indigo-700 dark:text-indigo-400';
                              const eventBadgeClass = 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-300';
                        
                              return (
                                <button key={idx} aria-label={`${data.classInfo.className} ${typeText} 일정: ${data.item.event?.title}`} onClick={() => { setSelectedItem(data); setIsModifying(false); }} className={`w-full text-left ${eventBgClass} p-2.5 rounded-lg text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${eventBorderClass}`}>
                                  <div className={`font-black ${eventTextClass} opacity-90 leading-tight truncate`}>
                                    {data.classInfo.className}
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-1">
                                    <span className="shrink-0 text-[11px] font-bold opacity-80 bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded-md dark:text-white/80">{data.classInfo.classScore || 0}점</span>
                                    <span className={`shrink-0 text-[10px] ${eventBadgeClass} px-1.5 py-0.5 rounded font-bold`}>{typeText}</span>
                                  </div>
                                  <div className="mt-1.5 font-bold text-gray-800 dark:text-gray-100 leading-snug line-clamp-2 break-keep text-sm">{data.item.event?.title}</div>
                                </button>
                              );
                            }
                          }
                        })
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 하단 주간 이동 배너: 모바일에서는 텍스트 숨김 (hidden sm:block 적용) 및 선택 상태 관리 */}
      <div className="mt-4 p-4 bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
        <div className="hidden sm:block text-sm font-bold text-gray-700 dark:text-gray-300">
          현재 주간: {dateUtils.formatDate(daysInWeek[0])} ~ {dateUtils.formatDate(daysInWeek[4])}
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <input
            type="date"
            aria-label="이동할 주간 선택"
            value={selectedDate}
            onChange={(e) => {
              if (e.target.value) {
                weekNavDirectionRef.current = 'today';
                setSelectedDate(e.target.value);
                setCurrentWeekStart(dateUtils.getStartOfWeek(e.target.value));
              }
            }}
            className="w-full sm:w-auto border border-gray-300 dark:border-slate-600 p-2.5 rounded-xl text-sm font-bold bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={() => {
              weekNavDirectionRef.current = 'today';
              const today = dateUtils.formatDate(new Date());
              setSelectedDate(today);
              setCurrentWeekStart(dateUtils.getStartOfWeek(today));
            }}
            className="px-4 py-2.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded-xl text-sm font-bold hover:bg-indigo-200 whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            이번 주로
          </button>
        </div>
      </div>

      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 dark:bg-gray-900/70 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-100 dark:border-slate-700">
            <div className={`p-6 md:p-8 ${COLOR_MAP[selectedItem.classInfo.color].bg} border-b ${COLOR_MAP[selectedItem.classInfo.color].border}`}>
              <div className="flex justify-between items-start mb-3">
                <span className={`px-3 py-1.5 bg-white dark:bg-black/20 rounded-lg text-xs font-black shadow-sm ${COLOR_MAP[selectedItem.classInfo.color].text}`}>{selectedItem.classInfo.className}</span>
                <span className="text-xs font-bold text-slate-500 dark:text-slate-300 bg-white/50 dark:bg-black/20 px-3 py-1.5 rounded-lg">{selectedItem.item.date} ({selectedItem.item.period}교시)</span>
              </div>
              <h2 className="text-xl md:text-2xl font-black text-slate-800 dark:text-white mt-2 leading-snug">
                {selectedItem.item.type === 'lesson' 
                  ? `[${selectedItem.item.lesson?.order}차시] ${selectedItem.item.lesson?.title}` 
                  : (selectedItem.item.event?.type === 'replace' ? `[내용 변경] ${selectedItem.item.event?.title}` : `[보강] ${selectedItem.item.event?.title}`)
                }
              </h2>
            </div>
            <div className="p-6 md:p-8 space-y-6 text-sm">
              <div>
                <h4 className="text-xs font-black text-slate-400 uppercase mb-2">{selectedItem.item.type === 'lesson' ? '선생님 비고' : '일정 구분'}</h4>
                <div className="text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-900/50 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 whitespace-pre-wrap leading-relaxed text-base font-medium">
                  {selectedItem.item.type === 'lesson' 
                    ? (selectedItem.item.lesson?.memo || <span className="text-slate-400 italic">기록된 비고가 없습니다.</span>) 
                    : (selectedItem.item.event?.type === 'replace' ? '기존 수업 대신 변경된 일정입니다. (원래 차시는 다음으로 밀림)' : '추가 보강 수업입니다.')
                  }
                </div>
              </div>

              {selectedItem.item.type === 'lesson' ? (
                isModifying ? (
                  <div className="p-5 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800/50 rounded-2xl space-y-4 animate-in fade-in zoom-in-95">
                    <div className="flex flex-col gap-2.5 border-b border-orange-200/50 dark:border-orange-800/50 pb-4">
                      <label className="flex items-center gap-2 text-sm font-bold text-orange-900 dark:text-orange-300 cursor-pointer">
                        <input type="radio" checked={modifyType === 'replace'} onChange={() => setModifyType('replace')} className="w-4 h-4 text-orange-600 bg-white border-orange-300 focus:ring-orange-500" /> 내용 변경 (수행평가 등, 진도 밀림)
                      </label>
                      <label className="flex items-center gap-2 text-sm font-bold text-orange-900 dark:text-orange-300 cursor-pointer">
                        <input type="radio" checked={modifyType === 'move'} onChange={() => setModifyType('move')} className="w-4 h-4 text-orange-600 bg-white border-orange-300 focus:ring-orange-500" /> 이동 (현재시간 빈칸 + 보강생성, 진도 밀림)
                      </label>
                      <label className="flex items-center gap-2 text-sm font-bold text-orange-900 dark:text-orange-300 cursor-pointer">
                        <input type="radio" checked={modifyType === 'cancel'} onChange={() => setModifyType('cancel')} className="w-4 h-4 text-orange-600 bg-white border-orange-300 focus:ring-orange-500" /> 단순 결강 (현재시간 빈칸, 진도 밀림)
                      </label>
                    </div>
                    
                    {modifyType === 'replace' && (
                      <div>
                        <label className="block text-xs font-black text-orange-700 dark:text-orange-400 mb-2">이 시간에 진행할 내용</label>
                        <input
                          type="text"
                          value={replaceTitle}
                          onChange={e => setReplaceTitle(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleModifySchedule()}
                          autoFocus
                          placeholder="예: 수행평가, 학교 행사 등"
                          className="w-full border border-orange-300 dark:border-orange-700 p-3 text-sm font-bold rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                        />
                        <p className="text-[11px] text-orange-600 dark:text-orange-400 mt-1.5 font-bold">⚠️ 기존 차시는 다음 수업으로 밀립니다.</p>
                      </div>
                    )}

                    {modifyType === 'move' && (
                      <div>
                        <label className="block text-xs font-black text-orange-700 dark:text-orange-400 mb-2">이동할 날짜 및 교시 (보강)</label>
                        <div className="flex gap-2">
                          <input type="date" aria-label="보강 날짜" value={targetDate} onChange={e => setTargetDate(e.target.value)} className="flex-1 border border-orange-300 dark:border-orange-700 p-3 text-sm font-bold rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500" />
                          <select aria-label="보강 교시" value={targetPeriod} onChange={e => setTargetPeriod(Number(e.target.value))} className="w-24 border border-orange-300 dark:border-orange-700 p-3 text-sm font-bold rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500">
                            {[1,2,3,4,5,6,7].map(p => <option key={p} value={p}>{p}교시</option>)}
                          </select>
                        </div>
                        <p className="text-[11px] text-orange-600 dark:text-orange-400 mt-1.5 font-bold">⚠️ 현재 슬롯이 빈칸이 되고, 지정한 날짜/교시로 보강이 추가됩니다.</p>
                      </div>
                    )}

                    {modifyType === 'cancel' && (
                      <p className="text-[11px] text-orange-600 dark:text-orange-400 font-bold">⚠️ 현재 슬롯이 빈칸이 되고, 해당 차시는 이후 수업으로 밀립니다.</p>
                    )}
                    
                    <div className="flex justify-end gap-2 pt-2">
                      <button onClick={() => setIsModifying(false)} className="px-5 py-2.5 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 text-sm font-bold rounded-xl hover:bg-gray-50 transition-colors shadow-sm">취소</button>
                      <button onClick={handleModifySchedule} className="px-5 py-2.5 bg-orange-600 dark:bg-orange-500 hover:bg-orange-700 text-white text-sm font-bold rounded-xl transition-colors shadow-sm">변경 적용</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setIsModifying(true); setModifyType('replace'); setTargetDate(''); setTargetPeriod(1); setReplaceTitle(''); }} className="w-full py-4 bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-400 font-bold text-sm rounded-2xl hover:bg-orange-200 border border-orange-200 dark:border-orange-800 transition-colors flex items-center justify-center gap-2">
                    <IconCalendar /> 시간표 변경 (결강/이동/내용변경)
                  </button>
                )
              ) : (
                <div className="space-y-3">
                  {selectedItem.item.event?.type === 'replace' ? (
                    isModifying ? (
                      <div className="p-5 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800/50 rounded-2xl space-y-4 animate-in fade-in zoom-in-95">
                        <label className="block text-xs font-black text-orange-700 dark:text-orange-400 mb-2">수업 내용 다시 변경</label>
                        <input
                          type="text"
                          value={replaceTitle}
                          onChange={e => setReplaceTitle(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleModifySchedule()}
                          autoFocus
                          placeholder="새로운 수업 내용 입력"
                          className="w-full border border-orange-300 dark:border-orange-700 p-3 text-sm font-bold rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                        />
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setIsModifying(false)} className="px-4 py-2.5 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 text-sm font-bold rounded-xl hover:bg-gray-50 transition-colors">취소</button>
                          <button onClick={handleModifySchedule} className="px-4 py-2.5 bg-orange-600 dark:bg-orange-500 hover:bg-orange-700 text-white text-sm font-bold rounded-xl transition-colors">변경 적용</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <button
                          onClick={() => { setIsModifying(true); setModifyType('replace'); setReplaceTitle(selectedItem.item.event?.title || ''); }}
                          className="w-full py-3.5 bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-400 font-bold text-sm rounded-2xl hover:bg-orange-200 border border-orange-200 dark:border-orange-800 transition-colors flex items-center justify-center gap-2"
                        >
                          ✏️ 수업 내용 다시 변경
                        </button>
                        <button onClick={() => handleDeleteEvent(selectedItem.item.event!.id)} className="w-full py-3.5 bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 font-bold text-sm rounded-2xl hover:bg-rose-100 border border-rose-200 dark:border-rose-800 transition-colors flex items-center justify-center gap-2">
                          ✕ 원상복구 (원래 차시로 되돌리기)
                        </button>
                      </div>
                    )
                  ) : (
                    <button onClick={() => handleDeleteEvent(selectedItem.item.event!.id)} className="w-full py-4 bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 font-bold text-sm rounded-2xl hover:bg-rose-100 border border-rose-200 dark:border-rose-800 transition-colors flex items-center justify-center gap-2">
                      ✕ 이 일정 변경사항 취소 (원상복구)
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="p-6 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
              <button onClick={() => { setSelectedItem(null); goToPage('records', { classId: selectedItem.classInfo.classId }); }} className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 text-sm font-bold hover:bg-indigo-50 px-4 py-2.5 rounded-xl transition-colors">
                <IconNotebook /> 기록장 이동
              </button>
              <button onClick={() => setSelectedItem(null)} className="px-6 py-2.5 bg-slate-800 dark:bg-slate-700 text-white text-sm font-bold rounded-xl hover:bg-slate-700 transition-colors">닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// SettingsPage
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
    <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border-2 border-indigo-200 dark:border-indigo-500/50 shadow-sm flex flex-col gap-5">
      <div className="flex justify-between items-center border-b border-gray-100 dark:border-slate-700 pb-3">
        <h3 className="text-base font-bold text-gray-900 dark:text-white">학급 정보 수정</h3>
        <div className="flex gap-2">
          <button onClick={onCancel} className="px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 rounded-lg text-sm font-bold">취소</button>
          <button onClick={onSave} className="px-4 py-2 bg-indigo-600 dark:bg-indigo-500 text-white rounded-lg text-sm font-bold">저장</button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div><label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5">학급 이름</label><input type="text" aria-label="수정할 학급 이름" value={editClassName} onChange={e => setEditClassName(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-2.5 rounded-xl text-sm font-bold bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none" /></div>
          <div><label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5">라벨 색상</label>{renderColorPicker(editClassColor, setEditClassColor)}</div>
          <div><label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5">학기 시작일</label><input type="date" aria-label="수정할 시작일" value={editStartDate} onChange={e => setEditStartDate(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-2.5 rounded-xl text-sm font-bold bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none" /></div>
        </div>
        <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-2xl border border-slate-200 dark:border-slate-700">
          <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-3">시간표 편집</label>
          <div className="flex gap-2 mb-3">
            <select aria-label="수정할 요일" value={slotDay} onChange={e => setSlotDay(Number(e.target.value))} className="border border-gray-300 dark:border-slate-600 p-2 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm font-bold flex-1 outline-none focus:ring-2 focus:ring-indigo-500">
              {dayNames.map((d, i) => i > 0 && i < 6 && <option key={i} value={i}>{d}요일</option>)}
            </select>
            <select aria-label="수정할 교시" value={slotPeriod} onChange={e => setSlotPeriod(Number(e.target.value))} className="border border-gray-300 dark:border-slate-600 p-2 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm font-bold w-20 outline-none focus:ring-2 focus:ring-indigo-500">
              {[1,2,3,4,5,6,7].map(p => <option key={p} value={p}>{p}교시</option>)}
            </select>
            <button aria-label="시간표 슬롯 추가" onClick={addSlotToEditClass} className="bg-slate-800 dark:bg-slate-700 text-white px-3 rounded-lg text-sm font-bold hover:bg-slate-700">추가</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {editSlots.map((s, i) => (
              <span key={i} className="bg-white dark:bg-slate-800 text-gray-800 dark:text-gray-200 border border-gray-300 dark:border-slate-600 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 shadow-sm">
                {dayNames[s.dayOfWeek]} {s.period}교시
                <button aria-label={`${dayNames[s.dayOfWeek]}요일 ${s.period}교시 삭제`} onClick={() => setEditSlots(editSlots.filter((_, idx) => idx !== i))} className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-full w-5 h-5 flex items-center justify-center">✕</button>
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
      <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-3xl shadow-xl p-6 md:p-8 animate-in zoom-in-95 border border-slate-100 dark:border-slate-700">
        <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">새 학급 추가</h3>
        {classError && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm rounded-lg font-bold">{classError}</div>}
        <div className="space-y-4 text-sm">
          <div><label className="block font-bold text-gray-700 dark:text-gray-300 mb-1.5">학급 이름</label><input type="text" aria-label="새 학급 이름" value={newClassName} onChange={e => setNewClassName(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-3 rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" /></div>
          <div><label className="block font-bold text-gray-700 dark:text-gray-300 mb-1.5">라벨 색상</label>{renderColorPicker(newClassColor, setNewClassColor)}</div>
          <div><label className="block font-bold text-gray-700 dark:text-gray-300 mb-1.5">시작일</label><input type="date" aria-label="학기 시작일" value={newStartDate} onChange={e => setNewStartDate(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-3 rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold" /></div>
          <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-slate-700">
            <label className="block font-bold text-gray-700 dark:text-gray-300 mb-2">시간표 등록</label>
            <div className="flex gap-2 mb-3">
              <select aria-label="새 요일" value={slotDay} onChange={e => setSlotDay(Number(e.target.value))} className="border border-gray-300 dark:border-slate-600 p-2 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white flex-1 font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500">
                {dayNames.map((d, i) => i > 0 && i < 6 && <option key={i} value={i}>{d}요일</option>)}
              </select>
              <select aria-label="새 교시" value={slotPeriod} onChange={e => setSlotPeriod(Number(e.target.value))} className="border border-gray-300 dark:border-slate-600 p-2 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white w-20 font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500">
                {[1,2,3,4,5,6,7].map(p => <option key={p} value={p}>{p}교시</option>)}
              </select>
              <button aria-label="새 슬롯 추가" onClick={addSlotToNewClass} className="bg-slate-800 dark:bg-slate-700 text-white px-3 rounded-lg font-bold">추가</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {newSlots.map((s, i) => (
                <span key={i} className="bg-white dark:bg-slate-800 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-slate-600 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2">
                  {dayNames[s.dayOfWeek]} {s.period}교시
                  <button aria-label={`${dayNames[s.dayOfWeek]}요일 ${s.period}교시 새 슬롯 삭제`} onClick={() => setNewSlots(newSlots.filter((_, idx) => idx !== i))} className="text-red-500 font-bold ml-1">✕</button>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="px-5 py-2.5 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-xl text-sm font-bold">취소</button>
          <button onClick={handleAdd} className="px-5 py-2.5 bg-slate-800 dark:bg-indigo-600 text-white rounded-xl text-sm font-bold">저장</button>
        </div>
      </div>
    </div>
  );
}

interface ClassManageModalProps {
  classes: ClassSchedule[];
  onClose: () => void;
  onEdit: (cls: ClassSchedule) => void;
  onDelete: (cls: ClassSchedule) => void;
}
function ClassManageModal({ classes, onClose, onEdit, onDelete }: ClassManageModalProps) {
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 dark:bg-gray-900/70 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 w-full max-w-2xl max-h-[86vh] overflow-hidden rounded-3xl shadow-xl animate-in zoom-in-95 border border-slate-100 dark:border-slate-700 flex flex-col">
        <div className="p-6 md:p-7 border-b border-slate-100 dark:border-slate-700 flex justify-between items-start gap-4">
          <div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">운영 학급 수정</h3>
            <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-1">학급 삭제는 이 화면에서만 진행되며, 삭제 전 확인 창이 한 번 더 표시됩니다.</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 font-black hover:bg-slate-200 dark:hover:bg-slate-600">×</button>
        </div>
        <div className="p-4 md:p-6 overflow-y-auto space-y-3">
          {classes.length > 0 ? classes.map(cls => (
            <div key={cls.classId} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${COLOR_MAP[cls.color].bg} border border-gray-300/60 shrink-0`}></span>
                  <span className="font-black text-slate-900 dark:text-white truncate">{cls.className}</span>
                </div>
                <div className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-2 flex flex-wrap gap-1.5">
                  <span className="px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">시작일 {cls.startDate}</span>
                  {cls.weeklySlots.map((slot, idx) => (
                    <span key={idx} className="px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">{dayNames[slot.dayOfWeek]} {slot.period}교시</span>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => onEdit(cls)} className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-800/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/50">시간표·색상 수정</button>
                <button onClick={() => onDelete(cls)} className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-300 border border-rose-100 dark:border-rose-900/40 hover:bg-rose-100 dark:hover:bg-rose-900/40">삭제</button>
              </div>
            </div>
          )) : (
            <div className="p-10 text-center rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 font-bold">등록된 운영 학급이 없습니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}

interface EventModalProps { classId: string; className: string; onClose: () => void; onAdd: (event: ClassEvent) => void; }
function EventModal({ classId, className, onClose, onAdd }: EventModalProps) {
  const [newEventDate, setNewEventDate] = useState('');
  const [newEventPeriod, setNewEventPeriod] = useState<number>(1);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventType, setNewEventType] = useState<'exception' | 'extra' | 'replace'>('exception');
  const [eventError, setEventError] = useState('');

  const handleAdd = () => {
    if (!newEventDate || ((newEventType === 'exception' || newEventType === 'replace') && !newEventTitle.trim())) { 
      setEventError('모든 필드를 입력하세요.'); return; 
    }
    const newEvent: ClassEvent = { id: `e-${Date.now()}`, classId, date: newEventDate, period: newEventPeriod, title: newEventType === 'extra' ? '보강 수업' : newEventTitle, type: newEventType };
    onAdd(newEvent);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 dark:bg-gray-900/70 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-3xl shadow-xl p-6 md:p-8 animate-in zoom-in-95 border border-slate-100 dark:border-slate-700">
        <h3 className="text-xl font-bold mb-1 text-gray-900 dark:text-white">일정 변경 등록</h3>
        <p className="text-orange-600 dark:text-orange-400 font-bold mb-5 text-sm">[{className}] 전용</p>
        {eventError && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm rounded-lg font-bold">{eventError}</div>}
        <div className="space-y-4 text-sm">
          <div className="flex gap-1.5 bg-slate-100 dark:bg-slate-900 p-1.5 rounded-xl">
            <button aria-label="결강 탭" onClick={() => setNewEventType('exception')} className={`flex-1 py-2 rounded-lg font-bold transition-colors text-xs ${newEventType === 'exception' ? 'bg-white dark:bg-slate-800 shadow-sm text-orange-600 dark:text-orange-400' : 'text-slate-500'}`}>결강 (빈칸)</button>
            <button aria-label="내용 변경 탭" onClick={() => setNewEventType('replace')} className={`flex-1 py-2 rounded-lg font-bold transition-colors text-xs ${newEventType === 'replace' ? 'bg-white dark:bg-slate-800 shadow-sm text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`}>내용 변경</button>
            <button aria-label="보강 탭" onClick={() => setNewEventType('extra')} className={`flex-1 py-2 rounded-lg font-bold transition-colors text-xs ${newEventType === 'extra' ? 'bg-white dark:bg-slate-800 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500'}`}>보강 추가</button>
          </div>
          
          <div>
            <label className="block font-bold text-gray-700 dark:text-gray-300 mb-1.5">
              {newEventType === 'extra' ? '보강 날짜' : (newEventType === 'replace' ? '변경 날짜' : '결강 날짜')}
            </label>
            <input type="date" aria-label={newEventType === 'extra' ? '보강 날짜' : '적용 날짜'} value={newEventDate} onChange={e => setNewEventDate(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-3 rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-white font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block font-bold text-gray-700 dark:text-gray-300 mb-1.5">
              {newEventType === 'extra' ? '보강 교시' : (newEventType === 'replace' ? '변경 교시' : '결강 교시')}
            </label>
            <select aria-label="교시" value={newEventPeriod} onChange={e => setNewEventPeriod(Number(e.target.value))} className="w-full border border-gray-300 dark:border-slate-600 p-3 rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-white font-bold outline-none focus:ring-2 focus:ring-indigo-500">
              {[1,2,3,4,5,6,7].map(p => <option key={p} value={p}>{p}교시</option>)}
            </select>
          </div>
          {(newEventType === 'exception' || newEventType === 'replace') && (
            <div>
              <label className="block font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                {newEventType === 'replace' ? '변경할 수업 내용' : '결강 사유'}
              </label>
              <input type="text" aria-label="사유 또는 내용 입력" value={newEventTitle} onChange={e => setNewEventTitle(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-3 rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-orange-500" placeholder={newEventType === 'replace' ? '예: 수행평가' : '행사명, 출장 등'} />
            </div>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="px-5 py-2.5 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-xl text-sm font-bold">취소</button>
          <button onClick={handleAdd} className={`px-5 py-2.5 text-white rounded-xl text-sm font-bold ${newEventType === 'extra' ? 'bg-indigo-600' : (newEventType === 'replace' ? 'bg-emerald-500' : 'bg-orange-500')}`}>저장</button>
        </div>
      </div>
    </div>
  );
}

// 공통 학급 일정 기간 등록 및 수업 연기
interface HolidayModalProps { onClose: () => void; onAdd: (holidays: Holiday[]) => void; }
function HolidayModal({ onClose, onAdd }: HolidayModalProps) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [isHolidayType, setIsHolidayType] = useState(true);
  const [error, setError] = useState('');

  const handleAdd = () => {
    if (!startDate || !endDate || !newTitle.trim()) { setError('날짜와 내용을 입력하세요.'); return; }
    const start = dateUtils.parseDate(startDate);
    const end = dateUtils.parseDate(endDate);
    if (start > end) { setError('종료일이 시작일보다 빠를 수 없습니다.'); return; }

    const newHolidays: Holiday[] = [];
    let curr = start;
    while (curr <= end) {
      newHolidays.push({ id: `h-${Date.now()}-${Math.random().toString(36).substr(2,9)}`, date: dateUtils.formatDate(curr), title: newTitle, isHoliday: isHolidayType });
      curr = dateUtils.addDays(curr, 1);
    }
    onAdd(newHolidays);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 dark:bg-gray-900/70 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-3xl shadow-xl p-6 md:p-8 animate-in zoom-in-95 border border-slate-100 dark:border-slate-700">
        <h3 className="text-xl font-bold mb-1 text-gray-900 dark:text-white">학교 공통 일정 등록</h3>
        <p className="text-rose-600 dark:text-rose-400 font-bold mb-5 text-sm">전체 학급에 공통 적용</p>
        {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm rounded-lg font-bold">{error}</div>}
        <div className="space-y-4 text-sm">
          <div>
            <label className="block font-bold text-gray-700 dark:text-gray-300 mb-1.5">일정 유형</label>
            <div className="flex gap-2 bg-slate-100 dark:bg-slate-900 p-1.5 rounded-xl">
              <button onClick={() => setIsHolidayType(true)} className={`flex-1 py-2.5 rounded-lg font-bold transition-colors ${isHolidayType ? 'bg-white dark:bg-slate-800 shadow-sm text-rose-600 dark:text-rose-400' : 'text-slate-500'}`}>휴강 (공휴일 등)</button>
              <button onClick={() => setIsHolidayType(false)} className={`flex-1 py-2.5 rounded-lg font-bold transition-colors ${!isHolidayType ? 'bg-white dark:bg-slate-800 shadow-sm text-blue-600 dark:text-blue-400' : 'text-slate-500'}`}>단순 일정 (평가 등)</button>
            </div>
            <p className="text-[10px] text-gray-500 mt-2 ml-1">* 어떤 유형으로 등록하든 해당 요일의 정규 수업은 다음 차시로 밀립니다.</p>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block font-bold text-gray-700 dark:text-gray-300 mb-1.5">시작일</label>
              <input type="date" aria-label="시작일" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-3 rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-white font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div className="flex-1">
              <label className="block font-bold text-gray-700 dark:text-gray-300 mb-1.5">종료일</label>
              <input type="date" aria-label="종료일" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-3 rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-white font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div><label className="block font-bold text-gray-700 dark:text-gray-300 mb-1.5">일정명</label><input type="text" aria-label="전체 일정 이름" value={newTitle} onChange={e => setNewTitle(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-3 rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500" placeholder={isHolidayType ? "예: 개교기념일" : "예: 1학기 중간고사"} /></div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="px-5 py-2.5 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-xl text-sm font-bold">취소</button>
          <button onClick={handleAdd} className={`px-5 py-2.5 text-white rounded-xl text-sm font-bold ${isHolidayType ? 'bg-rose-600' : 'bg-blue-600'}`}>저장</button>
        </div>
      </div>
    </div>
  );
}

function SettingsPage() {
  const { classes, updateClasses, holidays, updateHolidays, events, updateEvents, records, updateRecords, scoreLogs, updateScoreLogs, lessonPlans, updateLessonPlans } = useContext(AppContext)!;
  const addToast = useContext(ToastContext);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

  const [selectedTabClassId, setSelectedTabClassId] = useState<string>(classes[0]?.classId || '');
  const [isClassModalOpen, setClassModalOpen] = useState(false);
  const [isClassManageOpen, setClassManageOpen] = useState(false);
  const [isEventModalOpen, setEventModalOpen] = useState(false);
  const [isHolidayModalOpen, setHolidayModalOpen] = useState(false);
  const [classToDelete, setClassToDelete] = useState<ClassSchedule | null>(null);

  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [editClassName, setEditClassName] = useState('');
  const [editClassColor, setEditClassColor] = useState<ClassColor>('blue');
  const [editStartDate, setEditStartDate] = useState('');
  const [editSlots, setEditSlots] = useState<WeeklySlot[]>([]);

  useEffect(() => {
    if (classes.length > 0 && !classes.find(c => c.classId === selectedTabClassId)) {
      setSelectedTabClassId(classes[0].classId);
    } else if (classes.length === 0 && selectedTabClassId) {
      setSelectedTabClassId('');
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

  const handleDeleteClass = async (classId: string) => {
    const remainingClasses = classes.filter(c => c.classId !== classId);
    try {
      await updateClasses(remainingClasses);
      await updateLessonPlans(lessonPlans.map(plan => ({ ...plan, classIds: (plan.classIds || []).filter(id => id !== classId) })));
      await updateEvents(events.filter(e => e.classId !== classId));
      await updateRecords(records.filter(r => r.classId !== classId));
      await updateScoreLogs(scoreLogs.filter(l => l.classId !== classId));
      if (selectedTabClassId === classId) setSelectedTabClassId(remainingClasses[0]?.classId || '');
      if (editingClassId === classId) setEditingClassId(null);
      setClassToDelete(null);
      addToast('학급이 삭제되었습니다.', 'success');
    } catch {
      addToast('학급 삭제에 실패했습니다.');
    }
  };

  const handleAddEvent = async (newEvent: ClassEvent) => { try { await updateEvents([...events, newEvent]); setEventModalOpen(false); addToast('일정이 등록되었습니다.', 'success'); } catch { addToast('일정 등록에 실패했습니다.'); } };
  const handleDeleteEvent = async (id: string) => { try { await updateEvents(events.filter(ev => ev.id !== id)); addToast('삭제되었습니다.', 'success'); } catch { addToast('삭제에 실패했습니다.'); } };
  const handleAddHoliday = async (newHolidays: Holiday[]) => { try { await updateHolidays([...holidays, ...newHolidays].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())); setHolidayModalOpen(false); addToast('전체 일정이 등록되었습니다.', 'success'); } catch { addToast('일정 등록에 실패했습니다.'); } };
  const handleDeleteHoliday = async (idOrDate: string) => { try { await updateHolidays(holidays.filter(h => (h.id || h.date) !== idOrDate)); addToast('삭제되었습니다.', 'success'); } catch { addToast('삭제에 실패했습니다.'); } };

  const renderColorPicker = (selCol: ClassColor, onSel: (c: ClassColor) => void) => (
    <div className="flex gap-2">
      {(Object.keys(COLOR_MAP) as ClassColor[]).map(c => (
        <button key={c} type="button" aria-label={`${c} 색상 선택`} onClick={() => onSel(c)} className={`w-8 h-8 rounded-full border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-600 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-800 ${COLOR_MAP[c].bg} ${selCol === c ? 'border-gray-800 dark:border-white scale-110 shadow-sm' : 'border-transparent opacity-70'}`} />
      ))}
    </div>
  );

  return (
    <div className="p-4 md:p-6 h-full flex flex-col animate-in fade-in duration-500 overflow-hidden bg-white dark:bg-slate-900">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 shrink-0 bg-slate-100/50 dark:bg-slate-800/50 p-4 md:p-6 rounded-2xl md:rounded-3xl gap-4">
        <div><h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">학급 및 일정 설정</h1><p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 mt-1 md:mt-2">운영 학급과 예외 일정을 관리합니다.</p></div>
        <div className="grid grid-cols-2 gap-2 w-full md:w-auto">
          <button onClick={() => setClassModalOpen(true)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 px-4 py-3 rounded-2xl text-sm font-black hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm transition-colors flex flex-col items-start gap-1 min-w-[120px]">
            <span className="text-lg leading-none">＋</span>
            <span>학급 추가</span>
          </button>
          <button onClick={() => setClassManageOpen(true)} className="bg-slate-800 dark:bg-indigo-600 border border-slate-800 dark:border-indigo-500 text-white px-4 py-3 rounded-2xl text-sm font-black hover:bg-slate-700 shadow-sm transition-colors flex flex-col items-start gap-1 min-w-[120px]">
            <span className="text-lg leading-none">✎</span>
            <span>운영 학급 수정</span>
          </button>
        </div>
      </header>

      <div className="flex gap-2 overflow-x-auto pb-3 mb-2 shrink-0 scrollbar-hide">
        {classes.map(c => {
          const isSel = selectedTabClassId === c.classId;
          const isEdit = editingClassId === c.classId;
          return (
            <div key={c.classId} className="flex items-center group">
              {isEdit ? (
                <button aria-label="수정 취소" onClick={() => setEditingClassId(null)} className="px-4 py-2 rounded-full text-sm font-bold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 animate-pulse">수정 중...</button>
              ) : (
                <button aria-label={`${c.className} 설정 보기`} onClick={() => setSelectedTabClassId(c.classId)} className={`px-4 py-2 rounded-full text-sm font-bold transition-all flex items-center gap-2 ${isSel ? 'bg-slate-800 dark:bg-indigo-500 text-white shadow-md border border-transparent' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-slate-700 hover:bg-gray-50'}`}>
                  <span className={`w-3 h-3 rounded-full ${COLOR_MAP[c.color].bg} border border-gray-300/50`}></span>
                  {c.className}
                  {isSel && <span onClick={e => { e.stopPropagation(); startEditClass(c); }} className="ml-1 opacity-60 hover:opacity-100 text-xs">✏️</span>}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto pr-2 pb-6 space-y-6">
        {activeClass ? (
          editingClassId === activeClass.classId ? (
            <ClassEditForm editClassName={editClassName} setEditClassName={setEditClassName} editClassColor={editClassColor} setEditClassColor={setEditClassColor} editStartDate={editStartDate} setEditStartDate={setEditStartDate} editSlots={editSlots} setEditSlots={setEditSlots} onSave={() => handleSaveClassEdit(activeClass.classId)} onCancel={() => setEditingClassId(null)} renderColorPicker={renderColorPicker} dayNames={dayNames} />
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-6">
              <div className="bg-slate-100 dark:bg-slate-800/50 p-5 md:p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 shrink-0">
                  <h2 className="text-base font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2"><span className={`w-1.5 h-4 rounded-full ${COLOR_MAP[activeClass.color].bg} border border-gray-400`}></span>{activeClass.className} 기본 시간표</h2>
                  <button onClick={() => startEditClass(activeClass)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors">수정</button>
                </div>
                <div className="space-y-2 flex-1 overflow-y-auto">
                  {activeClass.weeklySlots.map((slot, i) => (
                    <div key={i} className="flex justify-between items-center px-4 py-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
                      <span className="text-sm font-bold text-slate-600 dark:text-slate-300">{dayNames[slot.dayOfWeek]}요일</span>
                      <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1 rounded-lg">{slot.period}교시</span>
                    </div>
                  ))}
                  {activeClass.weeklySlots.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400 p-2">설정된 시간표가 없습니다.</p>}
                </div>
                <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 text-right"><span className="text-xs font-bold text-gray-500 bg-white dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">학기 시작일: {activeClass.startDate}</span></div>
              </div>

              <div className="bg-slate-100 dark:bg-slate-800/50 p-5 md:p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col">
                <div className="flex justify-between items-center mb-4 shrink-0">
                  <h2 className="text-base font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2"><span className="w-1.5 h-4 rounded-full bg-orange-400"></span>{activeClass.className} 개별 일정</h2>
                  <button onClick={() => setEventModalOpen(true)} className="bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm hover:bg-orange-200">+ 일정 등록</button>
                </div>
                <div className="space-y-3 flex-1 overflow-y-auto pr-1">
                  {activeClassEvents.length > 0 ? activeClassEvents.map(e => (
                    <div key={e.id} className={`flex flex-col gap-1.5 p-4 rounded-xl border shadow-sm ${
                      e.type === 'extra' ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-100 dark:border-indigo-800/60' 
                      : (e.type === 'replace' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800/60'
                      : 'bg-white dark:bg-slate-800 border-orange-200 dark:border-orange-800/60')
                    }`}>
                      <div className="flex justify-between items-center">
                        <span className={`text-xs font-black ${
                          e.type === 'extra' ? 'text-indigo-800 dark:text-indigo-300' 
                          : (e.type === 'replace' ? 'text-emerald-800 dark:text-emerald-300' 
                          : 'text-orange-800 dark:text-orange-300')
                        }`}>{e.date}</span>
                        <div className="flex gap-1.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                            e.type === 'extra' ? 'bg-indigo-200 dark:bg-indigo-800/60 text-indigo-900 dark:text-indigo-200' 
                            : (e.type === 'replace' ? 'bg-emerald-200 dark:bg-emerald-800/60 text-emerald-900 dark:text-emerald-200'
                            : 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200')
                          }`}>{e.period}교시</span>
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-md text-white ${
                            e.type === 'extra' ? 'bg-indigo-500' : (e.type === 'replace' ? 'bg-emerald-500' : 'bg-orange-500')
                          }`}>{e.type === 'extra' ? '보강' : (e.type === 'replace' ? '내용 변경' : '결강')}</span>
                        </div>
                      </div>
                      <span className={`text-sm font-bold ${
                        e.type === 'extra' ? 'text-indigo-900 dark:text-indigo-100' 
                        : (e.type === 'replace' ? 'text-emerald-900 dark:text-emerald-100'
                        : 'text-slate-700 dark:text-slate-200')
                      }`}>{e.title}</span>
                      <button aria-label="일정 삭제" onClick={() => handleDeleteEvent(e.id)} className="text-xs text-gray-400 hover:text-red-500 text-right mt-1 font-bold">삭제</button>
                    </div>
                  )) : (
                    <div className="flex items-center justify-center h-full min-h-[80px] border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl"><p className="text-xs text-slate-400 dark:text-slate-500 font-bold">등록된 개별 일정이 없습니다.</p></div>
                  )}
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="flex items-center justify-center p-12 bg-slate-50 dark:bg-slate-800 rounded-3xl"><p className="text-base text-gray-400 dark:text-slate-500 font-bold">학급을 추가해주세요.</p></div>
        )}

        <section className="bg-rose-50/50 dark:bg-rose-900/10 p-5 md:p-6 rounded-3xl border border-rose-100 dark:border-rose-900/30 shrink-0">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-3">
            <h2 className="text-sm font-bold text-rose-700 dark:text-rose-400 flex items-center gap-2"><span className="w-1.5 h-4 bg-rose-400 rounded-full"></span>학교 공통 일정 (전체 학급)</h2>
            <button onClick={() => setHolidayModalOpen(true)} className="bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm hover:bg-rose-200">+ 공통 일정 등록</button>
          </div>
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 text-sm">
            {holidays.length > 0 ? holidays.map((h, i) => (
              <div key={h.id || i} className="flex gap-3 items-center bg-white/80 dark:bg-slate-800/80 py-2.5 px-4 rounded-xl border border-rose-100 dark:border-rose-900/50 shadow-sm w-full sm:w-auto justify-between sm:justify-start">
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${h.isHoliday !== false ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'}`}>{h.isHoliday !== false ? '휴강' : '일정'}</span>
                  <span className="font-bold text-rose-900 dark:text-rose-200 text-xs md:text-sm">{h.date}</span>
                  <span className="font-medium text-rose-700 dark:text-rose-300 text-xs md:text-sm">{h.title}</span>
                </div>
                <button aria-label="전체 일정 삭제" onClick={() => handleDeleteHoliday(h.id || h.date)} className="text-sm text-gray-400 hover:text-red-500 font-black p-1">✕</button>
              </div>
            )) : (
              <span className="text-slate-400 dark:text-slate-500 text-sm font-bold p-2">등록된 전체 일정이 없습니다.</span>
            )}
          </div>
        </section>
      </div>

      {classToDelete && (
        <ConfirmModal
          message={`${classToDelete.className} 학급을 삭제하시겠습니까?
개별 일정, 학급 기록, 점수 이력도 함께 삭제됩니다.`}
          onConfirm={() => handleDeleteClass(classToDelete.classId)}
          onCancel={() => setClassToDelete(null)}
        />
      )}
      {isClassModalOpen && <ClassModal onClose={() => setClassModalOpen(false)} onAdd={handleAddClass} renderColorPicker={renderColorPicker} dayNames={dayNames} />}
      {isClassManageOpen && <ClassManageModal classes={classes} onClose={() => setClassManageOpen(false)} onEdit={(cls) => { setClassManageOpen(false); setSelectedTabClassId(cls.classId); startEditClass(cls); }} onDelete={(cls) => setClassToDelete(cls)} />}
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
      <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-3xl shadow-xl p-6 md:p-8 animate-in zoom-in-95 border border-slate-100 dark:border-slate-700">
        <h3 className="text-xl font-bold mb-5 text-gray-900 dark:text-white">프로필 설정</h3>
        <div className="space-y-5 text-sm">
          <div><label className="block font-bold text-gray-700 dark:text-gray-300 mb-2">선생님 이름</label><input type="text" aria-label="선생님 이름" value={name} onChange={e => setName(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-3 rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold" /></div>
          <div><label className="block font-bold text-gray-700 dark:text-gray-300 mb-2">담당 과목/역할</label><input type="text" aria-label="담당 과목 또는 역할" value={subject} onChange={e => setSubject(e.target.value)} className="w-full border border-gray-300 dark:border-slate-600 p-3 rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="예: 국어 담당, 3학년 부장 등" /></div>
        </div>
        <div className="mt-8 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-3 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-xl text-sm font-bold">취소</button>
          <button onClick={() => onSave({ name, subject })} className="px-5 py-3 bg-indigo-600 dark:bg-indigo-500 text-white rounded-xl text-sm font-bold shadow-sm">저장하기</button>
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
  // 로컬 데이터가 있으면 즉시 표시, Firebase는 백그라운드 동기화
  const hasLocalData = !!localStorage.getItem('eduplanner_classes');
  const [isLoaded, setIsLoaded] = useState(!isFirebaseEnabled || hasLocalData);

  const [activePage, setActivePage] = useState<'manage' | 'plan' | 'settings' | 'records' | 'tasks'>('manage');
  const [pageParams, setPageParams] = useState<any>(null);

  const [lessonsState, setLessonsState] = useState<Lesson[]>(() => loadFromLocal('lessons', MOCK_LESSONS));
  const [lessonPlansState, setLessonPlansState] = useState<LessonPlan[]>(() => loadFromLocal('lessonPlans', [{ ...DEFAULT_LESSON_PLANS[0], lessons: loadFromLocal('lessons', MOCK_LESSONS) }]));
  const [classesState, setClassesState] = useState<ClassSchedule[]>(() => loadFromLocal('classes', MOCK_SCHEDULES));
  const [holidaysState, setHolidaysState] = useState<Holiday[]>(() => loadFromLocal('holidays', MOCK_HOLIDAYS));
  const [eventsState, setEventsState] = useState<ClassEvent[]>(() => loadFromLocal('events', []));
  const [recordsState, setRecordsState] = useState<ClassRecord[]>(() => loadFromLocal('records', []));
  const [tasksState, setTasksState] = useState<Task[]>(() => loadFromLocal('tasks', MOCK_TASKS));
  const [profileState, setProfileState] = useState<UserProfile>(() => loadFromLocal('profile', DEFAULT_PROFILE));
  const [menuOrderState, setMenuOrderState] = useState<string[]>(() => loadFromLocal('menuOrder', DEFAULT_MENU_ORDER));
  const [scoreLogsState, setScoreLogsState] = useState<ScoreLog[]>(() => loadFromLocal('scoreLogs', []));
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  // 창 너비 기반 레이아웃 분기 (기준점 800으로 수정 - 패드 화면분할 지원 강화)
  const [windowWidth, setWindowWidth] = useState(() => typeof window !== 'undefined' ? window.innerWidth : 1024);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setWindowWidth(window.innerWidth), 100);
    };
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(timer); window.removeEventListener('resize', onResize); };
  }, []);
  const isSidebarLayout = windowWidth >= 800; 
  const sidebarWidth = Math.min(256, Math.max(56, Math.round(windowWidth * 0.18)));

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (!isFirebaseEnabled) {
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
        const ls = data.lessons || [];
        const lps = data.lessonPlans || [{ ...DEFAULT_LESSON_PLANS[0], lessons: ls.length > 0 ? ls : MOCK_LESSONS }];
        const cs = data.classes || [];
        const hs = data.holidays || [];
        const es = data.events || [];
        const rs = data.records || [];
        const ts = data.tasks || [];
        const ps = data.profile || DEFAULT_PROFILE;
        const ms = data.menuOrder || DEFAULT_MENU_ORDER;
        setLessonsState(ls);
        setLessonPlansState(lps);
        setClassesState(cs);
        setHolidaysState(hs);
        setEventsState(es);
        setRecordsState(rs);
        setTasksState(ts);
        setProfileState(ps);
        setMenuOrderState(ms);
        // 다음 접속 시 즉시 표시를 위해 로컬에도 캐시
        saveToLocal('lessons', ls);
        saveToLocal('lessonPlans', lps);
        saveToLocal('classes', cs);
        saveToLocal('holidays', hs);
        saveToLocal('events', es);
        saveToLocal('records', rs);
        saveToLocal('tasks', ts);
        saveToLocal('profile', ps);
        saveToLocal('menuOrder', ms);
      } else {
        setDoc(docRef, { lessons: MOCK_LESSONS, lessonPlans: DEFAULT_LESSON_PLANS, classes: MOCK_SCHEDULES, holidays: MOCK_HOLIDAYS, events: [], records: [], tasks: MOCK_TASKS, profile: DEFAULT_PROFILE, menuOrder: DEFAULT_MENU_ORDER }, { merge: true });
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
    lessonPlans: lessonPlansState, updateLessonPlans: async (data) => { setLessonPlansState(data); if (!isFirebaseEnabled) saveToLocal('lessonPlans', data); else await updateFirestoreField('lessonPlans', data); },
    classes: classesState, updateClasses: async (data) => { setClassesState(data); if (!isFirebaseEnabled) saveToLocal('classes', data); else await updateFirestoreField('classes', data); },
    holidays: holidaysState, updateHolidays: async (data) => { setHolidaysState(data); if (!isFirebaseEnabled) saveToLocal('holidays', data); else await updateFirestoreField('holidays', data); },
    events: eventsState, updateEvents: async (data) => { setEventsState(data); if (!isFirebaseEnabled) saveToLocal('events', data); else await updateFirestoreField('events', data); },
    records: recordsState, updateRecords: async (data) => { setRecordsState(data); if (!isFirebaseEnabled) saveToLocal('records', data); else await updateFirestoreField('records', data); },
    tasks: tasksState, updateTasks: async (data) => { setTasksState(data); if (!isFirebaseEnabled) saveToLocal('tasks', data); else await updateFirestoreField('tasks', data); },
    profile: profileState, updateProfile: async (data) => { setProfileState(data); if (!isFirebaseEnabled) saveToLocal('profile', data); else await updateFirestoreField('profile', data); },
    menuOrder: menuOrderState, updateMenuOrder: async (data) => { setMenuOrderState(data); if (!isFirebaseEnabled) saveToLocal('menuOrder', data); else await updateFirestoreField('menuOrder', data); },
    scoreLogs: scoreLogsState, updateScoreLogs: async (data) => { setScoreLogsState(data); saveToLocal('scoreLogs', data); },
    goToPage: (page, params) => { setActivePage(page); setPageParams(params); },
    pageParams,
  };

  const NAV_ITEMS_CONFIG: Record<string, { id: string; label: string; icon: React.ReactNode }> = {
    manage:   { id: 'manage',   label: '주간 진도표',   icon: <IconCalendar /> },
    tasks:    { id: 'tasks',    label: '업무 체크리스트', icon: <IconChecklist /> },
    plan:     { id: 'plan',     label: '수업 계획서',   icon: <IconBook /> },
    records:  { id: 'records',  label: '학급 기록장',   icon: <IconNotebook /> },
    settings: { id: 'settings', label: '설정',          icon: <IconSettings /> },
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
          <div className="w-12 h-12 border-4 border-indigo-200 dark:border-indigo-800 border-t-indigo-600 dark:border-t-indigo-500 rounded-full animate-spin"></div>
          <div className="text-slate-500 dark:text-slate-400 font-bold text-sm animate-pulse">플래너 로딩 중...</div>
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <AppContext.Provider value={contextValue}>

        {isSidebarLayout ? (
          /* ── 사이드바 레이아웃 (windowWidth >= 800) ── */
          <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }} className="bg-white dark:bg-slate-900 font-sans text-slate-900 dark:text-slate-100 selection:bg-indigo-100 dark:selection:bg-indigo-900/50">
            <aside style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px`, maxWidth: `${sidebarWidth}px`, display: 'flex', flexDirection: 'column' }} className="bg-slate-900 z-20 shrink-0 border-r border-slate-800 shadow-xl">
              <div className="p-5 pb-2">
                <div className="flex items-center gap-3 text-white mb-2 overflow-hidden">
                  <div className="p-2 bg-indigo-500 rounded-xl shadow-lg shrink-0"><IconCalendar /></div>
                  {sidebarWidth >= 160 && <span className="text-lg font-black tracking-tight truncate">에듀플래너</span>}
                </div>
                {sidebarWidth >= 160 && (
                  <div className="text-[10px] font-bold text-slate-500 px-1 uppercase tracking-widest flex items-center gap-2">
                    Smart Scheduler
                    <span className={`w-2 h-2 rounded-full animate-pulse ${isFirebaseEnabled ? 'bg-green-500' : 'bg-orange-500'}`} title={isFirebaseEnabled ? "클라우드 연동됨" : "로컬 스토리지 보관됨"}></span>
                  </div>
                )}
                {sidebarWidth < 160 && (
                  <div className="flex justify-center mt-1">
                    <span className={`w-2 h-2 rounded-full animate-pulse ${isFirebaseEnabled ? 'bg-green-500' : 'bg-orange-500'}`}></span>
                  </div>
                )}
              </div>

              <nav className="flex-1 px-2 space-y-1 mt-4 overflow-y-auto scrollbar-hide">
                {menuOrderState.map((itemId, index) => {
                  const item = NAV_ITEMS_CONFIG[itemId];
                  if (!item) return null;
                  const isActive = activePage === item.id;
                  return (
                    <div
                      key={item.id}
                      draggable={sidebarWidth >= 160}
                      onDragStart={(e) => handleNavDragStart(e, index)}
                      onDragOver={(e) => handleNavDragOver(e, index)}
                      onDrop={(e) => handleNavDrop(e, index)}
                      className={`cursor-grab active:cursor-grabbing transition-opacity ${draggedNavIdx === index ? 'opacity-30' : 'opacity-100'}`}
                    >
                      <button
                        title={item.label}
                        onClick={() => { setActivePage(item.id as any); setPageParams(null); }}
                        className={`w-full flex items-center rounded-xl transition-all duration-200 focus:outline-none ${isActive ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
                        style={{ gap: sidebarWidth >= 160 ? '12px' : '0', padding: sidebarWidth >= 160 ? '10px 14px' : '12px 0', justifyContent: sidebarWidth >= 160 ? 'flex-start' : 'center' }}
                      >
                        {sidebarWidth >= 160 && (
                          <div className="opacity-20 hover:opacity-100 transition-opacity flex flex-col gap-[3px] items-center justify-center shrink-0" aria-hidden="true">
                            <span className="w-1 h-1 bg-current rounded-full"></span><span className="w-1 h-1 bg-current rounded-full"></span><span className="w-1 h-1 bg-current rounded-full"></span>
                          </div>
                        )}
                        <span className="shrink-0">{item.icon}</span>
                        {sidebarWidth >= 160 && <span className="font-bold text-sm truncate">{item.label}</span>}
                      </button>
                    </div>
                  );
                })}
              </nav>

              <div className="p-2">
                <button
                  aria-label="프로필 설정 수정"
                  onClick={() => setIsProfileModalOpen(true)}
                  className="w-full bg-slate-800/50 rounded-2xl border border-slate-700/50 flex items-center hover:bg-slate-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 group overflow-hidden"
                  style={{ gap: sidebarWidth >= 160 ? '12px' : '0', padding: sidebarWidth >= 160 ? '14px' : '10px 0', justifyContent: sidebarWidth >= 160 ? 'flex-start' : 'center' }}
                >
                  <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-indigo-400 font-bold text-base shrink-0 uppercase shadow-inner">
                    {profileState.name.charAt(0) || 'U'}
                  </div>
                  {sidebarWidth >= 160 && (
                    <div className="overflow-hidden flex-1">
                      <div className="text-white text-sm font-bold truncate group-hover:text-indigo-300 transition-colors">{profileState.name}</div>
                      <div className="text-slate-400 text-xs font-medium truncate mt-0.5">{profileState.subject}</div>
                    </div>
                  )}
                </button>
              </div>
            </aside>

            <main className="flex-1 overflow-hidden relative bg-white dark:bg-slate-900 min-w-0">
              <div className="max-w-[1400px] mx-auto h-full shadow-2xl bg-white dark:bg-slate-900 border-l border-r border-slate-100/50 dark:border-slate-800/50">
                {activePage === 'plan'     && <LessonPlanPage />}
                {activePage === 'settings' && <SettingsPage />}
                {activePage === 'manage'   && <ManagePage />}
                {activePage === 'records'  && <RecordsPage />}
                {activePage === 'tasks'    && <TasksPage />}
              </div>
            </main>
          </div>
        ) : (
          /* ── 하단 탭바 레이아웃 (windowWidth < 800) ── */
          <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }} className="bg-white dark:bg-slate-900 font-sans text-slate-900 dark:text-slate-100 selection:bg-indigo-100 dark:selection:bg-indigo-900/50">
            <header className="bg-slate-900 px-5 py-4 flex items-center justify-between shrink-0 shadow-md z-20">
              <div className="flex items-center gap-2.5 text-white">
                <div className="p-1.5 bg-indigo-500 rounded-lg"><IconCalendar /></div>
                <span className="text-lg font-black tracking-tight">에듀플래너</span>
                <span className={`w-2 h-2 rounded-full animate-pulse ${isFirebaseEnabled ? 'bg-green-500' : 'bg-orange-500'}`}></span>
              </div>
              <button aria-label="프로필 설정 수정" onClick={() => setIsProfileModalOpen(true)} className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-indigo-400 font-bold text-sm uppercase focus:outline-none shadow-inner">
                {profileState.name.charAt(0) || 'U'}
              </button>
            </header>
            <main className="flex-1 overflow-hidden relative bg-gray-50 dark:bg-slate-900 min-w-0">
              {activePage === 'plan'     && <LessonPlanPage />}
              {activePage === 'settings' && <SettingsPage />}
              {activePage === 'manage'   && <ManagePage />}
              {activePage === 'records'  && <RecordsPage />}
              {activePage === 'tasks'    && <TasksPage />}
            </main>
            <nav className="bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-800 shrink-0 flex px-2 pb-safe pt-1 z-20 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
              {menuOrderState.map((itemId) => {
                const item = NAV_ITEMS_CONFIG[itemId];
                if (!item) return null;
                const isActive = activePage === item.id;
                return (
                  <button key={item.id} onClick={() => { setActivePage(item.id as any); setPageParams(null); }}
                    className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-1.5 transition-colors focus:outline-none ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}>
                    <div className={`transition-transform duration-200 ${isActive ? 'scale-110 -translate-y-0.5' : ''}`}>{item.icon}</div>
                    <span className={`text-[10px] leading-none ${isActive ? 'font-black' : 'font-bold'}`}>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        )}

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