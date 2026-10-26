// src/redux/store.js
import { configureStore, combineReducers } from '@reduxjs/toolkit';
import DashboardDetaSlice from '../slices/DashboardSlice.js';
import HistoryDataSlice from '../slices/HistorySlice.js'
import authSlice from '../slices/authSlice.js';
import MobileMenuSlice from '../slices/MobileMenuSlice.js'
import profileImageSlice from '../slices/profileImage.js'
import AllAccountsSlice from '../slices/AllAccountsSlice.js'
import cogsSlice from '../slices/cogsSlice.js'
import errorsSlice from '../slices/errorsSlice.js'
import notificationsSlice from '../slices/notificationsSlice.js'
import currencySlice from '../slices/currencySlice.js'
import pageDataSlice from '../slices/PageDataSlice.js'
import keywordRecommendationsSlice from '../slices/KeywordRecommendationsSlice.js'
import tasksSlice from '../slices/TasksSlice.js'
import reimbursementSlice from '../slices/ReimbursementSlice.js'
import ppcMetricsSlice from '../slices/PPCMetricsSlice.js'
import ppcUnitsSoldSlice from '../slices/PPCUnitsSoldSlice.js'
import ppcCampaignAnalysisSlice from '../slices/PPCCampaignAnalysisSlice.js'
import marketplaceSlice, { sameMarketplace } from '../slices/marketplaceSlice.js'
import { amazonMarketplaceCurrencies } from '../../utils/amazonAllowedCountries.js'

const appReducer = combineReducers({
  Dashboard: DashboardDetaSlice,
  History:HistoryDataSlice,
  Auth:authSlice,
  MobileMenu:MobileMenuSlice,
  profileImage:profileImageSlice,
  AllAccounts:AllAccountsSlice,
  cogs: cogsSlice,
  errors: errorsSlice,
  notifications: notificationsSlice,
  currency: currencySlice,
  pageData: pageDataSlice,
  keywordRecommendations: keywordRecommendationsSlice,
  tasks: tasksSlice,
  reimbursement: reimbursementSlice,
  ppcMetrics: ppcMetricsSlice,
  ppcUnitsSold: ppcUnitsSoldSlice,
  ppcCampaignAnalysis: ppcCampaignAnalysisSlice,
  marketplace: marketplaceSlice,
});

/**
 * Slices whose data belongs to ONE marketplace. Their caches are keyed by time or date range,
 * not by marketplace, so after a switch they would happily serve the previous marketplace's
 * numbers. The old switcher avoided that with a full page reload; this resets just these slices
 * to their initial state, and each page's normal "nothing cached yet" fetch runs again.
 */
export const MARKETPLACE_SCOPED_SLICES = [
  'Dashboard', 'History', 'cogs', 'errors', 'pageData', 'keywordRecommendations',
  'tasks', 'reimbursement', 'ppcMetrics', 'ppcUnitsSold', 'ppcCampaignAnalysis',
];

export const rootReducer = (state, action) => {
  if (action.type === 'marketplace/selectMarketplace' && state) {
    const next = action.payload;
    const prev = state.marketplace?.selected;
    if (next?.country && next?.region && !sameMarketplace(prev, next)) {
      const cleared = { ...state };
      for (const key of MARKETPLACE_SCOPED_SLICES) cleared[key] = undefined;
      const reduced = appReducer(cleared, action);
      // Components still read the marketplace from these two places (TopNav, ProfitTable,
      // Category, ...), so keep them pointing at the new one.
      return {
        ...reduced,
        Dashboard: { ...reduced.Dashboard, DashBoardInfo: { Country: next.country, Region: next.region } },
        currency: { currency: amazonMarketplaceCurrencies[next.country] || '$', country: next.country },
      };
    }
  }
  return appReducer(state, action);
};

export const store = configureStore({
  reducer: rootReducer,
});
