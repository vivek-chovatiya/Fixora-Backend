const ApiError = require('../errors/ApiError');

class BaseService {
  constructor(repository) {
    this.repository = repository;
  }

  async create(payload) {
    return this.repository.create(payload);
  }

  async findAll(filter = {}, options = {}) {
    return this.repository.find(filter, options);
  }

  async findById(id, populate = '') {
    const record = await this.repository.findById(id, populate);
    if (!record) {
      throw new ApiError(404, 'Record not found.');
    }
    return record;
  }

  async update(id, payload) {
    await this.findById(id);
    return this.repository.update(id, payload);
  }

  async delete(id) {
    await this.findById(id);
    return this.repository.delete(id);
  }
}

module.exports = BaseService;
