import { useEffect } from 'react';
import { useLocation } from 'react-router';

export const RouteFocus = () => {
  const location = useLocation();

  useEffect(() => {
    const settleRouteFocus = (): boolean => {
      const main = document.querySelector<HTMLElement>('#main-content');
      if (!main) return false;

      const activeElement =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (activeElement) {
        const activeModal = activeElement.closest<HTMLElement>(
          '[role="dialog"][aria-modal="true"], dialog[open]',
        );
        if (activeModal?.isConnected) {
          return true;
        }

        if (activeElement !== main && main.contains(activeElement)) {
          return true;
        }
      }

      const heading = main.querySelector<HTMLElement>('h1[tabindex="-1"]');
      if (!heading) return false;
      heading.focus();
      return true;
    };
    const observer = new MutationObserver(() => {
      if (settleRouteFocus()) observer.disconnect();
    });
    const main = document.querySelector('#main-content');
    if (main) {
      observer.observe(main, { childList: true, subtree: true });
    }
    const frame = requestAnimationFrame(() => {
      if (settleRouteFocus()) observer.disconnect();
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [location.pathname]);

  return null;
};
