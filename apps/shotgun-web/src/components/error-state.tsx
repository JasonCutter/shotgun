import { ShotgunApiError } from '@shotgun/api-client';

const errorMessages: Readonly<Record<string, string>> = {
  AUTHENTICATION_REQUIRED: '로그인이 필요합니다.',
  AUTHENTICATION_INVALID: '로그인 정보가 유효하지 않습니다.',
  PROJECT_ACCESS_DENIED: '이 Project에 접근할 수 없습니다.',
  REQUEST_ORIGIN_DENIED: '보안 확인에 실패했습니다. 다시 시도해 주세요.',
  INVALID_PRODUCT_API_RESPONSE: '서버 응답을 안전하게 확인할 수 없습니다.',
};

export const safeErrorMessage = (error: unknown): string => {
  if (error instanceof ShotgunApiError) {
    return (
      errorMessages[error.code] ??
      (error.status >= 500 ? '서버 요청에 실패했습니다.' : error.message)
    );
  }
  if (error instanceof TypeError) return '네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
  return '요청을 완료하지 못했습니다.';
};

export const ErrorState = ({
  error,
  onRetry,
}: {
  readonly error: unknown;
  readonly onRetry?: () => void;
}) => (
  <section className="state-card state-card--error" aria-labelledby="error-heading">
    <h1 id="error-heading" tabIndex={-1}>
      요청 오류
    </h1>
    <p role="alert">{safeErrorMessage(error)}</p>
    {onRetry ? (
      <button type="button" onClick={onRetry}>
        다시 시도
      </button>
    ) : null}
  </section>
);
