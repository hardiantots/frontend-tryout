import { clearSession, getRefreshToken, saveSession, updateTokens, type AuthUserProfile } from './session';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

async function parseJsonSafe(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function login(data: { email: string; password: string }) {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  const payload = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(payload?.message ?? 'Login gagal.');
  }

  const me = await fetchMe(payload.accessToken);
  saveSession({
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    roles: me.roles ?? ['PARTICIPANT'],
    user: me.user as AuthUserProfile,
  });

  return me;
}

export async function participantTokenLogin(data: { token: string }) {
  const res = await fetch(`${API_URL}/auth/participant-token-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  const payload = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(payload?.message ?? 'Login token gagal.');
  }

  const me = await fetchMe(payload.accessToken);
  saveSession({
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    roles: me.roles ?? ['PARTICIPANT'],
    user: me.user as AuthUserProfile,
  });

  return {
    ...me,
    examAutoCompleted: payload.examAutoCompleted === true,
    examAutoCompleteReason: payload.examAutoCompleteReason ?? null,
    loginCount: payload.loginCount ?? null,
  };
}

export async function validateParticipantToken(data: { token: string }) {
  const res = await fetch(`${API_URL}/auth/participant-token-validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  const payload = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(payload?.message ?? 'Validasi token gagal.');
  }

  return payload as { success: true; valid: boolean; message: string };
}

export async function fetchMe(accessToken: string) {
  const res = await fetch(`${API_URL}/auth/me`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(payload?.message ?? 'Session tidak valid.');
  }

  return payload;
}

export async function tryRefreshSession() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return null;
  }

  try {
    const refreshRes = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    const refreshPayload = await parseJsonSafe(refreshRes);
    if (!refreshRes.ok) {
      clearSession();
      return null;
    }

    updateTokens(refreshPayload.accessToken, refreshPayload.refreshToken);

    try {
      const me = await fetchMe(refreshPayload.accessToken);
      return me;
    } catch {
      clearSession();
      return null;
    }
  } catch {
    clearSession();
    return null;
  }
}

export async function logout() {
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => null);
  }

  clearSession();
}

export async function forgotPassword(email: string) {
  const res = await fetch(`${API_URL}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  const payload = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(payload?.message ?? 'Gagal mengirim link reset password.');
  }

  return payload;
}

export async function resetPassword(token: string, newPassword: string) {
  const res = await fetch(`${API_URL}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, newPassword }),
  });

  const payload = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(payload?.message ?? 'Gagal mereset password.');
  }

  return payload;
}
