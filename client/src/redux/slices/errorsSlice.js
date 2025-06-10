import { createSlice } from '@reduxjs/toolkit';

const initialState = {
    profitabilityErrors: {
        totalErrors: 0,
        errorDetails: []
    },
    sponsoredAdsErrors: {
        totalErrors: 0,
        errorDetails: []
    }
};

const errorsSlice = createSlice({
    name: 'errors',
    initialState,
    reducers: {
        setProfitabilityErrorDetails: (state, action) => {
            state.profitabilityErrors = action.payload;
        },
        setSponsoredAdsErrorDetails: (state, action) => {
            state.sponsoredAdsErrors = action.payload;
        },
        updateProfitabilityErrors: (state, action) => {
            state.profitabilityErrors.totalErrors = action.payload.totalErrors;
            if (action.payload.errorDetails) {
                state.profitabilityErrors.errorDetails = action.payload.errorDetails;
            }
        },
        updateSponsoredAdsErrors: (state, action) => {
            state.sponsoredAdsErrors.totalErrors = action.payload.totalErrors;
            if (action.payload.errorDetails) {
                state.sponsoredAdsErrors.errorDetails = action.payload.errorDetails;
            }
        },
        clearErrors: (state) => {
            state.profitabilityErrors = initialState.profitabilityErrors;
            state.sponsoredAdsErrors = initialState.sponsoredAdsErrors;
        }
    }
});

export const { 
    setProfitabilityErrorDetails, 
    setSponsoredAdsErrorDetails, 
    updateProfitabilityErrors,
    updateSponsoredAdsErrors,
    clearErrors 
} = errorsSlice.actions;

export default errorsSlice.reducer; 