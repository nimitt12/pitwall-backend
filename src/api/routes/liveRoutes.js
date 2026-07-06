const express = require('express');
const router = express.Router();
const liveController = require('../controllers/liveController');

/**
 * @swagger
 * /live/state:
 *   get:
 *     summary: Get the current live timing state
 *     tags: [Live]
 *     description: One-shot snapshot of the merged F1 live timing session state (timing, drivers, weather, track status, race control, car telemetry, positions) plus relay connection status.
 *     responses:
 *       200:
 *         description: Live timing state
 */
router.get('/state', liveController.getLiveState);

/**
 * @swagger
 * /live/stream:
 *   get:
 *     summary: Subscribe to the live timing stream (SSE)
 *     tags: [Live]
 *     description: Server-Sent Events stream. Emits a `snapshot` event with the full state on connect, then `update` events ({topic, data, timestamp}) for every feed change and `status` events on relay connection changes. The relay holds a single upstream connection to the F1 live timing feed regardless of subscriber count.
 *     responses:
 *       200:
 *         description: SSE stream (text/event-stream)
 */
router.get('/stream', liveController.streamLive);

/**
 * @swagger
 * /live/simulate/start:
 *   post:
 *     summary: Start the live timing simulator
 *     tags: [Live]
 *     description: Replays a synthetic Grand Prix (laps, gaps, sectors, pit stops, incidents, telemetry, positions) through the same stream so the live timing UI can be demoed/tested without a real session running.
 *     responses:
 *       200:
 *         description: Simulation started
 */
router.post('/simulate/start', liveController.startSimulation);

/**
 * @swagger
 * /live/simulate/stop:
 *   post:
 *     summary: Stop the live timing simulator
 *     tags: [Live]
 *     description: Stops the synthetic session and reconnects to the real feed if clients are still subscribed.
 *     responses:
 *       200:
 *         description: Simulation stopped
 */
router.post('/simulate/stop', liveController.stopSimulation);

/**
 * @swagger
 * /live/archive/{year}:
 *   get:
 *     summary: Get a season's archived session index
 *     tags: [Live]
 *     description: Proxied (and cached) index of every meeting and session F1 archived for the season (2018 onward), including the Path used to start a replay.
 *     parameters:
 *       - in: path
 *         name: year
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Season index (meetings with sessions)
 *       404:
 *         description: No archive for that year
 */
router.get('/archive/:year', liveController.getArchiveIndex);

/**
 * @swagger
 * /live/replay/start:
 *   post:
 *     summary: Start replaying an archived session
 *     tags: [Live]
 *     description: Downloads the recorded feed for the given session Path and plays it through the live timing stream at the requested speed. Replaces any live/simulated source.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               path:
 *                 type: string
 *                 example: 2025/2025-04-06_Japanese_Grand_Prix/2025-04-06_Race/
 *               name:
 *                 type: string
 *               speed:
 *                 type: number
 *     responses:
 *       200:
 *         description: Replay started
 *       404:
 *         description: No recorded data for that session
 */
router.post('/replay/start', liveController.startReplay);

/**
 * @swagger
 * /live/replay/{action}:
 *   post:
 *     summary: Control the running replay
 *     tags: [Live]
 *     description: "Transport controls: stop, pause, resume, speed (body {speed}), seek (body {offsetMs})."
 *     parameters:
 *       - in: path
 *         name: action
 *         required: true
 *         schema:
 *           type: string
 *           enum: [stop, pause, resume, speed, seek]
 *     responses:
 *       200:
 *         description: Replay state after the action
 */
router.post('/replay/:action', liveController.controlReplay);

module.exports = router;
