const subCategoryService = require('../services/subcategory');
const ApiResponse = require('../utils/ApiResponse');

class SubCategoryController {
  async create(req, res, next) {
    try {
      const subCategory = await subCategoryService.createSubCategory(req.body);
      return ApiResponse.created(res, 'Sub-category created successfully.', subCategory);
    } catch (error) {
      next(error);
    }
  }

  async getAll(req, res, next) {
    try {
      const { data, meta } = await subCategoryService.getAllSubCategories(req.body);
      return ApiResponse.success(res, 'Sub-categories retrieved successfully.', data, meta);
    } catch (error) {
      next(error);
    }
  }

  async getById(req, res, next) {
    try {
      const subCategory = await subCategoryService.getSubCategoryById(req.body.id);
      return ApiResponse.success(res, 'Sub-category details retrieved successfully.', subCategory);
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const subCategory = await subCategoryService.updateSubCategory(req.body.id, req.body);
      return ApiResponse.success(res, 'Sub-category updated successfully.', subCategory);
    } catch (error) {
      next(error);
    }
  }

  async remove(req, res, next) {
    try {
      await subCategoryService.deleteSubCategory(req.body.id);
      return ApiResponse.success(res, 'Sub-category deleted successfully.', null);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new SubCategoryController();
