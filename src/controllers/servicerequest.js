const serviceRequestService = require('../services/servicerequest');
const vendorReportService = require('../services/vendorreport');
const ApiResponse = require('../utils/ApiResponse');

// Every method passes the signed-in user (`req.user`: { id, role }) so the service can decide
// what this caller may see and change (requests contract §2–§5).
class ServiceRequestController {
  async create(req, res, next) {
    try {
      const request = await serviceRequestService.createRequest(req.user, req.body);
      return ApiResponse.created(res, 'Service request created successfully.', request);
    } catch (error) {
      next(error);
    }
  }

  async accept(req, res, next) {
    try {
      const request = await serviceRequestService.acceptRequest(req.body.id, req.user);
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
        req.user,
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

  async recordPayment(req, res, next) {
    try {
      const request = await serviceRequestService.recordPayment(req.body.id, req.user, req.body);
      return ApiResponse.success(res, 'Payment recorded.', request);
    } catch (error) {
      next(error);
    }
  }

  async listPaymentMethods(req, res, next) {
    try {
      const methods = serviceRequestService.listPaymentMethods();
      return ApiResponse.success(res, 'Payment methods retrieved successfully.', methods);
    } catch (error) {
      next(error);
    }
  }

  // Routed as /vendors/report, but counted from the requests: whose report it is comes from the
  // token, never the body (Phase 4B §5).
  async vendorReport(req, res, next) {
    try {
      const report = await vendorReportService.getReport(req.user, req.body.period);
      return ApiResponse.success(res, 'Vendor report retrieved successfully.', report);
    } catch (error) {
      next(error);
    }
  }

  async cancel(req, res, next) {
    try {
      const request = await serviceRequestService.cancelRequest(
        req.body.id,
        req.user,
        req.body.reason
      );
      return ApiResponse.success(res, 'Service request cancelled.', request);
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
