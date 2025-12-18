// src/redux/store.js
import { configureStore } from '@reduxjs/toolkit';
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

export const store = configureStore({
  reducer: {
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
    reimbursement: reimbursementSlice
  },
});
