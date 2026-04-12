import { useEffect, useState } from 'react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

type ToastItem = {
  id: number;
  type: ToastType;
  message: string;
  exiting?: boolean;
};

const COLORS: Record<ToastType, { bg: string; border: string; text: string; icon: string }> = {
  success: { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-900', icon: '✓' },
  error: { bg: 'bg-rose-50', border: 'border-rose-300', text: 'text-rose-900', icon: '✕' },
  warning: { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-900', icon: '⚠' },
  info: { bg: 'bg-sky-50', border: 'border-sky-300', text: 'text-sky-900', icon: 'ℹ' },
};

let globalId = 0;
let globalPush: ((type: ToastType, message: string) => void) | null = null;

export function showToast(type: ToastType, message: string) {
  if (globalPush) {
    globalPush(type, message);
  }
}

export function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    globalPush = (type: ToastType, message: string) => {
      const id = ++globalId;
      setItems((prev) => [...prev.slice(-4), { id, type, message }]);

      setTimeout(() => {
        setItems((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
        setTimeout(() => {
          setItems((prev) => prev.filter((t) => t.id !== id));
        }, 300);
      }, 4000);
    };
    return () => {
      globalPush = null;
    };
  }, []);

  const dismiss = (id: number) => {
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  };

  if (!items.length) return null;

  return (
    <div className="fixed right-4 top-4 z-[9999] flex flex-col gap-2" style={{ maxWidth: '380px' }}>
      {items.map((item) => {
        const c = COLORS[item.type];
        return (
          <div
            key={item.id}
            className={`flex items-start gap-2 rounded-xl border px-4 py-3 shadow-lg backdrop-blur transition-all duration-300 ${c.bg} ${c.border} ${c.text} ${item.exiting ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'}`}
            style={{ animation: item.exiting ? undefined : 'slideInRight 0.3s ease-out' }}
          >
            <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white/80 text-xs font-bold">
              {c.icon}
            </span>
            <p className="flex-1 text-sm font-medium leading-snug">{item.message}</p>
            <button
              type="button"
              className="mt-0.5 flex-shrink-0 text-xs opacity-60 hover:opacity-100"
              onClick={() => dismiss(item.id)}
            >
              ✕
            </button>
          </div>
        );
      })}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
