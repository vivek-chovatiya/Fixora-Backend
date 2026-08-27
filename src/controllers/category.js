const categoryService = require('../services/category');
const ApiResponse = require('../utils/ApiResponse');

class CategoryController {
  async create(req, res, next) {
    try {
      const category = await categoryService.createCategory(req.body);
      return ApiResponse.created(res, 'Category created successfully.', category);
    } catch (error) {
      next(error);
    }
  }

  async getAll(req, res, next) {
    try {
      const { data, meta } = await categoryService.getAllCategories(req.body);
      return ApiResponse.success(res, 'Categories retrieved successfully.', data, meta);
    } catch (error) {
      next(error);
    }
  }

  async getById(req, res, next) {
    try {
      const category = await categoryService.getCategoryById(req.body.id);
      return ApiResponse.success(res, 'Category details retrieved successfully.', category);
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const category = await categoryService.updateCategory(req.body.id, req.body);
      return ApiResponse.success(res, 'Category updated successfully.', category);
    } catch (error) {
      next(error);
    }
  }

  async remove(req, res, next) {
    try {
      await categoryService.deleteCategory(req.body.id);
      return ApiResponse.success(res, 'Category deleted successfully.', null);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new CategoryController();
