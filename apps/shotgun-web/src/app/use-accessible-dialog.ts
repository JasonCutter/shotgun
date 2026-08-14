import { useEffect, useRef, type KeyboardEvent } from 'react';

const focusableSelector =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const useAccessibleDialog = (input: {
  readonly open: boolean;
  readonly onClose: () => void;
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const invokerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (input.open) {
      wasOpenRef.current = true;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector);
      (focusables?.[0] ?? dialogRef.current)?.focus();
      return;
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      const activeElement = document.activeElement;
      if (activeElement === null || activeElement === document.body) {
        invokerRef.current?.focus();
      }
    }
  }, [input.open]);

  const captureInvoker = (element: HTMLElement | null) => {
    invokerRef.current = element;
  };

  const onDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      input.onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusables = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
    );
    if (focusables.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    const first = focusables[0]!;
    const last = focusables.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return { dialogRef, captureInvoker, onDialogKeyDown };
};
