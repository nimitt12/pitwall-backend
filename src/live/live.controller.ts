import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AdminAuthGuard } from '../auth/admin-auth.guard.js';
import { ExclusiveWorkInterceptor } from '../security/exclusive-work.interceptor.js';
import { ValidateBody, schemas } from '../security/input-validation.js';
import { LiveTimingService } from './live-timing.service.js';

@ApiTags('Live')
@Controller('live')
export class LiveController {
  constructor(private readonly liveTimingService: LiveTimingService) {}
  @Get('state')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get the current live timing state',
    description:
      'One-shot snapshot of the merged F1 live timing session state (timing, drivers, weather, track status, race control, car telemetry, positions) plus relay connection status.',
  })
  @ApiResponse({ status: 200, description: 'Live timing state' })
  getLiveState() {
    try {
      return this.liveTimingService.getState();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in getLiveState controller:', error.message);
      throw new HttpException({ error: 'Failed to read live timing state' }, 500);
    }
  }

  @Get('stream')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Subscribe to the live timing stream (SSE)',
    description:
      'Server-Sent Events stream. Emits a `snapshot` event with the full state on connect, then `update` events ({topic, data, timestamp}) for every feed change and `status` events on relay connection changes. The relay holds a single upstream connection to the F1 live timing feed regardless of subscriber count.',
  })
  @ApiResponse({ status: 200, description: 'SSE stream (text/event-stream)' })
  streamLive(@Res() res: Response) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const write = (frame: string) => {
      if (res.destroyed || res.writableEnded) return;
      // Disconnect lagging consumers instead of accumulating unbounded buffers.
      if (res.writableLength > 256 * 1024) {
        res.destroy();
        return;
      }
      res.write(frame);
    };
    const send = (event: string, data: unknown) =>
      write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const unsubscribe = this.liveTimingService.addSubscriber({
      onShutdown: () => res.end(),
      onUpdate: (update) => send('update', update),
      onStatus: (status) => send('status', status),
      onReplay: (progress) => send('replay', progress),
      // Re-broadcast the full state whenever the source resets it wholesale
      // (replay start/seek/stop) — deltas alone can't express that.
      onSnapshot: () => send('snapshot', this.liveTimingService.getState()),
    });

    // Initial snapshot goes out after subscribing so no update can slip
    // between the snapshot read and the listener registration.
    send('snapshot', this.liveTimingService.getState());

    const ping = setInterval(() => write(': ping\n\n'), 15000);

    res.on('close', () => {
      clearInterval(ping);
      unsubscribe();
      res.end();
    });
  }

  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('bearerAuth')
  @Post('simulate/start')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Start the live timing simulator',
    description:
      'Replays a synthetic Grand Prix (laps, gaps, sectors, pit stops, incidents, telemetry, positions) through the same stream so the live timing UI can be demoed/tested without a real session running.',
  })
  @ApiResponse({ status: 200, description: 'Simulation started' })
  startSimulation() {
    try {
      const state = this.liveTimingService.startSimulation();
      return { status: 'Simulation running', simulated: state.simulated };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in startSimulation controller:', error.message);
      throw new HttpException({ error: 'Failed to start simulation' }, 500);
    }
  }

  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('bearerAuth')
  @Post('simulate/stop')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Stop the live timing simulator',
    description:
      'Stops the synthetic session and reconnects to the real feed if clients are still subscribed.',
  })
  @ApiResponse({ status: 200, description: 'Simulation stopped' })
  stopSimulation() {
    try {
      const state = this.liveTimingService.stopSimulation();
      return { status: 'Simulation stopped', simulated: state.simulated };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in stopSimulation controller:', error.message);
      throw new HttpException({ error: 'Failed to stop simulation' }, 500);
    }
  }

  @Get('archive/:year')
  @HttpCode(200)
  @ApiOperation({
    summary: "Get a season's archived session index",
    description:
      'Proxied (and cached) index of every meeting and session F1 archived for the season (2018 onward), including the Path used to start a replay.',
  })
  @ApiParam({ name: 'year', schema: { type: 'integer' } })
  @ApiResponse({ status: 200, description: 'Season index (meetings with sessions)' })
  @ApiResponse({ status: 404, description: 'No archive for that year' })
  async getArchiveIndex(@Param() params: Record<string, string>) {
    try {
      return await this.liveTimingService.getArchiveIndex(params.year);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in getArchiveIndex controller:', error.message);
      throw new HttpException(
        { error: error.message || 'Failed to fetch archive index' },
        error.status || 500,
      );
    }
  }

  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('bearerAuth')
  @ValidateBody(schemas.replay)
  @UseInterceptors(ExclusiveWorkInterceptor)
  @Post('replay/start')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Start replaying an archived session',
    description:
      'Downloads the recorded feed for the given session Path and plays it through the live timing stream at the requested speed. Replaces any live/simulated source.',
  })
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', example: '2025/2025-04-06_Japanese_Grand_Prix/2025-04-06_Race/' },
        name: { type: 'string' },
        speed: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Replay started' })
  @ApiResponse({ status: 404, description: 'No recorded data for that session' })
  async startReplay(@Body() body: { path: string; name?: string; speed?: number }) {
    try {
      const { path, name, speed } = body || {};
      const state = await this.liveTimingService.startReplay(path, { name, speed });
      return { status: 'Replay running', replay: state.replay };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in startReplay controller:', error.message);
      throw new HttpException(
        { error: error.message || 'Failed to start replay' },
        error.status || 500,
      );
    }
  }

  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('bearerAuth')
  @ValidateBody(schemas.replayControl)
  @Post('replay/:action')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Control the running replay',
    description:
      'Transport controls: stop, pause, resume, speed (body {speed}), seek (body {offsetMs}).',
  })
  @ApiParam({
    name: 'action',
    schema: { type: 'string', enum: ['stop', 'pause', 'resume', 'speed', 'seek'] },
  })
  @ApiResponse({ status: 200, description: 'Replay state after the action' })
  controlReplay(
    @Param() params: Record<string, string>,
    @Body() body: { speed?: number; offsetMs?: number },
  ) {
    try {
      const { action } = params;
      let state;
      if (action === 'stop') state = this.liveTimingService.stopReplay();
      else if (action === 'pause') state = this.liveTimingService.setReplayPaused(true);
      else if (action === 'resume') state = this.liveTimingService.setReplayPaused(false);
      else if (action === 'speed') state = this.liveTimingService.setReplaySpeed(body?.speed);
      else if (action === 'seek') state = this.liveTimingService.seekReplay(body?.offsetMs);
      else throw new HttpException({ error: `Unknown replay action: ${action}` }, 400);
      return { status: 'OK', replay: state.replay };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in controlReplay controller:', error.message);
      throw new HttpException({ error: 'Replay control failed' }, 500);
    }
  }
}
