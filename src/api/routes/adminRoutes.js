const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const adminAuth = require('../middlewares/adminAuthMiddleware');

/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Generic CRUD over whitelisted database tables (admin portal)
 */

// Every admin endpoint requires a valid admin session.
router.use(adminAuth);

/**
 * @swagger
 * /admin/verify:
 *   get:
 *     summary: Verify the caller has admin access
 *     tags: [Admin]
 *     description: Used by the admin portal's gate screen to confirm the current session belongs to an admin before rendering the dashboard.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: "Authorized — returns the admin user" }
 *       401: { description: Not authenticated }
 *       403: { description: Authenticated but not an admin }
 */
router.get('/verify', (req, res) => {
  res.json({ ok: true, user: req.adminUser });
});

/**
 * @swagger
 * /admin/tables:
 *   get:
 *     summary: List manageable tables and their column metadata
 *     tags: [Admin]
 *     description: Returns each whitelisted table with its primary key and editable columns. Used by the admin portal to render generic tables and forms.
 *     responses:
 *       200:
 *         description: Table metadata
 */
router.get('/tables', adminController.getTables);

/**
 * @swagger
 * /admin/{table}:
 *   get:
 *     summary: List rows of a table (paginated)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: table
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Case-insensitive filter across all visible columns
 *     responses:
 *       200: { description: "Paginated result { data, total, page, limit }" }
 *       400: { description: Unknown table }
 *   post:
 *     summary: Create a row
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: table
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       201: { description: Created record }
 *       400: { description: Validation error }
 *       409: { description: Conflict (duplicate key or constraint) }
 */
router.get('/:table', adminController.listRows);
router.post('/:table', adminController.createRow);

/**
 * @swagger
 * /admin/{table}/distinct/{column}:
 *   get:
 *     summary: Distinct values of a column (for filter dropdowns)
 *     tags: [Admin]
 *     description: Returns sorted distinct non-null values of a column. Extra query params act as exact-match filters (e.g. ?season=2026 to list that season's rounds).
 *     parameters:
 *       - in: path
 *         name: table
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: column
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Array of distinct values }
 *       400: { description: Unknown table or column }
 */
router.get('/:table/distinct/:column', adminController.getDistinctValues);

/**
 * @swagger
 * /admin/{table}/{id}:
 *   get:
 *     summary: Fetch a single row by primary key
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: table
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Record }
 *       404: { description: Not found }
 *   put:
 *     summary: Update a row by primary key
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: table
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200: { description: Updated record }
 *       404: { description: Not found }
 *   delete:
 *     summary: Delete a row by primary key
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: table
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deletion result }
 *       404: { description: Not found }
 */
router.get('/:table/:id', adminController.getRow);
router.put('/:table/:id', adminController.updateRow);
router.delete('/:table/:id', adminController.deleteRow);

module.exports = router;
