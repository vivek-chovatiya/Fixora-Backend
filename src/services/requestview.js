const mongoose = require('mongoose');
const { indiaWallClock } = require('../utils/indiaTime');

// Who may see a service request, and what each viewer sees of it (requests contract §2–§3;
// PROJECT_BIBLE.md sections 31–32, amended 21/10/2026; Phase 4B §2–§5).
//
//   ADMIN     everything (secrets are stripped by the models' toJSON).
//   CUSTOMER  their own requests; the vendor reduced to the public-facing few fields; the payment
//             record without the method id, the vendor's completion notes or any time.
//   VENDOR    requests assigned to them, and open broadcast ones they have not declined.
//             Until they HOLD the work (ACCEPTED, ASSIGNED, IN_PROGRESS, COMPLETED with
//             vendorId = them): no customer name/phone/email/photo, the address reduced to the
//             area, and nothing of the work itself (no team member, completion photos or payment)
//             — only the request's own photos, which describe the job (§32 lists Images).
//             Once they hold it: the customer's { id, firstName, lastName, phone }, the full
//             address and the whole payment record. Never the customer's email.
//
// ⚠️ Every request response goes through `presentRequest`; never return a populated request
// another way. Keys are not renamed (existing clients read them); withheld values become the
// plain id, null, or the area text. The payment record's own fields (currency, method label,
// completion notes, its times) appear only inside `payment`, shaped per role below — never add
// them to the top level, where every role would get them.

const HELD_STATUSES = Object.freeze(['ACCEPTED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED']);

const idOf = (ref) => {
  if (!ref) return null;
  return ref instanceof mongoose.Document || ref._id ? ref._id : ref;
};

const sameId = (a, b) => {
  const left = idOf(a);
  const right = idOf(b);
  return left != null && right != null && String(left) === String(right);
};

const isPopulated = (ref) => ref instanceof mongoose.Document;

const declinedBy = (request, vendorId) =>
  (request.declinedBy || []).some((declined) => sameId(declined, vendorId));

const isHeldBy = (request, vendorId) =>
  sameId(request.vendorId, vendorId) && HELD_STATUSES.includes(request.status);

// An open broadcast reaches only vendors who offer its category (contract §2, bible §31). The
// viewer carries `categoryIds` when the caller loaded them; without them nothing open is shown.
const offersCategory = (viewer, request) =>
  (viewer.categoryIds || []).some((categoryId) => sameId(categoryId, request.categoryId));

const isOpenFor = (request, viewer) =>
  !idOf(request.vendorId) &&
  request.status === 'PENDING' &&
  !declinedBy(request, viewer.id) &&
  offersCategory(viewer, request);

// Amended 17/11/2026: a vendor may also read a broadcast they declined (read-only, not-held shape)
// so the app's Rejected tab can open it.
const vendorCanSee = (request, viewer) =>
  sameId(request.vendorId, viewer.id) ||
  isOpenFor(request, viewer) ||
  declinedBy(request, viewer.id);

const canSee = (request, viewer) => {
  if (viewer.role === 'ADMIN') return true;
  if (viewer.role === 'CUSTOMER') return sameId(request.customerId, viewer.id);
  if (viewer.role === 'VENDOR') return vendorCanSee(request, viewer);
  return false;
};

// §3: the vendor as a customer (or another vendor) sees them.
const vendorAsSeenByOthers = (vendor) => ({
  _id: vendor._id,
  id: String(vendor._id),
  businessName: vendor.businessName,
  ownerName: vendor.ownerName,
  profileImage: vendor.profileImage,
  averageRating: vendor.averageRating,
  totalReviews: vendor.totalReviews,
});

// §3: the customer as the vendor holding the work sees them. Never the email.
const customerAsSeenByHolder = (customer) => ({
  _id: customer._id,
  id: String(customer._id),
  firstName: customer.firstName,
  lastName: customer.lastName,
  phone: customer.phone,
});

const plainDetails = (details) => {
  if (!details) return null;
  const plain = typeof details.toObject === 'function' ? details.toObject() : { ...details };
  delete plain._id;
  return plain;
};

const areaOf = (request) => {
  const details = request.serviceAddressDetails || {};
  const address = isPopulated(request.addressId) ? request.addressId : null;
  return request.serviceArea || details.area || details.city || (address && address.city) || '';
};

// A web view's `scheduledAt` as the app's preferred date and time, in India time; midnight means
// "no time given" (Phase 4B §3). Used when such a request is created and to read one stored
// before 4B.
const preferredFromScheduledAt = (scheduledAt) => {
  if (!scheduledAt) return { preferredDate: null, preferredTime: null };
  const { date, time } = indiaWallClock(scheduledAt);
  return { preferredDate: date, preferredTime: time === '00:00' ? null : time };
};

// A 4B request stores the pair, and its scheduledAt is null whenever both are; so both null with
// a scheduledAt can only be a request stored before 4B, answered derived (never written back).
const preferredOf = (request) => {
  if (request.preferredDate || request.preferredTime || !request.scheduledAt) {
    return {
      preferredDate: request.preferredDate || null,
      preferredTime: request.preferredTime || null,
    };
  }
  return preferredFromScheduledAt(request.scheduledAt);
};

// A record exists once the vendor completed with an amount (`paymentRecordedAt`), or on an older
// completed request already marked PAID. A method is shown only when one was recorded with it.
const hasPaymentRecord = (request) =>
  request.status === 'COMPLETED' &&
  (Boolean(request.paymentRecordedAt) || request.paymentStatus === 'PAID');

const paidWithMethod = (request) =>
  request.paymentStatus === 'PAID' && Boolean(request.paymentMethodLabel);

// The vendor holding the work, and admins (Phase 4B §4). Keys that do not apply are omitted.
const paymentForHolder = (request) => {
  if (!hasPaymentRecord(request)) return null;
  return {
    finalAmount: request.amount,
    currency: request.currency || 'INR',
    paymentStatus: request.paymentStatus,
    ...(paidWithMethod(request)
      ? { paymentMethodId: request.paymentMode, paymentMethodLabel: request.paymentMethodLabel }
      : {}),
    ...(request.completionNotes ? { completionNotes: request.completionNotes } : {}),
    recordedAt: request.paymentRecordedAt || null,
    ...(request.paymentStatus === 'PAID' && request.paidAt ? { paidAt: request.paidAt } : {}),
  };
};

// The customer: what they owe or paid and how, never the vendor's notes, the method id or times.
const paymentForCustomer = (request) => {
  if (!hasPaymentRecord(request)) return null;
  return {
    finalAmount: request.amount,
    currency: request.currency || 'INR',
    paymentStatus: request.paymentStatus,
    ...(paidWithMethod(request) ? { paymentMethodLabel: request.paymentMethodLabel } : {}),
  };
};

// When this vendor turned the request down: a directed reject's stored time, or their own entry
// in `declines` for a broadcast (null for a decline from before 4B). Never another vendor's.
const rejectedAtFor = (request, vendorId) => {
  if (declinedBy(request, vendorId)) {
    const own = (request.declines || []).find((entry) => sameId(entry.vendorId, vendorId));
    return own ? own.at : null;
  }
  return sameId(request.vendorId, vendorId) ? request.rejectedAt || null : null;
};

const baseView = (request, timeline) => ({
  id: request._id,
  requestNumber: request.requestNumber,
  customerId: request.customerId,
  vendorId: request.vendorId,
  assignedTeamMemberId: request.assignedTeamMemberId,
  categoryId: request.categoryId,
  subCategoryId: request.subCategoryId,
  addressId: request.addressId,
  serviceAddress: request.serviceAddress,
  serviceAddressDetails: plainDetails(request.serviceAddressDetails),
  serviceArea: areaOf(request),
  description: request.description,
  images: request.images || [],
  completionImages: request.completionImages || [],
  priority: request.priority,
  status: request.status,
  paymentStatus: request.paymentStatus,
  paymentMode: request.paymentMode,
  amount: request.amount,
  // Filled per role in presentRequest; nobody gets it by default.
  payment: null,
  ...preferredOf(request),
  scheduledAt: request.scheduledAt,
  completedAt: request.completedAt,
  rejectedAt: request.rejectedAt || null,
  cancelledAt: request.cancelledAt || null,
  notes: request.notes,
  timeline,
  createdAt: request.createdAt,
  updatedAt: request.updatedAt,
});

const presentRequest = (request, viewer, timeline = []) => {
  if (!request) return null;
  const view = baseView(request, timeline);

  if (viewer.role === 'ADMIN') {
    view.payment = paymentForHolder(request);
    view.declinedBy = request.declinedBy || [];
    view.declines = (request.declines || []).map((entry) => ({
      vendorId: entry.vendorId,
      at: entry.at,
    }));
    return view;
  }

  if (isPopulated(request.vendorId)) {
    view.vendorId = vendorAsSeenByOthers(request.vendorId);
  }

  if (viewer.role === 'CUSTOMER') {
    view.payment = paymentForCustomer(request);
  }

  if (viewer.role === 'VENDOR') {
    view.rejectedAt = rejectedAtFor(request, viewer.id);
    // Whether this vendor declined it (lead decision 17/11/2026: `declinedByMe`; `declined` is the
    // same value, kept for clients built earlier today). The `declinedBy` array itself is never
    // sent to vendors or customers: it would reveal other vendors' ids.
    view.declinedByMe = declinedBy(request, viewer.id);
    view.declined = view.declinedByMe;
    // A broadcast this vendor declined may since have gone to a competitor; who won is not theirs
    // to know.
    if (idOf(request.vendorId) && !sameId(request.vendorId, viewer.id)) {
      view.vendorId = null;
    }

    if (isHeldBy(request, viewer.id)) {
      view.payment = paymentForHolder(request);
      if (isPopulated(request.customerId)) {
        view.customerId = customerAsSeenByHolder(request.customerId);
      }
    } else {
      const area = areaOf(request);
      const details = view.serviceAddressDetails || {};
      view.customerId = idOf(request.customerId);
      view.addressId = null;
      // The work itself — who does it, what it cost, how it was paid, how it looked when done —
      // belongs to whoever holds it (review fix 17/11/2026).
      view.assignedTeamMemberId = null;
      view.amount = null;
      view.paymentStatus = null;
      view.paymentMode = null;
      view.payment = null;
      view.completionImages = [];
      view.serviceAddress = area;
      view.serviceAddressDetails = {
        ...(details.area ? { area: details.area } : {}),
        ...(details.city ? { city: details.city } : {}),
      };
      // Who did what, and their notes, belong to the people involved: a vendor who does not hold
      // the work sees only what happened and when.
      view.timeline = (timeline || []).map((entry) => ({
        _id: entry._id,
        status: entry.status,
        userRole: entry.userRole,
        timestamp: entry.timestamp,
      }));
    }
  }

  return view;
};

module.exports = {
  HELD_STATUSES,
  idOf,
  sameId,
  declinedBy,
  isHeldBy,
  offersCategory,
  canSee,
  preferredFromScheduledAt,
  presentRequest,
};
