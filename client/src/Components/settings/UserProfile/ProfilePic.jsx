import React,{useRef} from 'react'
import { useSelector } from 'react-redux'
const ProfilePic = ({handleFile}) => {
  const profilepic = useSelector(state => state.profileImage?.imageLink)
  const newImageRef=useRef(null)
  const handleUpdateImage=(e)=>{
    handleFile(e.target.files[0])
  }

  const openFiles=(e)=>{
    e.preventDefault();
    newImageRef.current.click()
  }

  return (
    <div className="flex flex-col md:flex-row items-start md:items-center gap-6 mb-8 ">
      {/* Profile Picture */}
      <div className="relative w-24 h-24 rounded-full ">
        <img
          src={profilepic}
          alt="Profile"
          className="w-full h-full object-cover rounded-full border-[1px] border-gray-300"
        />
         <input type="file" className="hidden" onChange={handleUpdateImage} ref={newImageRef}/>
        <button className='absolute bottom-0 right-2 w-6 h-6 bg-white border-2 border-black z-20 rounded-full' onClick={openFiles}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </button>
      </div>
    </div>
  )
}

export default ProfilePic