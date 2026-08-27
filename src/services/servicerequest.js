const ServiceRequest = require('../models/servicerequest');
const ServiceRequestTimeline = require('../models/timeline');
const Address = require('../models/address');
const Category = require('../models/category');
const SubCategory = require('../models/subcategory');
const ApiError = require('../utils/ApiError');
const { getPagination, getPaginationMetadata } = require('../utils/pagination');

const generateRequestNumber = () => {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(1000 + Math.random() * 9000);
  return `REQ-${timestamp}${random}`;
};

const serviceRequestMapper = (request, timeline = []) => {
  if (!request) return null;
  return {
    id: request._id,
    requestNumber: request.requestNumber,
    customerId: request.customerId,
    vendorId: request.vendorId,
    assignedTeamMemberId: request.assignedTeamMemberId,
    categoryId: request.categoryId,
    subCategoryId: request.subCategoryId,
    addressId: request.addressId,
    serviceAddress: request.serviceAddress,
    description: request.description,
    images: request.images || [],
    completionImages: request.completionImages || [],
    priority: request.priority,
    status: request.status,
    paymentStatus: request.paymentStatus,
    paymentMode: request.paymentMode,
    amount: request.amount,
    scheduledAt: request.scheduledAt,
    completedAt: request.completedAt,
    notes: request.notes,
    timeline,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
};

class ServiceRequestService {
  async createRequest(customerId, payload) {
    const address = await Address.findOne({ _id: payload.addressId, isDeleted: { $ne: true } });
    if (!address || address.customerId.toString() !== customerId.toString()) {
      throw new ApiError(404, 'Selected address not found.');
    }

    const category = await Category.findOne({ _id: payload.categoryId, isDeleted: { $ne: true } });
    if (!category) {
      throw new ApiError(404, 'Selected service category not found.');
    }

    const subCategory = await SubCategory.findOne({
      _id: payload.subCategoryId,
      isDeleted: { $ne: true },
    });
    if (!subCategory) {
      throw new ApiError(404, 'Selected sub-category not found.');
    }

    const fullAddress = `${address.addressLine1}${address.addressLine2 ? ', ' + address.addressLine2 : ''}, ${address.city}, ${address.state} - ${address.pincode}`;
    const requestNumber = generateRequestNumber();

    const request = await ServiceRequest.create({
      ...payload,
      requestNumber,
      customerId,
      serviceAddress: fullAddress,
      status: 'PENDING',
    });

    await ServiceRequestTimeline.create({
      serviceRequestId: request._id,
      status: 'PENDING',
      updatedBy: customerId,
      userRole: 'CUSTOMER',
      note: 'Service request submitted by customer.',
    });

    return serviceRequestMapper(request);
  }

  async acceptRequest(id, vendorId) {
    const request = await ServiceRequest.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!request) {
      throw new ApiError(404, 'Service request not found.');
    }

    if (request.status !== 'PENDING') {
      throw new ApiError(400, `Cannot accept request in current status: ${request.status}`);
    }

    const updated = await ServiceRequest.findByIdAndUpdate(
      id,
      { vendorId, status: 'ACCEPTED' },
      { new: true }
    );

    await ServiceRequestTimeline.create({
      serviceRequestId: id,
      status: 'ACCEPTED',
      updatedBy: vendorId,
      userRole: 'VENDOR',
      note: 'Vendor accepted service request.',
    });

    return serviceRequestMapper(updated);
  }

  async rejectRequest(id, userContext, note = '') {
    const request = await ServiceRequest.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!request) {
      throw new ApiError(404, 'Service request not found.');
    }

    const updated = await ServiceRequest.findByIdAndUpdate(
      id,
      { status: 'REJECTED' },
      { new: true }
    );

    await ServiceRequestTimeline.create({
      serviceRequestId: id,
      status: 'REJECTED',
      updatedBy: userContext.id,
      userRole: userContext.role,
      note: note || 'Service request rejected.',
    });

    return serviceRequestMapper(updated);
  }

  async assignTeamMember(id, vendorId, assignedTeamMemberId) {
    const request = await ServiceRequest.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!request) {
      throw new ApiError(404, 'Service request not found.');
    }

    if (request.vendorId.toString() !== vendorId.toString()) {
      throw new ApiError(403, 'Permission denied. Request assigned to another vendor.');
    }

    const updated = await ServiceRequest.findByIdAndUpdate(
      id,
      { assignedTeamMemberId, status: 'ASSIGNED' },
      { new: true }
    );

    await ServiceRequestTimeline.create({
      serviceRequestId: id,
      status: 'ASSIGNED',
      updatedBy: vendorId,
      userRole: 'VENDOR',
      note: 'Vendor assigned technician to service request.',
    });

    return serviceRequestMapper(updated);
  }

  async startWork(id, userContext) {
    const request = await ServiceRequest.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!request) {
      throw new ApiError(404, 'Service request not found.');
    }

    const updated = await ServiceRequest.findByIdAndUpdate(
      id,
      { status: 'IN_PROGRESS' },
      { new: true }
    );

    await ServiceRequestTimeline.create({
      serviceRequestId: id,
      status: 'IN_PROGRESS',
      updatedBy: userContext.id,
      userRole: userContext.role,
      note: 'Work started on service request.',
    });

    return serviceRequestMapper(updated);
  }

  async completeWork(id, userContext, payload = {}) {
    const request = await ServiceRequest.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!request) {
      throw new ApiError(404, 'Service request not found.');
    }

    const updateData = {
      status: 'COMPLETED',
      completedAt: new Date(),
    };

    if (payload.amount !== undefined) updateData.amount = payload.amount;
    if (payload.completionImages) updateData.completionImages = payload.completionImages;

    const updated = await ServiceRequest.findByIdAndUpdate(id, updateData, { new: true });

    await ServiceRequestTimeline.create({
      serviceRequestId: id,
      status: 'COMPLETED',
      updatedBy: userContext.id,
      userRole: userContext.role,
      note: payload.note || 'Work completed successfully.',
    });

    return serviceRequestMapper(updated);
  }

  async getRequestById(id, userContext) {
    const request = await ServiceRequest.findOne({ _id: id, isDeleted: { $ne: true } }).populate(
      'customerId vendorId categoryId subCategoryId assignedTeamMemberId addressId'
    );
    if (!request) {
      throw new ApiError(404, 'Service request not found.');
    }

    const timeline = await ServiceRequestTimeline.find({
      serviceRequestId: id,
      isDeleted: { $ne: true },
    }).sort({
      timestamp: 1,
    });

    return serviceRequestMapper(request, timeline);
  }

  async getAllRequests(body = {}, userContext) {
    const { page, limit, skip } = getPagination(body);
    const filter = { isDeleted: { $ne: true } };

    if (userContext.role === 'CUSTOMER') {
      filter.customerId = userContext.id;
    } else if (userContext.role === 'VENDOR') {
      filter.vendorId = userContext.id;
    }

    if (body.status) {
      filter.status = body.status;
    }

    if (body.priority) {
      filter.priority = body.priority;
    }

    const [requests, total] = await Promise.all([
      ServiceRequest.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .populate('customerId vendorId categoryId subCategoryId'),
      ServiceRequest.countDocuments(filter),
    ]);

    const mapped = requests.map((r) => serviceRequestMapper(r));
    const meta = getPaginationMetadata(total, page, limit);

    return { data: mapped, meta };
  }
}

module.exports = new ServiceRequestService();
