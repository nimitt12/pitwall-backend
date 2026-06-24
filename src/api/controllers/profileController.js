const profileService = require('../services/profileService');

class ProfileController {
  async getProfile(req, res) {
    try {
      const profile = await profileService.getProfile(req.params.id);
      if (!profile) {
        return res.status(404).json({ message: 'Profile not found' });
      }
      res.json(profile);
    } catch (error) {
      console.error('getProfile error:', error.message);
      res.status(500).json({ message: error.message });
    }
  }

  async updateProfile(req, res) {
    try {
      const updated = await profileService.updateProfile(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ message: 'Profile not found' });
      }
      res.json(updated);
    } catch (error) {
      console.error('updateProfile error:', error.message);
      res.status(500).json({ message: error.message });
    }
  }
}

module.exports = new ProfileController();
