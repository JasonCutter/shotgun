import { useEffect } from 'react';
import { useLocation } from 'react-router';

export const RouteFocus = () => {
  const location = useLocation();

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('main h1')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname]);

  return null;
};
