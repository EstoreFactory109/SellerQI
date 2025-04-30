import { createSlice } from "@reduxjs/toolkit";

const initialState = {
    imageLink:null
  };

  export const profileImageSlice = createSlice({
    name: "profileImage",
    initialState,
    reducers: {
      updateImageLink: (state, action) => {
        console.log(action.payload)
        state.imageLink = action.payload;
      },
    },
  });

  export const { updateImageLink } = profileImageSlice.actions;
  export default profileImageSlice.reducer;