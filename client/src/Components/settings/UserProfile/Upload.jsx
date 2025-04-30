import React from 'react'


const Upload = ({handleFile}) => {


  

  const handleFileChange = (e) => {
    handleFile(e.target.files[0]);
  };

 

  return (
    <div className='mb-5'>
      <p className='mb-3'>Upload</p>
      <div className="border border-dashed border-gray-300 rounded-lg bg-[#f9f9ff] w-full h-60 flex flex-col items-center justify-center text-center p-6">
      <div className="text-gray-500 flex flex-col items-center space-y-2">
      <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-10 w-10 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16"
          />
        </svg>
        <p className="text-sm">Drag & drop to upload or</p>
        <label className="mt-2">
          <input type="file" className="hidden"  onChange={handleFileChange}/>
          <span className="inline-block px-4 py-2 border border-gray-300 rounded-md bg-white text-sm font-semibold text-gray-700 cursor-pointer hover:bg-gray-100 transition">
            Choose File
          </span>
        </label>
      </div>
    </div>
    </div>
  )
}

export default Upload