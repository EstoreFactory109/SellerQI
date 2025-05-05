import React, { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import TopNav from '../Components/Navigation/TopNav'
import LeftNavSection from '../Components/Navigation/LeftNavSection'
import LeftNavSectionForTablet from '../Components/Navigation/LeftNavSectionForTablet'
import { useSelector,useDispatch } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { loginSuccess } from '../redux/slices/authSlice.js'
import { updateImageLink } from '../redux/slices/profileImage.js'
import axios from 'axios'

const MainPagesLayout = () => {

  const isAuthenticated = useSelector((state) => state.Auth.isAuthenticated);
  
  
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [name,setName] = useState('');
  useEffect(()=>{
    if(!isAuthenticated){
      (async () => {
        try {
          const response = await axios.get(
            `${import.meta.env.VITE_BASE_URI}/app/profile`, { withCredentials: true }
  
          );
  
          if (response?.status === 200 && response.data?.data) {
                      const user = response.data.data;
                      console.log(user)
                      dispatch(updateImageLink(user.profilePicUrl));
                      dispatch(loginSuccess({
                        firstName : user.firstName,
                        lastName : user.lastName ,
                        phone:user.phone ,
                        whatsapp:user.whatsapp ,
                        email:user.email
                      }));
          }
        } catch (error) {
          throw new Error(error)
        }
      })()
    }
  },[isAuthenticated, dispatch, navigate])

  

  return (
    <div className='flex min-h-screen'>
        <LeftNavSection  />
        <LeftNavSectionForTablet/>
        <section className='w-full h-[100vh] overflow-hidden'>
            <TopNav name={name}/>
            <Outlet/>
        </section>
    </div>
  )
}

export default MainPagesLayout