const serviceRequestService = require('../services/servicerequest');
const ApiResponse = require('../utils/ApiResponse');

class ServiceRequestController {
  async create(req, res, next) {
    try {
      const request = await serviceRequestService.createRequest(req.user.id, req.body);
      return ApiResponse.created(res, 'Service request created successfully.', request);
    } catch (error) {
      next(error);
    }
  }

  async accept(req, res, next) {
    try {
      const request = await serviceRequestService.acceptRequest(req.body.id, req.user.id);
      return ApiResponse.success(res, 'Service request accepted successfully.', request);
    } catch (error) {
      next(error);
    }
  }

  async reject(req, res, next) {
    try {
      const request = await serviceRequestService.rejectRequest(
        req.body.id,
        req.user,
        req.body.note
      );
      return ApiResponse.success(res, 'Service request rejected successfully.', request);
    } catch (error) {
      next(error);
    }
  }

  async assignTeam(req, res, next) {
    try {
      const request = await serviceRequestService.assignTeamMember(
        req.body.id,
        req.user.id,
        req.body.assignedTeamMemberId
      );
      return ApiResponse.success(
        res,
        'Service request assigned to technician successfully.',
        request
      );
    } catch (error) {
      next(error);
    }
  }

  async startWork(req, res, next) {
    try {
      const request = await serviceRequestService.startWork(req.body.id, req.user);
      return ApiResponse.success(res, 'Service work started successfully.', request);
    } catch (error) {
      next(error);
    }
  }

  async completeWork(req, res, next) {
    try {
      const request = await serviceRequestService.completeWork(req.body.id, req.user, req.body);
      return ApiResponse.success(res, 'Service work completed successfully.', request);
    } catch (error) {
      next(error);
    }
  }

  async getById(req, res, next) {
    try {
      const request = await serviceRequestService.getRequestById(req.body.id, req.user);
      return ApiResponse.success(res, 'Service request details retrieved successfully.', request);
    } catch (error) {
      next(error);
    }
  }

  async getAll(req, res, next) {
    try {
      const { data, meta } = await serviceRequestService.getAllRequests(req.body, req.user);
      return ApiResponse.success(res, 'Service requests retrieved successfully.', data, meta);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ServiceRequestController();
