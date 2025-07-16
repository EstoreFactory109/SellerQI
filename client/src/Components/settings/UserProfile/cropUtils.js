
import { createImage } from './imageUtils';

const getCroppedImg = async (imageSrc, pixelCrop) => {
  try {
    const image = await createImage(imageSrc);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    canvas.width = pixelCrop.width;
    canvas.height = pixelCrop.height;

    ctx.drawImage(
      image,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      pixelCrop.width,
      pixelCrop.height
    );

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Blob conversion failed"));
          return;
        }
        resolve(blob);
      }, 'image/jpeg');
    });
  } catch (error) {
    console.error('Error creating image:', error);
    throw error;
  }
};

export default getCroppedImg;
