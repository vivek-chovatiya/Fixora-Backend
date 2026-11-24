const vendorService = require('../services/vendor');

/**
 * Blocks vendor operations until an admin has approved the account
 * (PROJECT_BIBLE §11.3 — unapproved vendors cannot receive or act on requests).
 */
const requireApprovedVendor = async (req, res, next) => {
  try {
    await vendorService.assertApprovedAndActive(req.user.id);
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = requireApprovedVendor;
