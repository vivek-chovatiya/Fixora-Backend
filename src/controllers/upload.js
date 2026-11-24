const uploadService = require('../services/upload');
const ApiResponse = require('../utils/ApiResponse');

// POST /uploads (Phase 4B contract §1). `url` is a convenience for the uploader at this moment —
// this call's own host — and is never stored: records keep the host-free `path`, because the
// emulator, a phone on the LAN and the web views reach the server by different hosts.
//
// ⚠️ Never store `url`, and never echo anything of the client's own file (its name, its declared
// type) in this answer.
class UploadController {
  async create(req, res, next) {
    try {
      const stored = await uploadService.storeUploads({
        type: req.body.type,
        files: req.files,
        user: req.user,
      });
      const origin = `${req.protocol}://${req.get('host')}`;
      const files = stored.map(({ id, path, type, mimeType, sizeBytes }) => ({
        id,
        path,
        url: `${origin}${path}`,
        type,
        mimeType,
        sizeBytes,
      }));
      return ApiResponse.created(res, 'Images uploaded successfully.', { files });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new UploadController();
