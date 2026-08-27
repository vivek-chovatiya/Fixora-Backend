class BaseRepository {
  constructor(model) {
    this.model = model;
  }

  async create(data) {
    return this.model.create(data);
  }

  async find(filter = {}, options = {}) {
    const { skip = 0, limit = 20, sort = { createdAt: -1 }, populate = '' } = options;
    const queryFilter = { isDeleted: { $ne: true }, ...filter };

    let query = this.model.find(queryFilter).skip(skip).limit(limit).sort(sort);
    if (populate) {
      query = query.populate(populate);
    }
    return query;
  }

  async findOne(filter = {}, populate = '') {
    const queryFilter = { isDeleted: { $ne: true }, ...filter };
    let query = this.model.findOne(queryFilter);
    if (populate) {
      query = query.populate(populate);
    }
    return query;
  }

  async findById(id, populate = '') {
    const queryFilter = { _id: id, isDeleted: { $ne: true } };
    return this.findOne(queryFilter, populate);
  }

  async update(id, data) {
    const queryFilter = { _id: id, isDeleted: { $ne: true } };
    return this.model.findOneAndUpdate(queryFilter, data, { new: true });
  }

  async delete(id) {
    const queryFilter = { _id: id, isDeleted: { $ne: true } };
    return this.model.findOneAndUpdate(
      queryFilter,
      { isDeleted: true, deletedAt: new Date() },
      { new: true }
    );
  }

  async count(filter = {}) {
    const queryFilter = { isDeleted: { $ne: true }, ...filter };
    return this.model.countDocuments(queryFilter);
  }
}

module.exports = BaseRepository;
