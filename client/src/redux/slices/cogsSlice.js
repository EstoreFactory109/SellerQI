import { createSlice } from '@reduxjs/toolkit';
import { encryptObject, decryptObject } from '../../utils/encryption';

const COGS_STORAGE_KEY = 'ibex_cogs_data';

// Load initial state from localStorage
const loadCogsFromStorage = () => {
  try {
    const encryptedData = localStorage.getItem(COGS_STORAGE_KEY);
    if (encryptedData) {
      return decryptObject(encryptedData);
    }
  } catch (error) {
    console.error('Error loading COGs data:', error);
  }
  return {};
};

const initialState = {
  cogsValues: loadCogsFromStorage()
};

const cogsSlice = createSlice({
  name: 'cogs',
  initialState,
  reducers: {
    setCogsValue: (state, action) => {
      const { asin, value } = action.payload;
      state.cogsValues[asin] = value;
      
      // Save to localStorage with encryption
      try {
        const encrypted = encryptObject(state.cogsValues);
        localStorage.setItem(COGS_STORAGE_KEY, encrypted);
      } catch (error) {
        console.error('Error saving COGs data:', error);
      }
    },
    
    setMultipleCogsValues: (state, action) => {
      state.cogsValues = { ...state.cogsValues, ...action.payload };
      
      // Save to localStorage with encryption
      try {
        const encrypted = encryptObject(state.cogsValues);
        localStorage.setItem(COGS_STORAGE_KEY, encrypted);
      } catch (error) {
        console.error('Error saving COGs data:', error);
      }
    },
    
    clearCogsData: (state) => {
      state.cogsValues = {};
      // Remove from localStorage
      localStorage.removeItem(COGS_STORAGE_KEY);
    }
  }
});

export const { setCogsValue, setMultipleCogsValues, clearCogsData } = cogsSlice.actions;
export default cogsSlice.reducer; 