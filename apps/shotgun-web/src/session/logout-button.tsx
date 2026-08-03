/**
 * @file logout-button.tsx
 * @description 향후 Interactive Authentication (Password/OAuth/Passkey) 연동을 위해 보존된 세션 해제 컴포넌트.
 * 개인용 Local Owner Mode에서는 UI에 노출되지 않으며, Product Frontend의 TopBar/Settings에서 제외됩니다.
 */
import { useMutation } from '@tanstack/react-query';

import { ShotgunApiError } from '@shotgun/api-client';

import { useAppRuntime } from '../app/providers.js';
import { productSessionQueryKey } from '../app/query-keys.js';
import { safeErrorMessage } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';
import { clearAllPendingKnowledgeDraftCommandIdentities } from '../knowledge/pending-draft-command-storage.js';

export const LogoutButton = () => {
  const { apiClient, queryClient } = useAppRuntime();
  const resetSession = async () => {
    // Logout discards every pending FE-P3-S2 Draft command identity: a
    // command identity is scoped to its Session and must never survive it.
    try {
      if (globalThis.sessionStorage) {
        clearAllPendingKnowledgeDraftCommandIdentities(globalThis.sessionStorage);
      }
    } catch {
      // sessionStorage is best-effort; the session reset below still runs.
    }
    await queryClient.cancelQueries();
    await queryClient.resetQueries({ queryKey: productSessionQueryKey });
  };
  const logout = useMutation({
    mutationFn: () => apiClient.logout(),
    onSuccess: resetSession,
    onError: async (error) => {
      if (error instanceof ShotgunApiError && error.status === 401) await resetSession();
    },
  });

  return (
    <div className="logout-control">
      <button type="button" disabled={logout.isPending} onClick={() => logout.mutate()}>
        로그아웃
      </button>
      {logout.isPending ? <LoadingState message="Logout 처리 중" /> : null}
      {logout.error && !(logout.error instanceof ShotgunApiError && logout.error.status === 401) ? (
        <p role="alert">{safeErrorMessage(logout.error)}</p>
      ) : null}
    </div>
  );
};
