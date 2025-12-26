import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

const BASE_URL = import.meta.env.VITE_BASE_URI;

// Async thunk to fetch COGS from the database
export const fetchCogs = createAsyncThunk(
  'cogs/fetchCogs',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axios.get(`${BASE_URL}/api/cogs`, {
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data || { message: 'Failed to fetch COGS' });
    }
  }
);

// Async thunk to save a single COGS entry
export const saveCogsToDb = createAsyncThunk(
  'cogs/saveCogsToDb',
  async ({ asin, sku, cogs }, { rejectWithValue }) => {
    try {
      const response = await axios.post(
        `${BASE_URL}/api/cogs`,
        { asin, sku, cogs },
        { withCredentials: true }
      );
      return { asin, cogs, response: response.data };
    } catch (error) {
      return rejectWithValue(error.response?.data || { message: 'Failed to save COGS' });
    }
  }
);

// Async thunk to bulk save COGS entries
export const bulkSaveCogsToDb = createAsyncThunk(
  'cogs/bulkSaveCogsToDb',
  async (cogsValues, { rejectWithValue }) => {
    try {
      const response = await axios.post(
        `${BASE_URL}/api/cogs/bulk`,
        { cogsValues },
        { withCredentials: true }
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data || { message: 'Failed to bulk save COGS' });
    }
  }
);

// Async thunk to delete a COGS entry
export const deleteCogsFromDb = createAsyncThunk(
  'cogs/deleteCogsFromDb',
  async (asin, { rejectWithValue }) => {
    try {
      const response = await axios.delete(`${BASE_URL}/api/cogs/${asin}`, {
        withCredentials: true,
      });
      return { asin, response: response.data };
    } catch (error) {
      return rejectWithValue(error.response?.data || { message: 'Failed to delete COGS' });
    }
  }
);

const initialState = {
  cogsValues: {},
  savedCogsValues: {}, // Values that are saved in the database
  loading: false,
  saving: {}, // Track saving state per ASIN
  error: null,
  lastFetched: null,
  hasUnsavedChanges: false,
};

const cogsSlice = createSlice({
  name: 'cogs',
  initialState,
  reducers: {
    setCogsValue: (state, action) => {
      const { asin, value } = action.payload;
      state.cogsValues[asin] = value;
      // Check if this value differs from the saved value
      if (state.savedCogsValues[asin] !== value) {
        state.hasUnsavedChanges = true;
      }
    },
    
    setMultipleCogsValues: (state, action) => {
      state.cogsValues = { ...state.cogsValues, ...action.payload };
      state.hasUnsavedChanges = true;
    },
    
    clearCogsData: (state) => {
      state.cogsValues = {};
      state.savedCogsValues = {};
      state.hasUnsavedChanges = false;
    },

    markAsSaved: (state, action) => {
      const { asin, value } = action.payload;
      state.savedCogsValues[asin] = value;
      // Check if all values are now saved
      const allSaved = Object.entries(state.cogsValues).every(
        ([key, val]) => state.savedCogsValues[key] === val
      );
      if (allSaved) {
        state.hasUnsavedChanges = false;
      }
    },

    setSavingState: (state, action) => {
      const { asin, isSaving } = action.payload;
      state.saving[asin] = isSaving;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch COGS
      .addCase(fetchCogs.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCogs.fulfilled, (state, action) => {
        state.loading = false;
        if (action.payload?.data?.cogsValues) {
          state.cogsValues = action.payload.data.cogsValues;
          state.savedCogsValues = { ...action.payload.data.cogsValues };
        }
        state.lastFetched = Date.now();
        state.hasUnsavedChanges = false;
      })
      .addCase(fetchCogs.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || 'Failed to fetch COGS';
      })
      // Save single COGS
      .addCase(saveCogsToDb.pending, (state, action) => {
        const asin = action.meta.arg.asin;
        state.saving[asin] = true;
        state.error = null;
      })
      .addCase(saveCogsToDb.fulfilled, (state, action) => {
        const { asin, cogs } = action.payload;
        state.saving[asin] = false;
        state.savedCogsValues[asin] = cogs;
        // Check if all values are now saved
        const allSaved = Object.entries(state.cogsValues).every(
          ([key, val]) => state.savedCogsValues[key] === val
        );
        if (allSaved) {
          state.hasUnsavedChanges = false;
        }
      })
      .addCase(saveCogsToDb.rejected, (state, action) => {
        const asin = action.meta.arg.asin;
        state.saving[asin] = false;
        state.error = action.payload?.message || 'Failed to save COGS';
      })
      // Bulk save COGS
      .addCase(bulkSaveCogsToDb.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(bulkSaveCogsToDb.fulfilled, (state, action) => {
        state.loading = false;
        if (action.payload?.data?.cogsValues) {
          state.savedCogsValues = { ...action.payload.data.cogsValues };
        }
        state.hasUnsavedChanges = false;
      })
      .addCase(bulkSaveCogsToDb.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload?.message || 'Failed to bulk save COGS';
      })
      // Delete COGS
      .addCase(deleteCogsFromDb.pending, (state) => {
        state.error = null;
      })
      .addCase(deleteCogsFromDb.fulfilled, (state, action) => {
        const { asin } = action.payload;
        delete state.cogsValues[asin];
        delete state.savedCogsValues[asin];
        delete state.saving[asin];
      })
      .addCase(deleteCogsFromDb.rejected, (state, action) => {
        state.error = action.payload?.message || 'Failed to delete COGS';
      });
  },
});

export const { 
  setCogsValue, 
  setMultipleCogsValues, 
  clearCogsData, 
  markAsSaved,
  setSavingState 
} = cogsSlice.actions;

// Selectors
export const selectCogsValues = (state) => state.cogs.cogsValues;
export const selectSavedCogsValues = (state) => state.cogs.savedCogsValues;
export const selectCogsLoading = (state) => state.cogs.loading;
export const selectCogsSaving = (state) => state.cogs.saving;
export const selectCogsError = (state) => state.cogs.error;
export const selectHasUnsavedChanges = (state) => state.cogs.hasUnsavedChanges;
export const selectIsAsinSaved = (asin) => (state) => 
  state.cogs.cogsValues[asin] === state.cogs.savedCogsValues[asin];

export default cogsSlice.reducer;
