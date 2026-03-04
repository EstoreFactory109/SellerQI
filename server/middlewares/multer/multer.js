const multer = require('multer');
const path = require('path');
const fs = require('fs');
const uuidv4 = require('uuid').v4;

const tempDir = path.resolve(__dirname, '../../public/temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, tempDir);
  },
  filename: function (_req, file, cb) {
    const uniqueSuffix = uuidv4();
    cb(null, file.originalname + '-' + uniqueSuffix);
  },
});

const upload = multer({ storage });

  module.exports=upload;