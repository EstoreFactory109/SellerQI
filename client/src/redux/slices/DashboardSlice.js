import { createSlice } from '@reduxjs/toolkit';

const initialState = {
    DashBoardInfo: null
};

const DashboardDataSlice = createSlice({
    name: 'Dashboard',
    initialState,
    reducers: {
      setDashboardInfo: (state, action) => {
        state.DashBoardInfo = action.payload;
      },
      UpdateDashboardInfo:(state,action)=>{
        state.DashBoardInfo.startDate=action.payload.startDate;
        state.DashBoardInfo.endDate=action.payload.endDate;
        state.DashBoardInfo.accountFinance=action.payload.financeData;
        state.DashBoardInfo.reimbustment=action.payload.reimburstmentData;
        state.DashBoardInfo.TotalWeeklySale=action.payload.WeeklySales;
        state.DashBoardInfo.TotalSales=action.payload.TotalSales;
      },
      setProfitabilityErrors: (state, action) => {
        if (state.DashBoardInfo) {
          state.DashBoardInfo.totalProfitabilityErrors = action.payload;
        }
      },
      setSponsoredAdsErrors: (state, action) => {
        if (state.DashBoardInfo) {
          state.DashBoardInfo.totalSponsoredAdsErrors = action.payload;
        }
      },


    },
  });

  export const { setDashboardInfo,UpdateDashboardInfo, setProfitabilityErrors, setSponsoredAdsErrors } = DashboardDataSlice.actions;
export default DashboardDataSlice.reducer;