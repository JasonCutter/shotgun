export const LoadingState = ({ message }: { readonly message: string }) => (
  <p className="status-message" role="status" aria-live="polite">
    {message}
  </p>
);
