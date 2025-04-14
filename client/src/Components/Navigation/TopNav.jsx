import React, { useState } from 'react'
import Notification from '../../assets/Icons/notification.png'
import Avatar from '../../assets/Icons/avatar.jpeg'
import hamburger from '../../assets/Icons/hamburger.png'
import { useSelector, useDispatch } from 'react-redux'
import {setPosition} from '../../redux/slices/MobileMenuSlice.js'

const TopNav = ({name}) => {

    const user = useSelector((state) => state.Auth?.user);
    const Country=useSelector((state) => state.Dashboard?.DashBoardInfo?.Country);
    const dispatch = useDispatch();

    const handleHamburger = () => {
        dispatch(setPosition("0%"))
    }

    return (
        <nav className="w-full lg:w-[83vw] lg:h-[10vh] h-[8vh] flex items-center justify-between lg:justify-end p-10 lg:gap-7 gap-2 shadow-md bg-white border-b-[1px] border-gray-200 fixed top-0 z-50 lg:static">
            <img src={hamburger} className='w-[1.5rem] lg:hidden' onClick={handleHamburger}/>
            <div className='flex items-center justify-end  lg:gap-7 gap-2 h-full'>
                <select className="lg:p-1 rounded-md outline-none text-xs lg:text-base">
                    <option>{name || user?.firstName} | Amazon {Country}</option>
                </select>
                <div className="w-6 h-6 lg:w-7 lg:h-8 relative flex justify-center items-center mr-2" >
                    <img src={Notification} alt="" className='w-[70%] h-[70%] cursor-pointer' />
                    <p className='absolute text-white bg-[#b92533] text-[8px] lg:text-xs px-[3px] py-[0.5px] lg:px-[4px] rounded-full top-0 right-0'>5</p>
                </div>
                <img src={Avatar} alt="" className="lg:w-8 lg:h-8 w-6 h-6 rounded-full" />
            </div>

        </nav>
    )
}

export default TopNav