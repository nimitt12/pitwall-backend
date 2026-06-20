const adminService = require('../services/adminService');

/** Map a service error (carrying an optional .status) to a JSON response. */
const handleError = (res, error, fallback) => {
    const status = error.status || 500;
    if (status >= 500) {
        console.error('Error in admin controller:', error.message);
    }
    res.status(status).json({ error: status >= 500 ? fallback : error.message });
};

const getTables = async (req, res) => {
    try {
        res.json(adminService.listTables());
    } catch (error) {
        handleError(res, error, 'Failed to list tables');
    }
};

const listRows = async (req, res) => {
    try {
        // page/limit/search are reserved; any other query param is an exact-match filter.
        const { page, limit, search, ...filters } = req.query;
        const result = await adminService.list(req.params.table, { page, limit, search, filters });
        res.json(result);
    } catch (error) {
        handleError(res, error, 'Failed to fetch records');
    }
};

const getDistinctValues = async (req, res) => {
    try {
        const { table, column } = req.params;
        const values = await adminService.distinct(table, column, req.query);
        res.json(values);
    } catch (error) {
        handleError(res, error, 'Failed to fetch values');
    }
};

const getRow = async (req, res) => {
    try {
        const row = await adminService.getOne(req.params.table, req.params.id);
        if (!row) return res.status(404).json({ error: 'Record not found' });
        res.json(row);
    } catch (error) {
        handleError(res, error, 'Failed to fetch record');
    }
};

const createRow = async (req, res) => {
    try {
        const row = await adminService.create(req.params.table, req.body || {});
        res.status(201).json(row);
    } catch (error) {
        handleError(res, error, 'Failed to create record');
    }
};

const updateRow = async (req, res) => {
    try {
        const row = await adminService.update(req.params.table, req.params.id, req.body || {});
        res.json(row);
    } catch (error) {
        handleError(res, error, 'Failed to update record');
    }
};

const deleteRow = async (req, res) => {
    try {
        const result = await adminService.remove(req.params.table, req.params.id);
        res.json(result);
    } catch (error) {
        handleError(res, error, 'Failed to delete record');
    }
};

module.exports = {
    getTables,
    listRows,
    getDistinctValues,
    getRow,
    createRow,
    updateRow,
    deleteRow,
};
