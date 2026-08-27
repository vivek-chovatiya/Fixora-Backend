const getPagination = (body = {}) => {
  const page = Math.max(1, parseInt(body.page) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(body.limit) || 20));
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

const getPaginationMetadata = (total, page, limit) => {
  const pages = Math.ceil(total / limit);
  return {
    total,
    page,
    limit,
    pages,
    hasNextPage: page < pages,
    hasPrevPage: page > 1,
  };
};

module.exports = {
  getPagination,
  getPaginationMetadata,
};
