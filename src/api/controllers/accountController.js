const accountService = require('../services/accountService');

class AccountController {
  async requestDeletion(req, res) {
    const { userId, email, reason } = req.body || {};
    if (!userId || !email) {
      return res.status(400).json({ message: 'userId and email are required' });
    }
    try {
      const request = await accountService.createDeletionRequest(userId, { email, reason });
      res.status(201).json(request);
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) console.error('requestDeletion error:', error.message);
      res.status(status).json({ message: error.message });
    }
  }
}

module.exports = new AccountController();
