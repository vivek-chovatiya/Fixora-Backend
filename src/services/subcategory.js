const SubCategory = require('../models/subcategory');
const Category = require('../models/category');
const ApiError = require('../utils/ApiError');
const { escapeRegex } = require('../utils/regex');
const { getPagination, getPaginationMetadata } = require('../utils/pagination');

const generateSlug = (name) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const subCategoryMapper = (subCategory) => {
  if (!subCategory) return null;
  return {
    id: subCategory._id,
    categoryId: subCategory.categoryId,
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

class SubCategoryService {
  async createSubCategory(payload) {
    const category = await Category.findOne({ _id: payload.categoryId, isDeleted: { $ne: true } });
    if (!category) {
      throw new ApiError(404, 'Parent category not found.');
    }

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

  async getAllSubCategories(body = {}) {
    const { page, limit, skip } = getPagination(body);
    const filter = { isDeleted: { $ne: true } };

    if (body.categoryId) {
      filter.categoryId = body.categoryId;
    }

    if (body.search) {
      filter.name = { $regex: escapeRegex(body.search), $options: 'i' };
    }

    if (body.status) {
      filter.status = body.status;
    }

    const [subCategories, total] = await Promise.all([
      SubCategory.find(filter).skip(skip).limit(limit).sort({ name: 1 }),
      SubCategory.countDocuments(filter),
    ]);

    const mapped = subCategories.map(subCategoryMapper);
    const meta = getPaginationMetadata(total, page, limit);

    return { data: mapped, meta };
  }

  async updateSubCategory(id, payload) {
    const subCategory = await SubCategory.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!subCategory) {
      throw new ApiError(404, 'Sub-category not found.');
    }

    if (payload.name && !payload.slug) {
      payload.slug = generateSlug(payload.name);
    }

    const categoryId = payload.categoryId || subCategory.categoryId;
    if (payload.slug && payload.slug !== subCategory.slug) {
      const existing = await SubCategory.findOne({
        slug: payload.slug,
        categoryId,
        isDeleted: { $ne: true },
      });
      if (existing) {
        throw new ApiError(409, 'Sub-category with this slug already exists under this category.');
      }
    }

    const updated = await SubCategory.findByIdAndUpdate(id, payload, { new: true });
    return subCategoryMapper(updated);
  }

  async deleteSubCategory(id) {
    const subCategory = await SubCategory.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!subCategory) {
      throw new ApiError(404, 'Sub-category not found.');
    }
    await SubCategory.findByIdAndUpdate(id, { isDeleted: true, deletedAt: new Date() });
    return true;
  }
}

module.exports = new SubCategoryService();
