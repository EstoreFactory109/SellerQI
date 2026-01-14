import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { getReimbursementSummary, getReimbursementByCategory } from '../../services/reimbursementService';

// Async thunk for fetching reimbursement summary (with pagination support)
export const fetchReimbursementSummary = createAsyncThunk(
  'reimbursement/fetchSummary',
  async ({ page = 1, limit = 20, summaryOnly = false, category = null } = {}, { getState, rejectWithValue }) => {
    try {
      const state = getState();
      const existingData = state.reimbursement?.summary?.rawData;
      const lastFetched = state.reimbursement?.lastFetched;
      
      // For initial load, check cache (only for page 1 and no category filter)
      if (!category && page === 1 && !summaryOnly && lastFetched && (Date.now() - lastFetched) < 5 * 60 * 1000 && existingData) {
        return {
          totalReimbursement: state.reimbursement.summary.totalReimbursement,
          rawData: existingData,
          fromCache: true
        };
      }
      
      const response = await getReimbursementSummary({ page, limit, summaryOnly, category });
      
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
          rawData: response.data,
          fromCache: false
        };
      }
      return { totalReimbursement: 0, rawData: null, fromCache: false };
    } catch (error) {
      console.error('[ReimbursementSlice] Error fetching summary:', error);
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch reimbursement summary');
    }
  }
);

// Async thunk for loading more data for a specific category
export const fetchMoreReimbursementData = createAsyncThunk(
  'reimbursement/fetchMoreData',
  async ({ category, page, limit = 20 }, { getState, rejectWithValue }) => {
    try {
      const response = await getReimbursementSummary({ page, limit, category });
      
      if (response && response.data) {
        return {
          category,
          data: response.data,
          page
        };
      }
      return { category, data: null, page };
    } catch (error) {
      console.error('[ReimbursementSlice] Error fetching more data:', error);
      return rejectWithValue(error.response?.data?.message || 'Failed to fetch more reimbursement data');
    }
  }
);

const initialState = {
  summary: {
    totalReimbursement: 0,
    rawData: null
  },
  loading: false,
  loadingMore: false,
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
    },
    // Append more data to a category
    appendCategoryData: (state, action) => {
      const { category, data } = action.payload;
      if (state.summary.rawData && data) {
        const categoryKey = {
          'shipment': 'feeProtector',
          'lost': 'backendLostInventory',
          'damaged': 'backendDamagedInventory',
          'disposed': 'backendDisposedInventory'
        }[category];
        
        if (categoryKey && state.summary.rawData[categoryKey]) {
          const existingData = state.summary.rawData[categoryKey].data || [];
          state.summary.rawData[categoryKey].data = [...existingData, ...data];
        }
      }
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
        // Only update if not from cache
        if (!action.payload.fromCache) {
          state.summary = {
            totalReimbursement: action.payload.totalReimbursement,
            rawData: action.payload.rawData
          };
          state.lastFetched = Date.now();
        }
        state.error = null;
      })
      .addCase(fetchReimbursementSummary.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Handle loading more data for a category
      .addCase(fetchMoreReimbursementData.pending, (state) => {
        state.loadingMore = true;
      })
      .addCase(fetchMoreReimbursementData.fulfilled, (state, action) => {
        state.loadingMore = false;
        const { category, data } = action.payload;
        
        if (data && state.summary.rawData) {
          // Map category to the correct key in rawData
          const categoryMap = {
            'shipment': 'feeProtector',
            'lost': 'backendLostInventory',
            'damaged': 'backendDamagedInventory',
            'disposed': 'backendDisposedInventory'
          };
          
          const rawDataKey = categoryMap[category];
          if (rawDataKey) {
            // Get the new data from the response
            let newItems = [];
            let pagination = null;
            
            if (category === 'shipment' && data.feeProtector?.backendShipmentItems) {
              newItems = data.feeProtector.backendShipmentItems.data || [];
              pagination = data.feeProtector.backendShipmentItems.pagination;
            } else if (data[rawDataKey]) {
              newItems = data[rawDataKey].data || [];
              pagination = data[rawDataKey].pagination;
            }
            
            // Append to existing data
            if (category === 'shipment') {
              const existing = state.summary.rawData.feeProtector?.backendShipmentItems?.data || [];
              state.summary.rawData.feeProtector.backendShipmentItems.data = [...existing, ...newItems];
              if (pagination) {
                state.summary.rawData.feeProtector.backendShipmentItems.pagination = pagination;
              }
            } else {
              const existing = state.summary.rawData[rawDataKey]?.data || [];
              state.summary.rawData[rawDataKey].data = [...existing, ...newItems];
              if (pagination) {
                state.summary.rawData[rawDataKey].pagination = pagination;
              }
            }
          }
        }
      })
      .addCase(fetchMoreReimbursementData.rejected, (state, action) => {
        state.loadingMore = false;
        state.error = action.payload;
      });
  }
});

export const { clearReimbursementData, forceRefresh, appendCategoryData } = ReimbursementSlice.actions;
export default ReimbursementSlice.reducer;

