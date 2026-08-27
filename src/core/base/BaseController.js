const ApiResponse = require('../response/ApiResponse');

class BaseController {
  sendResponse(res, statusCode, success, message, data, meta, errors) {
    return ApiResponse.send(res, statusCode, success, message, data, meta, errors);
  }
}

module.exports = BaseController;
