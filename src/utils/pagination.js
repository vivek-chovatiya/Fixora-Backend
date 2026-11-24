const getPagination = (source = {}) => {
  const page = Math.max(1, parseInt(source.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(source.limit, 10) || 20));
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

const getPaginationMetadata = (total, page, limit) => {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
};

module.exports = {
  getPagination,
  getPaginationMetadata,
};
