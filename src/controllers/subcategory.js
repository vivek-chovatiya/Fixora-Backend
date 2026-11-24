const subCategoryService = require('../services/subcategory');
const ApiResponse = require('../utils/ApiResponse');
const { wrapController } = require('../utils/asyncHandler');

class SubCategoryController {
  async create(req, res) {
    const subCategory = await subCategoryService.createSubCategory(req.body);
    return ApiResponse.created(res, 'Sub-category created successfully.', subCategory);
  }

  async getAll(req, res) {
    const { data, meta } = await subCategoryService.getAllSubCategories(req.body || {});
    return ApiResponse.success(res, 'Sub-categories retrieved successfully.', data, meta);
  }

  async getAllAdmin(req, res) {
    const { data, meta } = await subCategoryService.getAllSubCategories(req.body, {
      includeHidden: true,
    });
    return ApiResponse.success(res, 'Sub-categories retrieved successfully.', data, meta);
  }

  async getById(req, res) {
    const subCategory = await subCategoryService.getSubCategoryById(req.body.id);
    return ApiResponse.success(res, 'Sub-category details retrieved successfully.', subCategory);
  }

  async update(req, res) {
    const subCategory = await subCategoryService.updateSubCategory(req.body.id, req.body);
    return ApiResponse.success(res, 'Sub-category updated successfully.', subCategory);
  }

  async remove(req, res) {
    await subCategoryService.deleteSubCategory(req.body.id);
    return ApiResponse.success(res, 'Sub-category deleted successfully.', null);
  }
}

module.exports = wrapController(new SubCategoryController());
