const ServiceRequest = require('../models/servicerequest');
const ServiceRequestTimeline = require('../models/timeline');
const Address = require('../models/address');
const Category = require('../models/category');
const SubCategory = require('../models/subcategory');
const TeamMember = require('../models/team');
const Vendor = require('../models/vendor');
const Notification = require('../models/notification');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { ERROR_CODES } = require('../utils/errorCodes');
const { getPagination, getPaginationMetadata } = require('../utils/pagination');
const {
  HELD_STATUSES,
  canSee,
  declinedBy,
  offersCategory,
  presentRequest,
  sameId,
} = require('./requestview');

// Service requests to the requests contract (lead, 17/11/2026) and PROJECT_BIBLE.md sections
// 20–24 and 31–36: who may see what (services/requestview.js), first-accept-wins, per-vendor
// decline of broadcast requests, holder-only start/complete, customer cancel until accepted, and a
// create that records only what the customer actually gave.
//
// ⚠️ Every status change is one conditional findOneAndUpdate on the state it starts from. Never
// read-check-then-write: two vendors pressing Accept together must produce exactly one winner.

const DETAIL_POPULATE = 'customerId vendorId categoryId subCategoryId assignedTeamMemberId addressId';
const LIST_POPULATE = 'customerId vendorId categoryId subCategoryId';

const generateRequestNumber = () => {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(1000 + Math.random() * 9000);
  return `REQ-${timestamp}${random}`;
};

const notFound = () =>
  new ApiError(404, 'Service request not found.', null, ERROR_CODES.REQUEST_NOT_FOUND);

const alreadyTaken = () =>
  new ApiError(
    409,
    'This request has already been taken by another professional.',
    null,
    ERROR_CODES.REQUEST_ALREADY_TAKEN
  );

const notPending = () =>
  new ApiError(
    409,
    'This request is no longer waiting for an answer.',
    null,
    ERROR_CODES.REQUEST_NOT_PENDING
  );

const invalidTransition = () =>
  new ApiError(
    409,
    'This request cannot move to that status from where it is now.',
    null,
    ERROR_CODES.INVALID_TRANSITION
  );

const notCancellable = () =>
  new ApiError(
    409,
    'This request can no longer be cancelled.',
    null,
    ERROR_CODES.REQUEST_NOT_CANCELLABLE
  );

const fieldInvalid = (field, message) =>
  new ApiError(400, 'Validation Failed', [{ field, message }], ERROR_CODES.VALIDATION_FAILED);

const composeAddress = (address) =>
  [
    address.addressLine1,
    address.addressLine2,
    address.city,
    [address.state, address.pincode].filter(Boolean).join(' - '),
  ]
    .filter(Boolean)
    .join(', ');

// A notification is a courtesy; failing to save one must not undo the change it describes.
const notify = (payload) =>
  Notification.create(payload).catch((error) => {
    logger.warn(`notification not saved: ${error.name}`);
  });

const addTimeline = (serviceRequestId, status, viewer, note) =>
  ServiceRequestTimeline.create({
    serviceRequestId,
    status,
    updatedBy: viewer.id,
    userRole: viewer.role,
    note,
  });

class ServiceRequestService {
  // A vendor viewer carries their categories: open broadcasts reach only vendors who offer the
  // request's category (requests contract §2).
  async withCategories(viewer) {
    if (viewer.role !== 'VENDOR' || viewer.categoryIds) return viewer;
    const vendor = await Vendor.findOne({ _id: viewer.id, isDeleted: { $ne: true } })
      .select('categoryIds')
      .lean();
    return { ...viewer, categoryIds: vendor ? vendor.categoryIds : [] };
  }

  // Taking or turning down open work needs an ACTIVE + APPROVED vendor who offers the request's
  // category (requests contract §4).
  async assertCanTakeWork(vendorId, request) {
    const vendor = await Vendor.findOne({ _id: vendorId, isDeleted: { $ne: true } });
    const eligible =
      vendor &&
      vendor.status === 'ACTIVE' &&
      vendor.approvalStatus === 'APPROVED' &&
      (vendor.categoryIds || []).some((categoryId) => sameId(categoryId, request.categoryId));
    if (!eligible) {
      throw new ApiError(
        403,
        'You cannot accept requests for this service.',
        null,
        ERROR_CODES.FORBIDDEN
      );
    }
  }

  async findRequest(id) {
    const request = await ServiceRequest.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!request) throw notFound();
    return request;
  }

  // The request as `viewer` sees it, with its timeline. `checkAccess: false` only for the answer
  // to an action the viewer has just been allowed to take (a decline hides the request from them).
  async view(id, caller, { checkAccess = true } = {}) {
    const viewer = await this.withCategories(caller);
    const request = await ServiceRequest.findOne({ _id: id, isDeleted: { $ne: true } }).populate(
      DETAIL_POPULATE
    );
    if (!request || (checkAccess && !canSee(request, viewer))) throw notFound();

    const timeline = await ServiceRequestTimeline.find({
      serviceRequestId: request._id,
      isDeleted: { $ne: true },
    }).sort({ timestamp: 1 });

    return presentRequest(request, viewer, timeline);
  }

  // §6: nothing invented — no placeholder address, no guessed sub-category.
  async createRequest(viewer, payload) {
    const customerId = viewer.id;

    const category = await Category.findOne({
      _id: payload.categoryId,
      status: 'ACTIVE',
      isDeleted: { $ne: true },
    });
    if (!category) {
      throw fieldInvalid('categoryId', 'This service is not available.');
    }

    let subCategoryId = null;
    if (payload.subCategoryId) {
      const subCategory = await SubCategory.findOne({
        _id: payload.subCategoryId,
        categoryId: category._id,
        isDeleted: { $ne: true },
      });
      if (!subCategory) {
        throw fieldInvalid('subCategoryId', 'This option does not belong to the selected service.');
      }
      subCategoryId = subCategory._id;
    }

    let vendorId = null;
    if (payload.vendorId) {
      const vendor = await Vendor.findOne({
        _id: payload.vendorId,
        status: 'ACTIVE',
        approvalStatus: 'APPROVED',
        categoryIds: category._id,
        isDeleted: { $ne: true },
      });
      if (!vendor) {
        throw fieldInvalid('vendorId', 'This professional is not available for this service.');
      }
      vendorId = vendor._id;
    }

    let addressId = null;
    let serviceAddress = payload.serviceAddress;
    let details = payload.serviceAddressDetails || null;
    let fallbackArea = '';

    if (payload.addressId) {
      const address = await Address.findOne({
        _id: payload.addressId,
        customerId,
        isDeleted: { $ne: true },
      });
      if (!address) {
        throw fieldInvalid('addressId', 'This address is not in your address book.');
      }
      addressId = address._id;
      serviceAddress = serviceAddress || composeAddress(address);
      details = details || {
        line1: address.addressLine1,
        line2: address.addressLine2,
        city: address.city,
        pincode: address.pincode,
        latitude: address.latitude,
        longitude: address.longitude,
      };
      fallbackArea = address.city;
    }

    const request = await ServiceRequest.create({
      requestNumber: generateRequestNumber(),
      customerId,
      vendorId,
      categoryId: category._id,
      subCategoryId,
      addressId,
      serviceAddress,
      serviceAddressDetails: details || undefined,
      serviceArea: (details && (details.area || details.city)) || fallbackArea || '',
      description: payload.description || '',
      images: payload.images || [],
      priority: payload.priority,
      scheduledAt: payload.scheduledAt || null,
      notes: payload.notes || '',
      status: 'PENDING',
    });

    await addTimeline(request._id, 'PENDING', viewer, 'Service request submitted by customer.');

    await notify({
      userId: customerId,
      userRole: 'CUSTOMER',
      title: 'Service Request Created',
      message: vendorId
        ? `Your booking ${request.requestNumber} has been sent to the professional you chose.`
        : `Your booking ${request.requestNumber} has been received and broadcast to verified specialists.`,
      type: 'SERVICE_REQUEST',
      referenceId: request._id,
    });

    return this.view(request._id, viewer);
  }

  // §4: first accept wins, decided by one conditional update.
  async acceptRequest(id, viewer) {
    const vendorId = viewer.id;
    const request = await this.findRequest(id);

    // A broadcast this vendor declined is readable but read-only: they have answered already.
    if (declinedBy(request, vendorId) && !sameId(request.vendorId, vendorId)) {
      throw notPending();
    }

    await this.assertCanTakeWork(vendorId, request);

    const accepted = await ServiceRequest.findOneAndUpdate(
      {
        _id: request._id,
        isDeleted: { $ne: true },
        status: 'PENDING',
        $or: [{ vendorId: null }, { vendorId }],
        declinedBy: { $ne: vendorId },
      },
      { $set: { vendorId, status: 'ACCEPTED' } },
      { new: true }
    );

    if (!accepted) {
      const current = await this.findRequest(id);
      if (sameId(current.vendorId, vendorId)) {
        // Accepted by me already (a double tap): the same answer again.
        if (current.status === 'ACCEPTED') return this.view(id, viewer);
        throw notPending();
      }
      if (current.vendorId && ['PENDING', ...HELD_STATUSES].includes(current.status)) {
        throw alreadyTaken();
      }
      throw notPending();
    }

    await addTimeline(accepted._id, 'ACCEPTED', viewer, 'Vendor accepted service request.');
    await notify({
      userId: accepted.customerId,
      userRole: 'CUSTOMER',
      title: 'Request Accepted 👨‍🔧',
      message: `A service provider has claimed your request ${accepted.requestNumber} and is preparing dispatch.`,
      type: 'SERVICE_REQUEST',
      referenceId: accepted._id,
    });

    return this.view(id, viewer);
  }

  // §4: a directed request is rejected back to the customer; an open broadcast is declined for
  // this vendor only and stays PENDING for everyone else.
  async rejectRequest(id, viewer, note = '') {
    const vendorId = viewer.id;
    const request = await this.findRequest(id);

    if (declinedBy(request, vendorId)) {
      return this.view(id, viewer, { checkAccess: false });
    }

    if (sameId(request.vendorId, vendorId)) {
      const rejected = await ServiceRequest.findOneAndUpdate(
        { _id: request._id, vendorId, status: 'PENDING' },
        { $set: { status: 'REJECTED' } },
        { new: true }
      );
      if (!rejected) throw notPending();

      await addTimeline(rejected._id, 'REJECTED', viewer, note || 'Service request rejected.');
      await notify({
        userId: rejected.customerId,
        userRole: 'CUSTOMER',
        title: 'Request Status Update',
        message: `Your request ${rejected.requestNumber} could not be taken by the professional you chose.`,
        type: 'SERVICE_REQUEST',
        referenceId: rejected._id,
      });
      return this.view(id, viewer);
    }

    if (!request.vendorId) {
      // Only a vendor the broadcast reaches may decline it (review fix 17/11/2026): outside their
      // categories it does not exist for them, and it takes an ACTIVE + APPROVED vendor.
      if (!offersCategory(await this.withCategories(viewer), request)) throw notFound();
      await this.assertCanTakeWork(vendorId, request);

      // No timeline entry or customer notification: the request itself has not changed.
      const declined = await ServiceRequest.findOneAndUpdate(
        { _id: request._id, vendorId: null, status: 'PENDING' },
        { $addToSet: { declinedBy: vendorId } },
        { new: true }
      );
      if (!declined) throw notPending();
      return this.view(id, viewer, { checkAccess: false });
    }

    // Held by, or directed to, another vendor.
    if (request.status === 'PENDING') throw notFound();
    throw notPending();
  }

  async assignTeamMember(id, viewer, assignedTeamMemberId) {
    const vendorId = viewer.id;
    const request = await this.findRequest(id);
    if (!canSee(request, await this.withCategories(viewer))) throw notFound();

    const member = await TeamMember.findOne({
      _id: assignedTeamMemberId,
      vendorId,
      isDeleted: { $ne: true },
    });
    if (!member) {
      throw fieldInvalid('assignedTeamMemberId', 'This person is not in your team.');
    }

    const assigned = await ServiceRequest.findOneAndUpdate(
      { _id: request._id, vendorId, status: { $in: ['ACCEPTED', 'ASSIGNED'] } },
      { $set: { assignedTeamMemberId: member._id, status: 'ASSIGNED' } },
      { new: true }
    );
    if (!assigned) throw invalidTransition();

    await addTimeline(
      assigned._id,
      'ASSIGNED',
      viewer,
      'Vendor assigned technician to service request.'
    );
    await notify({
      userId: assigned.customerId,
      userRole: 'CUSTOMER',
      title: 'Technician Assigned 👥',
      message: `A specialist has been assigned to your service request ${assigned.requestNumber}.`,
      type: 'SERVICE_REQUEST',
      referenceId: assigned._id,
    });

    return this.view(id, viewer);
  }

  async startWork(id, viewer) {
    const request = await this.findRequest(id);
    if (!canSee(request, await this.withCategories(viewer))) throw notFound();

    const started = await ServiceRequest.findOneAndUpdate(
      { _id: request._id, vendorId: viewer.id, status: { $in: ['ACCEPTED', 'ASSIGNED'] } },
      { $set: { status: 'IN_PROGRESS' } },
      { new: true }
    );
    if (!started) throw invalidTransition();

    await addTimeline(started._id, 'IN_PROGRESS', viewer, 'Work started on service request.');
    await notify({
      userId: started.customerId,
      userRole: 'CUSTOMER',
      title: 'Work In Progress 🛠️',
      message: `Technician has arrived on site and started work for request ${started.requestNumber}.`,
      type: 'SERVICE_REQUEST',
      referenceId: started._id,
    });

    return this.view(id, viewer);
  }

  // Payment fields are unchanged for now (recorded as a gap in the contract).
  async completeWork(id, viewer, payload = {}) {
    const request = await this.findRequest(id);
    if (!canSee(request, await this.withCategories(viewer))) throw notFound();

    const updateData = { status: 'COMPLETED', completedAt: new Date() };
    if (payload.amount !== undefined) updateData.amount = payload.amount;
    if (payload.completionImages) updateData.completionImages = payload.completionImages;

    const completed = await ServiceRequest.findOneAndUpdate(
      { _id: request._id, vendorId: viewer.id, status: 'IN_PROGRESS' },
      { $set: updateData },
      { new: true }
    );
    if (!completed) throw invalidTransition();

    await addTimeline(
      completed._id,
      'COMPLETED',
      viewer,
      payload.note || 'Work completed successfully.'
    );
    await notify({
      userId: completed.customerId,
      userRole: 'CUSTOMER',
      title: 'Service Completed 🎉',
      message: `Your service request ${completed.requestNumber} has been marked completed! Please rate your technician.`,
      type: 'SERVICE_REQUEST',
      referenceId: completed._id,
    });

    return this.view(id, viewer);
  }

  // §5 (owner decision 3D-11): a customer may cancel until a professional accepts.
  async cancelRequest(id, viewer, reason = '') {
    const request = await this.findRequest(id);
    if (!sameId(request.customerId, viewer.id)) throw notFound();
    if (request.status === 'CANCELLED') return this.view(id, viewer);

    const cancelled = await ServiceRequest.findOneAndUpdate(
      { _id: request._id, customerId: viewer.id, status: 'PENDING' },
      { $set: { status: 'CANCELLED' } },
      { new: true }
    );
    if (!cancelled) {
      const current = await this.findRequest(id);
      if (current.status === 'CANCELLED') return this.view(id, viewer);
      throw notCancellable();
    }

    await addTimeline(cancelled._id, 'CANCELLED', viewer, reason || 'Cancelled by customer.');
    if (cancelled.vendorId) {
      await notify({
        userId: cancelled.vendorId,
        userRole: 'VENDOR',
        title: 'Request Cancelled',
        message: `Request ${cancelled.requestNumber} was cancelled by the customer.`,
        type: 'SERVICE_REQUEST',
        referenceId: cancelled._id,
      });
    }

    return this.view(id, viewer);
  }

  async getRequestById(id, viewer) {
    return this.view(id, viewer);
  }

  async getAllRequests(body = {}, viewer) {
    const { page, limit, skip } = getPagination(body);
    const conditions = [{ isDeleted: { $ne: true } }];

    if (viewer.role === 'CUSTOMER') {
      conditions.push({ customerId: viewer.id });
    } else if (viewer.role === 'VENDOR') {
      const { categoryIds } = await this.withCategories(viewer);
      conditions.push(
        body.declined === true
          ? { declinedBy: viewer.id }
          : {
              $or: [
                { vendorId: viewer.id },
                {
                  vendorId: null,
                  status: 'PENDING',
                  declinedBy: { $ne: viewer.id },
                  categoryId: { $in: categoryIds },
                },
              ],
            }
      );
    }

    if (body.status) conditions.push({ status: body.status });
    if (body.priority) conditions.push({ priority: body.priority });

    const filter = { $and: conditions };
    const [requests, total] = await Promise.all([
      ServiceRequest.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .populate(LIST_POPULATE),
      ServiceRequest.countDocuments(filter),
    ]);

    const mapped = requests.map((request) => presentRequest(request, viewer));
    const meta = getPaginationMetadata(total, page, limit);

    return { data: mapped, meta };
  }
}

module.exports = new ServiceRequestService();
