const TeamMember = require('../models/team');
const ApiError = require('../utils/ApiError');
const { TEAM_MEMBER_STATUS, ERROR_CODE } = require('../constants');

const teamMapper = (member) => {
  if (!member) return null;
  return {
    id: member._id,
    vendorId: member.vendorId,
    name: member.name,
    phone: member.phone,
    designation: member.designation,
    profileImage: member.profileImage,
    status: member.status,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  };
};

const EDITABLE_FIELDS = ['name', 'phone', 'designation', 'profileImage', 'status'];

const pick = (source, keys) =>
  keys.reduce((acc, key) => {
    if (source[key] !== undefined) acc[key] = source[key];
    return acc;
  }, {});

const duplicatePhoneError = () =>
  new ApiError(
    409,
    'A team member with this phone number already exists.',
    [{ field: 'phone', message: 'A team member with this phone number already exists.' }],
    ERROR_CODE.DUPLICATE_RECORD
  );

class TeamService {
  /** One phone number belongs to one person within a vendor's team. */
  async assertPhoneAvailable(vendorId, phone, excludeId = null) {
    if (!phone) return;
    const filter = { vendorId, phone, isDeleted: { $ne: true } };
    if (excludeId) filter._id = { $ne: excludeId };
    if (await TeamMember.exists(filter)) throw duplicatePhoneError();
  }

  async createMember(vendorId, payload) {
    await this.assertPhoneAvailable(vendorId, payload.phone);
    const member = await TeamMember.create({ ...pick(payload, EDITABLE_FIELDS), vendorId });
    return teamMapper(member);
  }

  async getVendorTeam(vendorId) {
    const members = await TeamMember.find({ vendorId, isDeleted: { $ne: true } }).sort({
      status: 1,
      createdAt: -1,
    });
    return members.map(teamMapper);
  }

  async getOwnedMemberDocument(id, vendorId) {
    const member = await TeamMember.findOne({ _id: id, vendorId, isDeleted: { $ne: true } });
    if (!member) {
      throw new ApiError(404, 'Team member not found.');
    }
    return member;
  }

  async getOwnedActiveMember(id, vendorId) {
    const member = await this.getOwnedMemberDocument(id, vendorId);
    if (member.status !== TEAM_MEMBER_STATUS.ACTIVE) {
      throw new ApiError(400, 'Only active team members can be assigned.');
    }
    return member;
  }

  async getMemberById(id, vendorId) {
    return teamMapper(await this.getOwnedMemberDocument(id, vendorId));
  }

  async updateMember(id, vendorId, payload) {
    await this.getOwnedMemberDocument(id, vendorId);
    await this.assertPhoneAvailable(vendorId, payload.phone, id);
    const updated = await TeamMember.findByIdAndUpdate(id, pick(payload, EDITABLE_FIELDS), {
      new: true,
    });
    return teamMapper(updated);
  }

  async deleteMember(id, vendorId) {
    await this.getOwnedMemberDocument(id, vendorId);
    await TeamMember.findByIdAndUpdate(id, { isDeleted: true, deletedAt: new Date() });
    return true;
  }
}

module.exports = new TeamService();
module.exports.teamMapper = teamMapper;
