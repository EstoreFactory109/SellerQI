const cloudinary = require('cloudinary').v2;
const fs=require('fs');


const uploadToCloudinary=async(localPath)=>{
    cloudinary.config({ 
        cloud_name: process.env.CLOUDINARY_NAME, 
        api_key: process.env.CLOUDINARY_API_KEY, 
        api_secret: process.env.API_SECRET 
    });

    const uploadResult = await cloudinary.uploader
       .upload(
           localPath, {
               resource_type:'auto'
           }
       )
       .catch((error) => {
            fs.unlinkSync(localPath);
            console.log(error)
           return false
       });
    

       fs.unlinkSync(localPath);
       return uploadResult.url;
}


module.exports={uploadToCloudinary};