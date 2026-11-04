require('dotenv').config({ path: __dirname + '/../../.env' });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const Category = require('../models/category');
const SubCategory = require('../models/subcategory');
const Customer = require('../models/customer');
const Vendor = require('../models/vendor');
const Admin = require('../models/admin');
const Address = require('../models/address');
const ServiceRequest = require('../models/servicerequest');

const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/fixora';

const seedDatabase = async () => {
  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB for seeding...');

    // Clear existing data
    await Category.deleteMany({});
    await SubCategory.deleteMany({});
    await Customer.deleteMany({});
    await Vendor.deleteMany({});
    await Admin.deleteMany({});
    await Address.deleteMany({});
    await ServiceRequest.deleteMany({});

    const hashedPassword = await bcrypt.hash('Password123!', 10);

    // 1. Create Categories
    const categoriesData = [
      { name: 'Electrical', slug: 'electrical', icon: 'flash', description: 'Wiring, fixtures, breaker repairs & installation', sortOrder: 1 },
      { name: 'Plumbing', slug: 'plumbing', icon: 'pipe-leak', description: 'Leak fixes, pipe fittings, tap repair & bath setup', sortOrder: 2 },
      { name: 'AC & Appliance', slug: 'ac-appliance', icon: 'air-conditioner', description: 'AC servicing, gas refill, fridge & washer repair', sortOrder: 3 },
      { name: 'Carpentry', slug: 'carpentry', icon: 'hammer', description: 'Furniture repair, door locks, custom woodwork', sortOrder: 4 },
      { name: 'Cleaning & Wash', slug: 'cleaning', icon: 'broom', description: 'Deep home cleaning, sofa & carpet shampoo', sortOrder: 5 },
      { name: 'Painting', slug: 'painting', icon: 'format-paint', description: 'Interior, exterior, damp treatment & touch-ups', sortOrder: 6 },
    ];

    const createdCategories = await Category.insertMany(categoriesData);
    console.log(`Created ${createdCategories.length} Categories.`);

    // 2. Create SubCategories
    const subCategoriesData = [
      { categoryId: createdCategories[0]._id, name: 'Fan & Light Installation', slug: 'fan-light', price: 299 },
      { categoryId: createdCategories[0]._id, name: 'Switch & Socket Repair', slug: 'switch-socket', price: 199 },
      { categoryId: createdCategories[0]._id, name: 'Full House Wiring Check', slug: 'full-wiring', price: 999 },
      { categoryId: createdCategories[1]._id, name: 'Tap & Sink Leak Repair', slug: 'tap-leak', price: 249 },
      { categoryId: createdCategories[1]._id, name: 'Toilet & Flush Fitting', slug: 'toilet-fitting', price: 499 },
      { categoryId: createdCategories[2]._id, name: 'AC Deep Service', slug: 'ac-service', price: 699 },
      { categoryId: createdCategories[2]._id, name: 'AC Gas Charging', slug: 'ac-gas', price: 1499 },
      { categoryId: createdCategories[3]._id, name: 'Door Lock Repair', slug: 'lock-repair', price: 349 },
      { categoryId: createdCategories[4]._id, name: 'Full Home Deep Clean', slug: 'deep-clean', price: 1999 },
      { categoryId: createdCategories[5]._id, name: '1 Room Wall Painting', slug: 'room-paint', price: 2499 },
    ];

    const createdSubCategories = await SubCategory.insertMany(subCategoriesData);
    console.log(`Created ${createdSubCategories.length} SubCategories.`);

    // 3. Create Admin
    const admin = await Admin.create({
      name: 'System Admin',
      email: 'admin@fixora.com',
      password: hashedPassword,
      phone: '+18005550199',
      role: 'ADMIN',
    });
    console.log('Created Admin:', admin.email);

    // 4. Create Demo Customer
    const customer = await Customer.create({
      firstName: 'Alex',
      lastName: 'Morgan',
      email: 'customer@fixora.com',
      phone: '+18005550100',
      password: hashedPassword,
      isVerified: true,
    });
    console.log('Created Demo Customer:', customer.email);

    // 5. Create Customer Address
    const address = await Address.create({
      customerId: customer._id,
      title: 'Home',
      addressLine1: '742 Evergreen Terrace',
      city: 'Springfield',
      state: 'IL',
      pincode: '62704',
      isDefault: true,
    });
    customer.defaultAddress = address._id;
    await customer.save();

    // 6. Create Demo Vendors
    const vendor1 = await Vendor.create({
      businessName: 'SparkFix Electricals',
      ownerName: 'David Miller',
      email: 'vendor@fixora.com',
      phone: '+18005550201',
      password: hashedPassword,
      categoryIds: [createdCategories[0]._id, createdCategories[2]._id],
      address: '102 Tech Park Avenue, Springfield',
      description: 'Certified Master Electrician with 8+ years experience in residential & commercial wiring.',
      averageRating: 4.9,
      totalReviews: 42,
      approvalStatus: 'APPROVED',
      availability: true,
    });

    const vendor2 = await Vendor.create({
      businessName: 'AquaFlow Plumbing Solutions',
      ownerName: 'Robert Chen',
      email: 'plumber@fixora.com',
      phone: '+18005550202',
      password: hashedPassword,
      categoryIds: [createdCategories[1]._id],
      address: '45 Riverbed Lane, Springfield',
      description: 'Fast response emergency plumbing service for residential leakages and bathroom fittings.',
      averageRating: 4.8,
      totalReviews: 29,
      approvalStatus: 'APPROVED',
      availability: true,
    });

    console.log('Created Demo Vendors:', vendor1.email, vendor2.email);

    // 7. Create Demo Service Requests
    const req1 = await ServiceRequest.create({
      requestNumber: 'REQ-' + Math.floor(100000 + Math.random() * 900000),
      customerId: customer._id,
      vendorId: vendor1._id,
      categoryId: createdCategories[0]._id,
      subCategoryId: createdSubCategories[0]._id,
      addressId: address._id,
      serviceAddress: '742 Evergreen Terrace, Springfield',
      description: 'Living room ceiling fan is making clicking noise and running slow.',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      amount: 499,
      scheduledAt: new Date(Date.now() + 86400000),
    });

    const req2 = await ServiceRequest.create({
      requestNumber: 'REQ-' + Math.floor(100000 + Math.random() * 900000),
      customerId: customer._id,
      vendorId: null, // Broadcast open request
      categoryId: createdCategories[1]._id,
      subCategoryId: createdSubCategories[3]._id,
      addressId: address._id,
      serviceAddress: '742 Evergreen Terrace, Springfield',
      description: 'Kitchen sink tap is dripping constantly. Need urgent repair.',
      priority: 'URGENT',
      status: 'PENDING',
      amount: 299,
      scheduledAt: new Date(Date.now() + 3600000 * 3),
    });

    console.log(`Created ${req1.requestNumber} and ${req2.requestNumber} Service Requests.`);
    console.log('Database Seeding Complete Successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
};

seedDatabase();
