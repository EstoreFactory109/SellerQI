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
        state.DashBoardInfo.GetOrderData=action.payload.GetOrderData;
        // Set calendar mode flag for custom range
        state.DashBoardInfo.calendarMode = action.payload.calendarMode || 'custom';
        // Preserve createdAccountDate when updating dashboard info
        if (action.payload.createdAccountDate) {
          state.DashBoardInfo.createdAccountDate = action.payload.createdAccountDate;
        }
      },
      setCalendarMode: (state, action) => {
        if (state.DashBoardInfo) {
          state.DashBoardInfo.calendarMode = action.payload;
        }
      }
    },
  });

  export const { setDashboardInfo,UpdateDashboardInfo,setCalendarMode } = DashboardDataSlice.actions;
  export default DashboardDataSlice.reducer;