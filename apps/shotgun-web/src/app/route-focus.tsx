import { useEffect } from 'react';
import { useLocation } from 'react-router';

export const RouteFocus = () => {
  const location = useLocation();

  useEffect(() => {
    const focusRouteHeading = () => {
      const heading = document.querySelector<HTMLElement>('#main-content h1[tabindex="-1"]');
      if (!heading) return false;
      heading.focus();
      return true;
    };
    const observer = new MutationObserver(() => {
      if (focusRouteHeading()) observer.disconnect();
    });
    const main = document.querySelector('#main-content');
    if (main) {
      observer.observe(main, { childList: true, subtree: true });
    }
    const frame = requestAnimationFrame(() => {
      if (focusRouteHeading()) observer.disconnect();
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [location.pathname]);

  return null;
};
