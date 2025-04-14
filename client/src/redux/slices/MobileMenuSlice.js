import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  position:"-100%"
};

const MobileMenuSlice = createSlice({
  name: 'MobileMenu',
  initialState,
  reducers: {
    setPosition(state, action) {
      state.position = action.payload;
    },
    
  }
});

export const { setPosition} = MobileMenuSlice.actions;
export default MobileMenuSlice.reducer;
