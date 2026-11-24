/** Forwards async controller errors to the global error handler. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Wraps every method of a controller instance. */
const wrapController = (controller) =>
  Object.getOwnPropertyNames(Object.getPrototypeOf(controller))
    .filter((key) => key !== 'constructor' && typeof controller[key] === 'function')
    .reduce((acc, key) => {
      acc[key] = asyncHandler(controller[key].bind(controller));
      return acc;
    }, {});

module.exports = { asyncHandler, wrapController };
