class ApiResponse {
  static send(res, statusCode, success, message, data = null, meta = {}, errors = null) {
    return res.status(statusCode).json({
      success,
      message,
      data,
      meta,
      errors,
    });
  }

  static success(res, message, data = null, meta = {}) {
    return this.send(res, 200, true, message, data, meta, null);
  }

  static created(res, message, data = null, meta = {}) {
    return this.send(res, 201, true, message, data, meta, null);
  }
}

module.exports = ApiResponse;
