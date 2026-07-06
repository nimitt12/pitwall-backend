const liveTimingService = require('../services/liveTimingService');

/**
 * Controller to return the full merged live timing state (one-shot snapshot).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getLiveState = (req, res) => {
    try {
        res.json(liveTimingService.getState());
    } catch (error) {
        console.error('Error in getLiveState controller:', error.message);
        res.status(500).json({ error: 'Failed to read live timing state' });
    }
};

/**
 * Controller for the Server-Sent Events stream. Sends the full state as a
 * `snapshot` event on connect, then re-broadcasts every feed change as an
 * `update` event ({topic, data, timestamp}). Connection status changes are
 * sent as `status` events, and a comment ping every 15s keeps proxies from
 * closing the idle connection.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const streamLive = (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const send = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const unsubscribe = liveTimingService.addSubscriber({
        onUpdate: (update) => send('update', update),
        onStatus: (status) => send('status', status),
        onReplay: (progress) => send('replay', progress),
        // Re-broadcast the full state whenever the source resets it wholesale
        // (replay start/seek/stop) — deltas alone can't express that.
        onSnapshot: () => send('snapshot', liveTimingService.getState()),
    });

    // Initial snapshot goes out after subscribing so no update can slip
    // between the snapshot read and the listener registration.
    send('snapshot', liveTimingService.getState());

    const ping = setInterval(() => res.write(': ping\n\n'), 15000);

    req.on('close', () => {
        clearInterval(ping);
        unsubscribe();
        res.end();
    });
};

/**
 * Controller to start the built-in session simulator (demo/dev mode).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const startSimulation = (req, res) => {
    try {
        const state = liveTimingService.startSimulation();
        res.json({ status: 'Simulation running', simulated: state.simulated });
    } catch (error) {
        console.error('Error in startSimulation controller:', error.message);
        res.status(500).json({ error: 'Failed to start simulation' });
    }
};

/**
 * Controller to stop the simulator and fall back to the real feed.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const stopSimulation = (req, res) => {
    try {
        const state = liveTimingService.stopSimulation();
        res.json({ status: 'Simulation stopped', simulated: state.simulated });
    } catch (error) {
        console.error('Error in stopSimulation controller:', error.message);
        res.status(500).json({ error: 'Failed to stop simulation' });
    }
};

/**
 * Controller to return a season's archived meetings/sessions index.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getArchiveIndex = async (req, res) => {
    try {
        res.json(await liveTimingService.getArchiveIndex(req.params.year));
    } catch (error) {
        console.error('Error in getArchiveIndex controller:', error.message);
        res.status(error.status || 500).json({ error: error.message || 'Failed to fetch archive index' });
    }
};

/**
 * Controller to start replaying an archived session through the live stream.
 * Body: { path: "2025/2025-04-06_Japanese_Grand_Prix/2025-04-06_Race/", name?, speed? }
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const startReplay = async (req, res) => {
    try {
        const { path, name, speed } = req.body || {};
        const state = await liveTimingService.startReplay(path, { name, speed });
        res.json({ status: 'Replay running', replay: state.replay });
    } catch (error) {
        console.error('Error in startReplay controller:', error.message);
        res.status(error.status || 500).json({ error: error.message || 'Failed to start replay' });
    }
};

/**
 * Controller for replay transport: stop / pause / resume / speed / seek.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const controlReplay = (req, res) => {
    try {
        const { action } = req.params;
        let state;
        if (action === 'stop') state = liveTimingService.stopReplay();
        else if (action === 'pause') state = liveTimingService.setReplayPaused(true);
        else if (action === 'resume') state = liveTimingService.setReplayPaused(false);
        else if (action === 'speed') state = liveTimingService.setReplaySpeed(req.body?.speed);
        else if (action === 'seek') state = liveTimingService.seekReplay(req.body?.offsetMs);
        else return res.status(400).json({ error: `Unknown replay action: ${action}` });
        res.json({ status: 'OK', replay: state.replay });
    } catch (error) {
        console.error('Error in controlReplay controller:', error.message);
        res.status(500).json({ error: 'Replay control failed' });
    }
};

module.exports = {
    getLiveState,
    streamLive,
    startSimulation,
    stopSimulation,
    getArchiveIndex,
    startReplay,
    controlReplay,
};
