const crypto = require('crypto');
const ServiceRequest = require('../models/servicerequest');
const ServiceRequestTimeline = require('../models/timeline');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const addressService = require('./address');
const categoryService = require('./category');
const subCategoryService = require('./subcategory');
const vendorService = require('./vendor');
const customerService = require('./customer');
const teamService = require('./team');
const notificationService = require('./notification');
const { formatFullAddress } = require('./address');
const { getPagination, getPaginationMetadata } = require('../utils/pagination');
const {
  ROLE,
  REQUEST_STATUS,
  REQUEST_STATUS_LABEL,
  REQUEST_TRANSITIONS,
  ACTIVE_REQUEST_STATUSES,
  PRIORITY_LABEL,
  DISPATCH_MODE,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  VENDOR_REQUEST_VIEW,
  CUSTOMER_REQUEST_VIEW,
  REQUEST_ACTION,
  REPORT_PERIOD,
  ERROR_CODE,
  NOTIFICATION_TYPE,
} = require('../constants');

const S = REQUEST_STATUS;
const NOT_DELETED = { isDeleted: { $ne: true } };
const POPULATE = [
  { path: 'customerId', select: 'firstName lastName phone profileImage' },
  {
    path: 'vendorId',
    select: 'businessName ownerName phone profileImage averageRating totalReviews',
  },
  {
    path: 'requestedVendorId',
    select: 'businessName ownerName phone profileImage averageRating totalReviews',
  },
  { path: 'categoryId', select: 'name icon' },
  { path: 'subCategoryId', select: 'name estimatedPrice estimatedDuration' },
  { path: 'assignedTeamMemberId', select: 'name phone designation' },
  { path: 'addressId', select: 'title addressLine1 addressLine2 city state pincode' },
];

const CUSTOMER_VIEW_STATUSES = Object.freeze({
  [CUSTOMER_REQUEST_VIEW.ACTIVE]: ACTIVE_REQUEST_STATUSES,
  [CUSTOMER_REQUEST_VIEW.COMPLETED]: [S.COMPLETED, S.CLOSED],
  [CUSTOMER_REQUEST_VIEW.CANCELLED]: [S.CANCELLED, S.REJECTED],
});

const idOf = (value) => (value && value._id ? value._id : value);
const sameId = (a, b) => Boolean(a && b) && idOf(a).toString() === idOf(b).toString();

const generateRequestNumber = () => {
  const now = new Date();
  const datePart = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `FX-${datePart}-${crypto.randomInt(100000, 1000000)}`;
};

const periodStart = (period) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (period === REPORT_PERIOD.WEEK) {
    const day = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - day);
  } else if (period === REPORT_PERIOD.MONTH) {
    d.setDate(1);
  }
  return d;
};

const assertTransition = (from, to) => {
  if (!(REQUEST_TRANSITIONS[from] || []).includes(to)) {
    throw new ApiError(
      409,
      `This request is ${REQUEST_STATUS_LABEL[from] || from} and can no longer be moved to ${REQUEST_STATUS_LABEL[to] || to}.`,
      null,
      ERROR_CODE.INVALID_STATUS_TRANSITION
    );
  }
};

class ServiceRequestService {
  // ---------------------------------------------------------------------------
  // Visibility & actions
  // ---------------------------------------------------------------------------

  hasDeclined(request, vendorId) {
    return (request.declines || []).some((d) => sameId(d.vendorId, vendorId));
  }

  /** Is this unassigned request currently offered to this vendor? */
  isOfferedToVendor(request, vendor) {
    if (request.status !== S.PENDING_VENDOR || request.vendorId) return false;
    if (this.hasDeclined(request, vendor._id)) return false;
    if (request.dispatchMode === DISPATCH_MODE.DIRECTED) {
      return sameId(request.requestedVendorId, vendor._id);
    }
    return (vendor.categoryIds || []).some((c) => sameId(c, request.categoryId));
  }

  canView(request, user, vendor) {
    if (user.role === ROLE.ADMIN) return true;
    if (user.role === ROLE.CUSTOMER) return sameId(request.customerId, user.id);
    if (user.role === ROLE.VENDOR) {
      return (
        sameId(request.vendorId, user.id) ||
        sameId(request.requestedVendorId, user.id) ||
        this.hasDeclined(request, user.id) ||
        (vendor ? this.isOfferedToVendor(request, vendor) : false)
      );
    }
    return false;
  }

  /** The backend decides which actions are valid; the app only renders them. */
  getAllowedActions(request, user, vendor) {
    const actions = [];
    const { status } = request;

    if (user.role === ROLE.CUSTOMER && sameId(request.customerId, user.id)) {
      if ([S.CREATED, S.PENDING_VENDOR, S.ACCEPTED].includes(status)) {
        actions.push(REQUEST_ACTION.CANCEL);
      }
      if (status === S.COMPLETED && !request.isReviewed && request.vendorId) {
        actions.push(REQUEST_ACTION.REVIEW);
      }
    }

    if (user.role === ROLE.VENDOR && vendor) {
      if (this.isOfferedToVendor(request, vendor)) {
        actions.push(REQUEST_ACTION.ACCEPT, REQUEST_ACTION.REJECT);
      }
      if (sameId(request.vendorId, user.id)) {
        if (status === S.ACCEPTED) actions.push(REQUEST_ACTION.START);
        if (status === S.IN_PROGRESS) actions.push(REQUEST_ACTION.COMPLETE);
        if ([S.ACCEPTED, S.IN_PROGRESS].includes(status)) actions.push(REQUEST_ACTION.ASSIGN_TEAM);
      }
    }

    if (user.role === ROLE.ADMIN && [S.CREATED, S.PENDING_VENDOR, S.ACCEPTED].includes(status)) {
      actions.push(REQUEST_ACTION.CANCEL);
    }

    return actions;
  }

  // ---------------------------------------------------------------------------
  // Mapping
  // ---------------------------------------------------------------------------

  mapTimeline(entry) {
    return {
      id: entry._id,
      status: entry.status,
      statusLabel: REQUEST_STATUS_LABEL[entry.status] || entry.status,
      title: entry.title,
      note: entry.note,
      userRole: entry.userRole,
      createdAt: entry.timestamp || entry.createdAt,
    };
  }

  /** `request` must be populated with POPULATE. */
  mapRequest(request, user, { vendor = null, timeline = null, review = null } = {}) {
    if (!request) return null;
    const isOwnerVendor = user.role === ROLE.VENDOR && sameId(request.vendorId, user.id);
    const isAssigned = Boolean(request.vendorId);
    const address = request.addressId && request.addressId._id ? request.addressId : null;

    return {
      id: request._id,
      requestNumber: request.requestNumber,
      status: request.status,
      statusLabel: REQUEST_STATUS_LABEL[request.status] || request.status,
      priority: request.priority,
      priorityLabel: PRIORITY_LABEL[request.priority] || request.priority,
      dispatchMode: request.dispatchMode,
      isDirectedToMe:
        user.role === ROLE.VENDOR &&
        request.dispatchMode === DISPATCH_MODE.DIRECTED &&
        sameId(request.requestedVendorId, user.id),
      category: request.categoryId && request.categoryId._id
        ? { id: request.categoryId._id, name: request.categoryId.name, icon: request.categoryId.icon }
        : null,
      subCategory: request.subCategoryId && request.subCategoryId._id
        ? {
            id: request.subCategoryId._id,
            name: request.subCategoryId.name,
            estimatedPrice: request.subCategoryId.estimatedPrice,
          }
        : null,
      // Customer contact is shared with a vendor only once that vendor owns the job.
      customer: customerService.toRequestParty(request.customerId, {
        includeContact: user.role !== ROLE.VENDOR || isOwnerVendor,
      }),
      // Vendor contact is shared with the customer once the vendor has accepted.
      vendor: vendorService.toRequestParty(request.vendorId, { includeContact: isAssigned }),
      requestedVendor: vendorService.toRequestParty(request.requestedVendorId, {
        includeContact: false,
      }),
      assignedTeamMember: request.assignedTeamMemberId && request.assignedTeamMemberId._id
        ? {
            id: request.assignedTeamMemberId._id,
            name: request.assignedTeamMemberId.name,
            phone: request.assignedTeamMemberId.phone,
            designation: request.assignedTeamMemberId.designation,
          }
        : null,
      address: address
        ? { id: address._id, title: address.title, fullAddress: formatFullAddress(address) }
        : null,
      serviceAddress: request.serviceAddress,
      description: request.description,
      notes: request.notes,
      images: request.images || [],
      preferredDate: request.preferredDate,
      preferredTime: request.preferredTime,
      estimatedAmount: request.estimatedAmount,
      finalAmount: request.finalAmount,
      paymentMethod: request.paymentMethod,
      paymentMethodLabel: request.paymentMethod ? PAYMENT_METHOD_LABEL[request.paymentMethod] : null,
      paymentStatus: request.paymentStatus,
      paymentStatusLabel: PAYMENT_STATUS_LABEL[request.paymentStatus] || request.paymentStatus,
      completionNotes: request.completionNotes,
      completionImages: request.completionImages || [],
      cancelReason: request.cancelReason,
      acceptedAt: request.acceptedAt,
      startedAt: request.startedAt,
      completedAt: request.completedAt,
      cancelledAt: request.cancelledAt,
      isReviewed: request.isReviewed,
      review,
      timeline: timeline ? timeline.map((t) => this.mapTimeline(t)) : undefined,
      allowedActions: this.getAllowedActions(request, user, vendor),
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  async addTimeline(requestId, { status, title, note = '', user }) {
    return ServiceRequestTimeline.create({
      serviceRequestId: requestId,
      status,
      title,
      note,
      updatedBy: user.id,
      userRole: user.role,
    });
  }

  async loadVendorContext(user) {
    if (user.role !== ROLE.VENDOR) return null;
    return vendorService.getVendorDocument(user.id);
  }

  async findRequestDocument(id) {
    const request = await ServiceRequest.findOne({ _id: id, ...NOT_DELETED });
    if (!request) {
      throw new ApiError(404, 'Service request not found.');
    }
    return request;
  }

  async findVisibleRequest(id, user, vendor) {
    const request = await this.findRequestDocument(id);
    if (!this.canView(request, user, vendor)) {
      throw new ApiError(404, 'Service request not found.');
    }
    return request;
  }

  async notifyBroadcast(request, excludeVendorIds = []) {
    const vendorIds = await vendorService.getEligibleVendorIdsForCategory(
      request.categoryId,
      excludeVendorIds
    );
    await notificationService.notifyMany(vendorIds, {
      userRole: ROLE.VENDOR,
      type: NOTIFICATION_TYPE.SERVICE_REQUEST,
      title: 'New request available',
      message: `A new ${request.priority === 'EMERGENCY' ? 'emergency ' : ''}request ${request.requestNumber} is open in your area.`,
      referenceId: request._id,
    });
    return vendorIds.length;
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  async createRequest(customerId, payload) {
    const user = { id: customerId, role: ROLE.CUSTOMER };
    const address = await addressService.getOwnedAddressDocument(payload.addressId, customerId);
    const category = await categoryService.assertPublicCategory(payload.categoryId);
    const subCategory = await subCategoryService.assertPublicSubCategoryInCategory(
      payload.subCategoryId,
      category._id
    );

    let requestedVendor = null;
    if (payload.vendorId) {
      requestedVendor = await vendorService.assertEligibleForCategory(payload.vendorId, category._id);
    }

    const base = {
      customerId,
      categoryId: category._id,
      subCategoryId: subCategory._id,
      addressId: address._id,
      serviceAddress: formatFullAddress(address),
      description: payload.description,
      notes: payload.notes || '',
      images: payload.images || [],
      priority: payload.priority,
      preferredDate: payload.preferredDate || null,
      preferredTime: payload.preferredTime || '',
      estimatedAmount: subCategory.estimatedPrice || 0,
      dispatchMode: requestedVendor ? DISPATCH_MODE.DIRECTED : DISPATCH_MODE.OPEN,
      requestedVendorId: requestedVendor ? requestedVendor._id : null,
      status: S.PENDING_VENDOR,
      createdBy: customerId,
    };

    let request = null;
    for (let attempt = 0; attempt < 5 && !request; attempt += 1) {
      try {
        request = await ServiceRequest.create({ ...base, requestNumber: generateRequestNumber() });
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
    }
    if (!request) {
      throw new ApiError(500, 'Could not generate a request number. Please try again.');
    }

    await this.addTimeline(request._id, {
      status: S.CREATED,
      title: 'Request Created',
      note: `${subCategory.name} request submitted.`,
      user,
    });

    if (requestedVendor) {
      await this.addTimeline(request._id, {
        status: S.PENDING_VENDOR,
        title: 'Vendor Requested',
        note: `Waiting for ${requestedVendor.businessName} to respond.`,
        user,
      });
      await notificationService.notify({
        userId: requestedVendor._id,
        userRole: ROLE.VENDOR,
        type: NOTIFICATION_TYPE.SERVICE_REQUEST,
        title: 'New request for you',
        message: `A customer chose you for ${subCategory.name} (${request.requestNumber}).`,
        referenceId: request._id,
      });
    } else {
      await this.addTimeline(request._id, {
        status: S.PENDING_VENDOR,
        title: 'Sent to Vendors',
        note: 'Finding an available vendor for you.',
        user,
      });
      await this.notifyBroadcast(request);
    }

    await notificationService.notify({
      userId: customerId,
      userRole: ROLE.CUSTOMER,
      type: NOTIFICATION_TYPE.SERVICE_REQUEST,
      title: 'Request created',
      message: `Your request ${request.requestNumber} has been created.`,
      referenceId: request._id,
    });

    logger.info(`Request created: ${request.requestNumber} (${request.dispatchMode})`);
    return this.getRequestById(request._id, user);
  }

  /**
   * First-accept-wins (App PROJECT_BIBLE §33.1). The conditional update is atomic,
   * so exactly one vendor can ever move a request out of PENDING_VENDOR.
   */
  async acceptRequest(id, vendorId) {
    const user = { id: vendorId, role: ROLE.VENDOR };
    const vendor = await vendorService.assertApprovedAndActive(vendorId);
    const request = await this.findRequestDocument(id);

    if (request.vendorId && !sameId(request.vendorId, vendorId)) {
      throw new ApiError(
        409,
        'This request has already been assigned to another vendor.',
        null,
        ERROR_CODE.REQUEST_ALREADY_ASSIGNED
      );
    }
    if (request.status !== S.PENDING_VENDOR) {
      assertTransition(request.status, S.ACCEPTED);
    }
    if (!this.isOfferedToVendor(request, vendor)) {
      throw new ApiError(404, 'Service request not found.');
    }

    const filter = { _id: id, status: S.PENDING_VENDOR, vendorId: null, ...NOT_DELETED };
    if (request.dispatchMode === DISPATCH_MODE.DIRECTED) {
      filter.requestedVendorId = vendorId;
      filter.dispatchMode = DISPATCH_MODE.DIRECTED;
    }

    const updated = await ServiceRequest.findOneAndUpdate(
      filter,
      { $set: { vendorId, status: S.ACCEPTED, acceptedAt: new Date(), updatedBy: vendorId } },
      { new: true }
    );

    if (!updated) {
      const latest = await this.findRequestDocument(id);
      if (latest.vendorId && !sameId(latest.vendorId, vendorId)) {
        logger.info(`Accept lost: ${latest.requestNumber} vendor ${vendorId}`);
        throw new ApiError(
          409,
          'This request has already been assigned to another vendor.',
          null,
          ERROR_CODE.REQUEST_ALREADY_ASSIGNED
        );
      }
      throw new ApiError(
        409,
        'This request is no longer available.',
        null,
        ERROR_CODE.INVALID_STATUS_TRANSITION
      );
    }

    await this.addTimeline(id, {
      status: S.ACCEPTED,
      title: 'Vendor Accepted',
      note: `${vendor.businessName} accepted the request.`,
      user,
    });
    await notificationService.notify({
      userId: updated.customerId,
      userRole: ROLE.CUSTOMER,
      type: NOTIFICATION_TYPE.SERVICE_REQUEST,
      title: 'Vendor assigned',
      message: `${vendor.businessName} accepted your request ${updated.requestNumber}.`,
      referenceId: id,
    });

    logger.info(`Request accepted: ${updated.requestNumber} by vendor ${vendorId}`);
    return this.getRequestById(id, user);
  }

  /**
   * A vendor declines an unassigned request. A declined DIRECTED request re-enters
   * open dispatch so the customer still gets served.
   */
  async rejectRequest(id, user, reason = '') {
    const request = await this.findRequestDocument(id);

    if (user.role === ROLE.ADMIN) {
      assertTransition(request.status, S.REJECTED);
      const updated = await ServiceRequest.findOneAndUpdate(
        { _id: id, status: request.status },
        { $set: { status: S.REJECTED, cancelReason: reason, updatedBy: user.id } },
        { new: true }
      );
      if (!updated) throw new ApiError(409, 'Request changed. Please refresh.', null, ERROR_CODE.INVALID_STATUS_TRANSITION);
      await this.addTimeline(id, { status: S.REJECTED, title: 'Request Rejected', note: reason, user });
      await notificationService.notify({
        userId: request.customerId,
        userRole: ROLE.CUSTOMER,
        type: NOTIFICATION_TYPE.SERVICE_REQUEST,
        title: 'Request rejected',
        message: `Your request ${request.requestNumber} was rejected. ${reason}`.trim(),
        referenceId: id,
      });
      return this.getRequestById(id, user);
    }

    const vendor = await vendorService.assertApprovedAndActive(user.id);
    if (request.vendorId) {
      throw new ApiError(
        409,
        sameId(request.vendorId, user.id)
          ? 'You have already accepted this request.'
          : 'This request has already been assigned to another vendor.',
        null,
        sameId(request.vendorId, user.id)
          ? ERROR_CODE.INVALID_STATUS_TRANSITION
          : ERROR_CODE.REQUEST_ALREADY_ASSIGNED
      );
    }
    if (!this.isOfferedToVendor(request, vendor)) {
      throw new ApiError(404, 'Service request not found.');
    }

    const decline = { vendorId: user.id, reason: reason || '', at: new Date() };
    const isDirectedToMe =
      request.dispatchMode === DISPATCH_MODE.DIRECTED && sameId(request.requestedVendorId, user.id);

    const update = { $push: { declines: decline }, $set: { updatedBy: user.id } };
    if (isDirectedToMe) {
      update.$set.dispatchMode = DISPATCH_MODE.OPEN;
    }

    const updated = await ServiceRequest.findOneAndUpdate(
      { _id: id, status: S.PENDING_VENDOR, vendorId: null, 'declines.vendorId': { $ne: user.id } },
      update,
      { new: true }
    );
    if (!updated) {
      throw new ApiError(409, 'This request is no longer available.', null, ERROR_CODE.INVALID_STATUS_TRANSITION);
    }

    if (isDirectedToMe) {
      await this.addTimeline(id, {
        status: S.PENDING_VENDOR,
        title: 'Sent to Vendors',
        note: `${vendor.businessName} is unavailable. We are finding another vendor for you.`,
        user,
      });
      await notificationService.notify({
        userId: request.customerId,
        userRole: ROLE.CUSTOMER,
        type: NOTIFICATION_TYPE.SERVICE_REQUEST,
        title: 'Finding another vendor',
        message: `${vendor.businessName} couldn't take ${request.requestNumber}. We've sent it to other available vendors.`,
        referenceId: id,
      });
      await this.notifyBroadcast(updated, updated.declines.map((d) => d.vendorId));
    }

    logger.info(`Request declined: ${request.requestNumber} by vendor ${user.id}`);
    return this.getRequestById(id, user);
  }

  /** Customer may cancel until work has started (PROJECT_BIBLE §11.6). */
  async cancelRequest(id, user, reason = '') {
    const request = await this.findRequestDocument(id);
    if (user.role === ROLE.CUSTOMER && !sameId(request.customerId, user.id)) {
      throw new ApiError(404, 'Service request not found.');
    }
    assertTransition(request.status, S.CANCELLED);

    const updated = await ServiceRequest.findOneAndUpdate(
      { _id: id, status: request.status, ...NOT_DELETED },
      {
        $set: {
          status: S.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: reason || '',
          updatedBy: user.id,
        },
      },
      { new: true }
    );
    if (!updated) {
      throw new ApiError(409, 'This request was just updated. Please refresh.', null, ERROR_CODE.INVALID_STATUS_TRANSITION);
    }

    await this.addTimeline(id, {
      status: S.CANCELLED,
      title: 'Request Cancelled',
      note: reason || 'Cancelled by customer.',
      user,
    });

    const vendorToNotify = updated.vendorId || (updated.dispatchMode === DISPATCH_MODE.DIRECTED ? updated.requestedVendorId : null);
    if (vendorToNotify) {
      await notificationService.notify({
        userId: vendorToNotify,
        userRole: ROLE.VENDOR,
        type: NOTIFICATION_TYPE.SERVICE_REQUEST,
        title: 'Request cancelled',
        message: `Request ${updated.requestNumber} was cancelled by the customer.`,
        referenceId: id,
      });
    }

    return this.getRequestById(id, user);
  }

  async assignTeamMember(id, vendorId, assignedTeamMemberId) {
    const user = { id: vendorId, role: ROLE.VENDOR };
    const request = await this.findRequestDocument(id);
    if (!sameId(request.vendorId, vendorId)) {
      throw new ApiError(404, 'Service request not found.');
    }
    if (![S.ACCEPTED, S.IN_PROGRESS].includes(request.status)) {
      throw new ApiError(409, 'A team member can only be assigned to active work.', null, ERROR_CODE.INVALID_STATUS_TRANSITION);
    }

    const member = await teamService.getOwnedActiveMember(assignedTeamMemberId, vendorId);
    await ServiceRequest.findByIdAndUpdate(id, {
      assignedTeamMemberId: member._id,
      updatedBy: vendorId,
    });

    await this.addTimeline(id, {
      status: request.status,
      title: 'Technician Assigned',
      note: `${member.name} (${member.designation}) will handle this request.`,
      user,
    });
    await notificationService.notify({
      userId: request.customerId,
      userRole: ROLE.CUSTOMER,
      type: NOTIFICATION_TYPE.SERVICE_REQUEST,
      title: 'Technician assigned',
      message: `${member.name} has been assigned to ${request.requestNumber}.`,
      referenceId: id,
    });

    return this.getRequestById(id, user);
  }

  /** Atomic status move for the assigned vendor. */
  async moveOwnedRequest(id, vendorId, from, to, extraSet = {}) {
    const request = await this.findRequestDocument(id);
    if (!sameId(request.vendorId, vendorId)) {
      throw new ApiError(404, 'Service request not found.');
    }
    if (request.status !== from) {
      assertTransition(request.status, to);
    }
    const updated = await ServiceRequest.findOneAndUpdate(
      { _id: id, vendorId, status: from, ...NOT_DELETED },
      { $set: { status: to, updatedBy: vendorId, ...extraSet } },
      { new: true }
    );
    if (!updated) {
      throw new ApiError(409, 'This request was just updated. Please refresh.', null, ERROR_CODE.INVALID_STATUS_TRANSITION);
    }
    return updated;
  }

  async startWork(id, vendorId) {
    const user = { id: vendorId, role: ROLE.VENDOR };
    await vendorService.assertApprovedAndActive(vendorId);
    const updated = await this.moveOwnedRequest(id, vendorId, S.ACCEPTED, S.IN_PROGRESS, {
      startedAt: new Date(),
    });

    await this.addTimeline(id, { status: S.IN_PROGRESS, title: 'Work Started', user });
    await notificationService.notify({
      userId: updated.customerId,
      userRole: ROLE.CUSTOMER,
      type: NOTIFICATION_TYPE.SERVICE_REQUEST,
      title: 'Work started',
      message: `Work has started on your request ${updated.requestNumber}.`,
      referenceId: id,
    });
    return this.getRequestById(id, user);
  }

  /** Phase 1 records offline payment only — Fixora never processes money. */
  async completeWork(id, vendorId, payload) {
    const user = { id: vendorId, role: ROLE.VENDOR };
    await vendorService.assertApprovedAndActive(vendorId);
    const updated = await this.moveOwnedRequest(id, vendorId, S.IN_PROGRESS, S.COMPLETED, {
      completedAt: new Date(),
      finalAmount: payload.finalAmount,
      paymentMethod: payload.paymentMethod,
      paymentStatus: payload.paymentStatus,
      completionNotes: payload.completionNotes || '',
      completionImages: payload.completionImages || [],
    });

    await this.addTimeline(id, {
      status: S.COMPLETED,
      title: 'Work Completed',
      note: payload.completionNotes || '',
      user,
    });
    await notificationService.notify({
      userId: updated.customerId,
      userRole: ROLE.CUSTOMER,
      type: NOTIFICATION_TYPE.SERVICE_REQUEST,
      title: 'Service completed',
      message: `Your request ${updated.requestNumber} is complete. Please rate your experience.`,
      referenceId: id,
    });
    return this.getRequestById(id, user);
  }

  // ---------------------------------------------------------------------------
  // Review support (called by the review service)
  // ---------------------------------------------------------------------------

  async assertReviewable(id, customerId) {
    const request = await this.findRequestDocument(id);
    if (!sameId(request.customerId, customerId)) {
      throw new ApiError(404, 'Service request not found.');
    }
    if (request.isReviewed) {
      throw new ApiError(409, 'You have already reviewed this request.', null, ERROR_CODE.REVIEW_NOT_ALLOWED);
    }
    if (request.status !== S.COMPLETED || !request.vendorId) {
      throw new ApiError(400, 'You can review a request only after it is completed.', null, ERROR_CODE.REVIEW_NOT_ALLOWED);
    }
    return request;
  }

  async markReviewed(id, customerId) {
    const updated = await ServiceRequest.findOneAndUpdate(
      { _id: id, customerId, status: S.COMPLETED, isReviewed: false },
      { $set: { status: S.CLOSED, isReviewed: true, updatedBy: customerId } },
      { new: true }
    );
    if (!updated) {
      throw new ApiError(409, 'You have already reviewed this request.', null, ERROR_CODE.REVIEW_NOT_ALLOWED);
    }
    await this.addTimeline(id, {
      status: S.CLOSED,
      title: 'Review Submitted',
      user: { id: customerId, role: ROLE.CUSTOMER },
    });
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async getRequestById(id, user) {
    const vendor = await this.loadVendorContext(user);
    await this.findVisibleRequest(id, user, vendor);

    const [request, timeline] = await Promise.all([
      ServiceRequest.findById(id).populate(POPULATE),
      ServiceRequestTimeline.find({ serviceRequestId: id, ...NOT_DELETED }).sort({ timestamp: 1, _id: 1 }),
    ]);

    // Lazy require avoids a circular import (review service depends on this one).
    // eslint-disable-next-line global-require
    const reviewService = require('./review');
    const review = request.isReviewed ? await reviewService.getReviewForRequest(id) : null;

    return this.mapRequest(request, user, { vendor, timeline, review });
  }

  vendorViewFilter(view, vendor) {
    const me = vendor._id;
    switch (view) {
      case VENDOR_REQUEST_VIEW.ACCEPTED:
        return { vendorId: me, status: S.ACCEPTED };
      case VENDOR_REQUEST_VIEW.IN_PROGRESS:
        return { vendorId: me, status: { $in: [S.IN_PROGRESS, S.ON_HOLD] } };
      case VENDOR_REQUEST_VIEW.COMPLETED:
        return { vendorId: me, status: { $in: [S.COMPLETED, S.CLOSED] } };
      case VENDOR_REQUEST_VIEW.REJECTED:
        return { 'declines.vendorId': me };
      case VENDOR_REQUEST_VIEW.NEW:
      default:
        return {
          status: S.PENDING_VENDOR,
          vendorId: null,
          'declines.vendorId': { $ne: me },
          $or: [
            { dispatchMode: DISPATCH_MODE.DIRECTED, requestedVendorId: me },
            { dispatchMode: DISPATCH_MODE.OPEN, categoryId: { $in: vendor.categoryIds || [] } },
          ],
        };
    }
  }

  async getAllRequests(body = {}, user) {
    const { page, limit, skip } = getPagination(body);
    let filter = { ...NOT_DELETED };
    let vendor = null;
    let sort = { createdAt: -1 };

    if (user.role === ROLE.CUSTOMER) {
      filter.customerId = user.id;
      const statuses = CUSTOMER_VIEW_STATUSES[body.view];
      if (statuses) filter.status = { $in: statuses };
    } else if (user.role === ROLE.VENDOR) {
      vendor = await vendorService.assertApprovedAndActive(user.id);
      filter = { ...filter, ...this.vendorViewFilter(body.view, vendor) };
      if (!body.view || body.view === VENDOR_REQUEST_VIEW.NEW) {
        // Directed leads first — they are this vendor's to lose (App PROJECT_BIBLE §31.1).
        sort = { dispatchMode: 1, createdAt: -1 };
      }
    } else if (body.status) {
      filter.status = body.status;
    }

    if (body.priority) filter.priority = body.priority;

    const [requests, total] = await Promise.all([
      ServiceRequest.find(filter).sort(sort).skip(skip).limit(limit).populate(POPULATE),
      ServiceRequest.countDocuments(filter),
    ]);

    return {
      data: requests.map((r) => this.mapRequest(r, user, { vendor })),
      meta: getPaginationMetadata(total, page, limit),
    };
  }

  async getVendorDashboard(vendorId) {
    const vendor = await vendorService.getVendorDocument(vendorId);
    const user = { id: vendorId, role: ROLE.VENDOR };
    const today = periodStart(REPORT_PERIOD.TODAY);
    const newFilter = { ...NOT_DELETED, ...this.vendorViewFilter(VENDOR_REQUEST_VIEW.NEW, vendor) };

    const [newCount, newToday, mineToday, accepted, inProgress, completed, activeJobs] =
      await Promise.all([
        ServiceRequest.countDocuments(newFilter),
        ServiceRequest.countDocuments({ ...newFilter, createdAt: { $gte: today } }),
        ServiceRequest.countDocuments({ ...NOT_DELETED, vendorId, acceptedAt: { $gte: today } }),
        ServiceRequest.countDocuments({ ...NOT_DELETED, ...this.vendorViewFilter(VENDOR_REQUEST_VIEW.ACCEPTED, vendor) }),
        ServiceRequest.countDocuments({ ...NOT_DELETED, ...this.vendorViewFilter(VENDOR_REQUEST_VIEW.IN_PROGRESS, vendor) }),
        ServiceRequest.countDocuments({ ...NOT_DELETED, ...this.vendorViewFilter(VENDOR_REQUEST_VIEW.COMPLETED, vendor) }),
        ServiceRequest.find({ ...NOT_DELETED, vendorId, status: { $in: [S.ACCEPTED, S.IN_PROGRESS] } })
          .sort({ updatedAt: -1 })
          .limit(5)
          .populate(POPULATE),
      ]);

    return {
      todayRequests: newToday + mineToday,
      pendingRequests: newCount,
      acceptedRequests: accepted,
      inProgressRequests: inProgress,
      completedRequests: completed,
      averageRating: vendor.averageRating,
      totalReviews: vendor.totalReviews,
      availability: vendor.availability,
      approvalStatus: vendor.approvalStatus,
      activeJobs: activeJobs.map((r) => this.mapRequest(r, user, { vendor })),
    };
  }

  async getVendorReport(vendorId, period) {
    const vendor = await vendorService.getVendorDocument(vendorId);
    const since = periodStart(period);
    // eslint-disable-next-line global-require
    const reviewService = require('./review');

    const [accepted, completed, rejected, cancelled, periodRating] = await Promise.all([
      ServiceRequest.countDocuments({ ...NOT_DELETED, vendorId, acceptedAt: { $gte: since } }),
      ServiceRequest.countDocuments({ ...NOT_DELETED, vendorId, completedAt: { $gte: since } }),
      ServiceRequest.countDocuments({
        ...NOT_DELETED,
        declines: { $elemMatch: { vendorId: vendor._id, at: { $gte: since } } },
      }),
      ServiceRequest.countDocuments({
        ...NOT_DELETED,
        vendorId,
        status: S.CANCELLED,
        cancelledAt: { $gte: since },
      }),
      reviewService.getAverageSince(vendorId, since),
    ]);

    return {
      period,
      since,
      totalRequests: accepted + rejected,
      acceptedRequests: accepted,
      completedRequests: completed,
      rejectedRequests: rejected,
      cancelledRequests: cancelled,
      averageRating: vendor.averageRating,
      totalReviews: vendor.totalReviews,
      periodAverageRating: periodRating.averageRating,
      periodReviews: periodRating.totalReviews,
    };
  }
}

module.exports = new ServiceRequestService();
