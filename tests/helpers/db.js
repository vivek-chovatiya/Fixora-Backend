// The test database: dropped and re-indexed once per file, emptied before every test.
// autoIndex is off so Mongoose's background index builds cannot race the drop; every model's
// indexes (the partial unique ones included) are then built explicitly.
const mongoose = require('mongoose');

const databaseName = (uri) => new URL(uri).pathname.replace(/^\//, '');

const connect = async () => {
  const uri = process.env.MONGO_URI;
  if (!databaseName(uri).endsWith('_test')) {
    throw new Error(`Refusing to run tests against database "${databaseName(uri)}".`);
  }

  await mongoose.connect(uri, { autoIndex: false });
  await mongoose.connection.dropDatabase();
  for (const model of Object.values(mongoose.models)) {
    await model.syncIndexes();
  }
};

const clear = async () => {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
};

const disconnect = async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
};

module.exports = {
  connect,
  clear,
  disconnect,
};
