const TeamMember = require('../models/team');
const ApiError = require('../utils/ApiError');
const { resolveImageField } = require('./uploadAttach');

// A member's photo is one of their vendor's own `team` uploads, or the one already stored on that
// member (Phase 4B contract §2); null or '' clears it.
const memberPhoto = (vendorId, value, stored) =>
  resolveImageField({ value, field: 'profileImage', type: 'team', ownerId: vendorId, stored });

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

class TeamService {
  async createMember(vendorId, payload) {
    const changes = { ...payload, phone: payload.phone || '', vendorId };
    if (payload.profileImage !== undefined) {
      changes.profileImage = await memberPhoto(vendorId, payload.profileImage, null);
    }
    const member = await TeamMember.create(changes);
    return teamMapper(member);
  }

  async getVendorTeam(vendorId) {
    const members = await TeamMember.find({ vendorId, isDeleted: { $ne: true } }).sort({
      createdAt: -1,
    });
    return members.map(teamMapper);
  }

  async getMemberById(id, vendorId) {
    const member = await TeamMember.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!member || member.vendorId.toString() !== vendorId.toString()) {
      throw new ApiError(404, 'Team member not found.');
    }
    return teamMapper(member);
  }

  async updateMember(id, vendorId, payload) {
    const member = await TeamMember.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!member || member.vendorId.toString() !== vendorId.toString()) {
      throw new ApiError(404, 'Team member not found.');
    }
    // A cleared phone is stored as '' whether the client sent null or '' (requests contract §7).
    const changes = payload.phone === null ? { ...payload, phone: '' } : { ...payload };
    if (payload.profileImage !== undefined) {
      changes.profileImage = await memberPhoto(
        member.vendorId,
        payload.profileImage,
        member.profileImage
      );
    }
    const updated = await TeamMember.findByIdAndUpdate(id, changes, { new: true });
    return teamMapper(updated);
  }

  async deleteMember(id, vendorId) {
    const member = await TeamMember.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!member || member.vendorId.toString() !== vendorId.toString()) {
      throw new ApiError(404, 'Team member not found.');
    }
    await TeamMember.findByIdAndUpdate(id, { isDeleted: true, deletedAt: new Date() });
    return true;
  }
}

module.exports = new TeamService();
