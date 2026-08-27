const TeamMember = require('../models/team');
const ApiError = require('../utils/ApiError');

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
    const member = await TeamMember.create({
      ...payload,
      vendorId,
    });
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
    const updated = await TeamMember.findByIdAndUpdate(id, payload, { new: true });
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
