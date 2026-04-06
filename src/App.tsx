import { useEffect, useState } from 'react';
import { tryRefreshSession, logout } from './auth/api';
import { getSession, getSessionRoleLanding, clearSession } from './auth/session';
import { AdminHomePage } from './pages/AdminHomePage';
import { AuthPage } from './pages/AuthPage';
import { ExamPage } from './pages/ExamPage';
import { useExamStore } from './store/examStore';

type AppView = 'loading' | 'auth' | 'exam' | 'admin';

export function App() {
  const [view, setView] = useState<AppView>('loading');
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      const existing = getSession();
      if (!existing) {
        useExamStore.getState().resetExamState();
        if (mounted) {
          setView('auth');
        }
        return;
      }

      let me = null;
      try {
        me = await tryRefreshSession();
      } catch {
        me = null;
      }

      if (!mounted) {
        return;
      }

      if (!me) {
        clearSession();
        useExamStore.getState().resetExamState();
        setView('auth');
        return;
      }

      const effectiveRoles = (me.roles as string[] | undefined) ?? existing.roles ?? ['PARTICIPANT'];
      setRoles(effectiveRoles);
      setView(getSessionRoleLanding(effectiveRoles));
    };

    void bootstrap();

    return () => {
      mounted = false;
    };
  }, []);

  const onAuthenticated = (landing: 'exam' | 'admin') => {
    useExamStore.getState().resetExamState();
    const active = getSession();
    const activeRoles = active?.roles ?? ['PARTICIPANT'];
    setRoles(activeRoles);
    setView(landing);
  };

  const onLogout = async () => {
    await logout();
    useExamStore.getState().resetExamState();
    setRoles([]);
    setView('auth');
  };

  if (view === 'loading') {
    return (
      <main className="app-shell p-4 sm:p-6">
        <section className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-sm">
          Memeriksa session login...
        </section>
      </main>
    );
  }

  if (view === 'auth') {
    return <AuthPage onAuthenticated={onAuthenticated} />;
  }

  if (view === 'admin') {
    return <AdminHomePage roles={roles} onLogout={onLogout} />;
  }

  return <ExamPage onLogout={onLogout} />;
}
