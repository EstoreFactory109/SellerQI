import React, { useRef, useState, useEffect } from 'react'
import Notification from '../../assets/Icons/notification.png'
import hamburger from '../../assets/Icons/hamburger.png'
import { useSelector, useDispatch } from 'react-redux'
import { setPosition } from '../../redux/slices/MobileMenuSlice.js'
import ProfileIcon from '../../assets/Icons/ProfileIcon.jpg'
import Arrow from '../../assets/Icons/Arrow.png'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion';

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
    const sellerAccount = useSelector(state => state.AllAccounts?.AllAccounts)
    const [openDropDown, setOpenDropDown] = useState(false);
    const dispatch = useDispatch();
    const profilepic = useSelector(state => state.profileImage?.imageLink)
    const dropdownRef = useRef(null)

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
                    <div className="lg:p-1 rounded-md outline-none text-xs lg:text-base flex justify-center items-center gap-2 w-[13rem] border-2 border-gray-300 cursor-pointer bg-gray-50" onClick={openDropDownfnc}>
                        <p>{ user?.firstName} | {marketplaces[Country]}</p>
                        <img src={Arrow} alt="" className='w-3 h-2 ' />
                    </div>
                    <AnimatePresence>
                        {openDropDown && (
                            <motion.div
                                initial={{ opacity: 0, scaleY: 0 }}
                                animate={{ opacity: 1, scaleY: 1 }}
                                exit={{ opacity: 0, scaleY: 0 }}
                                transition={{ duration: 0.25 }}
                                className="w-[13rem] absolute top-10 flex flex-col shadow-sm shadow-black p-1 bg-white origin-top z-[99]"
                            >
                                {sellerAccount.map((elm, key) =>
                                    elm.country !== Country && (
                                        <div
                                            key={key}
                                            className="w-full h-10 bg-white flex justify-center items-center hover:bg-[#333651] hover:text-white cursor-pointer rounded-md "
                                        >
                                            { user?.firstName} | {marketplaces[elm.country]}
                                        </div>
                                    )
                                )}
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

        </nav>
    )
}

export default TopNav