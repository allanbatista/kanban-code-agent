import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useSearchParamsState(key: string, defaultValue?: string) {
  const [searchParams, setSearchParams] = useSearchParams();

  const value = searchParams.get(key) ?? defaultValue ?? '';

  const setValue = useCallback(
    (newValue: string | null) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (newValue === null || newValue === '') {
          next.delete(key);
        } else {
          next.set(key, newValue);
        }
        return next;
      }, { replace: true });
    },
    [key, setSearchParams]
  );

  return [value, setValue] as const;
}
