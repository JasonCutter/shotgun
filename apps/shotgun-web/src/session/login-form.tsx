import { useMutation } from '@tanstack/react-query';
import { useId } from 'react';
import { useNavigate } from 'react-router';

import { productSessionQueryKey } from '../app/query-keys.js';
import { useAppRuntime } from '../app/providers.js';
import { safeErrorMessage } from '../components/error-state.js';
import { LoadingState } from '../components/loading-state.js';

export const LoginForm = () => {
  const { apiClient, queryClient } = useAppRuntime();
  const navigate = useNavigate();
  const headingId = useId();
  const login = useMutation({
    mutationFn: (input: Parameters<typeof apiClient.login>[0]) => apiClient.login(input),
    onSuccess: async (session) => {
      queryClient.setQueryData(productSessionQueryKey, session);
      await navigate('/');
    },
  });

  return (
    <form
      className="login-form"
      aria-labelledby={headingId}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        login.mutate({
          accountId: String(data.get('accountId') ?? ''),
          password: String(data.get('password') ?? ''),
          projectId: String(data.get('projectId') ?? ''),
        });
      }}
    >
      <h1 id={headingId} tabIndex={-1}>
        로그인
      </h1>
      <p>서버 Session으로 Shotgun Workspace에 접속합니다.</p>
      <label>
        Account ID
        <input name="accountId" autoComplete="username" required disabled={login.isPending} />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={login.isPending}
        />
      </label>
      <label>
        Project ID
        <input name="projectId" autoComplete="off" required disabled={login.isPending} />
      </label>
      <button type="submit" disabled={login.isPending}>
        로그인
      </button>
      {login.isPending ? <LoadingState message="Login 처리 중" /> : null}
      {login.error ? <p role="alert">{safeErrorMessage(login.error)}</p> : null}
    </form>
  );
};
