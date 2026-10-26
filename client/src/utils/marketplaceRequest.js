import axios from 'axios';
import axiosInstance from '../config/axios.config.js';
import { PER_PAGE_MARKETPLACE } from './featureFlags.js';

/**
 * Sends the page's marketplace on every request to our API as `X-Marketplace: UK:EU`.
 *
 * The server (middlewares/Auth/getLocation.js) prefers this header over the old location cookie,
 * checks the user owns that marketplace, and keys its response cache by it — so two tabs can show
 * two marketplaces, and a switch needs no reload.
 *
 * Installed on BOTH the shared axiosInstance and the default axios export, because about 35 files
 * still import plain axios.
 */
let currentHeader = null;

export const marketplaceHeaderValue = (selected) =>
  selected?.country && selected?.region ? `${selected.country}:${selected.region}` : null;

const API_BASE = import.meta.env.VITE_BASE_URI || '';

/** Only our own API gets the header — never a third-party URL (CDNs, Amazon, etc.). */
export const isOwnApiRequest = (config, base = API_BASE) => {
  const url = String(config?.url || '');
  const baseURL = String(config?.baseURL || '');
  if (/^https?:\/\//i.test(url)) return Boolean(base) && url.startsWith(base);
  if (baseURL) return !base || baseURL.startsWith(base);
  return true; // relative URL → same origin
};

export const addMarketplaceHeader = (config, header = currentHeader) => {
  if (header && isOwnApiRequest(config) && !config.headers?.['X-Marketplace']) {
    config.headers = config.headers || {};
    if (typeof config.headers.set === 'function') config.headers.set('X-Marketplace', header);
    else config.headers['X-Marketplace'] = header;
  }
  return config;
};

let installed = false;

export const installMarketplaceHeader = (store) => {
  if (installed || !PER_PAGE_MARKETPLACE) return;
  installed = true;

  const sync = () => {
    currentHeader = marketplaceHeaderValue(store.getState().marketplace?.selected);
  };
  sync();
  store.subscribe(sync);

  axiosInstance.interceptors.request.use((config) => addMarketplaceHeader(config));
  axios.interceptors.request.use((config) => addMarketplaceHeader(config));
};
