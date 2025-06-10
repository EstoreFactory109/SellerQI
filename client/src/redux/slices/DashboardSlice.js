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
      }
    },
  });

  export const { setDashboardInfo,UpdateDashboardInfo } = DashboardDataSlice.actions;
  export default DashboardDataSlice.reducer;