import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  isAuthenticated: false,
  user: null,
};

const authSlice = createSlice({
  name: 'Auth',
  initialState,
  reducers: {
    loginSuccess(state, action) {
      state.isAuthenticated = true;
      state.user = action.payload;
    },
    addBrand(state,action){
      state.user.brand = action.payload;
    },
    logout(state) {
      state.isAuthenticated = false;
      state.user = null;
    }
  }
});

export const { loginSuccess, logout,addBrand } = authSlice.actions;
export default authSlice.reducer;
