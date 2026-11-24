const ApiResponse = require('../utils/ApiResponse');
const { wrapController } = require('../utils/asyncHandler');
const {
  PRIORITIES,
  PRIORITY_LABEL,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABEL,
  REQUEST_STATUSES,
  REQUEST_STATUS_LABEL,
  REPORT_PERIODS,
} = require('../constants');

const toOptions = (values, labels) => values.map((value) => ({ value, label: labels[value] || value }));

/** Backend-owned enumerations the app renders as choices (App PROJECT_BIBLE §15, §37). */
class MetaController {
  async get(req, res) {
    return ApiResponse.success(res, 'Configuration retrieved successfully.', {
      priorities: toOptions(PRIORITIES, PRIORITY_LABEL),
      paymentMethods: toOptions(PAYMENT_METHODS, PAYMENT_METHOD_LABEL),
      paymentStatuses: toOptions(PAYMENT_STATUSES, PAYMENT_STATUS_LABEL),
      requestStatuses: toOptions(REQUEST_STATUSES, REQUEST_STATUS_LABEL),
      reportPeriods: REPORT_PERIODS,
    });
  }
}

module.exports = wrapController(new MetaController());
