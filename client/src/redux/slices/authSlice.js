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
    updatePackageType(state, action) {
      if (state.user) {
        state.user.packageType = action.payload.packageType;
        state.user.subscriptionStatus = action.payload.subscriptionStatus;
      }
    },
    updateProfileDetails(state, action) {
      if (state.user) {
        // Only update the profile fields, preserve other user data
        state.user.firstName = action.payload.firstName;
        state.user.lastName = action.payload.lastName;
        state.user.phone = action.payload.phone;
        state.user.whatsapp = action.payload.whatsapp;
        state.user.email = action.payload.email;
      }
    },
    updateTrialStatus(state, action) {
      if (state.user) {
        // Update trial-related fields
        state.user.packageType = action.payload.packageType;
        state.user.subscriptionStatus = action.payload.subscriptionStatus;
        state.user.isInTrialPeriod = action.payload.isInTrialPeriod;
        state.user.trialEndsDate = action.payload.trialEndsDate;
      }
    },
    logout(state) {
      state.isAuthenticated = false;
      state.user = null;
    }
  }
});

export const { loginSuccess, logout, addBrand, updatePackageType, updateProfileDetails, updateTrialStatus } = authSlice.actions;
export default authSlice.reducer;
