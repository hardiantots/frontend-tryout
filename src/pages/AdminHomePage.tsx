import { FormEvent, useEffect, useMemo, useState } from 'react';
import { logout, tryRefreshSession } from '../auth/api';
import { getSession } from '../auth/session';
import { RichTextRenderer } from '../components/RichTextRenderer';
import { showToast, ToastContainer } from '../components/Toast';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

const PERMISSION_CODES = [
  'QUESTION_CREATE',
  'QUESTION_UPDATE',
  'QUESTION_DELETE',
  'QUESTION_VIEW_DRAFT',
  'QUESTION_PUBLISH',
  'QUESTION_REVIEW',
  'SUBTEST_VIEW',
  'EXAM_RESULT_VIEW',
  'EXAM_RESULT_EXPORT',
  'USER_VIEW',
  'USER_SUSPEND',
  'ADMIN_ROLE_ASSIGN',
  'ADMIN_ROLE_REVOKE',
  'ADMIN_PERMISSION_GRANT',
  'ADMIN_PERMISSION_REVOKE',
  'AUDIT_LOG_VIEW',
] as const;

const PERMISSION_LABELS: Record<(typeof PERMISSION_CODES)[number], string> = {
  QUESTION_CREATE: 'Buat Soal',
  QUESTION_UPDATE: 'Ubah Soal',
  QUESTION_DELETE: 'Hapus Soal',
  QUESTION_VIEW_DRAFT: 'Lihat Draft Soal',
  QUESTION_PUBLISH: 'Publikasi Soal',
  QUESTION_REVIEW: 'Review Soal',
  SUBTEST_VIEW: 'Lihat Sub-Tes',
  EXAM_RESULT_VIEW: 'Lihat Hasil Ujian',
  EXAM_RESULT_EXPORT: 'Ekspor Hasil Ujian',
  USER_VIEW: 'Lihat Akun Pengguna',
  USER_SUSPEND: 'Suspend Pengguna',
  ADMIN_ROLE_ASSIGN: 'Tetapkan Role Admin',
  ADMIN_ROLE_REVOKE: 'Cabut Role Admin',
  ADMIN_PERMISSION_GRANT: 'Berikan Izin Admin',
  ADMIN_PERMISSION_REVOKE: 'Cabut Izin Admin',
  AUDIT_LOG_VIEW: 'Lihat Audit Log',
};

const PERMISSION_GROUPS = {
  QUESTION_BANK: {
    label: 'Bank Soal',
    permissions: [
      'QUESTION_CREATE',
      'QUESTION_UPDATE',
      'QUESTION_DELETE',
      'QUESTION_VIEW_DRAFT',
      'QUESTION_PUBLISH',
      'QUESTION_REVIEW',
      'SUBTEST_VIEW',
    ] as const,
  },
  RESULT_AND_USER: {
    label: 'Hasil Ujian & Pengguna',
    permissions: ['EXAM_RESULT_VIEW', 'EXAM_RESULT_EXPORT', 'USER_VIEW', 'USER_SUSPEND'] as const,
  },
  ACCESS_ADMIN: {
    label: 'Akses Admin',
    permissions: ['ADMIN_ROLE_ASSIGN', 'ADMIN_ROLE_REVOKE', 'ADMIN_PERMISSION_GRANT', 'ADMIN_PERMISSION_REVOKE', 'AUDIT_LOG_VIEW'] as const,
  },
  OPERATOR_STANDARD: {
    label: 'Operator Standar',
    permissions: ['QUESTION_CREATE', 'QUESTION_UPDATE', 'QUESTION_VIEW_DRAFT', 'SUBTEST_VIEW', 'EXAM_RESULT_VIEW'] as const,
  },
} as const;

type ScopeType = 'GLOBAL' | 'SUB_TEST';
type PermissionMode = 'SINGLE' | 'GROUP';
type AnswerFormat = 'MULTIPLE_CHOICE_SINGLE' | 'SHORT_INPUT' | 'MULTIPLE_CHOICE_COMPLEX';
type AnswerOption = 'A' | 'B' | 'C' | 'D' | 'E';
type ComplexBinaryOption = 'LEFT' | 'RIGHT';

type SubTestSummary = {
  id: string;
  code: string;
  name: string;
  componentType: string;
};

type ManagedUserSummary = {
  id: string;
  fullName: string;
  email: string;
  roles: string[];
  createdAt: string;
};

type AccessSubTestSummary = {
  id: string;
  code: string;
  name: string;
  component: string;
};

type ParticipantTokenSummary = {
  id: string;
  tokenKey: string;
  label?: string | null;
  createdAt: string;
  usedAt?: string | null;
  revokedAt?: string | null;
  used: boolean;
  sessionCount: number;
  latestSession?: {
    id: string;
    status: string;
    participantName?: string | null;
    participantCongregation?: string | null;
    participantSchool?: string | null;
    submittedAt?: string | null;
  } | null;
};

type QuestionBankItem = {
  id: string;
  subTestId: string;
  promptText: string;
  materialTopic?: string | null;
  imageUrl?: string | null;
  imageUrls?: string[];
  isMathContent?: boolean;
  answerFormat: AnswerFormat;
  optionA?: string | null;
  optionB?: string | null;
  optionC?: string | null;
  optionD?: string | null;
  optionE?: string | null;
  correctAnswer?: AnswerOption | null;
  complexStatements?: string[];
  complexOptionLeftLabel?: string;
  complexOptionRightLabel?: string;
  complexCorrectAnswers?: ComplexBinaryOption[];
  shortAnswerType?: 'TEXT' | 'NUMERIC' | null;
  shortAnswerKey?: string | null;
  shortAnswerTolerance?: number | null;
  shortAnswerCaseSensitive?: boolean | null;
  discussion: string;
  createdAt: string;
  updatedAt: string;
};

const ANSWER_OPTIONS: AnswerOption[] = ['A', 'B', 'C', 'D', 'E'];

function getAuthHeaders(): HeadersInit {
  const accessToken = window.localStorage.getItem('accessToken');
  if (!accessToken) {
    return { 'Content-Type': 'application/json' };
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
}

async function parseJsonSafe(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

type AdminHomePageProps = {
  roles: string[];
  onLogout: () => void;
};

export function AdminHomePage({ roles, onLogout }: AdminHomePageProps) {
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<'accounts' | 'permissions' | 'tokens' | 'audit' | 'questions'>('accounts');
  const [targetUserId, setTargetUserId] = useState('');
  const [selectedTargetUserName, setSelectedTargetUserName] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'MASTER_ADMIN' | 'ADMIN' | 'PARTICIPANT'>('ALL');
  const [managedUsers, setManagedUsers] = useState<ManagedUserSummary[]>([]);
  const [accessSubTests, setAccessSubTests] = useState<AccessSubTestSummary[]>([]);
  const [roleReason, setRoleReason] = useState('');
  const [permissionCode, setPermissionCode] = useState<(typeof PERMISSION_CODES)[number]>('QUESTION_CREATE');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('SINGLE');
  const [permissionGroupKey, setPermissionGroupKey] = useState<keyof typeof PERMISSION_GROUPS>('QUESTION_BANK');
  const [scopeType, setScopeType] = useState<ScopeType>('GLOBAL');
  const [subTestId, setSubTestId] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [grantExpiresAt, setGrantExpiresAt] = useState('');
  const [effectiveUserId, setEffectiveUserId] = useState('');
  const [auditTargetUserId, setAuditTargetUserId] = useState('');
  const [auditActionType, setAuditActionType] = useState('');
  const [participantTokenLabel, setParticipantTokenLabel] = useState('');
  const [participantTokens, setParticipantTokens] = useState<ParticipantTokenSummary[]>([]);
  const [selectedTokenIds, setSelectedTokenIds] = useState<string[]>([]);
  const [lastGeneratedToken, setLastGeneratedToken] = useState<string | null>(null);
  const [writableSubTests, setWritableSubTests] = useState<SubTestSummary[]>([]);
  const [questionSubTestId, setQuestionSubTestId] = useState('');
  const [questionPrompt, setQuestionPrompt] = useState('');
  const [questionMaterialTopic, setQuestionMaterialTopic] = useState('');
  const [questionImageFiles, setQuestionImageFiles] = useState<File[]>([]);
  const [uploadedQuestionImageUrls, setUploadedQuestionImageUrls] = useState<string[]>([]);
  const [uploadingQuestionImages, setUploadingQuestionImages] = useState(false);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [questionBankItems, setQuestionBankItems] = useState<QuestionBankItem[]>([]);
  const [questionPage, setQuestionPage] = useState(1);
  const [questionPageSize] = useState(5);
  const [questionTotalPages, setQuestionTotalPages] = useState(1);
  const [questionTotalItems, setQuestionTotalItems] = useState(0);
  const [questionIsMathContent, setQuestionIsMathContent] = useState(false);
  const [questionDiscussion, setQuestionDiscussion] = useState('');
  const [questionFormat, setQuestionFormat] = useState<AnswerFormat>('MULTIPLE_CHOICE_SINGLE');
  const [optionA, setOptionA] = useState('');
  const [optionB, setOptionB] = useState('');
  const [optionC, setOptionC] = useState('');
  const [optionD, setOptionD] = useState('');
  const [optionE, setOptionE] = useState('');
  const [correctAnswer, setCorrectAnswer] = useState<AnswerOption>('A');
  const [complexOptionLeftLabel, setComplexOptionLeftLabel] = useState('Benar');
  const [complexOptionRightLabel, setComplexOptionRightLabel] = useState('Salah');
  const [complexStatements, setComplexStatements] = useState<string[]>(['', '', '', '']);
  const [complexAnswers, setComplexAnswers] = useState<ComplexBinaryOption[]>(['LEFT', 'LEFT', 'LEFT', 'LEFT']);
  const [shortAnswerType, setShortAnswerType] = useState<'TEXT' | 'NUMERIC'>('TEXT');
  const [shortAnswerKey, setShortAnswerKey] = useState('');
  const [shortAnswerTolerance, setShortAnswerTolerance] = useState('0');
  const [shortAnswerCaseSensitive, setShortAnswerCaseSensitive] = useState(false);
  const [resultText, setResultText] = useState('Belum ada aksi.');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const roleModes = useMemo(() => {
    const normalized = roles.map((role) => role.toUpperCase());
    return normalized.filter((role) => role === 'MASTER_ADMIN' || role === 'ADMIN');
  }, [roles]);

  const [activeRoleMode, setActiveRoleMode] = useState<'MASTER_ADMIN' | 'ADMIN'>('ADMIN');

  useEffect(() => {
    if (!roleModes.length) {
      return;
    }

    if (roleModes.includes('MASTER_ADMIN')) {
      setActiveRoleMode('MASTER_ADMIN');
      return;
    }

    setActiveRoleMode('ADMIN');
  }, [roleModes.join('|')]);

  const isMasterAdmin = activeRoleMode === 'MASTER_ADMIN';
  const canAuthorQuestions = useMemo(
    () => activeRoleMode === 'ADMIN' || activeRoleMode === 'MASTER_ADMIN',
    [activeRoleMode],
  );

  const selectedPermissionCodes = useMemo(() => {
    if (permissionMode === 'SINGLE') {
      return [permissionCode];
    }
    return [...PERMISSION_GROUPS[permissionGroupKey].permissions];
  }, [permissionMode, permissionCode, permissionGroupKey]);

  const actorSession = getSession();

  const loadManagedUsers = async () => {
    if (!isMasterAdmin) {
      return;
    }

    const params = new URLSearchParams();
    if (userSearch.trim()) {
      params.set('q', userSearch.trim());
    }
    if (roleFilter !== 'ALL') {
      params.set('roleCode', roleFilter);
    }

    const query = params.toString();
    const payload = await callApi(`/admin/access/users${query ? `?${query}` : ''}`);
    const items = (payload?.items ?? []) as ManagedUserSummary[];
    setManagedUsers(items);
    setSelectedUserIds((prev) => prev.filter((id) => items.some((item) => item.id === id)));
  };

  const loadAccessSubTests = async () => {
    if (!isMasterAdmin) {
      return;
    }

    const payload = await callApi('/admin/access/sub-tests');
    const items = (payload?.items ?? []) as AccessSubTestSummary[];
    setAccessSubTests(items);
    if (items.length) {
      setSubTestId((prev) => prev || items[0].id);
    }
  };

  const loadParticipantTokens = async () => {
    if (!isMasterAdmin) {
      return;
    }

    const payload = await callApi('/admin/access/participant-tokens');
    const items = (payload?.items ?? []) as ParticipantTokenSummary[];
    setParticipantTokens(items);
    setSelectedTokenIds((prev) => prev.filter((id) => items.some((item) => item.id === id)));
  };

  useEffect(() => {
    if (!canAuthorQuestions) {
      return;
    }

    const loadWritableSubTests = async () => {
      try {
        const payload = await callApi('/admin/questions/subtests');
        const subTests = (payload?.subTests ?? []) as SubTestSummary[];
        setWritableSubTests(subTests);
        if (subTests.length) {
          setQuestionSubTestId((prev) => prev || subTests[0].id);
        }
      } catch (error) {
        setResultText(`Error: ${(error as Error).message}`);
      }
    };

    void loadWritableSubTests();
  }, [canAuthorQuestions]);

  const loadQuestionBank = async (subTestId: string, page: number) => {
    if (!canAuthorQuestions || !subTestId) {
      setQuestionBankItems([]);
      setQuestionTotalItems(0);
      setQuestionTotalPages(1);
      return;
    }

    const payload = await callApi(
      `/admin/questions?subTestId=${encodeURIComponent(subTestId)}&page=${page}&pageSize=${questionPageSize}`,
    );
    setQuestionBankItems((payload?.items ?? []) as QuestionBankItem[]);
    setQuestionTotalItems(Number(payload?.pagination?.total ?? 0));
    setQuestionTotalPages(Math.max(1, Number(payload?.pagination?.totalPages ?? 1)));
  };

  const resetQuestionForm = () => {
    setEditingQuestionId(null);
    setQuestionPrompt('');
    setQuestionMaterialTopic('');
    setQuestionImageFiles([]);
    setUploadedQuestionImageUrls([]);
    setQuestionIsMathContent(false);
    setQuestionDiscussion('');
    setQuestionFormat('MULTIPLE_CHOICE_SINGLE');
    setOptionA('');
    setOptionB('');
    setOptionC('');
    setOptionD('');
    setOptionE('');
    setCorrectAnswer('A');
    setComplexOptionLeftLabel('Benar');
    setComplexOptionRightLabel('Salah');
    setComplexStatements(['', '', '', '']);
    setComplexAnswers(['LEFT', 'LEFT', 'LEFT', 'LEFT']);
    setShortAnswerType('TEXT');
    setShortAnswerKey('');
    setShortAnswerTolerance('0');
    setShortAnswerCaseSensitive(false);
  };

  const startEditQuestion = (item: QuestionBankItem) => {
    setEditingQuestionId(item.id);
    setQuestionSubTestId(item.subTestId);
    setQuestionPrompt(item.promptText ?? '');
    setQuestionMaterialTopic(item.materialTopic ?? '');
    setUploadedQuestionImageUrls(item.imageUrls ?? (item.imageUrl ? [item.imageUrl] : []));
    setQuestionImageFiles([]);
    setQuestionIsMathContent(Boolean(item.isMathContent));
    setQuestionDiscussion(item.discussion ?? '');
    setQuestionFormat(item.answerFormat);

    if (item.answerFormat === 'MULTIPLE_CHOICE_SINGLE') {
      setOptionA(item.optionA ?? '');
      setOptionB(item.optionB ?? '');
      setOptionC(item.optionC ?? '');
      setOptionD(item.optionD ?? '');
      setOptionE(item.optionE ?? '');
      setCorrectAnswer((item.correctAnswer as AnswerOption) ?? 'A');
    }

    if (item.answerFormat === 'MULTIPLE_CHOICE_COMPLEX') {
      setComplexOptionLeftLabel(item.complexOptionLeftLabel ?? 'Benar');
      setComplexOptionRightLabel(item.complexOptionRightLabel ?? 'Salah');
      const nextStatements = [...(item.complexStatements ?? []), '', '', '', ''].slice(0, 4);
      const nextAnswers = [...(item.complexCorrectAnswers ?? []), 'LEFT', 'LEFT', 'LEFT', 'LEFT'].slice(0, 4) as ComplexBinaryOption[];
      setComplexStatements(nextStatements);
      setComplexAnswers(nextAnswers);
    }

    if (item.answerFormat === 'SHORT_INPUT') {
      setShortAnswerType((item.shortAnswerType as 'TEXT' | 'NUMERIC') ?? 'TEXT');
      setShortAnswerKey(item.shortAnswerKey ?? '');
      setShortAnswerTolerance(String(item.shortAnswerTolerance ?? 0));
      setShortAnswerCaseSensitive(Boolean(item.shortAnswerCaseSensitive));
    }
  };

  useEffect(() => {
    if (!isMasterAdmin) {
      return;
    }

    void loadManagedUsers().catch((error) => {
      setResultText(`Error: ${(error as Error).message}`);
    });
    void loadAccessSubTests().catch((error) => {
      setResultText(`Error: ${(error as Error).message}`);
    });
    void loadParticipantTokens().catch((error) => {
      setResultText(`Error: ${(error as Error).message}`);
    });
  }, [isMasterAdmin, roleFilter]);

  useEffect(() => {
    if (!canAuthorQuestions || activeWorkspaceTab !== 'questions' || !questionSubTestId) {
      return;
    }

    void loadQuestionBank(questionSubTestId, questionPage).catch((error) => {
      setResultText(`Error: ${(error as Error).message}`);
    });
  }, [canAuthorQuestions, activeWorkspaceTab, questionSubTestId, questionPage]);

  const handleLogout = async () => {
    const confirmed = window.confirm('Yakin ingin keluar dari akun admin ini?');
    if (!confirmed) {
      return;
    }
    await logout();
    onLogout();
  };

  const runAction = async (runner: () => Promise<void>) => {
    setLoading(true);
    setSuccessMessage(null);
    try {
      await runner();
    } catch (error) {
      const msg = (error as Error).message;
      setResultText(`Error: ${msg}`);
      showToast('error', msg);
    } finally {
      setLoading(false);
    }
  };

  const callApi = async (path: string, init?: RequestInit) => {
    const doFetch = async () => {
      return fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          ...getAuthHeaders(),
          ...(init?.headers ?? {}),
        },
      });
    };

    let response = await doFetch();

    // Auto-refresh token on 401 and retry once
    if (response.status === 401) {
      const refreshed = await tryRefreshSession();
      if (refreshed) {
        response = await doFetch();
      } else {
        showToast('error', 'Sesi telah berakhir. Silakan login kembali.');
        throw new Error('Sesi telah berakhir. Silakan login kembali.');
      }
    }

    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      throw new Error(payload?.message ?? `Request failed (${response.status})`);
    }

    return payload;
  };

  const submitAssignAdmin = (event: FormEvent) => {
    event.preventDefault();
    void runAction(async () => {
      const payload = await callApi('/admin/access/assign-role', {
        method: 'POST',
        body: JSON.stringify({
          targetUserId,
          roleCode: 'ADMIN',
          reason: roleReason || undefined,
        }),
      });
      setResultText(JSON.stringify(payload, null, 2));
      setSuccessMessage('Akses tinggi berhasil diberikan.');
      await loadManagedUsers();
    });
  };

  const submitRevokeAdmin = (event: FormEvent) => {
    event.preventDefault();
    void runAction(async () => {
      const payload = await callApi('/admin/access/revoke-role', {
        method: 'POST',
        body: JSON.stringify({
          targetUserId,
          roleCode: 'ADMIN',
          reason: roleReason || 'Revoked by master admin',
        }),
      });
      setResultText(JSON.stringify(payload, null, 2));
      setSuccessMessage('Akses tinggi berhasil dicabut.');
      await loadManagedUsers();
    });
  };

  const submitDeleteUser = () => {
    void runAction(async () => {
      if (!isMasterAdmin) {
        throw new Error('Hanya master admin yang dapat menghapus akun.');
      }

      if (!targetUserId) {
        throw new Error('Pilih akun target yang akan dihapus.');
      }

      const confirmation = window.confirm(
        `Hapus akun ${selectedTargetUserName || targetUserId} secara permanen? Tindakan ini tidak dapat dibatalkan.`,
      );
      if (!confirmation) {
        return;
      }

      const payload = await callApi('/admin/access/delete-user', {
        method: 'POST',
        body: JSON.stringify({
          targetUserId,
          reason: roleReason || 'Akun dihapus oleh master admin.',
        }),
      });

      setResultText(JSON.stringify(payload, null, 2));
      setSuccessMessage('Akun berhasil dihapus secara permanen.');

      setTargetUserId('');
      setSelectedTargetUserName('');
      setEffectiveUserId('');
      await loadManagedUsers();
    });
  };

  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  };

  const toggleTokenSelection = (tokenId: string) => {
    setSelectedTokenIds((prev) => (prev.includes(tokenId) ? prev.filter((id) => id !== tokenId) : [...prev, tokenId]));
  };

  const selectAllUsers = () => {
    setSelectedUserIds(managedUsers.map((item) => item.id));
  };

  const clearSelectedUsers = () => {
    setSelectedUserIds([]);
  };

  const selectAllTokens = () => {
    setSelectedTokenIds(participantTokens.filter((item) => !item.revokedAt).map((item) => item.id));
  };

  const clearSelectedTokens = () => {
    setSelectedTokenIds([]);
  };

  const submitBulkDeleteUsers = () => {
    void runAction(async () => {
      if (!isMasterAdmin) {
        throw new Error('Hanya master admin yang dapat menghapus akun secara massal.');
      }

      if (!selectedUserIds.length) {
        throw new Error('Pilih minimal 1 akun untuk dihapus.');
      }

      const confirmation = window.confirm(`Hapus ${selectedUserIds.length} akun terpilih secara permanen?`);
      if (!confirmation) {
        return;
      }

      let success = 0;
      const failed: string[] = [];
      for (const userId of selectedUserIds) {
        try {
          await callApi('/admin/access/delete-user', {
            method: 'POST',
            body: JSON.stringify({
              targetUserId: userId,
              reason: roleReason || 'Bulk delete oleh master admin.',
            }),
          });
          success += 1;
        } catch (error) {
          failed.push(`${userId}: ${(error as Error).message}`);
        }
      }

      setResultText(
        JSON.stringify(
          {
            action: 'bulk-delete-users',
            success,
            failed,
          },
          null,
          2,
        ),
      );
      setSuccessMessage(`Bulk delete user selesai. Berhasil: ${success}, Gagal: ${failed.length}.`);
      setSelectedUserIds([]);
      await loadManagedUsers();
    });
  };

  const submitBulkDisableTokens = () => {
    void runAction(async () => {
      if (!isMasterAdmin) {
        throw new Error('Hanya master admin yang dapat menonaktifkan token secara massal.');
      }

      const tokenTargets = participantTokens.filter((item) => selectedTokenIds.includes(item.id) && !item.revokedAt);
      if (!tokenTargets.length) {
        throw new Error('Pilih minimal 1 token aktif untuk dinonaktifkan.');
      }

      const confirmation = window.confirm(`Nonaktifkan ${tokenTargets.length} token participant terpilih?`);
      if (!confirmation) {
        return;
      }

      let success = 0;
      const failed: string[] = [];
      for (const token of tokenTargets) {
        try {
          await callApi('/admin/access/participant-tokens/delete', {
            method: 'POST',
            body: JSON.stringify({
              tokenId: token.id,
              reason: 'Bulk nonaktifkan token dari dasbor admin.',
            }),
          });
          success += 1;
        } catch (error) {
          failed.push(`${token.tokenKey}: ${(error as Error).message}`);
        }
      }

      setResultText(
        JSON.stringify(
          {
            action: 'bulk-disable-tokens',
            success,
            failed,
          },
          null,
          2,
        ),
      );
      setSuccessMessage(`Bulk nonaktifkan token selesai. Berhasil: ${success}, Gagal: ${failed.length}.`);
      setSelectedTokenIds([]);
      await loadParticipantTokens();
    });
  };

  const submitGrantPermission = (event: FormEvent) => {
    event.preventDefault();
    void runAction(async () => {
      if (scopeType === 'SUB_TEST' && !subTestId) {
        throw new Error('Pilih Sub-Tes terlebih dahulu untuk scope SUB_TEST.');
      }

      const success: string[] = [];
      const failed: Array<{ code: string; message: string }> = [];

      for (const code of selectedPermissionCodes) {
        try {
          await callApi('/admin/access/grant-permission', {
            method: 'POST',
            body: JSON.stringify({
              targetUserId,
              permissionCode: code,
              scopeType,
              subTestId: scopeType === 'SUB_TEST' ? subTestId : undefined,
              expiresAt: grantExpiresAt || undefined,
              reason: grantReason || undefined,
            }),
          });
          success.push(code);
        } catch (error) {
          failed.push({
            code,
            message: (error as Error).message,
          });
        }
      }

      setResultText(
        JSON.stringify(
          {
            action: 'grant-permission',
            mode: permissionMode,
            targetUserId,
            scopeType,
            subTestId: scopeType === 'SUB_TEST' ? subTestId : null,
            success,
            failed,
          },
          null,
          2,
        ),
      );

      if (!success.length) {
        throw new Error('Semua grant permission gagal diproses.');
      }

      if (failed.length) {
        setSuccessMessage(`Sebagian izin berhasil diberikan (${success.length}/${selectedPermissionCodes.length}).`);
      } else {
        setSuccessMessage(`Izin berhasil diberikan (${success.length} permission).`);
      }
      await loadManagedUsers();
    });
  };

  const submitRevokePermission = (event: FormEvent) => {
    event.preventDefault();
    void runAction(async () => {
      if (scopeType === 'SUB_TEST' && !subTestId) {
        throw new Error('Pilih Sub-Tes terlebih dahulu untuk scope SUB_TEST.');
      }

      const success: string[] = [];
      const failed: Array<{ code: string; message: string }> = [];

      for (const code of selectedPermissionCodes) {
        try {
          await callApi('/admin/access/revoke-permission', {
            method: 'POST',
            body: JSON.stringify({
              targetUserId,
              permissionCode: code,
              scopeType,
              subTestId: scopeType === 'SUB_TEST' ? subTestId : undefined,
              reason: grantReason || 'Revoked by admin panel',
            }),
          });
          success.push(code);
        } catch (error) {
          failed.push({
            code,
            message: (error as Error).message,
          });
        }
      }

      setResultText(
        JSON.stringify(
          {
            action: 'revoke-permission',
            mode: permissionMode,
            targetUserId,
            scopeType,
            subTestId: scopeType === 'SUB_TEST' ? subTestId : null,
            success,
            failed,
          },
          null,
          2,
        ),
      );

      if (!success.length) {
        throw new Error('Semua revoke permission gagal diproses.');
      }

      if (failed.length) {
        setSuccessMessage(`Sebagian izin berhasil dicabut (${success.length}/${selectedPermissionCodes.length}).`);
      } else {
        setSuccessMessage(`Izin berhasil dicabut (${success.length} permission).`);
      }
      await loadManagedUsers();
    });
  };

  const fetchEffective = () => {
    void runAction(async () => {
      const userId = effectiveUserId || actorSession?.user.id;
      if (!userId) {
        throw new Error('Isi User ID terlebih dahulu.');
      }
      const payload = await callApi(`/admin/access/effective-permissions/${userId}`);
      setResultText(JSON.stringify(payload, null, 2));
    });
  };

  const fetchAudit = () => {
    void runAction(async () => {
      const params = new URLSearchParams();
      if (auditTargetUserId) {
        params.set('targetUserId', auditTargetUserId);
      }
      if (auditActionType) {
        params.set('actionType', auditActionType);
      }
      params.set('page', '1');
      params.set('pageSize', '20');

      const payload = await callApi(`/admin/access/audit?${params.toString()}`);
      setResultText(JSON.stringify(payload, null, 2));
    });
  };

  const updateComplexStatement = (index: number, value: string) => {
    setComplexStatements((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const updateComplexAnswer = (index: number, value: ComplexBinaryOption) => {
    setComplexAnswers((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const onSelectQuestionImages = (files: FileList | null) => {
    const picked = Array.from(files ?? []).slice(0, 3);
    setQuestionImageFiles(picked);
  };

  const uploadQuestionImagesToS3 = async () => {
    if (!questionSubTestId) {
      throw new Error('Pilih sub-tes sebelum upload gambar.');
    }

    if (!questionImageFiles.length) {
      throw new Error('Pilih minimal 1 gambar untuk diupload.');
    }

    if (questionImageFiles.length > 3) {
      throw new Error('Maksimal 3 gambar per soal.');
    }

    setUploadingQuestionImages(true);
    try {
      const uploaded: string[] = [];
      for (const file of questionImageFiles) {
        const signPayload = await callApi('/admin/questions/upload-url', {
          method: 'POST',
          body: JSON.stringify({
            subTestId: questionSubTestId,
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          }),
        });

        const uploadResponse = await fetch(signPayload.uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': file.type,
          },
          body: file,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload gagal untuk file ${file.name}.`);
        }

        uploaded.push(String(signPayload.publicUrl));
      }

      setUploadedQuestionImageUrls(uploaded);
      showToast('success', `${uploaded.length} gambar berhasil diupload ke storage.`);
    } finally {
      setUploadingQuestionImages(false);
    }
  };

  const submitCreateQuestion = (event: FormEvent) => {
    event.preventDefault();
    void runAction(async () => {
      if (!canAuthorQuestions) {
        throw new Error('Akun ini belum memiliki izin untuk input soal.');
      }

      if (!questionSubTestId) {
        throw new Error('Pilih sub-tes terlebih dahulu.');
      }

      const basePayload = {
        subTestId: questionSubTestId,
        promptText: questionPrompt,
        materialTopic: questionMaterialTopic || undefined,
        imageUrls: uploadedQuestionImageUrls,
        isMathContent: questionIsMathContent,
        answerFormat: questionFormat,
        discussion: questionDiscussion,
      };

      let payload: Record<string, unknown> = { ...basePayload };

      if (questionFormat === 'MULTIPLE_CHOICE_SINGLE') {
        payload = {
          ...basePayload,
          optionA,
          optionB,
          optionC,
          optionD,
          optionE,
          correctAnswer,
        };
      }

      if (questionFormat === 'MULTIPLE_CHOICE_COMPLEX') {
        const cleanedStatements = complexStatements.map((item) => item.trim()).filter(Boolean);
        if (cleanedStatements.length < 3 || cleanedStatements.length > 4) {
          throw new Error('Soal kompleks wajib memiliki 3 sampai 4 pernyataan.');
        }

        payload = {
          ...basePayload,
          complexStatements: cleanedStatements,
          complexOptionLeftLabel: complexOptionLeftLabel.trim(),
          complexOptionRightLabel: complexOptionRightLabel.trim(),
          complexCorrectAnswers: complexAnswers.slice(0, cleanedStatements.length),
        };
      }

      if (questionFormat === 'SHORT_INPUT') {
        payload = {
          ...basePayload,
          shortAnswerType,
          shortAnswerKey,
          shortAnswerTolerance: shortAnswerType === 'NUMERIC' ? Number(shortAnswerTolerance || 0) : undefined,
          shortAnswerCaseSensitive,
        };
      }

      const response = await callApi(editingQuestionId ? '/admin/questions/update' : '/admin/questions', {
        method: 'POST',
        body: JSON.stringify(
          editingQuestionId
            ? {
                ...payload,
                questionId: editingQuestionId,
              }
            : payload,
        ),
      });
      setResultText(JSON.stringify(response, null, 2));
      showToast('success', editingQuestionId ? 'Soal berhasil diperbarui.' : 'Soal berhasil disimpan.');
      resetQuestionForm();
      setQuestionPage(1);
      await loadQuestionBank(questionSubTestId, 1);
    });
  };

  const handleDeleteQuestion = (questionId: string) => {
    void runAction(async () => {
      if (!questionSubTestId) {
        throw new Error('Sub-tes belum dipilih.');
      }

      const ok = window.confirm('Yakin ingin menghapus soal ini? Soal akan disembunyikan dari peserta.');
      if (!ok) {
        return;
      }

      const response = await callApi('/admin/questions/delete', {
        method: 'POST',
        body: JSON.stringify({ questionId }),
      });

      setResultText(JSON.stringify(response, null, 2));
      showToast('success', 'Soal berhasil dihapus dari daftar aktif.');

      if (editingQuestionId === questionId) {
        resetQuestionForm();
      }

      const nextPage = Math.min(questionPage, questionTotalPages);
      await loadQuestionBank(questionSubTestId, nextPage);
    });
  };

  const submitGenerateParticipantToken = (event: FormEvent) => {
    event.preventDefault();
    void runAction(async () => {
      if (!isMasterAdmin) {
        throw new Error('Hanya master admin yang dapat membuat token participant.');
      }

      const response = await callApi('/admin/access/participant-tokens', {
        method: 'POST',
        body: JSON.stringify({
          label: participantTokenLabel || undefined,
        }),
      });

      setLastGeneratedToken(response?.token ?? null);
      setParticipantTokenLabel('');
      setResultText(JSON.stringify(response, null, 2));
      showToast('success', 'Token participant berhasil dibuat. Simpan token ini sekarang.');
      await loadParticipantTokens();
    });
  };

  const handleDeleteParticipantToken = (tokenId: string, tokenKey: string) => {
    void runAction(async () => {
      if (!isMasterAdmin) {
        throw new Error('Hanya master admin yang dapat menonaktifkan token participant.');
      }

      const ok = window.confirm(`Nonaktifkan token ${tokenKey}?`);
      if (!ok) {
        return;
      }

      const response = await callApi('/admin/access/participant-tokens/delete', {
        method: 'POST',
        body: JSON.stringify({
          tokenId,
          reason: 'Token dinonaktifkan dari panel admin.',
        }),
      });

      setResultText(JSON.stringify(response, null, 2));
      showToast('success', 'Token participant berhasil dinonaktifkan.');
      await loadParticipantTokens();
    });
  };

  const handleRegenerateParticipantToken = (tokenKey: string) => {
    void runAction(async () => {
      if (!isMasterAdmin) {
        throw new Error('Hanya master admin yang dapat regenerate token participant.');
      }

      const ok = window.confirm(`Regenerate token penuh untuk key ${tokenKey}?`);
      if (!ok) {
        return;
      }

      const response = await callApi('/admin/access/participant-tokens/regenerate', {
        method: 'POST',
        body: JSON.stringify({ tokenKey }),
      });

      setLastGeneratedToken(response?.token ?? null);
      setResultText(JSON.stringify(response, null, 2));
      showToast('success', 'Token participant berhasil diregenerate.');
      await loadParticipantTokens();
    });
  };

  const handleResetAntiCheat = (tokenKey: string) => {
    void runAction(async () => {
      if (!isMasterAdmin) {
        throw new Error('Hanya master admin yang dapat mereset anti-cheat.');
      }

      const ok = window.confirm(
        `Reset anti-cheat untuk token ${tokenKey}?\n\nIni akan:\n• Reset jumlah pelanggaran ke 0\n• Reset login count ke 1\n• Mengembalikan session yang force-submitted ke IN_PROGRESS\n• Reset timer sub-tes aktif\n\nPeserta dapat login kembali dan melanjutkan ujian.`,
      );
      if (!ok) return;

      const response = await callApi('/admin/access/reset-anti-cheat', {
        method: 'POST',
        body: JSON.stringify({ tokenKey, reason: 'Reset anti-cheat oleh master admin dari panel.' }),
      });

      setResultText(JSON.stringify(response, null, 2));
      showToast('success', `Anti-cheat untuk token ${tokenKey} berhasil direset. Peserta dapat melanjutkan ujian.`);
      await loadParticipantTokens();
    });
  };

  return (
    <main className="app-shell p-4 sm:p-6">
      <ToastContainer />
      <header className="sticky top-0 z-40 mb-4 rounded-2xl border border-slate-200/80 bg-white/90 p-3 shadow-sm backdrop-blur">
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <img src="/logo-ppgt.webp" alt="Logo PPGT" className="h-10 w-10 rounded-full border border-slate-200 bg-white object-cover" />
            <div>
              <h1 className="text-sm font-semibold text-slate-900">Panel Manajemen SNBT</h1>
              <p className="text-xs text-slate-600">Kelola akses, audit, dan bank soal.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white" onClick={handleLogout}>
              Keluar
            </button>
          </div>
        </div>
      </header>

      <section className="w-full rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold text-slate-900">Dasbor Manajemen</h1>
        </div>

        <p className="mt-2 text-sm text-slate-600">Panel ini menyesuaikan hak akses akun yang sedang login.</p>

        {successMessage ? (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{successMessage}</div>
        ) : null}

        {!isMasterAdmin ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Fitur assign/revoke role dan permission hanya tersedia untuk akun dengan hak akses tertinggi.
          </div>
        ) : null}

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-700">Pusat Kontrol Dasbor</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <button
              type="button"
              className={`rounded-lg border px-2 py-2 text-xs font-semibold ${activeWorkspaceTab === 'accounts' ? 'border-teal-500 bg-teal-100 text-teal-900' : 'border-slate-300 bg-white text-slate-700'}`}
              onClick={() => setActiveWorkspaceTab('accounts')}
            >
              Akun
            </button>
            <button
              type="button"
              className={`rounded-lg border px-2 py-2 text-xs font-semibold ${activeWorkspaceTab === 'permissions' ? 'border-teal-500 bg-teal-100 text-teal-900' : 'border-slate-300 bg-white text-slate-700'}`}
              onClick={() => setActiveWorkspaceTab('permissions')}
            >
              Permission
            </button>
            <button
              type="button"
              className={`rounded-lg border px-2 py-2 text-xs font-semibold ${activeWorkspaceTab === 'tokens' ? 'border-teal-500 bg-teal-100 text-teal-900' : 'border-slate-300 bg-white text-slate-700'}`}
              onClick={() => setActiveWorkspaceTab('tokens')}
            >
              Token
            </button>
            <button
              type="button"
              className={`rounded-lg border px-2 py-2 text-xs font-semibold ${activeWorkspaceTab === 'audit' ? 'border-teal-500 bg-teal-100 text-teal-900' : 'border-slate-300 bg-white text-slate-700'}`}
              onClick={() => setActiveWorkspaceTab('audit')}
            >
              Audit
            </button>
            <button
              type="button"
              className={`rounded-lg border px-2 py-2 text-xs font-semibold ${activeWorkspaceTab === 'questions' ? 'border-teal-500 bg-teal-100 text-teal-900' : 'border-slate-300 bg-white text-slate-700'}`}
              onClick={() => setActiveWorkspaceTab('questions')}
            >
              Bank Soal
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className={`rounded-xl border border-slate-200 p-4 ${activeWorkspaceTab !== 'accounts' ? 'hidden' : ''}`}>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Akun Pengguna</h2>
            {isMasterAdmin ? (
              <>
                <div className="mb-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Cari nama atau email"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                  />
                  <select
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value as 'ALL' | 'MASTER_ADMIN' | 'ADMIN' | 'PARTICIPANT')}
                  >
                    <option value="ALL">Semua Role</option>
                    <option value="MASTER_ADMIN">MASTER_ADMIN</option>
                    <option value="ADMIN">ADMIN</option>
                    <option value="PARTICIPANT">PARTICIPANT</option>
                  </select>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                    onClick={() => {
                      void runAction(async () => {
                        await loadManagedUsers();
                        setResultText('Daftar akun berhasil diperbarui.');
                      });
                    }}
                    disabled={loading}
                  >
                    Muat Ulang
                  </button>
                </div>

                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                    onClick={selectAllUsers}
                    disabled={loading || !managedUsers.length}
                  >
                    Pilih Semua
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                    onClick={clearSelectedUsers}
                    disabled={loading || !selectedUserIds.length}
                  >
                    Kosongkan Pilihan
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-rose-700 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                    onClick={submitBulkDeleteUsers}
                    disabled={loading || !isMasterAdmin || !selectedUserIds.length}
                  >
                    Hapus Akun Terpilih ({selectedUserIds.length})
                  </button>
                </div>

                <div className="max-h-72 space-y-2 overflow-auto rounded-lg border border-slate-200 p-2">
                  {managedUsers.map((item) => {
                    const selected = targetUserId === item.id;
                    const checked = selectedUserIds.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`w-full rounded-lg border p-2 text-left text-sm transition ${selected ? 'border-teal-400 bg-teal-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                        onClick={() => {
                          setTargetUserId(item.id);
                          setSelectedTargetUserName(item.fullName);
                          setEffectiveUserId(item.id);
                        }}
                      >
                        <label className="mb-2 inline-flex items-center gap-2 text-xs text-slate-600" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleUserSelection(item.id)}
                          />
                          Pilih untuk aksi massal
                        </label>
                        <p className="font-medium text-slate-800">{item.fullName}</p>
                        <p className="text-xs text-slate-600">{item.email}</p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {(item.roles?.length ? item.roles : ['PARTICIPANT']).map((role) => (
                            <span key={`${item.id}-${role}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                              {role}
                            </span>
                          ))}
                        </div>
                      </button>
                    );
                  })}
                  {!managedUsers.length ? <p className="px-2 py-3 text-xs text-slate-600">Belum ada akun yang cocok.</p> : null}
                </div>

                <p className="mt-2 text-xs text-slate-600">
                  Target terpilih: {selectedTargetUserName || '-'}
                </p>
              </>
            ) : (
              <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">Daftar akun hanya tersedia pada akun dengan hak akses tertinggi.</p>
            )}

            <input
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Catatan aksi (opsional)"
              value={roleReason}
              onChange={(e) => setRoleReason(e.target.value)}
            />
          </section>

          <section className={`rounded-xl border border-slate-200 p-4 ${activeWorkspaceTab !== 'permissions' ? 'hidden' : ''}`}>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Izin Efektif</h2>
            {isMasterAdmin ? (
              <select
                className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={effectiveUserId}
                onChange={(e) => setEffectiveUserId(e.target.value)}
              >
                <option value="">Pilih akun target</option>
                {managedUsers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.fullName} - {item.email}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="ID Pengguna (kosongkan untuk akun sendiri)"
                value={effectiveUserId}
                onChange={(e) => setEffectiveUserId(e.target.value)}
              />
            )}
            <button
              className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              onClick={fetchEffective}
              disabled={loading}
            >
              Cek Effective Permissions
            </button>
          </section>

          <section className={`rounded-xl border border-slate-200 p-4 ${activeWorkspaceTab !== 'permissions' ? 'hidden' : ''}`}>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Manajemen Hak Akses Tingkat Lanjut</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <form onSubmit={submitAssignAdmin}>
                <button
                  className="w-full rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  type="submit"
                  disabled={loading || !isMasterAdmin || !targetUserId}
                >
                  Tetapkan Akses Tinggi
                </button>
              </form>
              <form onSubmit={submitRevokeAdmin}>
                <button
                  className="w-full rounded-lg bg-rose-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  type="submit"
                  disabled={loading || !isMasterAdmin || !targetUserId}
                >
                  Cabut Akses Tinggi
                </button>
              </form>
            </div>
            <button
              className="mt-2 w-full rounded-lg bg-rose-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              type="button"
              onClick={submitDeleteUser}
              disabled={loading || !isMasterAdmin || !targetUserId}
            >
              Hapus Akun Permanen
            </button>
            <p className="mt-2 text-xs text-rose-700">
              Hapus akun akan menghapus data sesi user. Jika user pernah membuat soal, author soal akan dialihkan ke akun master yang melakukan penghapusan.
            </p>
          </section>

          <section className={`rounded-xl border border-slate-200 p-4 ${activeWorkspaceTab !== 'permissions' ? 'hidden' : ''}`}>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Manajemen Izin</h2>
            <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={permissionMode}
                onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}
              >
                <option value="SINGLE">Izin Tunggal</option>
                <option value="GROUP">Paket Izin (Kelompok)</option>
              </select>

              {permissionMode === 'GROUP' ? (
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={permissionGroupKey}
                  onChange={(e) => setPermissionGroupKey(e.target.value as keyof typeof PERMISSION_GROUPS)}
                >
                  {Object.entries(PERMISSION_GROUPS).map(([key, value]) => (
                    <option key={key} value={key}>
                      {value.label}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={permissionCode}
                  onChange={(e) => setPermissionCode(e.target.value as (typeof PERMISSION_CODES)[number])}
                >
                  {PERMISSION_CODES.map((code) => (
                    <option key={code} value={code}>
                      {PERMISSION_LABELS[code]} ({code})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
              <p className="text-xs font-semibold text-slate-700">Izin yang akan diproses ({selectedPermissionCodes.length})</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {selectedPermissionCodes.map((code) => (
                  <span key={code} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 border border-slate-200">
                    {PERMISSION_LABELS[code]} ({code})
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Mode paket akan dieksekusi bertahap menggunakan endpoint backend saat ini (tanpa perubahan skema API).
              </p>
            </div>

            <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={scopeType}
                onChange={(e) => setScopeType(e.target.value as ScopeType)}
              >
                <option value="GLOBAL">Semua Sub-Tes (GLOBAL)</option>
                <option value="SUB_TEST">Sub-Tes Tertentu (SUB_TEST)</option>
              </select>
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={subTestId}
                onChange={(e) => setSubTestId(e.target.value)}
                disabled={scopeType !== 'SUB_TEST'}
              >
                <option value="">Pilih Sub-Tes</option>
                {accessSubTests.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} - {item.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="datetime-local"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={grantExpiresAt}
                onChange={(e) => setGrantExpiresAt(e.target.value)}
              />
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Alasan"
                value={grantReason}
                onChange={(e) => setGrantReason(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <form onSubmit={submitGrantPermission}>
                <button
                  className="w-full rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  type="submit"
                  disabled={loading || !isMasterAdmin || !targetUserId}
                >
                  Beri Izin
                </button>
              </form>
              <form onSubmit={submitRevokePermission}>
                <button
                  className="w-full rounded-lg bg-rose-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  type="submit"
                  disabled={loading || !isMasterAdmin || !targetUserId}
                >
                  Cabut Izin
                </button>
              </form>
            </div>
          </section>

          <section className={`rounded-xl border border-slate-200 p-4 lg:col-span-2 ${activeWorkspaceTab !== 'tokens' ? 'hidden' : ''}`}>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Token Participant</h2>
            <form onSubmit={submitGenerateParticipantToken} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Label token (opsional, contoh: Gelombang 1 Sesi Pagi)"
                value={participantTokenLabel}
                onChange={(e) => setParticipantTokenLabel(e.target.value)}
              />
              <button
                className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                type="submit"
                disabled={loading || !isMasterAdmin}
              >
                Generate Token
              </button>
            </form>

            {lastGeneratedToken ? (
              <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">
                <p className="font-semibold">Token baru (ditampilkan sekali):</p>
                <p className="mt-1 break-all font-mono">{lastGeneratedToken}</p>
                <p className="mt-1 text-xs text-indigo-800">
                  Gunakan token ini untuk login participant. Simpan baik-baik karena token tidak dapat ditampilkan ulang.
                </p>
                <button
                  type="button"
                  className="mt-2 rounded-md bg-indigo-700 px-2 py-1 text-xs font-semibold text-white"
                  onClick={() => {
                    void navigator.clipboard.writeText(lastGeneratedToken);
                    showToast('info', 'Token disalin ke clipboard.');
                    setSuccessMessage('Token participant berhasil disalin.');
                  }}
                >
                  Salin Token
                </button>
              </div>
            ) : null}

            <div className="mt-3 max-h-72 space-y-2 overflow-auto rounded-lg border border-slate-200 p-2">
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
                <button
                  type="button"
                  className="rounded-md border border-slate-300 px-2 py-1 text-slate-700"
                  onClick={selectAllTokens}
                  disabled={loading || !participantTokens.length}
                >
                  Pilih Semua Token Aktif
                </button>
                <button
                  type="button"
                  className="rounded-md border border-slate-300 px-2 py-1 text-slate-700"
                  onClick={clearSelectedTokens}
                  disabled={loading || !selectedTokenIds.length}
                >
                  Kosongkan Pilihan
                </button>
                <button
                  type="button"
                  className="rounded-md bg-rose-700 px-2 py-1 font-semibold text-white disabled:opacity-50"
                  disabled={loading || !isMasterAdmin || !selectedTokenIds.length}
                  onClick={submitBulkDisableTokens}
                >
                  Nonaktifkan Token Terpilih ({selectedTokenIds.length})
                </button>
              </div>

              {participantTokens.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-slate-800">Key: {item.tokenKey}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.revokedAt ? 'bg-rose-100 text-rose-700' : item.used ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
                      {item.revokedAt ? 'NONAKTIF' : item.used ? 'SUDAH DIGUNAKAN' : 'BELUM DIGUNAKAN'}
                    </span>
                  </div>
                  <label className="mt-1 inline-flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={selectedTokenIds.includes(item.id)}
                      onChange={() => toggleTokenSelection(item.id)}
                      disabled={Boolean(item.revokedAt)}
                    />
                    Pilih untuk nonaktifkan massal
                  </label>
                  <p className="text-[11px] text-slate-500">Token ini dapat digunakan participant untuk login dan melanjutkan riwayat try out.</p>
                  <p className="text-xs text-slate-600">Label: {item.label || '-'}</p>
                  <p className="text-xs text-slate-600">Dibuat: {new Date(item.createdAt).toLocaleString('id-ID')}</p>
                  <p className="text-xs text-slate-600">Sesi terkait: {item.sessionCount}</p>
                  {item.latestSession ? (
                    <p className="text-xs text-slate-600">
                      Peserta terbaru: {item.latestSession.participantName || '-'} | {item.latestSession.participantCongregation || '-'} | {item.latestSession.participantSchool || '-'}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-md bg-teal-700 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                      disabled={loading || !isMasterAdmin || Boolean(item.revokedAt)}
                      onClick={() => handleResetAntiCheat(item.tokenKey)}
                    >
                      Reset Anti-Cheat
                    </button>
                    <button
                      type="button"
                      className="rounded-md bg-amber-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                      disabled={loading || !isMasterAdmin || Boolean(item.revokedAt)}
                      onClick={() => handleRegenerateParticipantToken(item.tokenKey)}
                    >
                      Regenerate Token
                    </button>
                    <button
                      type="button"
                      className="rounded-md bg-rose-700 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                      disabled={loading || !isMasterAdmin || Boolean(item.revokedAt)}
                      onClick={() => handleDeleteParticipantToken(item.id, item.tokenKey)}
                    >
                      Nonaktifkan Token
                    </button>
                  </div>
                </div>
              ))}
              {!participantTokens.length ? <p className="px-2 py-3 text-xs text-slate-600">Belum ada token participant.</p> : null}
            </div>
          </section>

          <section className={`rounded-xl border border-slate-200 p-4 lg:col-span-2 ${activeWorkspaceTab !== 'audit' ? 'hidden' : ''}`}>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Log Audit</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="ID Pengguna Target"
                value={auditTargetUserId}
                onChange={(e) => setAuditTargetUserId(e.target.value)}
              />
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Tipe Aksi"
                value={auditActionType}
                onChange={(e) => setAuditActionType(e.target.value)}
              />
              <button
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                onClick={fetchAudit}
                disabled={loading || !isMasterAdmin}
              >
                Tampilkan Log Audit
              </button>
            </div>
          </section>

          <section className={`rounded-xl border border-slate-200 p-4 lg:col-span-2 ${activeWorkspaceTab !== 'questions' ? 'hidden' : ''}`}>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Input Soal per Sub-Tes</h2>
            {!canAuthorQuestions ? (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                Akun ini tidak memiliki akses input soal.
              </p>
            ) : (
              <form onSubmit={submitCreateQuestion} className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
                  <p className="font-semibold text-slate-700">
                    Mode: {editingQuestionId ? 'Edit Soal' : 'Tambah Soal Baru'}
                  </p>
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-700"
                    onClick={resetQuestionForm}
                    disabled={loading}
                  >
                    Reset Form
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <select
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={questionSubTestId}
                    onChange={(e) => {
                      setQuestionSubTestId(e.target.value);
                      setQuestionPage(1);
                    }}
                    disabled={loading || !writableSubTests.length}
                  >
                    {!writableSubTests.length ? <option value="">Tidak ada sub-tes yang bisa diinput</option> : null}
                    {writableSubTests.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.code} - {item.name}
                      </option>
                    ))}
                  </select>

                  <select
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={questionFormat}
                    onChange={(e) => setQuestionFormat(e.target.value as AnswerFormat)}
                    disabled={loading}
                  >
                    <option value="MULTIPLE_CHOICE_SINGLE">Pilihan Ganda Tunggal</option>
                    <option value="SHORT_INPUT">Jawaban Singkat</option>
                    <option value="MULTIPLE_CHOICE_COMPLEX">Pilihan Ganda Kompleks</option>
                  </select>
                </div>

                <textarea
                  className="min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Teks soal"
                  value={questionPrompt}
                  onChange={(e) => setQuestionPrompt(e.target.value)}
                  required
                />

                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Materi terkait (contoh: Aljabar Linear, Ide Pokok Bacaan, Penalaran Deduktif)"
                  value={questionMaterialTopic}
                  onChange={(e) => setQuestionMaterialTopic(e.target.value)}
                />

                <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={questionIsMathContent}
                    onChange={(e) => setQuestionIsMathContent(e.target.checked)}
                  />
                  Aktifkan format matematika (soal/jawaban mendukung teks simbol math)
                </label>

                <details className="rounded-lg border border-sky-200 bg-sky-50/50 p-2 text-xs text-sky-900">
                  <summary className="cursor-pointer font-semibold">📐 Panduan Notasi Matematika (KaTeX)</summary>
                  <div className="mt-2 space-y-1 text-[11px] leading-relaxed">
                    <p><b>Inline:</b> <code>$x^2 + y^2 = z^2$</code></p>
                    <p><b>Block:</b> <code>$$\frac{'{a}'}{'{b}'}$$</code></p>
                    <p><b>Pecahan:</b> <code>\frac{'{a}'}{'{b}'}</code> → a/b</p>
                    <p><b>Akar:</b> <code>\sqrt{'{x}'}</code>, <code>\sqrt[3]{'{x}'}</code></p>
                    <p><b>Pangkat/Subskrip:</b> <code>x^2</code>, <code>x_1</code></p>
                    <p><b>Kombinasi:</b> <code>\binom{'{n}'}{'{r}'}</code></p>
                    <p><b>Sigma:</b> <code>\sum_{'\{i=1\}'}^{'{n}'} x_i</code></p>
                    <p><b>Integral:</b> <code>\int_0^1 f(x)\,dx</code></p>
                    <p><b>Limit:</b> <code>\lim_{'\{x \\to 0\}'} f(x)</code></p>
                    <p><b>Matriks:</b> <code>\begin{'{pmatrix}'} a & b \\ c & d \end{'{pmatrix}'}</code></p>
                    <p><b>Sudut:</b> <code>90^\circ</code></p>
                    <p><b>Himpunan:</b> <code>\mathbb{'{R}'}</code>, <code>\mathbb{'{Z}'}</code>, <code>\in</code>, <code>\cup</code>, <code>\cap</code></p>
                    <p><b>Peluang:</b> <code>P(A \cap B)</code>, <code>P(A|B)</code></p>
                    <p><b>Tanda:</b> <code>\leq</code>, <code>\geq</code>, <code>\neq</code>, <code>\approx</code>, <code>\pm</code></p>
                    <p><b>Greek:</b> <code>\alpha</code>, <code>\beta</code>, <code>\theta</code>, <code>\pi</code>, <code>\sigma</code></p>
                  </div>
                </details>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-700">Upload Gambar Soal (maksimal 3 file)</p>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    onChange={(e) => onSelectQuestionImages(e.target.files)}
                  />

                  <button
                    type="button"
                    className="mt-2 rounded-lg bg-indigo-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    disabled={loading || uploadingQuestionImages || !questionImageFiles.length}
                    onClick={() => {
                      void runAction(async () => {
                        await uploadQuestionImagesToS3();
                      });
                    }}
                  >
                    {uploadingQuestionImages ? 'Mengupload...' : 'Upload ke AWS S3'}
                  </button>

                  {uploadedQuestionImageUrls.length ? (
                    <div className="mt-2 space-y-1">
                      {uploadedQuestionImageUrls.map((url) => (
                        <p key={url} className="break-all text-xs text-slate-600">
                          {url}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>

                {questionFormat === 'MULTIPLE_CHOICE_SINGLE' ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Opsi A" value={optionA} onChange={(e) => setOptionA(e.target.value)} required />
                    <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Opsi B" value={optionB} onChange={(e) => setOptionB(e.target.value)} required />
                    <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Opsi C" value={optionC} onChange={(e) => setOptionC(e.target.value)} required />
                    <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Opsi D" value={optionD} onChange={(e) => setOptionD(e.target.value)} required />
                    <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" placeholder="Opsi E" value={optionE} onChange={(e) => setOptionE(e.target.value)} required />
                  </div>
                ) : null}

                {questionFormat === 'MULTIPLE_CHOICE_SINGLE' ? (
                  <select
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={correctAnswer}
                    onChange={(e) => setCorrectAnswer(e.target.value as AnswerOption)}
                    disabled={loading}
                  >
                    {ANSWER_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        Jawaban benar: {opt}
                      </option>
                    ))}
                  </select>
                ) : null}

                {questionFormat === 'MULTIPLE_CHOICE_COMPLEX' ? (
                  <div className="rounded-lg border border-slate-200 p-3 text-sm">
                    <p className="mb-2 font-medium text-slate-700">Format tabel pernyataan (3-4 baris) dengan dua opsi jawaban.</p>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <input
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        value={complexOptionLeftLabel}
                        onChange={(e) => setComplexOptionLeftLabel(e.target.value)}
                        placeholder="Label opsi kiri (contoh: Benar)"
                        required
                      />
                      <input
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        value={complexOptionRightLabel}
                        onChange={(e) => setComplexOptionRightLabel(e.target.value)}
                        placeholder="Label opsi kanan (contoh: Salah)"
                        required
                      />
                    </div>

                    <div className="mt-3 space-y-2">
                      {[0, 1, 2, 3].map((idx) => (
                        <div key={`complex-row-${idx}`} className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-[1fr_160px]">
                          <input
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            placeholder={`Pernyataan ${idx + 1}${idx < 3 ? ' (wajib)' : ' (opsional)'}`}
                            value={complexStatements[idx] ?? ''}
                            onChange={(e) => updateComplexStatement(idx, e.target.value)}
                            required={idx < 3}
                          />
                          <select
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            value={complexAnswers[idx] ?? 'LEFT'}
                            onChange={(e) => updateComplexAnswer(idx, e.target.value as ComplexBinaryOption)}
                          >
                            <option value="LEFT">{complexOptionLeftLabel || 'Opsi kiri'}</option>
                            <option value="RIGHT">{complexOptionRightLabel || 'Opsi kanan'}</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {questionFormat === 'SHORT_INPUT' ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <select
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      value={shortAnswerType}
                      onChange={(e) => setShortAnswerType(e.target.value as 'TEXT' | 'NUMERIC')}
                    >
                      <option value="TEXT">TEXT</option>
                      <option value="NUMERIC">NUMERIC</option>
                    </select>
                    <input
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Kunci jawaban"
                      value={shortAnswerKey}
                      onChange={(e) => setShortAnswerKey(e.target.value)}
                      required
                    />
                    <input
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Tolerance (untuk NUMERIC)"
                      value={shortAnswerTolerance}
                      onChange={(e) => setShortAnswerTolerance(e.target.value)}
                      disabled={shortAnswerType !== 'NUMERIC'}
                    />
                    <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={shortAnswerCaseSensitive}
                        onChange={(e) => setShortAnswerCaseSensitive(e.target.checked)}
                      />
                      Case sensitive
                    </label>
                  </div>
                ) : null}

                <textarea
                  className="min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Pembahasan soal"
                  value={questionDiscussion}
                  onChange={(e) => setQuestionDiscussion(e.target.value)}
                  required
                />
                
                {questionPrompt || questionDiscussion ? (
                  <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-3 mt-2">
                    <p className="text-xs font-semibold text-teal-800 mb-2">Pratinjau Format Teks & Matematika:</p>
                    <div className="space-y-4">
                      {questionPrompt ? (
                        <div className="rounded border border-white bg-white p-2">
                          <p className="text-xs font-medium text-slate-500 mb-1">Soal:</p>
                          <RichTextRenderer content={questionPrompt} />
                        </div>
                      ) : null}
                      {questionDiscussion ? (
                        <div className="rounded border border-white bg-white p-2">
                          <p className="text-xs font-medium text-slate-500 mb-1">Pembahasan:</p>
                          <RichTextRenderer content={questionDiscussion} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <button
                  className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  type="submit"
                  disabled={loading || !questionSubTestId}
                >
                  {editingQuestionId ? 'Simpan Perubahan Soal' : 'Simpan Soal'}
                </button>

                {editingQuestionId ? (
                  <button
                    className="w-full rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    type="button"
                    disabled={loading}
                    onClick={() => handleDeleteQuestion(editingQuestionId)}
                  >
                    Hapus Soal Ini
                  </button>
                ) : null}
              </form>
            )}

            {canAuthorQuestions ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-800">Daftar Soal Sub-Tes Terpilih</h3>
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                    onClick={() => {
                      void runAction(async () => {
                        await loadQuestionBank(questionSubTestId, questionPage);
                        setResultText('Daftar soal berhasil diperbarui.');
                      });
                    }}
                    disabled={loading || !questionSubTestId}
                  >
                    Muat Ulang Daftar
                  </button>
                </div>

                <div className="space-y-2">
                  {questionBankItems.map((item, index) => (
                    <article key={item.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-700">
                          Soal {(questionPage - 1) * questionPageSize + index + 1}
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="rounded-md bg-teal-700 px-2 py-1 text-xs font-semibold text-white"
                            onClick={() => startEditQuestion(item)}
                          >
                            Edit Soal
                          </button>
                          <button
                            type="button"
                            className="rounded-md bg-rose-700 px-2 py-1 text-xs font-semibold text-white"
                            onClick={() => handleDeleteQuestion(item.id)}
                          >
                            Hapus
                          </button>
                        </div>
                      </div>
                      {item.materialTopic ? <p className="mt-1 text-xs text-slate-600">Materi: {item.materialTopic}</p> : null}
                      {/* Tampilkan gambar pada preview daftar bank soal apabila ada */}
                      {(item.imageUrls?.length ? item.imageUrls : (item.imageUrl ? [item.imageUrl] : [])).length ? (
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {(item.imageUrls?.length ? item.imageUrls : (item.imageUrl ? [item.imageUrl] : [])).map((imgUrl, imgIndex) => (
                            <img
                              key={`${item.id}-img-${imgIndex}`}
                              src={imgUrl}
                              alt={`Preview soal ${imgIndex + 1}`}
                              className="w-32 rounded-md border border-slate-200 object-cover"
                              loading="lazy"
                            />
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-2">
                        <RichTextRenderer content={item.promptText} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">Format: {item.answerFormat}</p>
                    </article>
                  ))}

                  {!questionBankItems.length ? <p className="text-xs text-slate-600">Belum ada soal pada sub-tes ini.</p> : null}
                </div>

                {questionTotalItems > 0 ? (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-2">
                    <p className="text-xs text-slate-600">
                      Halaman {questionPage} dari {questionTotalPages} ({questionTotalItems} soal)
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                        disabled={questionPage <= 1 || loading}
                        onClick={() => setQuestionPage((prev) => Math.max(1, prev - 1))}
                      >
                        Sebelumnya
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
                        disabled={questionPage >= questionTotalPages || loading}
                        onClick={() => setQuestionPage((prev) => Math.min(questionTotalPages, prev + 1))}
                      >
                        Berikutnya
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>

        <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Respons API</h2>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-700">{resultText}</pre>
        </section>
      </section>
    </main>
  );
}
