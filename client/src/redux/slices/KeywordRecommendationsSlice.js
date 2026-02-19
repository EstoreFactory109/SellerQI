import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  // ASINs list with summary info
  asinsList: [],
  loadingAsins: false,
  
  // Current selected ASIN data
  selectedAsin: null,
  summary: null, // { totalKeywords, avgBid, highRelevanceCount, highImpressionCount }
  
  // Paginated keywords for selected ASIN
  keywords: [],
  pagination: {
    page: 1,
    limit: 10,
    totalItems: 0,
    totalPages: 0,
    hasMore: false
  },
  loadingKeywords: false,
  loadingMoreKeywords: false, // For load more state
  
  // Legacy support - keywords by ASIN cache
  keywordsByAsin: {}, // { [asin]: { data, loading, error, fetchedAt, pagination } }
  
  // Filter state
  currentFilter: 'all', // 'all', 'highRank', 'highImpression'
  
  // Product info for ASIN lookup
  productInfo: {}, // { [asin]: { sku, name } }
  
  // Error state
  error: null,
  
  // Initial load flag
  initialLoadComplete: false
};

const KeywordRecommendationsSlice = createSlice({
  name: 'keywordRecommendations',
  initialState,
  reducers: {
    // Set initial page data (from optimized endpoint)
    setInitialData: (state, action) => {
      const { asinsList, selectedAsin, summary, keywords, pagination, productInfo } = action.payload;
      state.asinsList = asinsList || [];
      state.selectedAsin = selectedAsin;
      state.summary = summary;
      state.keywords = keywords || [];
      state.pagination = pagination || { page: 1, limit: 10, totalItems: 0, totalPages: 0, hasMore: false };
      state.productInfo = productInfo || {}; // Store product info (asin -> { name, sku })
      state.loadingAsins = false;
      state.loadingKeywords = false;
      state.error = null;
      state.initialLoadComplete = true;
      
      // Also cache in keywordsByAsin for backward compatibility
      if (selectedAsin && keywords) {
        state.keywordsByAsin[selectedAsin] = {
          data: { 
            keywordRecommendationData: { keywordTargetList: [] },
            summary,
            keywords
          },
          loading: false,
          error: null,
          fetchedAt: new Date().toISOString(),
          pagination
        };
      }
    },
    
    // Set ASINs list
    setAsinsList: (state, action) => {
      state.asinsList = action.payload;
      state.loadingAsins = false;
      state.error = null;
    },
    
    setLoadingAsins: (state, action) => {
      state.loadingAsins = action.payload;
    },
    
    // Set selected ASIN
    setSelectedAsin: (state, action) => {
      state.selectedAsin = action.payload;
    },
    
    // Set summary for current ASIN
    setSummary: (state, action) => {
      state.summary = action.payload;
    },
    
    // Set keywords with pagination (replace)
    setKeywords: (state, action) => {
      const { asin, keywords, pagination, summary } = action.payload;
      state.keywords = keywords || [];
      state.pagination = pagination || state.pagination;
      state.summary = summary || state.summary;
      state.loadingKeywords = false;
      state.loadingMoreKeywords = false;
      
      // Cache in keywordsByAsin
      state.keywordsByAsin[asin] = {
        data: { summary, keywords },
        loading: false,
        error: null,
        fetchedAt: new Date().toISOString(),
        pagination
      };
    },
    
    // Append keywords (for load more)
    appendKeywords: (state, action) => {
      const { asin, keywords, pagination } = action.payload;
      state.keywords = [...state.keywords, ...(keywords || [])];
      state.pagination = pagination || state.pagination;
      state.loadingMoreKeywords = false;
      
      // Update cache
      if (state.keywordsByAsin[asin]) {
        state.keywordsByAsin[asin].data.keywords = state.keywords;
        state.keywordsByAsin[asin].pagination = pagination;
        state.keywordsByAsin[asin].fetchedAt = new Date().toISOString();
      }
    },
    
    setLoadingKeywords: (state, action) => {
      state.loadingKeywords = action.payload;
    },
    
    setLoadingMoreKeywords: (state, action) => {
      state.loadingMoreKeywords = action.payload;
    },
    
    // Set filter
    setCurrentFilter: (state, action) => {
      state.currentFilter = action.payload;
      // Reset pagination when filter changes
      state.pagination.page = 1;
      state.keywords = [];
    },
    
    // Set product info
    setProductInfo: (state, action) => {
      state.productInfo = { ...state.productInfo, ...action.payload };
    },
    
    // Legacy support methods
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
      state.keywords = [];
      state.summary = null;
      state.selectedAsin = null;
      state.pagination = { page: 1, limit: 10, totalItems: 0, totalPages: 0, hasMore: false };
      state.productInfo = {};
      state.error = null;
      state.initialLoadComplete = false;
    },
    
    setError: (state, action) => {
      state.error = action.payload;
      state.loadingAsins = false;
      state.loadingKeywords = false;
      state.loadingMoreKeywords = false;
    }
  }
});

export const {
  setInitialData,
  setAsinsList,
  setLoadingAsins,
  setSelectedAsin,
  setSummary,
  setKeywords,
  appendKeywords,
  setLoadingKeywords,
  setLoadingMoreKeywords,
  setCurrentFilter,
  setProductInfo,
  setKeywordsForAsin,
  setLoadingKeywordsForAsin,
  setErrorForAsin,
  clearKeywordsData,
  setError
} = KeywordRecommendationsSlice.actions;

export default KeywordRecommendationsSlice.reducer;

