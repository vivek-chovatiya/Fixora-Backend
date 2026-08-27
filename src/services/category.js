const Category = require('../models/category');
const ApiError = require('../utils/ApiError');
const { getPagination, getPaginationMetadata } = require('../utils/pagination');

const generateSlug = (name) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const categoryMapper = (category) => {
  if (!category) return null;
  return {
    id: category._id,
    name: category.name,
    slug: category.slug,
    icon: category.icon,
    description: category.description,
    sortOrder: category.sortOrder,
    isVisible: category.isVisible,
    status: category.status,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
};

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

  async getAllCategories(body = {}) {
    const { page, limit, skip } = getPagination(body);
    const filter = { isDeleted: { $ne: true } };

    if (body.search) {
      filter.name = { $regex: body.search, $options: 'i' };
    }

    if (body.status) {
      filter.status = body.status;
    }

    const [categories, total] = await Promise.all([
      Category.find(filter).skip(skip).limit(limit).sort({ sortOrder: 1, name: 1 }),
      Category.countDocuments(filter),
    ]);

    const mapped = categories.map(categoryMapper);
    const meta = getPaginationMetadata(total, page, limit);

    return { data: mapped, meta };
  }

  async updateCategory(id, payload) {
    const category = await Category.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!category) {
      throw new ApiError(404, 'Category not found.');
    }

    if (payload.name && !payload.slug) {
      payload.slug = generateSlug(payload.name);
    }

    if (payload.slug && payload.slug !== category.slug) {
      const existing = await Category.findOne({ slug: payload.slug, isDeleted: { $ne: true } });
      if (existing) {
        throw new ApiError(409, 'Category with this slug already exists.');
      }
    }

    const updated = await Category.findByIdAndUpdate(id, payload, { new: true });
    return categoryMapper(updated);
  }

  async deleteCategory(id) {
    const category = await Category.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!category) {
      throw new ApiError(404, 'Category not found.');
    }
    await Category.findByIdAndUpdate(id, { isDeleted: true, deletedAt: new Date() });
    return true;
  }
}

module.exports = new CategoryService();
