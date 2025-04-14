import { createSlice } from '@reduxjs/toolkit';

const initialState = {
    HistoryInfo:null
};

const HistoryDataSlice = createSlice({
    name: 'History',
    initialState,
    reducers: {
      setHistoryInfo: (state, action) => {
        state.HistoryInfo = action.payload;
      },
    },
  });

  export const { setHistoryInfo } = HistoryDataSlice.actions;
export default HistoryDataSlice.reducer;