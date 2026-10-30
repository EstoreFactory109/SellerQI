import { useEffect, useState } from 'react';
import axiosInstance from '../config/axios.config.js';

/**
 * Which changes on Amazon this account can make (GET /api/actions/capabilities).
 * The server decides: a new kind of change appears only once it is switched on
 * for the account, so buttons for it stay hidden until then.
 *
 * @returns {{ can: (actionType: string) => boolean, loaded: boolean }}
 */
export default function useActionCapabilities() {
  const [enabled, setEnabled] = useState(() => new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    axiosInstance.get('/api/actions/capabilities')
      .then((res) => {
        if (cancelled) return;
        const features = res.data?.data?.features || {};
        setEnabled(new Set(Object.values(features).flat().filter((a) => a.enabled).map((a) => a.actionType)));
      })
      .catch(() => { /* nothing offered */ })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  return { can: (actionType) => enabled.has(actionType), loaded };
}
