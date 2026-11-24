const serviceRequestService = require('../services/servicerequest');
const ApiResponse = require('../utils/ApiResponse');
const { wrapController } = require('../utils/asyncHandler');

class ServiceRequestController {
  async create(req, res) {
    const request = await serviceRequestService.createRequest(req.user.id, req.body);
    return ApiResponse.created(res, 'Service request created successfully.', request);
  }

  async getAll(req, res) {
    const { data, meta } = await serviceRequestService.getAllRequests(req.body, req.user);
    return ApiResponse.success(res, 'Service requests retrieved successfully.', data, meta);
  }

  async getById(req, res) {
    const request = await serviceRequestService.getRequestById(req.body.id, req.user);
    return ApiResponse.success(res, 'Service request retrieved successfully.', request);
  }

  async accept(req, res) {
    const request = await serviceRequestService.acceptRequest(req.body.id, req.user.id);
    return ApiResponse.success(res, 'Request accepted. It is now assigned to you.', request);
  }

  async reject(req, res) {
    const request = await serviceRequestService.rejectRequest(req.body.id, req.user, req.body.reason);
    return ApiResponse.success(res, 'Request declined.', request);
  }

  async cancel(req, res) {
    const request = await serviceRequestService.cancelRequest(req.body.id, req.user, req.body.reason);
    return ApiResponse.success(res, 'Request cancelled.', request);
  }

  async assignTeam(req, res) {
    const request = await serviceRequestService.assignTeamMember(
      req.body.id,
      req.user.id,
      req.body.assignedTeamMemberId
    );
    return ApiResponse.success(res, 'Team member assigned.', request);
  }

  async startWork(req, res) {
    const request = await serviceRequestService.startWork(req.body.id, req.user.id);
    return ApiResponse.success(res, 'Work started.', request);
  }

  async completeWork(req, res) {
    const request = await serviceRequestService.completeWork(req.body.id, req.user.id, req.body);
    return ApiResponse.success(res, 'Work completed and payment recorded.', request);
  }
}

module.exports = wrapController(new ServiceRequestController());
