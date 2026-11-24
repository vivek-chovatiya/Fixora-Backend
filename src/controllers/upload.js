const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { wrapController } = require('../utils/asyncHandler');

class UploadController {
  /** Returns server-relative paths; clients resolve them against the API host. */
  async upload(req, res) {
    const files = req.files || [];
    if (files.length === 0) {
      throw new ApiError(400, 'Please choose at least one file to upload.', [
        { field: 'files', message: 'Please choose at least one file to upload.' },
      ]);
    }
    logger.info(`Upload: ${files.length} file(s) by ${req.user.role} ${req.user.id} (${req.body.type})`);
    const data = files.map((file) => ({
      url: `/uploads/${file.filename}`,
      mimeType: file.mimetype,
      size: file.size,
      type: req.body.type,
    }));
    return ApiResponse.created(res, 'Files uploaded successfully.', data);
  }
}

module.exports = wrapController(new UploadController());
