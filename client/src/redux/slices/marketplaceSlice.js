import { createSlice } from '@reduxjs/toolkit';

/**
 * Which marketplace the current page shows.
 *
 * Replaces the old app-wide switcher (TopNav pill + /app/switch-account + full page reload).
 * Every page has its own switcher; the choice is sent on each API request as the X-Marketplace
 * header (utils/marketplaceRequest.js) and remembered on the user's account, so the next page
 * opens on the same marketplace.
 *
 *   selected  — { country, region } shown by single-marketplace pages.
 *   mode      — 'all' only on the Dashboard's "All marketplaces" view (every marketplace side by
 *               side); every other page is 'single'.
 *
 * Changing `selected` resets every marketplace-scoped slice (see store.js), which is what the old
 * hard reload used to do.
 */
const initialState = {
  selected: null,
  mode: 'single',
  initialized: false,
};

const sameMarketplace = (a, b) => Boolean(a && b) && a.country === b.country && a.region === b.region;

const marketplaceSlice = createSlice({
  name: 'marketplace',
  initialState,
  reducers: {
    initMarketplace: (state, action) => {
      const { selected } = action.payload || {};
      if (selected?.country && selected?.region) state.selected = { country: selected.country, region: selected.region };
      state.initialized = true;
    },
    selectMarketplace: (state, action) => {
      const { country, region } = action.payload || {};
      if (!country || !region) return;
      state.selected = { country, region };
      state.mode = 'single';
    },
    setMarketplaceMode: (state, action) => {
      state.mode = action.payload === 'all' ? 'all' : 'single';
    },
  },
});

export const { initMarketplace, selectMarketplace, setMarketplaceMode } = marketplaceSlice.actions;
export { sameMarketplace };
export default marketplaceSlice.reducer;
