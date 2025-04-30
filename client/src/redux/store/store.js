// src/redux/store.js
import { configureStore } from '@reduxjs/toolkit';
import DashboardDetaSlice from '../slices/DashboardSlice.js';
import HistoryDataSlice from '../slices/HistorySlice.js'
import authSlice from '../slices/authSlice.js';
import MobileMenuSlice from '../slices/MobileMenuSlice.js'
import profileImageSlice from '../slices/profileImage.js'
import AllAccountsSlice from '../slices/AllAccountsSlice.js'

export const store = configureStore({
  reducer: {
    Dashboard: DashboardDetaSlice,
    History:HistoryDataSlice,
    Auth:authSlice,
    MobileMenu:MobileMenuSlice,
    profileImage:profileImageSlice,
    AllAccounts:AllAccountsSlice
  },
});
