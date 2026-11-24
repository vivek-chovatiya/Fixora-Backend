const teamService = require('../services/team');
const ApiResponse = require('../utils/ApiResponse');
const { wrapController } = require('../utils/asyncHandler');

class TeamController {
  async create(req, res) {
    const member = await teamService.createMember(req.user.id, req.body);
    return ApiResponse.created(res, 'Team member added successfully.', member);
  }

  async getAll(req, res) {
    const members = await teamService.getVendorTeam(req.user.id);
    return ApiResponse.success(res, 'Team members retrieved successfully.', members, {
      total: members.length,
    });
  }

  async getById(req, res) {
    const member = await teamService.getMemberById(req.body.id, req.user.id);
    return ApiResponse.success(res, 'Team member details retrieved successfully.', member);
  }

  async update(req, res) {
    const member = await teamService.updateMember(req.body.id, req.user.id, req.body);
    return ApiResponse.success(res, 'Team member updated successfully.', member);
  }

  async remove(req, res) {
    await teamService.deleteMember(req.body.id, req.user.id);
    return ApiResponse.success(res, 'Team member removed successfully.', null);
  }
}

module.exports = wrapController(new TeamController());
