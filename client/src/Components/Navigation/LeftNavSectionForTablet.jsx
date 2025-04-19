import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import Close from '../../assets/Icons/close.png'
import DashboardIcon from '../../assets/Icons/dashboard.png';
import activeDashboardIcon from '../../assets/Icons/active-dashboard.png';
import IssuesIcon from '../../assets/Icons/error.png';
import activeIssueIcon from '../../assets/Icons/issues-active.png';
import ReportsIcon from '../../assets/Icons/reports.png';
import activeReportsIcon from '../../assets/Icons/active-reports.png';
import HistoryIcon from '../../assets/Icons/history.png';
import activeHistoryIcon from '../../assets/Icons/active-history.png';
import LogoutIcon from '../../assets/Icons/logout.png';
import { logout } from '../../redux/slices/authSlice.js'
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import BeatLoader from "react-spinners/BeatLoader";
import { useSelector,useDispatch } from 'react-redux';
import {setPosition} from '../../redux/slices/MobileMenuSlice.js'
const LeftNavSection = () => {

    const dispatch = useDispatch();
    const navigate=useNavigate();
    const [loader,setLoader]=useState(false)

    const position = useSelector(state => state.MobileMenu.position);
    const logoutUser=async(e)=>{
        e.preventDefault();
        setLoader(true)
            try {
                const response=await axios.get(`${import.meta.env.VITE_BASE_URI}/app/logout`, {withCredentials:true});
                if(response ){
                    console.log(response.data.message)
                    dispatch(logout());
                    setLoader(false)
                    navigate('/')
                }
            } catch (error) {
                setLoader(false)
                throw new Error(error)
            }
        
    }


    return (
        <aside className="h-screen w-2/5 lg:w-1/5 shadow-md p-2 border-r-[1px] border-gray-200 font-roboto bg-white block lg:hidden fixed z-[99] transition-all duration-300 ease-in-out" style={{ left: position }}>
            <div className="w-full h-7 flex items-center pl-2 mt-4">
                <p className="text-2xl font-semibold">iBEX</p>
                <img src={Close} alt="Close" className="w-3 h-3 ml-auto cursor-pointer mr-3" onClick={() => dispatch(setPosition("-100%"))} />
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
                                <img src={isActive ? activeDashboardIcon : DashboardIcon} alt="Dashboard" className="w-4 h-4" />
                                <p className="font-medium text-xs">Dashboard</p>
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
                                <img src={isActive ? activeIssueIcon : IssuesIcon} alt="Issues" className="w-4 h-4" />
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
                                <img src={isActive ? activeReportsIcon : ReportsIcon} alt="Reports" className="w-4 h-4" />
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
                                <img src={isActive ? activeHistoryIcon : HistoryIcon} alt="Account History" className="w-4 h-4" />
                                <p className="font-medium text-xs">Accounts History</p>
                            </>
                        )}
                    </NavLink>
                </div>
            </div>

            <hr className="w-11/12 mx-auto" />

           {/* <div className="w-full pt-5 pl-2">
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
                            <img src={isActive ? activeSettingsIcon : SettingsIcon} alt="Settings" className="w-4 h-4" />
                            <p className="font-medium text-xs">Settings</p>
                        </>
                    )}
                </NavLink>
            </div>*/}

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
