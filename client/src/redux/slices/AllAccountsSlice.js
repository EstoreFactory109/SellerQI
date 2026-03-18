import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  AllAccounts:null
};

const AllAccountsSlice = createSlice({
  name: 'AllAccounts',
  initialState,
  reducers: {
    setAllAccounts(state, action) {
      state.AllAccounts = action.payload;
    },
  }
});

export const { setAllAccounts } = AllAccountsSlice.actions;
export default AllAccountsSlice.reducer;
