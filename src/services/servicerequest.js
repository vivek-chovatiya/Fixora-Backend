const ServiceRequest = require('../models/servicerequest');
const ServiceRequestTimeline = require('../models/timeline');
const Address = require('../models/address');
const Category = require('../models/category');
const SubCategory = require('../models/subcategory');
const Notification = require('../models/notification');
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
    let address = null;
    if (payload.addressId) {
      address = await Address.findOne({ _id: payload.addressId, isDeleted: { $ne: true } });
    }
    if (!address) {
      address = await Address.findOne({ customerId, isDeleted: { $ne: true } });
    }
    if (!address) {
      address = await Address.create({
        customerId,
        title: 'Home',
        addressLine1: payload.serviceAddress || '742 Evergreen Terrace',
        city: 'Springfield',
        state: 'IL',
        pincode: '62704',
        isDefault: true,
      });
    }

    const category = await Category.findOne({ _id: payload.categoryId, isDeleted: { $ne: true } });
    if (!category) {
      throw new ApiError(404, 'Selected service category not found.');
    }

    let subCategory = null;
    if (payload.subCategoryId) {
      subCategory = await SubCategory.findOne({
        _id: payload.subCategoryId,
        isDeleted: { $ne: true },
      });
    }
    if (!subCategory) {
      subCategory = await SubCategory.findOne({
        categoryId: payload.categoryId,
        isDeleted: { $ne: true },
      });
    }

    const fullAddress = payload.serviceAddress || `${address.addressLine1}${address.addressLine2 ? ', ' + address.addressLine2 : ''}, ${address.city}, ${address.state} - ${address.pincode}`;
    const requestNumber = generateRequestNumber();

    const request = await ServiceRequest.create({
      ...payload,
      subCategoryId: subCategory ? subCategory._id : null,
      addressId: address._id,
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

    await Notification.create({
      userId: customerId,
      userRole: 'CUSTOMER',
      title: 'Service Request Created',
      message: `Your booking ${request.requestNumber} has been received and broadcast to verified specialists.`,
      type: 'SERVICE_REQUEST',
      referenceId: request._id,
    }).catch(() => {});

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

    await Notification.create({
      userId: request.customerId,
      userRole: 'CUSTOMER',
      title: 'Request Accepted 👨‍🔧',
      message: `A service provider has claimed your request ${request.requestNumber} and is preparing dispatch.`,
      type: 'SERVICE_REQUEST',
      referenceId: id,
    }).catch(() => {});

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

    await Notification.create({
      userId: request.customerId,
      userRole: 'CUSTOMER',
      title: 'Request Status Update',
      message: `Your request ${request.requestNumber} status update: ${note || 'Request rejected/cancelled.'}`,
      type: 'SERVICE_REQUEST',
      referenceId: id,
    }).catch(() => {});

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

    await Notification.create({
      userId: request.customerId,
      userRole: 'CUSTOMER',
      title: 'Technician Assigned 👥',
      message: `A specialist has been assigned to your service request ${request.requestNumber}.`,
      type: 'SERVICE_REQUEST',
      referenceId: id,
    }).catch(() => {});

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

    await Notification.create({
      userId: request.customerId,
      userRole: 'CUSTOMER',
      title: 'Work In Progress 🛠️',
      message: `Technician has arrived on site and started work for request ${request.requestNumber}.`,
      type: 'SERVICE_REQUEST',
      referenceId: id,
    }).catch(() => {});

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

    await Notification.create({
      userId: request.customerId,
      userRole: 'CUSTOMER',
      title: 'Service Completed 🎉',
      message: `Your service request ${request.requestNumber} has been marked completed! Please rate your technician.`,
      type: 'SERVICE_REQUEST',
      referenceId: id,
    }).catch(() => {});

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
      filter.$or = [{ vendorId: userContext.id }, { vendorId: null }];
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
