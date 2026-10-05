import type { RequestHandler } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import { integerSetting } from './config.js';

/** Bound open requests as well as request rates; SSE connections can live for hours. */
export function concurrencyLimit(): RequestHandler {
  let active = 0;
  let streams = 0;
  let expensive = 0;
  const perIp = new Map<string, number>();
  const maxActive = integerSetting('HTTP_MAX_INFLIGHT', 200);
  const maxStreams = integerSetting('SSE_MAX_CONNECTIONS', 200);
  const maxPerIp = integerSetting('SSE_MAX_PER_IP', 3);
  return (req, res, next) => {
    const path = req.path.toLowerCase().replace(/\/+$/, '');
    const stream = path === '/live/stream';
    const work =
      /\/sync-|^\/live\/replay\/start$|^\/results\/get-lap-positions|^\/live\/archive|^\/constructors$/.test(
        path,
      );
    const key = ipKeyGenerator(req.ip || req.socket.remoteAddress || 'unknown');
    if (
      stream
        ? streams >= maxStreams || (perIp.get(key) || 0) >= maxPerIp
        : active >= maxActive || (work && expensive >= 4)
    ) {
      res.setHeader('Retry-After', '5');
      res.status(503).json({ message: 'Service temporarily unavailable' });
      return;
    }
    if (stream) {
      streams++;
      perIp.set(key, (perIp.get(key) || 0) + 1);
    } else {
      active++;
      if (work) expensive++;
    }
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (stream) {
        streams--;
        const count = (perIp.get(key) || 1) - 1;
        if (count) perIp.set(key, count);
        else perIp.delete(key);
      } else {
        active--;
        if (work) expensive--;
      }
    };
    res.once('close', release);
    res.once('finish', release);
    next();
  };
}
