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
      // Guard like every sibling reducer: this fires from the navbar/dashboard
      // fetches, which can resolve after a logout has already nulled the user.
      if (state.user) {
        state.user.brand = action.payload;
      }
    },
    updatePackageType(state, action) {
      if (state.user) {
        state.user.packageType = action.payload.packageType;
        state.user.subscriptionStatus = action.payload.subscriptionStatus;
        // Also update trial-related fields when package type changes
        if (action.payload.isInTrialPeriod !== undefined) {
          state.user.isInTrialPeriod = action.payload.isInTrialPeriod;
        }
        if (action.payload.trialEndsDate !== undefined) {
          state.user.trialEndsDate = action.payload.trialEndsDate;
        }
        if (action.payload.servedTrial !== undefined) {
          state.user.servedTrial = action.payload.servedTrial;
        }
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
        // Update all trial-related fields
        state.user.packageType = action.payload.packageType;
        state.user.subscriptionStatus = action.payload.subscriptionStatus;
        state.user.isInTrialPeriod = action.payload.isInTrialPeriod;
        state.user.trialEndsDate = action.payload.trialEndsDate;
        // Also update servedTrial when trial status changes
        if (action.payload.servedTrial !== undefined) {
          state.user.servedTrial = action.payload.servedTrial;
        }
      }
    },
    // Applied after the phone-collection modal saves, so the modal stops showing
    // without needing a fresh /app/profile round trip.
    phoneCollected(state, action) {
      if (state.user) {
        state.user.phone = action.payload.phone;
        state.user.whatsapp = action.payload.whatsapp;
        state.user.needsPhoneUpdate = false;
        state.user.phoneUpdateReason = null;
      }
    },
    logout(state) {
      state.isAuthenticated = false;
      state.user = null;
    }
  }
});

export const { loginSuccess, logout, addBrand, updatePackageType, updateProfileDetails, updateTrialStatus, phoneCollected } = authSlice.actions;
export default authSlice.reducer;
