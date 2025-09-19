import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  currency: null,
  country: null,
};

const currencySlice = createSlice({
  name: 'currency',
  initialState,
  reducers: {
    setCurrency: (state, action) => {
      state.currency = action.payload.currency;
      state.country = action.payload.country;
    },
    clearCurrency: (state) => {
      state.currency = null;
      state.country = null;
    },
  },
});

export const { setCurrency, clearCurrency } = currencySlice.actions;
export default currencySlice.reducer;
