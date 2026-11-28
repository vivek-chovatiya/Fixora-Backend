const ServiceRequest = require('../models/servicerequest');
const ServiceRequestTimeline = require('../models/timeline');
const Address = require('../models/address');
const Category = require('../models/category');
const SubCategory = require('../models/subcategory');
const TeamMember = require('../models/team');
const Vendor = require('../models/vendor');
const notificationService = require('./notification');
const ApiError = require('../utils/ApiError');
const clock = require('../utils/clock');
const logger = require('../utils/logger');
const { ERROR_CODES } = require('../utils/errorCodes');
const { indiaInstant } = require('../utils/indiaTime');
const { getPagination, getPaginationMetadata } = require('../utils/pagination');
const { PAYMENT_METHODS, paymentMethodById } = require('../config/paymentMethods');
const { resolveImageField } = require('./uploadAttach');
const {
  HELD_STATUSES,
  canSee,
  declinedBy,
  idOf,
  offersCategory,
  preferredFromScheduledAt,
  presentRequest,
  sameId,
} = require('./requestview');

// Service requests to the requests contract (lead, 17/11/2026), the Phase 4B contract
// (24/11/2026) and PROJECT_BIBLE.md sections 16, 20–24 and 31–37: who may see what
// (services/requestview.js), first-accept-wins, per-vendor decline of broadcast requests,
// holder-only start/complete, the offline payment record and its one later "paid", customer cancel
// until accepted, and a create that records only what the customer actually gave.
//
// ⚠️ Every status change is one conditional findOneAndUpdate on the state it starts from. Never
// read-check-then-write: two vendors pressing Accept together must produce exactly one winner,
// and two "Paid" presses exactly one record. Times written here come from utils/clock.js so the
// reports' tests can fix them.

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

const paymentAlreadyRecorded = () =>
  new ApiError(
    409,
    'This payment has already been recorded as paid.',
    null,
    ERROR_CODES.PAYMENT_ALREADY_RECORDED
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

// The words of every notification a request change sends (Phase 4B §8): plain and factual, no
// emoji, nothing beyond what happened. `business` is null when the vendor's name cannot be read.
const theProfessional = (business, { start = false } = {}) =>
  business || (start ? 'Your professional' : 'your professional');

const MESSAGES = Object.freeze({
  createdDirected: {
    title: 'Request received',
    body: ({ service, ref, business }) =>
      `We have received your ${service} request ${ref} and sent it to ${theProfessional(business)}.`,
  },
  createdOpen: {
    title: 'Request received',
    body: ({ service, ref }) =>
      `We have received your ${service} request ${ref}. We will let you know when a professional accepts it.`,
  },
  accepted: {
    title: 'Request accepted',
    body: ({ service, ref, business }) =>
      `${theProfessional(business, { start: true })} accepted your ${service} request ${ref}.`,
  },
  rejected: {
    title: 'Request not accepted',
    body: ({ service, ref, business }) =>
      `${theProfessional(business, { start: true })} did not accept your ${service} request ${ref}.`,
  },
  assigned: {
    title: 'Team member assigned',
    body: ({ service, ref, business }) =>
      `${theProfessional(business, { start: true })} assigned a team member to your ${service} request ${ref}.`,
  },
  started: {
    title: 'Work started',
    body: ({ service, ref, business }) =>
      `${theProfessional(business, { start: true })} started work on your ${service} request ${ref}.`,
  },
  completed: {
    title: 'Work completed',
    body: ({ service, ref, business }) =>
      `${theProfessional(business, { start: true })} marked your ${service} request ${ref} as complete. You can now rate the work.`,
  },
  cancelled: {
    title: 'Request cancelled',
    body: ({ service, ref }) => `The customer cancelled their ${service} request ${ref}.`,
  },
});

// What the words name: the sub-category, else the category; the vendor's business name. A name
// that cannot be read falls back rather than costing the notification.
const describeRequest = async (request) => {
  const nameOf = (query) => query.lean().catch(() => null);
  const [subCategory, category, vendor] = await Promise.all([
    request.subCategoryId
      ? nameOf(SubCategory.findById(idOf(request.subCategoryId)).select('name'))
      : null,
    nameOf(Category.findById(idOf(request.categoryId)).select('name')),
    request.vendorId
      ? nameOf(Vendor.findById(idOf(request.vendorId)).select('businessName'))
      : null,
  ]);
  return {
    ref: request.requestNumber,
    service: (subCategory && subCategory.name) || (category && category.name) || 'service',
    business: (vendor && vendor.businessName) || null,
  };
};

// A notification is a courtesy; failing to save one must not undo the change it describes. It is
// created through NotificationService, the one place that also pushes it (Phase 5 contract §6.2).
const notify = async (request, recipient, message) => {
  try {
    const words = await describeRequest(request);
    await notificationService.createNotification({
      userId: recipient.userId,
      userRole: recipient.userRole,
      title: message.title,
      message: message.body(words),
      type: 'SERVICE_REQUEST',
      referenceId: request._id,
    });
  } catch (error) {
    logger.warn(`notification not saved: ${error.name}`);
  }
};

const toCustomer = (request) => ({ userId: request.customerId, userRole: 'CUSTOMER' });

// §3 (Phase 4B): the preferred date and time as sent, and scheduledAt derived from them for the
// web views; a body with only scheduledAt (a web view) gets the pair derived from it instead.
// "Sent" means the key is there — `null` or "" is a choice of none, not an absence.
const scheduleOf = (payload) => {
  if (payload.preferredDate !== undefined || payload.preferredTime !== undefined) {
    const preferredDate = payload.preferredDate || null;
    const preferredTime = payload.preferredTime || null;
    return {
      preferredDate,
      preferredTime,
      scheduledAt: preferredDate ? indiaInstant(preferredDate, preferredTime || '00:00') : null,
    };
  }
  const scheduledAt = payload.scheduledAt || null;
  return { ...preferredFromScheduledAt(scheduledAt), scheduledAt };
};

// §4 (Phase 4B): the payment record a completion with an amount writes. PAID carries the
// configured method and the time; PENDING ("not paid yet") leaves paymentMode untouched.
const paymentRecordOf = (payload, at) => {
  const method =
    payload.paymentStatus === 'PAID' ? paymentMethodById(payload.paymentMethodId) : null;
  return {
    currency: 'INR',
    paymentStatus: method ? 'PAID' : 'PENDING',
    completionNotes: payload.completionNotes || '',
    paymentRecordedAt: at,
    ...(method ? { paymentMode: method.id, paymentMethodLabel: method.label, paidAt: at } : {}),
  };
};

const addTimeline = (serviceRequestId, status, viewer, note) =>
  ServiceRequestTimeline.create({
    serviceRequestId,
    status,
    updatedBy: viewer.id,
    userRole: viewer.role,
    note,
  });

class ServiceRequestService {
  // A vendor viewer carries their categories and whether they are accepting requests: open
  // broadcasts reach only vendors who offer the request's category (requests contract §2), and
  // none reach a vendor whose availability is off (Phase 4B §6).
  async withCategories(viewer) {
    if (viewer.role !== 'VENDOR' || viewer.categoryIds) return viewer;
    const vendor = await Vendor.findOne({ _id: viewer.id, isDeleted: { $ne: true } })
      .select('categoryIds availability')
      .lean();
    return {
      ...viewer,
      categoryIds: vendor ? vendor.categoryIds : [],
      acceptingRequests: Boolean(vendor) && vendor.availability !== false,
    };
  }

  // What a vendor's lists hold, for a viewer from withCategories. `declined: true` is the
  // Rejected tab: the broadcasts they declined. Otherwise their own requests in any status, plus
  // the open broadcasts in their categories they have not declined — none while they are not
  // accepting requests (Phase 4B §6; held and directed work is unaffected).
  // ⚠️ The vendor report's total counts with these same conditions (services/vendorreport.js), so
  // the report and the lists cannot disagree; change one and you change both.
  vendorListCondition(viewer, { declined = false } = {}) {
    if (declined) return { declinedBy: viewer.id };
    const own = { vendorId: viewer.id };
    if (viewer.acceptingRequests === false) return own;
    return {
      $or: [
        own,
        {
          vendorId: null,
          status: 'PENDING',
          declinedBy: { $ne: viewer.id },
          categoryId: { $in: viewer.categoryIds || [] },
        },
      ],
    };
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
      // A vendor who is not accepting requests cannot be chosen (Phase 4B §6).
      const vendor = await Vendor.findOne({
        _id: payload.vendorId,
        status: 'ACTIVE',
        approvalStatus: 'APPROVED',
        availability: { $ne: false },
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

    // §2 (Phase 4B): only the customer's own `request` uploads, stored as their paths. The photos
    // describe the job, so vendors see them before they accept (bible §32); the upload already
    // dropped any location the camera wrote into them.
    const images = await resolveImageField({
      value: payload.images,
      field: 'images',
      type: 'request',
      ownerId: customerId,
      stored: [],
    });

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
      images,
      priority: payload.priority,
      ...scheduleOf(payload),
      notes: payload.notes || '',
      status: 'PENDING',
    });

    await addTimeline(request._id, 'PENDING', viewer, 'Service request submitted by customer.');

    await notify(
      request,
      toCustomer(request),
      vendorId ? MESSAGES.createdDirected : MESSAGES.createdOpen
    );

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
    await notify(accepted, toCustomer(accepted), MESSAGES.accepted);

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
        { $set: { status: 'REJECTED', rejectedAt: clock.now() } },
        { new: true }
      );
      if (!rejected) throw notPending();

      await addTimeline(rejected._id, 'REJECTED', viewer, note || 'Service request rejected.');
      await notify(rejected, toCustomer(rejected), MESSAGES.rejected);
      return this.view(id, viewer);
    }

    if (!request.vendorId) {
      // Only a vendor the broadcast reaches may decline it (review fix 17/11/2026): outside their
      // categories it does not exist for them, and it takes an ACTIVE + APPROVED vendor.
      if (!offersCategory(await this.withCategories(viewer), request)) throw notFound();
      await this.assertCanTakeWork(vendorId, request);

      // No timeline entry or customer notification: the request itself has not changed. The
      // decline's time goes in with it, in the same update, so a report counts it exactly once.
      const declined = await ServiceRequest.findOneAndUpdate(
        { _id: request._id, vendorId: null, status: 'PENDING', declinedBy: { $ne: vendorId } },
        {
          $addToSet: { declinedBy: vendorId },
          $push: { declines: { vendorId, at: clock.now() } },
        },
        { new: true }
      );
      if (!declined) {
        // A second tap that lost to the first has declined it all the same.
        if (declinedBy(await this.findRequest(id), vendorId)) {
          return this.view(id, viewer, { checkAccess: false });
        }
        throw notPending();
      }
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
    await notify(assigned, toCustomer(assigned), MESSAGES.assigned);

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
    await notify(started, toCustomer(started), MESSAGES.started);

    return this.view(id, viewer);
  }

  // §4 (Phase 4B): an amount above zero writes the payment record in the same update that
  // completes the work; no amount (or 0, with no payment field — the validation's rule) completes
  // with no record, as before.
  async completeWork(id, viewer, payload = {}) {
    const request = await this.findRequest(id);
    if (!canSee(request, await this.withCategories(viewer))) throw notFound();

    const at = clock.now();
    const updateData = { status: 'COMPLETED', completedAt: at };
    if (payload.amount !== undefined) updateData.amount = payload.amount;
    if (payload.completionImages) updateData.completionImages = payload.completionImages;
    if (payload.amount > 0) Object.assign(updateData, paymentRecordOf(payload, at));

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
    await notify(completed, toCustomer(completed), MESSAGES.completed);

    return this.view(id, viewer);
  }

  // "Not paid yet" → "Paid", once (bible §37 amended 21/10/2026; Phase 4B §4). Only the status,
  // the method and the time change; no timeline entry and no notification, as the request's
  // status did not change. Two presses together: the condition lets exactly one through.
  async recordPayment(id, viewer, payload) {
    const method = paymentMethodById(payload.paymentMethodId);
    const paid = await ServiceRequest.findOneAndUpdate(
      {
        _id: id,
        isDeleted: { $ne: true },
        vendorId: viewer.id,
        status: 'COMPLETED',
        paymentRecordedAt: { $ne: null },
        paymentStatus: 'PENDING',
      },
      {
        $set: {
          paymentStatus: 'PAID',
          paymentMode: method.id,
          paymentMethodLabel: method.label,
          paidAt: clock.now(),
        },
      },
      { new: true }
    );

    if (!paid) {
      const current = await ServiceRequest.findOne({ _id: id, isDeleted: { $ne: true } });
      if (!current || !sameId(current.vendorId, viewer.id)) throw notFound();
      // A paid record is final, whoever's press got there first.
      if (current.status === 'COMPLETED' && current.paymentStatus === 'PAID') {
        throw paymentAlreadyRecorded();
      }
      throw invalidTransition();
    }

    return this.view(id, viewer);
  }

  // Bible §37: the methods follow backend configuration (config/paymentMethods.js), in order.
  listPaymentMethods() {
    return PAYMENT_METHODS.map(({ id, label }) => ({ id, label }));
  }

  // §5 (owner decision 3D-11): a customer may cancel until a professional accepts.
  async cancelRequest(id, viewer, reason = '') {
    const request = await this.findRequest(id);
    if (!sameId(request.customerId, viewer.id)) throw notFound();
    if (request.status === 'CANCELLED') return this.view(id, viewer);

    const cancelled = await ServiceRequest.findOneAndUpdate(
      { _id: request._id, customerId: viewer.id, status: 'PENDING' },
      { $set: { status: 'CANCELLED', cancelledAt: clock.now() } },
      { new: true }
    );
    if (!cancelled) {
      const current = await this.findRequest(id);
      if (current.status === 'CANCELLED') return this.view(id, viewer);
      throw notCancellable();
    }

    await addTimeline(cancelled._id, 'CANCELLED', viewer, reason || 'Cancelled by customer.');
    if (cancelled.vendorId) {
      await notify(
        cancelled,
        { userId: cancelled.vendorId, userRole: 'VENDOR' },
        MESSAGES.cancelled
      );
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
      conditions.push(
        this.vendorListCondition(await this.withCategories(viewer), {
          declined: body.declined === true,
        })
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
