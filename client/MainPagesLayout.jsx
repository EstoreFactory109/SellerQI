import React, { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import TopNav from '../Components/Navigation/TopNav'
import LeftNavSection from '../Components/Navigation/LeftNavSection'
import LeftNavSectionForTablet from '../Components/Navigation/LeftNavSectionForTablet'
import { useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { loginSuccess } from '../redux/slices/authSlice.js'
import axios from 'axios'
const MainPagesLayout = () => {

  const isAuthenticated = useSelector((state) => state.Auth.isAuthenticated);
  const navigate = useNavigate();
  useEffect(()=>{
    if(!isAuthenticated){
      (async () => {
        try {
          const response = await axios.get(
            `${import.meta.env.VITE_BASE_URI}/app/profile`, { withCredentials: true }
  
          );
  
          if (response?.status === 200 && response.data?.data) {
            dispatch(loginSuccess(response.data.data));
            console.log(response.data.data.firstName)
            setName(response.data.data.firstName);
            
          }
        } catch (error) {
          throw new Error(error)
        }
      })()
    }
  },[isAuthenticated, dispatch, navigate])

  console.log(name)

  return (
    <div className='flex'>
        <LeftNavSection  />
        <LeftNavSectionForTablet/>
        <section className='w-full h-[100vh] '>
            <TopNav />
            <Outlet/>
        </section>
    </div>
  )
}

export default MainPagesLayout