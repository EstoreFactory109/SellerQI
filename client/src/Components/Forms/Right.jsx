import React from 'react'
import Background from '../../assets/Background/Right-Background.png'

const Right = () => {
    return (
        <section className="w-1/2 h-full bg-[rgb(36,37,56)]  bg-center relative" style={{backgroundImage:`url(${Background})`}}>
            <div className="absolute inset-0 bg-[rgba(36,37,56,0.7)]  p-12 flex items-end">
                <div className="text-white text-2xl text-center">
                    <p className="font-extralight">Welcome To</p>
                    <h1 className="font-bold text-6xl text-yellow-400">SellerQI</h1>
                </div>
            </div>
        </section>
    )
}

export default Right