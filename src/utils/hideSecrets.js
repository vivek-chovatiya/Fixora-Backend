// Strips secret fields from every JSON form of a model's documents (requests contract §1).
//
// `select: false` keeps a secret out of ordinary queries; this is the second lock, for the paths
// that load it on purpose (`.select('+password')`) or reach it through a populate. With both in
// place no response, whatever mapper or populate produced it, can carry the field.
//
// ⚠️ Apply it to every model with a password, a code hash or similar. A transform set later with
// `schema.set('toJSON', ...)` would replace this one, so extend the list here instead.
const hideSecrets = (schema, fields) => {
  schema.set('toJSON', {
    transform: (doc, ret) => {
      for (const field of fields) {
        delete ret[field];
      }
      return ret;
    },
  });
};

module.exports = hideSecrets;
