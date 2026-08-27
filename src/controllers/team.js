const teamService = require('../services/team');
const ApiResponse = require('../utils/ApiResponse');

class TeamController {
  async create(req, res, next) {
    try {
      const member = await teamService.createMember(req.user.id, req.body);
      return ApiResponse.created(res, 'Team member added successfully.', member);
    } catch (error) {
      next(error);
    }
  }

  async getAll(req, res, next) {
    try {
      const members = await teamService.getVendorTeam(req.user.id);
      return ApiResponse.success(res, 'Team members retrieved successfully.', members);
    } catch (error) {
      next(error);
    }
  }

  async getById(req, res, next) {
    try {
      const member = await teamService.getMemberById(req.body.id, req.user.id);
      return ApiResponse.success(res, 'Team member details retrieved successfully.', member);
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const member = await teamService.updateMember(req.body.id, req.user.id, req.body);
      return ApiResponse.success(res, 'Team member profile updated successfully.', member);
    } catch (error) {
      next(error);
    }
  }

  async remove(req, res, next) {
    try {
      await teamService.deleteMember(req.body.id, req.user.id);
      return ApiResponse.success(res, 'Team member deleted successfully.', null);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TeamController();
