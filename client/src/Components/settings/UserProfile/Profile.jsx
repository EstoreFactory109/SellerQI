import React from 'react'
import Upload from './Upload'

const Profile = () => {
  return (
    <div className='w-full h-[35rem] bg-white p-5'>
        <h1 className='text-sm'>PROFILE DETAILS</h1>
        <p className='text-[10px] mt-2 opacity-40'>Edit Your Profile Details</p>
        <h4 className='text-xs mt-5'>Upload Your Profile Picture</h4>
        <Upload/>
    </div>
  )
}

export default Profile