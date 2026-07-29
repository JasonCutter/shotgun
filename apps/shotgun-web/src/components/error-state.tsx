import { ShotgunApiError } from '@shotgun/api-client';

const errorMessages: Readonly<Record<string, string>> = {
  AUTHENTICATION_REQUIRED: 'Sign in is required.',
  AUTHENTICATION_INVALID: 'The authentication information is invalid.',
  PROJECT_ACCESS_DENIED: 'You do not have access to this Project.',
  REQUEST_ORIGIN_DENIED: 'The request origin was denied. Try again from this app.',
  INVALID_PRODUCT_API_RESPONSE:
    'The server response did not match the protected Product API contract.',
};

export const safeErrorMessage = (error: unknown): string => {
  if (error instanceof ShotgunApiError) {
    return (
      errorMessages[error.code] ??
      (error.status >= 500 ? 'The server request failed.' : error.message)
    );
  }
  if (error instanceof TypeError) {
    return 'Check the network connection and try again.';
  }
  return error instanceof Error && error.message
    ? error.message
    : 'The request could not be completed.';
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
      Request error
    </h1>
    <p role="alert">{safeErrorMessage(error)}</p>
    {onRetry ? (
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    ) : null}
  </section>
);
