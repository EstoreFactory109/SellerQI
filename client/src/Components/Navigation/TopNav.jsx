import React, { useRef, useState, useEffect } from 'react'
import Notification from '../../assets/Icons/notification.png'
import hamburger from '../../assets/Icons/hamburger.png'
import { useSelector, useDispatch } from 'react-redux'
import { setPosition } from '../../redux/slices/MobileMenuSlice.js'
import ProfileIcon from '../../assets/Icons/ProfileIcon.jpg'
import Arrow from '../../assets/Icons/Arrow.png'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion';
import axios from 'axios'

const TopNav = () => {
    const navigate = useNavigate()
    const marketplaces = {
        US: "United States",
        CA: "Canada",
        MX: "Mexico",
        BR: "Brazil",
        UK: "United Kingdom",
        DE: "Germany",
        FR: "France",
        IT: "Italy",
        ES: "Spain",
        NL: "Netherlands",
        BE: "Belgium",
        SE: "Sweden",
        PL: "Poland",
        TR: "Turkey",
        SA: "Saudi Arabia",
        AE: "United Arab Emirates",
        EG: "Egypt",
        ZA: "South Africa",
        IN: "India",
        JP: "Japan",
        SG: "Singapore",
        AU: "Australia"
    };


    const user = useSelector((state) => state.Auth?.user);
    const Country = useSelector((state) => state.Dashboard?.DashBoardInfo?.Country);
    const sellerAccount = useSelector(state => state.AllAccounts?.AllAccounts) || []
    const [openDropDown, setOpenDropDown] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const dispatch = useDispatch();
    const profilepic = useSelector(state => state.profileImage?.imageLink)
    const dropdownRef = useRef(null)
    console.log(sellerAccount)

    const switchAccount = async (userId="",country,region) => {
        try{
            setIsLoading(true);
            const data={
                userId:userId,
                country:country,
                region:region
            }
           
            const response=await axios.post(`${import.meta.env.VITE_BASE_URI}/app/switch-account`,data,{withCredentials:true})
            if(response.status===200){
                window.location.href = "/seller-central-checker/dashboard";
            }
        }catch(error){
            console.log(error)
            setIsLoading(false);
        }
    }

    const handleHamburger = () => {
        dispatch(setPosition("0%"))
    }

    const openDropDownfnc = () => {
        openDropDown === false ? setOpenDropDown(true) : setOpenDropDown(false)
        console.log(openDropDown)
    }

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setOpenDropDown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [])

    return (
        <nav className="w-full lg:w-[83vw] lg:h-[10vh] h-[8vh] flex items-center justify-between lg:justify-end p-10 lg:gap-7 gap-2 shadow-md bg-white border-b-[1px] border-gray-200 fixed top-0 z-50 lg:static">
            <img src={hamburger} className='w-[1.5rem] lg:hidden' onClick={handleHamburger} />
            <div className='flex items-center justify-end  lg:gap-7 gap-2 h-full'>
                <div className='fit-content relative' ref={dropdownRef}>
                    <div className="lg:px-4 lg:py-1 rounded-md outline-none text-xs lg:text-base flex justify-center items-center gap-2 min-w-[13rem] border-2 border-gray-300 cursor-pointer bg-gray-50" onClick={openDropDownfnc}>
                        <p>{user?.brand || "Brand Name"} | {marketplaces[Country]}</p>
                        <img src={Arrow} alt="" className='w-3 h-2 ' />
                    </div>
                    <AnimatePresence>
                        {openDropDown && (
                            <motion.div
                                initial={{ opacity: 0, scaleY: 0 }}
                                animate={{ opacity: 1, scaleY: 1 }}
                                exit={{ opacity: 0, scaleY: 0 }}
                                transition={{ duration: 0.25 }}
                                className="min-w-[13rem] absolute top-10 flex flex-col shadow-sm shadow-black p-1 bg-white origin-top z-[99] "
                            >
                                {/* Show existing accounts if there are multiple accounts */}
                                {sellerAccount.length > 1 && sellerAccount.map((elm, key) =>
                                    <div
                                        key={key}
                                        className="min-w-[13rem] min-h-10 bg-white flex justify-center items-center hover:bg-[#333651] hover:text-white cursor-pointer rounded-md text-xs lg:text-base px-6 "
                                        onClick={elm.userId ? () => switchAccount(elm.userId, elm.country, elm.region) : () => switchAccount(elm.country, elm.region)}
                                    >
                                        {elm.brand || "Brand Name"} | {marketplaces[elm.country]}
                                    </div>
                                )}
                                
                                {/* Add New Account Option */}
                                <div
                                    className="min-w-[13rem] min-h-10 bg-white flex justify-center items-center hover:bg-[#333651] hover:text-white cursor-pointer rounded-md text-xs lg:text-base px-6 border-t border-gray-200"
                                    onClick={() => {
                                        setOpenDropDown(false);
                                        navigate('/seller-central-checker/settings?tab=account-integration');
                                    }}
                                >
                                    + Add New Account
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                </div>
                <div className="w-6 h-6 lg:w-7 lg:h-8 relative flex justify-center items-center mr-2" >
                    <img src={Notification} alt="" className='w-[70%] h-[70%] cursor-pointer' />
                    <p className='absolute text-white bg-[#b92533] text-[8px] lg:text-xs px-[3px] py-[0.5px] lg:px-[4px] rounded-full top-0 right-0'>5</p>

                </div>
                <img src={profilepic || ProfileIcon} alt="" className="lg:w-8 lg:h-8 w-6 h-6 rounded-full border-2 border-gray-300 cursor-pointer" onClick={() => navigate('/seller-central-checker/settings')} />
            </div>

            {/* Loading Screen Overlay */}
            {isLoading && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]"
                >
                    <div className="bg-white rounded-lg p-8 flex flex-col items-center justify-center shadow-lg">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#333651] mb-4"></div>
                        <p className="text-gray-700 text-lg font-medium">Switching Account...</p>
                        <p className="text-gray-500 text-sm mt-2">Please wait</p>
                    </div>
                </motion.div>
            )}
        </nav>
    )
}

export default TopNav