import React from 'react'
import Background from '../../assets/Background/Right-Background.png'

const Right = () => {
    return (
        <section className="w-1/2 h-full bg-[rgb(36,37,56)]  bg-center relative" style={{backgroundImage:`url(${Background})`}}>
            <div className="absolute inset-0 bg-[rgba(36,37,56,0.7)]  p-12 flex items-end">
                <div className="flex justify-center items-center w-full">
                    <img 
                        src="https://res.cloudinary.com/ddoa960le/image/upload/v1749393210/bg-white-logo_xrtck2.png"
                        alt="SellerQI Logo"
                        loading="lazy"
                        className="w-auto h-32 object-contain"
                        width="400"
                        height="128"
                    />
                </div>
            </div>
        </section>
    )
}

export default Right