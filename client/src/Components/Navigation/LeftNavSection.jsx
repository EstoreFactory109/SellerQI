import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {LayoutDashboard,BadgeAlert, ClipboardPlus,Clock8,Settings,ChartLine,LaptopMinimalCheck} from 'lucide-react'
import LogoutIcon from '../../assets/Icons/logout.png';
import { useDispatch } from 'react-redux';
import { logout } from '../../redux/slices/authSlice.js'
import { clearCogsData } from '../../redux/slices/cogsSlice.js'
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import BeatLoader from "react-spinners/BeatLoader";
const LeftNavSection = () => {

    const dispatch = useDispatch();
    const navigate=useNavigate();
    const [loader,setLoader]=useState(false)
    
    const logoutUser=async(e)=>{
        e.preventDefault();
        setLoader(true)
        try {
            const response=await axios.get(`${import.meta.env.VITE_BASE_URI}/app/logout`, {withCredentials:true});
            if(response && response.status===200 ){
                console.log(response.data.message)
                dispatch(logout());
                dispatch(clearCogsData());
                localStorage.setItem("isAuth",false)
                setLoader(false)
                navigate('/')
            }
        } catch (error) {
            setLoader(false)
            throw new Error(error)
        }
    }


    return (
        <aside className="h-screen w-2/5 lg:w-1/5 shadow-md p-2 border-r-[1px] border-gray-200 font-roboto bg-white hidden lg:block">
            <div className="w-full h-7 flex items-center pl-2 mt-4">
                <p className="text-2xl font-semibold">Seller QI</p>
            </div>
            <div className="w-full mt-5 pl-2 pb-5">
                <p className="font-light mb-3 text-sm">MENU</p>
                <div className="space-y-2">
                    <NavLink
                        to="/seller-central-checker/dashboard"
                        className={({ isActive }) =>
                            isActive
                                ? 'flex items-center gap-2 p-2 rounded-md bg-[#333651] text-white'
                                : 'flex items-center gap-2 p-2 rounded-md'
                        }
                    >
                        {({ isActive }) => (
                            <>
                               <LayoutDashboard className="w-4 h-4"/>
                                <p className="font-medium text-xs">Dashboard</p>
                            </>
                        )}
                    </NavLink>
                    <NavLink
                        to="/seller-central-checker/ppc-dashboard"
                        className={({ isActive }) =>
                            isActive
                                ? 'flex items-center gap-2 p-2 rounded-md bg-[#333651] text-white'
                                : 'flex items-center gap-2 p-2 rounded-md'
                        }
                    >
                        {({ isActive }) => (
                            <>
                               <LaptopMinimalCheck className="w-4 h-4"/>
                                <p className="font-medium text-xs">Sponsored Ads</p>
                            </>
                        )}
                    </NavLink>
                    
                    <NavLink
                        to="/seller-central-checker/profitibility-dashboard"
                        className={({ isActive }) =>
                            isActive
                                ? 'flex items-center gap-2 p-2 rounded-md bg-[#333651] text-white'
                                : 'flex items-center gap-2 p-2 rounded-md'
                        }
                    >
                        {({ isActive }) => (
                            <>
                               <ChartLine className="w-4 h-4"/>
                                <p className="font-medium text-xs">Profitibility</p>
                            </>
                        )}
                    </NavLink>

                    <NavLink
                        to="/seller-central-checker/issues"
                        className={({ isActive }) =>
                            isActive
                                ? 'flex items-center gap-2 p-2 rounded-md bg-[#333651] text-white'
                                : 'flex items-center gap-2 p-2 rounded-md'
                        }
                    >
                        {({ isActive }) => (
                            <>
                               <BadgeAlert className="w-4 h-4"/>
                                <p className="font-medium text-xs">Issues</p>
                            </>
                        )}
                    </NavLink>

                    <NavLink
                        to="/seller-central-checker/reports"
                        className={({ isActive }) =>
                            isActive
                                ? 'flex items-center gap-2 p-2 rounded-md bg-[#333651] text-white'
                                : 'flex items-center gap-2 p-2 rounded-md'
                        }
                    >
                        {({ isActive }) => (
                            <>
                               <ClipboardPlus className="w-4 h-4"/>
                                <p className="font-medium text-xs">Reports</p>
                            </>
                        )}
                    </NavLink>

                    <NavLink
                        to="/seller-central-checker/account-history"
                        className={({ isActive }) =>
                            isActive
                                ? 'flex items-center gap-2 p-2 rounded-md bg-[#333651] text-white'
                                : 'flex items-center gap-2 p-2 rounded-md'
                        }
                    >
                        {({ isActive }) => (
                            <>
                               <Clock8 className="w-4 h-4"/>
                                <p className="font-medium text-xs">Accounts History</p>
                            </>
                        )}
                    </NavLink>
                </div>
            </div>

            <hr className="w-11/12 mx-auto" />

           {<div className="w-full pt-5 pl-2">
                <p className="font-light mb-4">HELP</p>
                <NavLink
                    to="/seller-central-checker/settings"
                    className={({ isActive }) =>
                        isActive
                            ? 'flex items-center gap-2 p-2 rounded-md bg-[#333651] text-white'
                            : 'flex items-center gap-2 p-2 rounded-md'
                    }
                >
                    {({ isActive }) => (
                        <>
                            <Settings className="w-4 h-4"/>
                            <p className="font-medium text-xs">Settings</p>
                        </>
                    )}
                </NavLink>
            </div>}

            <div className="w-full pt-5 pl-2 absolute bottom-6">
                <button className='flex items-center gap-2 p-2' onClick={(e)=>logoutUser(e)}>
                    <img src={LogoutIcon} alt="Logout" className="w-4 h-4" />
                    <p className="font-medium text-xs text-[#b92533]">Log Out</p>
                    {loader&&<BeatLoader color="#b92533" size={8} />}
                </button>
            </div>
        </aside>
    );
};

export default LeftNavSection;
