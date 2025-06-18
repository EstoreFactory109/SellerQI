import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import Close from '../../assets/Icons/close.png'
import {LayoutDashboard,BadgeAlert, ClipboardPlus,Clock8,Settings,ChartLine,LaptopMinimalCheck,Search, ChevronDown, ChevronRight} from 'lucide-react'
import LogoutIcon from '../../assets/Icons/logout.png';
import { logout } from '../../redux/slices/authSlice.js'
import { clearCogsData } from '../../redux/slices/cogsSlice.js'
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import BeatLoader from "react-spinners/BeatLoader";
import { useSelector,useDispatch } from 'react-redux';
import {setPosition} from '../../redux/slices/MobileMenuSlice.js'
import { AnimatePresence, motion } from "framer-motion";

const LeftNavSection = () => {

    const dispatch = useDispatch();
    const navigate=useNavigate();
    const location = useLocation();
    const [loader,setLoader]=useState(false)
    const [issuesDropdownOpen, setIssuesDropdownOpen] = useState(false);

    const position = useSelector(state => state.MobileMenu.position);
    
    // Get current tab from URL search params
    const searchParams = new URLSearchParams(location.search);
    const currentTab = searchParams.get('tab') || 'overview';
    const isIssuesPage = location.pathname.includes('/issues');
    
    // Keep dropdown open if we're on issues page
    React.useEffect(() => {
        if (isIssuesPage) {
            setIssuesDropdownOpen(true);
        }
    }, [isIssuesPage]);

    // Handle Issues button click
    const handleIssuesClick = () => {
        if (!isIssuesPage) {
            // If not on issues page, navigate to overview
            navigate('/seller-central-checker/issues?tab=overview');
        }
        setIssuesDropdownOpen(!issuesDropdownOpen);
    };
    
    const logoutUser=async(e)=>{
        e.preventDefault();
        setLoader(true)
        try {
            const response=await axios.get(`${import.meta.env.VITE_BASE_URI}/app/logout`, {withCredentials:true});
            if(response.status===200){
                localStorage.removeItem('isAuth');
                dispatch(logout());
                dispatch(clearCogsData());
                setLoader(false)
                navigate('/login');
            }
        } catch (error) {
            setLoader(false)
            console.log(error);
        }
    }


    return (
        <aside className="h-screen w-2/5 lg:w-1/5 shadow-md p-2 border-r-[1px] border-gray-200 font-roboto bg-white block lg:hidden fixed z-[99] transition-all duration-300 ease-in-out" style={{ left: position }}>
            <div className="w-full h-7 flex items-center pl-2 mt-4">
                <img 
                    src="https://res.cloudinary.com/ddoa960le/image/upload/v1749063777/MainLogo_1_uhcg6o.png"
                    alt="Seller QI Logo"
                    loading="lazy"
                    className="h-7 w-auto object-contain"
                    width="120"
                    height="28"
                />
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
                                <LayoutDashboard className="w-4 h-4" />
                                <p className="font-medium text-xs">Dashboard</p>
                            </>
                        )}
                    </NavLink>

                    {/* Issues with Dropdown */}
                    <div className="space-y-1">
                        <div
                            className={`flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors ${
                                isIssuesPage 
                                    ? 'bg-[#333651] text-white' 
                                    : 'hover:bg-gray-100'
                            }`}
                            onClick={handleIssuesClick}
                        >
                            <BadgeAlert className="w-4 h-4"/>
                            <p className="font-medium text-xs flex-1">Issues</p>
                            <motion.div
                                animate={{ rotate: issuesDropdownOpen ? 90 : 0 }}
                                transition={{ duration: 0.2, ease: "easeInOut" }}
                            >
                                {issuesDropdownOpen ? 
                                    <ChevronDown className="w-3 h-3"/> : 
                                    <ChevronRight className="w-3 h-3"/>
                                }
                            </motion.div>
                        </div>
                        
                        <AnimatePresence>
                            {issuesDropdownOpen && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ 
                                        duration: 0.3, 
                                        ease: "easeInOut",
                                        opacity: { duration: 0.2 }
                                    }}
                                    className="ml-6 space-y-1 overflow-hidden"
                                >
                                    <motion.div
                                        initial={{ y: -10, opacity: 0 }}
                                        animate={{ y: 0, opacity: 1 }}
                                        exit={{ y: -10, opacity: 0 }}
                                        transition={{ delay: 0.1, duration: 0.2 }}
                                    >
                                        <NavLink
                                            to="/seller-central-checker/issues?tab=overview"
                                            className={() =>
                                                isIssuesPage && currentTab === 'overview'
                                                    ? 'flex items-center gap-2 p-2 rounded-md bg-[#4a4d70] text-white text-xs transition-colors'
                                                    : 'flex items-center gap-2 p-2 rounded-md text-xs hover:bg-gray-100 transition-colors'
                                            }
                                        >
                                            Overview
                                        </NavLink>
                                    </motion.div>
                                    <motion.div
                                        initial={{ y: -10, opacity: 0 }}
                                        animate={{ y: 0, opacity: 1 }}
                                        exit={{ y: -10, opacity: 0 }}
                                        transition={{ delay: 0.15, duration: 0.2 }}
                                    >
                                        <NavLink
                                            to="/seller-central-checker/issues?tab=category"
                                            className={() =>
                                                isIssuesPage && currentTab === 'category'
                                                    ? 'flex items-center gap-2 p-2 rounded-md bg-[#4a4d70] text-white text-xs transition-colors'
                                                    : 'flex items-center gap-2 p-2 rounded-md text-xs hover:bg-gray-100 transition-colors'
                                            }
                                        >
                                            Issues By Category
                                        </NavLink>
                                    </motion.div>
                                    <motion.div
                                        initial={{ y: -10, opacity: 0 }}
                                        animate={{ y: 0, opacity: 1 }}
                                        exit={{ y: -10, opacity: 0 }}
                                        transition={{ delay: 0.2, duration: 0.2 }}
                                    >
                                        <NavLink
                                            to="/seller-central-checker/issues?tab=account"
                                            className={() =>
                                                isIssuesPage && currentTab === 'account'
                                                    ? 'flex items-center gap-2 p-2 rounded-md bg-[#4a4d70] text-white text-xs transition-colors'
                                                    : 'flex items-center gap-2 p-2 rounded-md text-xs hover:bg-gray-100 transition-colors'
                                            }
                                        >
                                            Account Issues
                                        </NavLink>
                                    </motion.div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

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
                        to="/seller-central-checker/reports"
                        className={({ isActive }) =>
                            isActive
                                ? 'flex items-center gap-2 p-2 rounded-md bg-[#333651] text-white'
                                : 'flex items-center gap-2 p-2 rounded-md'
                        }
                    >
                        {({ isActive }) => (
                            <>
                                <ClipboardPlus className="w-4 h-4" />
                                <p className="font-medium text-xs">Reports</p>
                            </>
                        )}
                    </NavLink>

                    <NavLink
                        to="/seller-central-checker/asin-analyzer"
                        className={({ isActive }) =>
                            isActive
                                ? 'flex items-center gap-2 p-2 rounded-md bg-[#333651] text-white'
                                : 'flex items-center gap-2 p-2 rounded-md'
                        }
                    >
                        {({ isActive }) => (
                            <>
                                <Search className="w-4 h-4" />
                                <p className="font-medium text-xs">ASIN Analyzer</p>
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
                                <Clock8 className="w-4 h-4" />
                                <p className="font-medium text-xs">Accounts History</p>
                            </>
                        )}
                    </NavLink>
                </div>
            </div>

            <hr className="w-11/12 mx-auto" />

            <div className="w-full pt-5 pl-2">
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
                            <Settings className="w-4 h-4" />
                            <p className="font-medium text-xs">Settings</p>
                        </>
                    )}
                </NavLink>
            </div>

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
