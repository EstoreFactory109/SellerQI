import React, { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import getCroppedImg from './cropUtils.js'; // we'll create this helper
import './style.css'
import axios from 'axios';
import { updateImageLink } from '../../../redux/slices/profileImage.js'
import { useDispatch } from 'react-redux'
import BeatLoader from "react-spinners/BeatLoader";


const Preview = ({ image,setImage,setClose }) => {
  console.log(image?.preview.slice(5))
  const imageSrc = image?.preview;
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const dispatch = useDispatch()
const [loading, setLoading] = useState(false);

  const onCropComplete = useCallback((croppedArea, croppedPixels) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  const close=(e)=>{
    e.preventDefault();
    setImage(null)
    setClose(true)
  }

  const handleConfirm = async () => {
    const croppedImage = await getCroppedImg(imageSrc, croppedAreaPixels);
    console.log("Final Cropped Image", croppedImage);
    const file = new File([croppedImage], "avatar.jpg", { type: croppedImage.type });
    const formData = new FormData()
    formData.append("avatar", file)
    setLoading(true)
    try {
      const response = await axios.put(`${import.meta.env.VITE_BASE_URI}/app/updateProfilePic`, formData, { withCredentials: true })
      console.log(response.data.data.profilePicUrl)
      if (response) {
        dispatch(updateImageLink(response.data.data.profilePicUrl))
        setClose(true)
        setLoading(false)
      }
    } catch (error) {
      setLoading(false)
      console.log(error)
    }

    // You can now show this cropped image or upload it to server
  };

  return (
    <div className='w-full h-full flex items-center justify-center z-[99] fixed top-0 left-0 right-0 bg-black/50'>

      <div className="text-center bg-[#161b22] w-[40rem] h-[27rem] flex flex-col justify-center items-center rounded-lg border-[#30363d] border-2">
        <div className="w-[50%] h-[72%] rounded-full bg-[#1a1a1a] mx-auto overflow-hidden border-2 border-[#30363d] shadow-md relative">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropSize={{ width: 250, height: 250 }} // 👈 Fixed size cropper in pixels
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>
        <div className='flex items-center justify-center gap-2'>
          <input
            type="range"
            value={zoom}
            min={1}
            max={3}
            step={0.1}
            aria-labelledby="Zoom"
            onChange={(e) => {
              setZoom(e.target.value)
            }}
            className="custom-range w-[25rem] h-1 "
          />
          <p className="text-gray-200">{parseInt((zoom / 3) * 100)}%</p>
        </div>


        <div className='flex gap-4'>
        <button
          onClick={handleConfirm}
          className="w-[8rem] mt-4 px-5 py-2 bg-blue-600 text-white font-medium rounded transition hover:bg-blue-700"
        >
         {!loading?<p>Save Image</p>:<BeatLoader color="white" size={8}/>}
        </button>
        <button
          onClick={close}
          className="w-[8rem] mt-4 px-5 py-2 bg-[#30363d] text-gray-200 font-medium rounded transition hover:bg-[#21262d]"
        >
          Cancel
        </button>
        </div>
        
      </div>
    </div>
  );
};

export default Preview;
