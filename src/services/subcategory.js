const SubCategory = require('../models/subcategory');
const ApiError = require('../utils/ApiError');
const categoryService = require('./category');
const { RECORD_STATUS } = require('../constants');
const { getPagination, getPaginationMetadata } = require('../utils/pagination');
const { generateSlug, escapeRegex } = require('../utils/text');

const subCategoryMapper = (subCategory) => {
  if (!subCategory) return null;
  const category =
    subCategory.categoryId && subCategory.categoryId._id
      ? { id: subCategory.categoryId._id, name: subCategory.categoryId.name }
      : null;
  return {
    id: subCategory._id,
    categoryId: category ? category.id : subCategory.categoryId,
    category,
    name: subCategory.name,
    slug: subCategory.slug,
    icon: subCategory.icon,
    description: subCategory.description,
    estimatedDuration: subCategory.estimatedDuration,
    estimatedPrice: subCategory.estimatedPrice,
    isVisible: subCategory.isVisible,
    status: subCategory.status,
    createdAt: subCategory.createdAt,
    updatedAt: subCategory.updatedAt,
  };
};

const PUBLIC_FILTER = Object.freeze({
  isVisible: true,
  status: RECORD_STATUS.ACTIVE,
  isDeleted: { $ne: true },
});

class SubCategoryService {
  async createSubCategory(payload) {
    await categoryService.getCategoryById(payload.categoryId);

    const slug = payload.slug || generateSlug(payload.name);
    const existing = await SubCategory.findOne({
      slug,
      categoryId: payload.categoryId,
      isDeleted: { $ne: true },
    });

    if (existing) {
      throw new ApiError(409, 'Sub-category with this slug already exists under this category.');
    }

    const subCategory = await SubCategory.create({ ...payload, slug });
    return subCategoryMapper(subCategory);
  }

  async getSubCategoryById(id) {
    const subCategory = await SubCategory.findOne({ _id: id, isDeleted: { $ne: true } }).populate(
      'categoryId'
    );
    if (!subCategory) {
      throw new ApiError(404, 'Sub-category not found.');
    }
    return subCategoryMapper(subCategory);
  }

  /** Throws unless the sub-category is offered to customers and belongs to the category. */
  async assertPublicSubCategoryInCategory(subCategoryId, categoryId) {
    const subCategory = await SubCategory.findOne({ _id: subCategoryId, ...PUBLIC_FILTER });
    if (!subCategory || subCategory.categoryId.toString() !== categoryId.toString()) {
      throw new ApiError(400, 'Selected service is not available in this category.', [
        { field: 'subCategoryId', message: 'Selected service is not available in this category.' },
      ]);
    }
    return subCategory;
  }

  async getAllSubCategories(body = {}, { includeHidden = false } = {}) {
    const { page, limit, skip } = getPagination(body);
    const filter = includeHidden ? { isDeleted: { $ne: true } } : { ...PUBLIC_FILTER };

    if (body.categoryId) {
      filter.categoryId = body.categoryId;
    }

    if (body.search) {
      filter.name = { $regex: escapeRegex(body.search), $options: 'i' };
    }

    if (includeHidden && body.status) {
      filter.status = body.status;
    }

    const [subCategories, total] = await Promise.all([
      SubCategory.find(filter).skip(skip).limit(limit).sort({ name: 1 }),
      SubCategory.countDocuments(filter),
    ]);

    return {
      data: subCategories.map(subCategoryMapper),
      meta: getPaginationMetadata(total, page, limit),
    };
  }

  async updateSubCategory(id, payload) {
    const subCategory = await SubCategory.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!subCategory) {
      throw new ApiError(404, 'Sub-category not found.');
    }

    const update = { ...payload };
    delete update.id;

    if (update.categoryId) {
      await categoryService.getCategoryById(update.categoryId);
    }

    if (update.name && !update.slug) {
      update.slug = generateSlug(update.name);
    }

    const categoryId = update.categoryId || subCategory.categoryId;
    if (update.slug && update.slug !== subCategory.slug) {
      const existing = await SubCategory.findOne({
        slug: update.slug,
        categoryId,
        isDeleted: { $ne: true },
      });
      if (existing) {
        throw new ApiError(409, 'Sub-category with this slug already exists under this category.');
      }
    }

    const updated = await SubCategory.findByIdAndUpdate(id, update, { new: true });
    return subCategoryMapper(updated);
  }

  async deleteSubCategory(id) {
    const subCategory = await SubCategory.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!subCategory) {
      throw new ApiError(404, 'Sub-category not found.');
    }
    await categoryService.assertNoActiveRequests({ subCategoryId: id }, 'sub-category');
    await SubCategory.findByIdAndUpdate(id, { isDeleted: true, deletedAt: new Date() });
    return true;
  }
}

module.exports = new SubCategoryService();
