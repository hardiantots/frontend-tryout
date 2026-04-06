import { create } from 'zustand';

type Section = {
  order: number;
  code: string;
  title: string;
  durationSeconds: number;
};

type RuntimeQuestion = {
  id: string;
  promptText: string;
  materialTopic?: string | null;
  imageUrl?: string | null;
  imageUrls?: string[];
  isMathContent?: boolean;
  answerFormat: string;
  options?: { A?: string | null; B?: string | null; C?: string | null; D?: string | null; E?: string | null };
  complexStatements?: string[];
  complexChoiceLabels?: {
    left: string;
    right: string;
  };
  shortAnswerType?: string | null;
  savedAnswer?: {
    selectedAnswer?: string | null;
    shortAnswerText?: string | null;
    selectedAnswers?: string[] | null;
  } | null;
};

type ReviewItem = {
  attemptId: string;
  questionId: string;
  subTestCode: string;
  subTestName: string;
  materialTopic?: string | null;
  questionText: string;
  answerFormat: string;
  userAnswer: string;
  correctAnswer: string;
  isCorrect: boolean | null;
  discussion: string;
};

type ScoreSummary = {
  bySubTest: Record<string, { total: number; answered: number; correct: number; wrong: number }>;
  weakMaterials?: Array<{
    subTestCode: string;
    subTestName: string;
    materialTopic: string;
    total: number;
    answered: number;
    correct: number;
    wrong: number;
    accuracy: number;
  }>;
  totals: { correct: number; answered: number; wrong: number };
};

type ExamState = {
  sessionId: string | null;
  warningCount: number;
  isForceSubmitted: boolean;
  activeSectionOrder: number;
  isCompleted: boolean;
  isStarted: boolean;
  isLoadingQuestions: boolean;
  activeSectionRemaining: number;
  activeQuestionId: string | null;
  questions: RuntimeQuestion[];
  aiInsight: string | null;
  scoreSummary: ScoreSummary | null;
  reviewItems: ReviewItem[];
  sections: Section[];
  setSession: (payload: { sessionId: string; sections: Section[]; activeSectionOrder: number; activeQuestionId?: string | null }) => void;
  incrementWarning: () => number;
  setWarningCount: (value: number) => void;
  setQuestions: (questions: RuntimeQuestion[]) => void;
  setLoadingQuestions: (value: boolean) => void;
  setActiveSectionRemaining: (seconds: number) => void;
  setActiveSectionOrder: (order: number) => void;
  setActiveQuestionId: (id: string | null) => void;
  setAiInsight: (text: string | null) => void;
  forceSubmit: () => void;
  advanceSection: () => void;
  completeExam: (payload: { scoreSummary: ScoreSummary; reviewItems: ReviewItem[] }) => void;
  resetExamState: () => void;
};

const sections: Section[] = [
  { order: 1, code: 'PU_INDUKTIF', title: 'Penalaran Umum - Induktif', durationSeconds: 600 },
  { order: 2, code: 'PU_DEDUKTIF', title: 'Penalaran Umum - Deduktif', durationSeconds: 600 },
  { order: 3, code: 'PU_KUANTITATIF', title: 'Penalaran Umum - Kuantitatif', durationSeconds: 600 },
  { order: 4, code: 'PPU', title: 'Pengetahuan dan Pemahaman Umum', durationSeconds: 900 },
  { order: 5, code: 'PBM', title: 'Pemahaman Bacaan dan Menulis', durationSeconds: 1500 },
  { order: 6, code: 'PK', title: 'Pengetahuan Kuantitatif', durationSeconds: 1200 },
  { order: 7, code: 'LIT_ID', title: 'Literasi Bahasa Indonesia', durationSeconds: 2550 },
  { order: 8, code: 'LIT_EN', title: 'Literasi Bahasa Inggris', durationSeconds: 1200 },
  { order: 9, code: 'PM', title: 'Penalaran Matematika', durationSeconds: 2550 },
];

export const useExamStore = create<ExamState>((set, get) => ({
  sessionId: null,
  warningCount: 0,
  isForceSubmitted: false,
  activeSectionOrder: 1,
  isCompleted: false,
  isStarted: false,
  isLoadingQuestions: false,
  activeSectionRemaining: 0,
  activeQuestionId: null,
  questions: [],
  aiInsight: null,
  scoreSummary: null,
  reviewItems: [],
  sections,
  setSession: ({ sessionId, sections, activeSectionOrder, activeQuestionId }) =>
    set({
      sessionId,
      sections,
      activeSectionOrder,
      activeQuestionId,
      warningCount: 0,
      isForceSubmitted: false,
      isStarted: true,
      isCompleted: false,
      isLoadingQuestions: false,
      activeSectionRemaining: 0,
      questions: [],
      aiInsight: null,
      scoreSummary: null,
      reviewItems: [],
    }),
  incrementWarning: () => {
    const next = get().warningCount + 1;
    set({ warningCount: next });
    return next;
  },
  setWarningCount: (value: number) => set({ warningCount: value }),
  setQuestions: (questions: RuntimeQuestion[]) => set({ questions }),
  setLoadingQuestions: (value: boolean) => set({ isLoadingQuestions: value }),
  setActiveSectionRemaining: (seconds: number) => set({ activeSectionRemaining: seconds }),
  setActiveSectionOrder: (order: number) => set({ activeSectionOrder: order }),
  setActiveQuestionId: (id: string | null) => set({ activeQuestionId: id }),
  setAiInsight: (text: string | null) => set({ aiInsight: text }),
  forceSubmit: () => set({ isForceSubmitted: true }),
  advanceSection: () => {
    const current = get().activeSectionOrder;
    const max = get().sections.length;
    if (current < max) {
      set({ activeSectionOrder: current + 1 });
    } else {
      set({ isCompleted: true });
    }
  },
  completeExam: ({ scoreSummary, reviewItems }) =>
    set({
      isCompleted: true,
      scoreSummary,
      reviewItems,
      isStarted: false,
    }),
  resetExamState: () =>
    set({
      sessionId: null,
      warningCount: 0,
      isForceSubmitted: false,
      activeSectionOrder: 1,
      isCompleted: false,
      isStarted: false,
      isLoadingQuestions: false,
      activeSectionRemaining: 0,
      activeQuestionId: null,
      questions: [],
      aiInsight: null,
      scoreSummary: null,
      reviewItems: [],
      sections,
    }),
}));
