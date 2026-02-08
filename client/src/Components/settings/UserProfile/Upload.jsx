import React from 'react'


const Upload = ({handleFile}) => {


  

  const handleFileChange = (e) => {
    handleFile(e.target.files[0]);
  };

 

  return (
    <div className='mb-4'>
      <p className='mb-2 text-gray-100'>Upload</p>
      <div className="border border-dashed border-[#30363d] rounded-lg bg-[#1a1a1a] w-full h-48 flex flex-col items-center justify-center text-center p-4">
      <div className="text-gray-400 flex flex-col items-center space-y-2">
      <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-10 w-10 text-gray-500"
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
          <span className="inline-block px-4 py-2 border border-[#30363d] rounded-md bg-[#21262d] text-sm font-semibold text-gray-200 cursor-pointer hover:bg-[#30363d] transition">
            Choose File
          </span>
        </label>
      </div>
    </div>
    </div>
  )
}

export default Upload