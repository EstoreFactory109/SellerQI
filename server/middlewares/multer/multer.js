const multer  = require('multer')
const uuidv4=require('uuid').v4

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, './public/temp')
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = uuidv4();
      cb(null, file.originalname + '-' + uniqueSuffix)
    }
    
  })
  
  const upload = multer({ storage: storage })

  module.exports=upload;