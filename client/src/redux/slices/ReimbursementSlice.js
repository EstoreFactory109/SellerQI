import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { getReimbursementSummary } from '../../services/reimbursementService';

// Async thunk for fetching reimbursement summary
export const fetchReimbursementSummary = createAsyncThunk(
  'reimbursement/fetchSummary',
  async (_, { rejectWithValue }) => {
    try {
      const response = await getReimbursementSummary();
      
      if (response && response.data) {
        // Calculate total reimbursement from backend data
        const totalReimbursement = response.data?.totalRecoverable || 
                                    response.data?.totalRecoverableMonth || 
                                    (response.data?.feeProtector?.backendShipmentItems?.totalExpectedAmount || 0) +
                                    (response.data?.backendLostInventory?.totalExpectedAmount || 0) +
                                    (response.data?.backendDamagedInventory?.totalExpectedAmount || 0) +
                                    (response.data?.backendDisposedInventory?.totalExpectedAmount || 0) +
                                    (response.data?.backendFeeReimbursement?.totalExpectedAmount || 0);
        
        return {
          totalReimbursement: totalReimbursement || 0,
          rawData: response.data
        };
      }
      return { totalReimbursement: 0, rawData: null };
    } catch (error) {
      console.error('[ReimbursementSlice] Error fetching summary:', error);
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch reimbursement summary');
    }
  }
);

const initialState = {
  summary: {
    totalReimbursement: 0,
    rawData: null
  },
  loading: false,
  error: null,
  lastFetched: null
};

const ReimbursementSlice = createSlice({
  name: 'reimbursement',
  initialState,
  reducers: {
    clearReimbursementData: (state) => {
      state.summary = { totalReimbursement: 0, rawData: null };
      state.error = null;
      state.lastFetched = null;
    },
    // Force refresh will clear lastFetched to trigger new fetch
    forceRefresh: (state) => {
      state.lastFetched = null;
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchReimbursementSummary.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchReimbursementSummary.fulfilled, (state, action) => {
        state.loading = false;
        state.summary = action.payload;
        state.lastFetched = Date.now();
        state.error = null;
      })
      .addCase(fetchReimbursementSummary.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  }
});

export const { clearReimbursementData, forceRefresh } = ReimbursementSlice.actions;
export default ReimbursementSlice.reducer;

