import { useCallback, useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import axiosInstance from '../config/axios.config.js';
import {
  selectMarketplace as selectMarketplaceAction,
  setMarketplaceMode,
  sameMarketplace,
} from '../redux/slices/marketplaceSlice.js';
import { amazonMarketplaceCurrencies, getMarketplaceCurrencyCode } from '../utils/amazonAllowedCountries.js';
import { PER_PAGE_MARKETPLACE } from '../utils/featureFlags.js';

export const ALL_MARKETPLACES = 'all';

/**
 * Resolves a ?marketplace= value ("UK", "uk:eu" or "all") against the user's own marketplaces.
 * Returns 'all', a { country, region } the user owns, or null. Exported for tests.
 */
export const resolveMarketplaceParam = (value, accounts) => {
  if (!value) return null;
  const raw = String(value).trim().toUpperCase();
  if (raw === 'ALL') return ALL_MARKETPLACES;
  const [country, region] = raw.split(':');
  const match = (accounts || []).find((a) => a.country === country && (!region || a.region === region));
  return match ? { country: match.country, region: match.region } : null;
};

/** The user's marketplaces, connected first, once each. */
export const connectedMarketplaces = (accounts) => {
  const seen = new Set();
  const out = [];
  for (const a of accounts || []) {
    if (!a?.country || !a?.region) continue;
    const key = `${a.country}:${a.region}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ country: a.country, region: a.region, isConnected: a.isConnected !== false });
  }
  return out.sort((x, y) => Number(y.isConnected) - Number(x.isConnected));
};

/**
 * The marketplace the current page shows, and how to change it.
 *
 * Reads/writes ?marketplace= so a refresh or a shared link keeps the choice, and saves the pick on
 * the account (PUT /app/preferences/marketplace) so the next page opens on it. That call also
 * moves the old location cookie, so anything not yet sending the header — and QMate — follows.
 *
 * @param {{ allowAll?: boolean }} opts  true only on the Dashboard ("All marketplaces").
 */
export default function useMarketplace({ allowAll = false } = {}) {
  const dispatch = useDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const selected = useSelector((s) => s.marketplace?.selected);
  const mode = useSelector((s) => s.marketplace?.mode);
  const accounts = useSelector((s) => s.AllAccounts?.AllAccounts);

  const marketplaces = useMemo(() => connectedMarketplaces(accounts), [accounts]);
  const param = searchParams.get('marketplace');

  const writeParam = useCallback((value) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set('marketplace', value);
      else next.delete('marketplace');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Keep the page in step with its URL, and keep "All marketplaces" off pages that can't show it.
  useEffect(() => {
    if (!PER_PAGE_MARKETPLACE || !marketplaces.length) return;
    const fromUrl = resolveMarketplaceParam(param, marketplaces);

    if (fromUrl === ALL_MARKETPLACES) {
      if (allowAll) {
        if (mode !== 'all') dispatch(setMarketplaceMode('all'));
      } else {
        writeParam(null); // "all" means nothing here — fall back to the selected marketplace
        if (mode === 'all') dispatch(setMarketplaceMode('single'));
      }
      return;
    }
    if (param && !fromUrl) {
      writeParam(null); // not one of the user's marketplaces: drop it rather than trust it
      return;
    }
    if (fromUrl && !sameMarketplace(fromUrl, selected)) {
      dispatch(selectMarketplaceAction(fromUrl));
      return;
    }
    if (mode === 'all' && !allowAll) dispatch(setMarketplaceMode('single'));
  }, [param, marketplaces, allowAll, mode, selected, dispatch, writeParam]);

  const select = useCallback((target) => {
    if (target === ALL_MARKETPLACES) {
      if (!allowAll) return;
      dispatch(setMarketplaceMode('all'));
      writeParam('all');
      return;
    }
    if (!target?.country || !target?.region) return;
    const changed = !sameMarketplace(target, selected);
    dispatch(selectMarketplaceAction(target)); // also leaves "All marketplaces"
    writeParam(target.country);
    if (changed) {
      axiosInstance
        .put('/app/preferences/marketplace', { country: target.country, region: target.region })
        .catch(() => { /* the page already switched; only the remembered default is lost */ });
    }
  }, [allowAll, dispatch, selected, writeParam]);

  const isAll = allowAll && mode === 'all';

  return {
    enabled: PER_PAGE_MARKETPLACE,
    selected,
    isAll,
    marketplaces,
    select,
    currencySymbol: selected ? (amazonMarketplaceCurrencies[selected.country] || '$') : '$',
    currencyCode: selected ? getMarketplaceCurrencyCode(selected.country) : 'USD',
  };
}
