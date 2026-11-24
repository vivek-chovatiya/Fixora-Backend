const Category = require('../models/category');
const ServiceRequest = require('../models/servicerequest');
const ApiError = require('../utils/ApiError');
const { RECORD_STATUS, ACTIVE_REQUEST_STATUSES, ERROR_CODE } = require('../constants');

/**
 * Catalog entries with work in flight cannot be deleted — customers and vendors
 * would lose the service their open request belongs to. Hiding is the safe option.
 */
const assertNoActiveRequests = async (filter, label) => {
  const inUse = await ServiceRequest.exists({ ...filter, status: { $in: ACTIVE_REQUEST_STATUSES }, isDeleted: { $ne: true } });
  if (inUse) {
    throw new ApiError(
      409,
      `This ${label} has active service requests. Hide it instead, or delete it after those requests are finished.`,
      null,
      ERROR_CODE.RESOURCE_IN_USE
    );
  }
};
const { getPagination, getPaginationMetadata } = require('../utils/pagination');
const { generateSlug, escapeRegex } = require('../utils/text');

const categoryMapper = (category) => {
  if (!category) return null;
  return {
    id: category._id,
    name: category.name,
    slug: category.slug,
    icon: category.icon,
    image: category.image,
    description: category.description,
    sortOrder: category.sortOrder,
    isVisible: category.isVisible,
    status: category.status,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
};

/** What the customer app is allowed to see (PROJECT_BIBLE §11.5). */
const PUBLIC_FILTER = Object.freeze({
  isVisible: true,
  status: RECORD_STATUS.ACTIVE,
  isDeleted: { $ne: true },
});

class CategoryService {
  async createCategory(payload) {
    const slug = payload.slug || generateSlug(payload.name);
    const existing = await Category.findOne({ slug, isDeleted: { $ne: true } });
    if (existing) {
      throw new ApiError(409, 'Category with this slug already exists.');
    }

    const category = await Category.create({ ...payload, slug });
    return categoryMapper(category);
  }

  async getCategoryById(id) {
    const category = await Category.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!category) {
      throw new ApiError(404, 'Category not found.');
    }
    return categoryMapper(category);
  }

  /** Throws unless the category exists and is offered to customers. */
  async assertPublicCategory(id) {
    const category = await Category.findOne({ _id: id, ...PUBLIC_FILTER });
    if (!category) {
      throw new ApiError(404, 'Selected service category is not available.');
    }
    return category;
  }

  async assertCategoriesExist(ids = []) {
    if (!ids.length) return;
    const uniqueIds = [...new Set(ids.map(String))];
    const count = await Category.countDocuments({ _id: { $in: uniqueIds }, isDeleted: { $ne: true } });
    if (count !== uniqueIds.length) {
      throw new ApiError(400, 'One or more selected service categories are invalid.', [
        { field: 'categoryIds', message: 'One or more selected service categories are invalid.' },
      ]);
    }
  }

  async getAllCategories(body = {}, { includeHidden = false } = {}) {
    const { page, limit, skip } = getPagination(body);
    const filter = includeHidden ? { isDeleted: { $ne: true } } : { ...PUBLIC_FILTER };

    if (body.search) {
      filter.name = { $regex: escapeRegex(body.search), $options: 'i' };
    }

    if (includeHidden && body.status) {
      filter.status = body.status;
    }

    const [categories, total] = await Promise.all([
      Category.find(filter).skip(skip).limit(limit).sort({ sortOrder: 1, name: 1 }),
      Category.countDocuments(filter),
    ]);

    return { data: categories.map(categoryMapper), meta: getPaginationMetadata(total, page, limit) };
  }

  async updateCategory(id, payload) {
    const category = await Category.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!category) {
      throw new ApiError(404, 'Category not found.');
    }

    const update = { ...payload };
    delete update.id;

    if (update.name && !update.slug) {
      update.slug = generateSlug(update.name);
    }

    if (update.slug && update.slug !== category.slug) {
      const existing = await Category.findOne({ slug: update.slug, isDeleted: { $ne: true } });
      if (existing) {
        throw new ApiError(409, 'Category with this slug already exists.');
      }
    }

    const updated = await Category.findByIdAndUpdate(id, update, { new: true });
    return categoryMapper(updated);
  }

  async deleteCategory(id) {
    const category = await Category.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!category) {
      throw new ApiError(404, 'Category not found.');
    }
    await assertNoActiveRequests({ categoryId: id }, 'category');
    await Category.findByIdAndUpdate(id, { isDeleted: true, deletedAt: new Date() });
    return true;
  }
}

module.exports = new CategoryService();
module.exports.categoryMapper = categoryMapper;
module.exports.assertNoActiveRequests = assertNoActiveRequests;
