/**
 * Development seed.
 *
 * Resets the configured database and builds realistic data THROUGH the service layer,
 * so timelines, notifications, ratings and dispatch state are exactly what the real
 * flows would produce. Every demo account uses the password below.
 *
 *   npm run seed
 */
const mongoose = require('mongoose');
const config = require('../config');
const logger = require('./logger');
const { hashPassword } = require('./password');
const { APPROVAL_STATUS, PRIORITY, PAYMENT_METHOD, PAYMENT_STATUS, ROLE } = require('../constants');

const Admin = require('../models/admin');
const Category = require('../models/category');
const SubCategory = require('../models/subcategory');
const Customer = require('../models/customer');
const Vendor = require('../models/vendor');
const TeamMember = require('../models/team');
const Address = require('../models/address');
const ServiceRequest = require('../models/servicerequest');
const Timeline = require('../models/timeline');
const Review = require('../models/review');
const Notification = require('../models/notification');

const authService = require('../services/auth');
const addressService = require('../services/address');
const vendorService = require('../services/vendor');
const teamService = require('../services/team');
const requestService = require('../services/servicerequest');
const reviewService = require('../services/review');

const DEMO_PASSWORD = 'Password123!';

const CATALOG = [
  {
    name: 'Electrician', icon: 'flash', description: 'Wiring, switches, fans, lights and MCB repairs',
    subs: [
      ['Fan Repair & Installation', 299, 60],
      ['Switch & Socket Repair', 199, 45],
      ['Light Installation', 249, 45],
      ['MCB & Fuse Repair', 399, 60],
    ],
  },
  {
    name: 'Plumber', icon: 'pipe-wrench', description: 'Leaks, taps, pipes, toilets and water tanks',
    subs: [
      ['Tap & Mixer Repair', 249, 45],
      ['Pipe Leakage', 349, 60],
      ['Toilet & Flush Repair', 449, 60],
      ['Water Tank Cleaning', 799, 120],
    ],
  },
  {
    name: 'Carpenter', icon: 'hammer-wrench', description: 'Furniture repair, door locks and custom woodwork',
    subs: [
      ['Door Lock Repair', 349, 45],
      ['Furniture Repair', 499, 90],
      ['Curtain Rod Installation', 299, 45],
    ],
  },
  {
    name: 'AC Repair', icon: 'air-conditioner', description: 'AC servicing, gas refill and installation',
    subs: [
      ['AC Service', 599, 60],
      ['AC Gas Refill', 1999, 90],
      ['AC Installation', 1499, 120],
    ],
  },
  {
    name: 'Appliance Repair', icon: 'washing-machine', description: 'Washing machine, fridge, microwave and geyser',
    subs: [
      ['Washing Machine Repair', 499, 60],
      ['Refrigerator Repair', 549, 60],
      ['Geyser Repair', 449, 60],
    ],
  },
  {
    name: 'Cleaning', icon: 'broom', description: 'Home, kitchen, bathroom and sofa deep cleaning',
    subs: [
      ['Full Home Deep Cleaning', 2999, 240],
      ['Bathroom Cleaning', 499, 60],
      ['Sofa Shampooing', 799, 90],
    ],
  },
  {
    name: 'Painting', icon: 'format-paint', description: 'Interior, exterior and touch-up painting',
    subs: [
      ['Single Room Painting', 3499, 480],
      ['Wall Touch-up', 999, 120],
    ],
  },
  {
    name: 'Pest Control', icon: 'bug-outline', description: 'Cockroach, termite and general pest treatment',
    subs: [
      ['Cockroach Treatment', 899, 60],
      ['Termite Treatment', 2499, 120],
    ],
  },
  {
    // Hidden category: proves the app renders only what the backend makes visible.
    name: 'Home Automation', icon: 'home-automation', description: 'Coming soon', isVisible: false,
    subs: [['Smart Switch Setup', 999, 90]],
  },
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const daysAgo = (n, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d;
};

/** Moves a request's lifecycle timestamps into the past so history and reports look real. */
const backdate = async (requestId, days) => {
  const base = daysAgo(days);
  const plus = (mins) => new Date(base.getTime() + mins * 60000);
  const request = await ServiceRequest.findById(requestId);
  const set = { createdAt: base };
  if (request.acceptedAt) set.acceptedAt = plus(20);
  if (request.startedAt) set.startedAt = plus(90);
  if (request.completedAt) set.completedAt = plus(180);
  if (request.cancelledAt) set.cancelledAt = plus(30);
  await ServiceRequest.collection.updateOne({ _id: request._id }, { $set: set });
  const entries = await Timeline.find({ serviceRequestId: requestId }).sort({ timestamp: 1, _id: 1 });
  await Promise.all(
    entries.map((entry, i) =>
      Timeline.collection.updateOne(
        { _id: entry._id },
        { $set: { timestamp: plus(i * 45), createdAt: plus(i * 45) } }
      )
    )
  );
  await Review.collection.updateMany({ serviceRequestId: request._id }, { $set: { createdAt: plus(240) } });
};

const seedCatalog = async () => {
  const categories = {};
  const subs = {};
  for (const [index, entry] of CATALOG.entries()) {
    const category = await Category.create({
      name: entry.name,
      slug: slug(entry.name),
      icon: entry.icon,
      description: entry.description,
      sortOrder: index + 1,
      isVisible: entry.isVisible !== false,
    });
    categories[entry.name] = category;
    for (const [name, price, duration] of entry.subs) {
      subs[name] = await SubCategory.create({
        categoryId: category._id,
        name,
        slug: slug(name),
        estimatedPrice: price,
        estimatedDuration: duration,
      });
    }
  }
  return { categories, subs };
};

const createVendor = async (data, categories, approvalStatus) => {
  const { user } = await authService.registerVendor({
    ...data,
    password: DEMO_PASSWORD,
    categoryIds: data.categories.map((name) => categories[name]._id.toString()),
  });
  if (approvalStatus !== APPROVAL_STATUS.PENDING) {
    await vendorService.updateApprovalStatus(
      user.id,
      approvalStatus,
      approvalStatus === APPROVAL_STATUS.REJECTED ? 'Identity document could not be verified.' : ''
    );
  }
  return Vendor.findById(user.id);
};

const createCustomer = async (data, addresses) => {
  const { user } = await authService.registerCustomer({ ...data, password: DEMO_PASSWORD });
  const created = [];
  for (const address of addresses) {
    created.push(await addressService.createAddress(user.id, address));
  }
  return { customer: await Customer.findById(user.id), addresses: created };
};

const newRequest = (customer, address, category, sub, extra = {}) =>
  requestService.createRequest(customer._id.toString(), {
    categoryId: category._id.toString(),
    subCategoryId: sub._id.toString(),
    addressId: address.id.toString(),
    priority: PRIORITY.MEDIUM,
    ...extra,
  });

const complete = (requestId, vendor, amount, method = PAYMENT_METHOD.CASH, notes = 'Work completed and tested.') =>
  requestService.completeWork(requestId, vendor._id.toString(), {
    finalAmount: amount,
    paymentMethod: method,
    paymentStatus: PAYMENT_STATUS.PAID,
    completionNotes: notes,
  });

const run = async () => {
  await mongoose.connect(config.mongoUri);
  logger.info(`Seeding ${config.mongoUri}`);

  await mongoose.connection.db.dropDatabase();
  await Promise.all(
    [Admin, Category, SubCategory, Customer, Vendor, TeamMember, Address, ServiceRequest, Timeline, Review, Notification].map(
      (Model) => Model.syncIndexes()
    )
  );

  await Admin.create({
    name: 'Fixora Admin',
    email: 'admin@fixora.com',
    phone: '+919000000001',
    password: await hashPassword(DEMO_PASSWORD),
    role: ROLE.ADMIN,
  });

  const { categories, subs } = await seedCatalog();

  // --- Vendors -------------------------------------------------------------
  const sparkfix = await createVendor(
    {
      businessName: 'SparkFix Electricals',
      ownerName: 'Rakesh Patel',
      email: 'vendor@fixora.com',
      phone: '+919825000001',
      address: '12 Shivranjani Cross Road, Satellite, Ahmedabad',
      description: 'Licensed electricians with 10+ years of residential experience. Same-day visits.',
      workingAreas: ['Satellite', 'Vastrapur', 'Bodakdev'],
      workingHours: 'Mon–Sat, 9:00 AM – 8:00 PM',
      categories: ['Electrician', 'AC Repair'],
    },
    categories,
    APPROVAL_STATUS.APPROVED
  );
  const brightvolt = await createVendor(
    {
      businessName: 'BrightVolt Electric Services',
      ownerName: 'Imran Shaikh',
      email: 'brightvolt@fixora.com',
      phone: '+919825000002',
      address: '8 Navrangpura Main Road, Ahmedabad',
      description: 'Electrical repairs, fittings and appliance installation.',
      workingAreas: ['Navrangpura', 'Satellite', 'Paldi'],
      workingHours: 'All days, 8:00 AM – 9:00 PM',
      categories: ['Electrician', 'Appliance Repair'],
    },
    categories,
    APPROVAL_STATUS.APPROVED
  );
  const aquaflow = await createVendor(
    {
      businessName: 'AquaFlow Plumbing',
      ownerName: 'Suresh Mehta',
      email: 'plumber@fixora.com',
      phone: '+919825000003',
      address: '44 CG Road, Ahmedabad',
      description: 'Fast plumbing fixes, leak detection and bathroom fittings.',
      workingAreas: ['CG Road', 'Ellisbridge', 'Satellite'],
      workingHours: 'Mon–Sun, 8:00 AM – 8:00 PM',
      categories: ['Plumber', 'Carpenter'],
    },
    categories,
    APPROVAL_STATUS.APPROVED
  );
  await createVendor(
    {
      businessName: 'ShineHome Cleaning',
      ownerName: 'Neha Desai',
      email: 'cleaning@fixora.com',
      phone: '+919825000004',
      address: '3 Prahlad Nagar, Ahmedabad',
      description: 'Professional deep cleaning and pest control teams.',
      workingAreas: ['Prahlad Nagar', 'Satellite'],
      workingHours: 'Mon–Sat, 9:00 AM – 6:00 PM',
      categories: ['Cleaning', 'Pest Control', 'Painting'],
    },
    categories,
    APPROVAL_STATUS.APPROVED
  );
  await createVendor(
    {
      businessName: 'CoolAir Services',
      ownerName: 'Vikram Joshi',
      email: 'pending@fixora.com',
      phone: '+919825000005',
      address: '19 Maninagar, Ahmedabad',
      description: 'AC and refrigerator specialists.',
      workingAreas: ['Maninagar'],
      categories: ['AC Repair', 'Appliance Repair'],
    },
    categories,
    APPROVAL_STATUS.PENDING
  );
  await createVendor(
    {
      businessName: 'QuickFix Handyman',
      ownerName: 'Arjun Rao',
      email: 'rejected@fixora.com',
      phone: '+919825000006',
      address: '5 Bopal, Ahmedabad',
      categories: ['Carpenter'],
    },
    categories,
    APPROVAL_STATUS.REJECTED
  );

  const ramesh = await teamService.createMember(sparkfix._id, { name: 'Ramesh Kumar', phone: '+919811100001', designation: 'Senior Electrician' });
  await teamService.createMember(sparkfix._id, { name: 'Ajay Thakor', phone: '+919811100002', designation: 'Electrician' });
  await teamService.createMember(sparkfix._id, { name: 'Mahesh Parmar', phone: '+919811100003', designation: 'AC Technician', status: 'ON_LEAVE' });

  // --- Customers -----------------------------------------------------------
  const { customer: priya, addresses: priyaAddresses } = await createCustomer(
    { firstName: 'Priya', lastName: 'Sharma', email: 'customer@fixora.com', phone: '+919876543210' },
    [
      { title: 'Home', addressLine1: 'B-402, Shaligram Heights', addressLine2: 'Near Iskcon Temple, Satellite', city: 'Ahmedabad', state: 'Gujarat', pincode: '380015', isDefault: true },
      { title: 'Office', addressLine1: '7th Floor, Venus Atlantis', addressLine2: 'Prahlad Nagar', city: 'Ahmedabad', state: 'Gujarat', pincode: '380015' },
    ]
  );
  const { customer: rahul, addresses: rahulAddresses } = await createCustomer(
    { firstName: 'Rahul', lastName: 'Verma', email: 'rahul@fixora.com', phone: '+919876543211' },
    [{ title: 'Home', addressLine1: '21, Sundarvan Society', addressLine2: 'Vastrapur', city: 'Ahmedabad', state: 'Gujarat', pincode: '380054', isDefault: true }]
  );
  const { customer: anita, addresses: anitaAddresses } = await createCustomer(
    { firstName: 'Anita', lastName: 'Iyer', email: 'anita@fixora.com', phone: '+919876543212' },
    [{ title: 'Home', addressLine1: '9, Riverfront Residency', addressLine2: 'Paldi', city: 'Ahmedabad', state: 'Gujarat', pincode: '380007' }]
  );

  const S = sparkfix._id.toString();
  const B = brightvolt._id.toString();

  // --- Historic, reviewed work (builds real ratings) -------------------------
  const history = [
    [rahul, rahulAddresses[0], 'Electrician', 'Fan Repair & Installation', sparkfix, 450, 5, 'Very quick and professional. Fan works perfectly now.', 24],
    [anita, anitaAddresses[0], 'Electrician', 'MCB & Fuse Repair', sparkfix, 600, 5, 'Fixed the tripping issue in 30 minutes. Highly recommend.', 18],
    [priya, priyaAddresses[0], 'AC Repair', 'AC Service', sparkfix, 650, 4, 'Good service, arrived a little late.', 12],
    [anita, anitaAddresses[0], 'Electrician', 'Switch & Socket Repair', brightvolt, 250, 4, 'Neat work.', 15],
    [rahul, rahulAddresses[0], 'Plumber', 'Pipe Leakage', aquaflow, 500, 5, 'Found the leak quickly and fixed it properly.', 20],
    [priya, priyaAddresses[0], 'Plumber', 'Tap & Mixer Repair', aquaflow, 300, 3, 'Fixed, but had to come back once.', 9],
  ];
  for (const [customer, address, cat, sub, vendor, amount, rating, comment, days] of history) {
    const r = await newRequest(customer, address, categories[cat], subs[sub], {
      description: `Need help with ${sub.toLowerCase()} at home.`,
    });
    await requestService.acceptRequest(r.id, vendor._id.toString());
    await requestService.startWork(r.id, vendor._id.toString());
    await complete(r.id, vendor, amount, rating % 2 ? PAYMENT_METHOD.UPI : PAYMENT_METHOD.CASH);
    await reviewService.createReview(customer._id.toString(), { serviceRequestId: r.id.toString(), rating, comment });
    await backdate(r.id, days);
  }

  // --- Current, live states -------------------------------------------------
  // 1. Priya: AC directed to SparkFix, in progress with a technician.
  const acJob = await newRequest(priya, priyaAddresses[0], categories['AC Repair'], subs['AC Gas Refill'], {
    vendorId: S,
    priority: PRIORITY.HIGH,
    description: 'Bedroom AC is running but not cooling at all since yesterday.',
    notes: 'Split AC, 1.5 ton, installed 3 years ago.',
    preferredTime: 'Evening (5–8 PM)',
  });
  await requestService.acceptRequest(acJob.id, S);
  await requestService.assignTeamMember(acJob.id, S, ramesh.id.toString());
  await requestService.startWork(acJob.id, S);
  await backdate(acJob.id, 1);

  // 2. Priya: completed by BrightVolt, waiting for her review.
  const awaitingReview = await newRequest(priya, priyaAddresses[1], categories.Electrician, subs['Light Installation'], {
    description: 'Install 4 LED panel lights in the office cabin.',
  });
  await requestService.acceptRequest(awaitingReview.id, B);
  await requestService.startWork(awaitingReview.id, B);
  await complete(awaitingReview.id, brightvolt, 1100, PAYMENT_METHOD.UPI, 'Installed 4 panels, tested all switches.');
  await backdate(awaitingReview.id, 2);

  // 3. Priya: open plumbing request still searching (broadcast lead for AquaFlow).
  await newRequest(priya, priyaAddresses[0], categories.Plumber, subs['Toilet & Flush Repair'], {
    priority: PRIORITY.EMERGENCY,
    description: 'Toilet flush is continuously leaking water and the tank will not stop filling.',
  });

  // 4. Rahul: directed to SparkFix, waiting for SparkFix (directed lead).
  await newRequest(rahul, rahulAddresses[0], categories.Electrician, subs['Fan Repair & Installation'], {
    vendorId: S,
    description: 'Ceiling fan in the living room makes a loud humming noise and runs slowly.',
    notes: 'Please bring a capacitor if possible.',
    preferredTime: 'Morning (9–12)',
  });

  // 5. Anita: open electrician request — SparkFix and BrightVolt both see it (race demo).
  await newRequest(anita, anitaAddresses[0], categories.Electrician, subs['Switch & Socket Repair'], {
    priority: PRIORITY.HIGH,
    description: 'Kitchen socket sparks when the mixer is plugged in. Needs urgent check.',
  });

  // 6. Rahul: accepted by SparkFix, not started yet.
  const accepted = await newRequest(rahul, rahulAddresses[0], categories.Electrician, subs['Light Installation'], {
    description: 'Install a chandelier in the dining area. Wiring point already exists.',
  });
  await requestService.acceptRequest(accepted.id, S);

  // 7. Rahul: cancelled painting request.
  const cancelled = await newRequest(rahul, rahulAddresses[0], categories.Painting, subs['Wall Touch-up'], {
    description: 'Touch-up paint for two walls in the bedroom.',
  });
  await requestService.cancelRequest(cancelled.id, { id: rahul._id.toString(), role: ROLE.CUSTOMER }, 'Plans changed.');
  await backdate(cancelled.id, 5);

  // 8. Anita: SparkFix declined a broadcast lead (shows in SparkFix "Rejected").
  const declined = await newRequest(anita, anitaAddresses[0], categories['AC Repair'], subs['AC Installation'], {
    description: 'Install a new split AC in the master bedroom.',
  });
  await requestService.rejectRequest(declined.id, { id: S, role: ROLE.VENDOR }, 'Fully booked this week.');

  const counts = await Promise.all([
    Category.countDocuments(), SubCategory.countDocuments(), Vendor.countDocuments(),
    Customer.countDocuments(), ServiceRequest.countDocuments(), Review.countDocuments(),
  ]);
  logger.info(`Seed complete: categories=${counts[0]} subcategories=${counts[1]} vendors=${counts[2]} customers=${counts[3]} requests=${counts[4]} reviews=${counts[5]}`);
  logger.info(`All demo accounts use password: ${DEMO_PASSWORD}`);
  await mongoose.disconnect();
};

if (require.main === module) {
  run().catch(async (error) => {
    logger.error(`Seed failed: ${error.message}`, { stack: error.stack });
    await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = { run, DEMO_PASSWORD };
