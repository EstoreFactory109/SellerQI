import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  asinsList: [],
  keywordsByAsin: {}, // { [asin]: { data, loading, error, fetchedAt } }
  loadingAsins: false,
  error: null
};

const KeywordRecommendationsSlice = createSlice({
  name: 'keywordRecommendations',
  initialState,
  reducers: {
    setAsinsList: (state, action) => {
      state.asinsList = action.payload;
      state.loadingAsins = false;
      state.error = null;
    },
    
    setLoadingAsins: (state, action) => {
      state.loadingAsins = action.payload;
    },
    
    setKeywordsForAsin: (state, action) => {
      const { asin, data } = action.payload;
      state.keywordsByAsin[asin] = {
        data: data,
        loading: false,
        error: null,
        fetchedAt: new Date().toISOString()
      };
    },
    
    setLoadingKeywordsForAsin: (state, action) => {
      const { asin, loading } = action.payload;
      if (!state.keywordsByAsin[asin]) {
        state.keywordsByAsin[asin] = {
          data: null,
          loading: loading,
          error: null,
          fetchedAt: null
        };
      } else {
        state.keywordsByAsin[asin].loading = loading;
      }
    },
    
    setErrorForAsin: (state, action) => {
      const { asin, error } = action.payload;
      if (!state.keywordsByAsin[asin]) {
        state.keywordsByAsin[asin] = {
          data: null,
          loading: false,
          error: error,
          fetchedAt: null
        };
      } else {
        state.keywordsByAsin[asin].error = error;
        state.keywordsByAsin[asin].loading = false;
      }
    },
    
    clearKeywordsData: (state) => {
      state.keywordsByAsin = {};
      state.asinsList = [];
      state.error = null;
    },
    
    setError: (state, action) => {
      state.error = action.payload;
      state.loadingAsins = false;
    }
  }
});

export const {
  setAsinsList,
  setLoadingAsins,
  setKeywordsForAsin,
  setLoadingKeywordsForAsin,
  setErrorForAsin,
  clearKeywordsData,
  setError
} = KeywordRecommendationsSlice.actions;

export default KeywordRecommendationsSlice.reducer;

