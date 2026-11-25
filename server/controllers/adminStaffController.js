const { Users } = require('../config/db');
const { hashPassword } = require('../utils/password');
const { logAudit } = require('../utils/auditLogger');
const { ROLES, ROLE_PERMISSIONS } = require('../config/roles');

async function getStaffList(req, res) {
  try {
    const allUsers = Users.find();
    const staffList = allUsers
      .filter(u => u.role && u.role.toUpperCase() !== 'CUSTOMER')
      .map(u => {
        const role = (u.role || '').toUpperCase();
        return {
          id: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          phone: u.phone || '',
          role,
          permissions: u.permissions || ROLE_PERMISSIONS[role] || [],
          status: u.status || 'active',
          lastLogin: u.lastLogin || null,
          createdAt: u.createdAt
        };
      });

    res.json({ success: true, staff: staffList });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error retrieving staff members.' });
  }
}

async function createStaff(req, res) {
  try {
    const { firstName, lastName, email, phone, role, password, permissions } = req.body;

    if (!firstName || !lastName || !email || !password || !role) {
      return res.status(400).json({ success: false, message: 'First name, last name, email, password and role are required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const targetRole = String(role).trim().toUpperCase();

    if (!ROLES[targetRole] || targetRole === 'CUSTOMER') {
      return res.status(400).json({ success: false, message: 'Invalid staff role specified.' });
    }

    // Only an authorized Super Admin can create privileged staff accounts and assign roles
    if (req.user.role !== ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Only an authorized Super Admin can create privileged staff accounts and assign roles.' });
    }

    const existing = Users.findOne({ email: cleanEmail });
    if (existing) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists.' });
    }

    const hashedPassword = await hashPassword(password);
    const assignedPermissions = Array.isArray(permissions) && permissions.length 
      ? permissions 
      : (ROLE_PERMISSIONS[targetRole] || []);

    const newStaff = Users.insert({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: cleanEmail,
      phone: (phone || '').trim(),
      password: hashedPassword,
      role: targetRole,
      permissions: assignedPermissions,
      status: 'active',
      isVerified: true,
      createdBy: req.user.id,
      lastLogin: null
    });

    logAudit({
      actor: req.user,
      action: 'STAFF_CREATED',
      recordId: newStaff.id,
      details: `Created new staff account: ${cleanEmail} (${targetRole})`,
      ip: req.ip
    });

    res.status(201).json({
      success: true,
      message: `Staff account created successfully for ${firstName} ${lastName}.`,
      staff: {
        id: newStaff.id,
        firstName: newStaff.firstName,
        lastName: newStaff.lastName,
        email: newStaff.email,
        phone: newStaff.phone,
        role: newStaff.role,
        permissions: newStaff.permissions,
        status: newStaff.status,
        createdAt: newStaff.createdAt
      }
    });
  } catch (err) {
    console.error('Create staff error:', err);
    res.status(500).json({ success: false, message: 'Server error creating staff account.' });
  }
}

async function updateStaff(req, res) {
  try {
    const { id } = req.params;
    const { firstName, lastName, phone, role, permissions, status } = req.body;

    const targetUser = Users.findById(id);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'Staff user not found.' });
    }

    // Security check: Prevent users from modifying their own role or status
    if (targetUser.id === req.user.id) {
      if ((role && role.toUpperCase() !== targetUser.role.toUpperCase()) || 
          (status && status !== targetUser.status)) {
        return res.status(403).json({ success: false, message: 'Security restriction: You cannot modify your own role or account status.' });
      }
    }

    let targetRole = targetUser.role;
    if (role) {
      const formattedRole = String(role).trim().toUpperCase();
      if (!ROLES[formattedRole] || formattedRole === 'CUSTOMER') {
        return res.status(400).json({ success: false, message: 'Invalid staff role specified.' });
      }

      // Security check: Prevent demoting the last Super Admin
      if (targetUser.role.toUpperCase() === ROLES.SUPER_ADMIN && formattedRole !== ROLES.SUPER_ADMIN) {
        const superAdmins = Users.find({ role: ROLES.SUPER_ADMIN, status: 'active' });
        if (superAdmins.length <= 1) {
          return res.status(403).json({ success: false, message: 'Action blocked: Cannot demote the only remaining active Super Admin.' });
        }
      }

      // Only Super Admin can promote someone to Super Admin
      if (formattedRole === ROLES.SUPER_ADMIN && req.user.role !== ROLES.SUPER_ADMIN) {
        return res.status(403).json({ success: false, message: 'Only a Super Admin can assign the Super Admin role.' });
      }

      targetRole = formattedRole;
    }

    // Security check: Prevent deactivating the last Super Admin
    if (status && status !== 'active' && targetUser.role.toUpperCase() === ROLES.SUPER_ADMIN) {
      const superAdmins = Users.find({ role: ROLES.SUPER_ADMIN, status: 'active' });
      if (superAdmins.length <= 1) {
        return res.status(403).json({ success: false, message: 'Action blocked: Cannot deactivate the only remaining active Super Admin.' });
      }
    }

    const updatePayload = {};
    if (firstName) updatePayload.firstName = firstName.trim();
    if (lastName) updatePayload.lastName = lastName.trim();
    if (phone !== undefined) updatePayload.phone = phone.trim();
    if (targetRole) updatePayload.role = targetRole;
    if (status) updatePayload.status = status;
    if (permissions && Array.isArray(permissions)) updatePayload.permissions = permissions;

    const updated = Users.findByIdAndUpdate(id, updatePayload);

    logAudit({
      actor: req.user,
      action: 'STAFF_UPDATED',
      recordId: id,
      details: `Updated staff ${updated.email}: Role=${updated.role}, Status=${updated.status}`,
      ip: req.ip
    });

    res.json({
      success: true,
      message: 'Staff account updated successfully.',
      staff: {
        id: updated.id,
        firstName: updated.firstName,
        lastName: updated.lastName,
        email: updated.email,
        phone: updated.phone,
        role: updated.role,
        permissions: updated.permissions,
        status: updated.status,
        updatedAt: updated.updatedAt
      }
    });
  } catch (err) {
    console.error('Update staff error:', err);
    res.status(500).json({ success: false, message: 'Server error updating staff account.' });
  }
}

async function deleteStaff(req, res) {
  try {
    const { id } = req.params;
    const targetUser = Users.findById(id);

    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'Staff member not found.' });
    }

    // Security check: User cannot delete themselves
    if (targetUser.id === req.user.id) {
      return res.status(403).json({ success: false, message: 'Security restriction: You cannot delete your own account.' });
    }

    // Security check: Cannot delete the last Super Admin
    if (targetUser.role.toUpperCase() === ROLES.SUPER_ADMIN) {
      const superAdmins = Users.find({ role: ROLES.SUPER_ADMIN });
      if (superAdmins.length <= 1) {
        return res.status(403).json({ success: false, message: 'Action blocked: Cannot delete the only remaining Super Admin.' });
      }
    }

    Users.findByIdAndDelete(id);

    logAudit({
      actor: req.user,
      action: 'STAFF_DELETED',
      recordId: id,
      details: `Deleted staff account: ${targetUser.email} (${targetUser.role})`,
      ip: req.ip
    });

    res.json({ success: true, message: `Staff account for ${targetUser.email} was permanently removed.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error deleting staff account.' });
  }
}

async function resetStaffPassword(req, res) {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters long.' });
    }

    const targetUser = Users.findById(id);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'Staff member not found.' });
    }

    const hashedPassword = await hashPassword(newPassword);
    Users.findByIdAndUpdate(id, { password: hashedPassword });

    logAudit({
      actor: req.user,
      action: 'STAFF_PASSWORD_RESET',
      recordId: id,
      details: `Administrative password reset performed for ${targetUser.email}`,
      ip: req.ip
    });

    res.json({ success: true, message: `Password reset successfully for ${targetUser.email}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error resetting staff password.' });
  }
}

async function getStaffRequests(req, res) {
  try {
    const allUsers = Users.find();
    const requests = allUsers
      .filter(u => u.status === 'pending_approval')
      .map(u => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email,
        email: u.email,
        phone: u.phone || '',
        requestedRole: (u.requestedRole || u.role || 'STAFF').toUpperCase(),
        notes: u.requestNotes || '',
        requestedAt: u.requestedAt || u.createdAt
      }));

    res.json({ success: true, count: requests.length, requests });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error retrieving staff requests.' });
  }
}

async function approveStaffRequest(req, res) {
  try {
    const { id } = req.params;
    const { assignedRole } = req.body;

    const applicant = Users.findById(id) || Users.findOne({ id });
    if (!applicant) {
      return res.status(404).json({ success: false, message: 'Staff request not found.' });
    }

    const finalRole = (assignedRole || applicant.requestedRole || applicant.role || 'KITCHEN_STAFF').toUpperCase();
    if (!ROLES[finalRole] || finalRole === 'CUSTOMER') {
      return res.status(400).json({ success: false, message: 'Invalid staff role specified.' });
    }

    const updated = Users.findByIdAndUpdate(applicant.id, {
      role: finalRole,
      status: 'active',
      permissions: ROLE_PERMISSIONS[finalRole] || [],
      approvedBy: `${req.user.firstName} ${req.user.lastName}`,
      approvedAt: new Date().toISOString()
    });

    logAudit({
      actor: req.user,
      action: 'STAFF_REQUEST_APPROVED',
      recordId: applicant.id,
      details: `Admin approved staff request for ${applicant.email} as ${finalRole}`,
      ip: req.ip
    });

    res.json({
      success: true,
      message: `Staff request approved! ${applicant.firstName || applicant.email} is now an active ${finalRole.replace(/_/g, ' ')}.`,
      user: {
        id: updated.id,
        email: updated.email,
        role: updated.role,
        status: updated.status
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error approving staff request.' });
  }
}

async function rejectStaffRequest(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const applicant = Users.findById(id) || Users.findOne({ id });
    if (!applicant) {
      return res.status(404).json({ success: false, message: 'Staff request not found.' });
    }

    Users.findByIdAndUpdate(applicant.id, {
      status: 'rejected',
      role: 'CUSTOMER',
      rejectedBy: `${req.user.firstName} ${req.user.lastName}`,
      rejectionReason: reason || 'Application rejected by management',
      rejectedAt: new Date().toISOString()
    });

    logAudit({
      actor: req.user,
      action: 'STAFF_REQUEST_REJECTED',
      recordId: applicant.id,
      details: `Staff request for ${applicant.email} was rejected. Reason: ${reason || 'N/A'}`,
      ip: req.ip
    });

    res.json({
      success: true,
      message: `Access request for ${applicant.email} was rejected.`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error rejecting staff request.' });
  }
}

module.exports = {
  getStaffList,
  getStaffRequests,
  approveStaffRequest,
  rejectStaffRequest,
  createStaff,
  updateStaff,
  deleteStaff,
  resetStaffPassword
};
