const categoryService = require('../services/category');
const ApiResponse = require('../utils/ApiResponse');
const { wrapController } = require('../utils/asyncHandler');

class CategoryController {
  async create(req, res) {
    const category = await categoryService.createCategory(req.body);
    return ApiResponse.created(res, 'Category created successfully.', category);
  }

  async getAll(req, res) {
    const { data, meta } = await categoryService.getAllCategories(req.body || {});
    return ApiResponse.success(res, 'Categories retrieved successfully.', data, meta);
  }

  async getAllAdmin(req, res) {
    const { data, meta } = await categoryService.getAllCategories(req.body, { includeHidden: true });
    return ApiResponse.success(res, 'Categories retrieved successfully.', data, meta);
  }

  async getById(req, res) {
    const category = await categoryService.getCategoryById(req.body.id);
    return ApiResponse.success(res, 'Category details retrieved successfully.', category);
  }

  async update(req, res) {
    const category = await categoryService.updateCategory(req.body.id, req.body);
    return ApiResponse.success(res, 'Category updated successfully.', category);
  }

  async remove(req, res) {
    await categoryService.deleteCategory(req.body.id);
    return ApiResponse.success(res, 'Category deleted successfully.', null);
  }
}

module.exports = wrapController(new CategoryController());
