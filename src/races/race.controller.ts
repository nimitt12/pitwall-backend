import { Controller, Get, HttpCode, HttpException, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RaceService } from './race.service.js';

@ApiTags('Races')
@Controller('races')
export class RaceController {
  constructor(private readonly raceService: RaceService) {}
  @Get('')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get the race calendar',
    description:
      "Public read of the race calendar from the database (managed via the admin portal's `races` table). Returns nested Ergast/Jolpica-shaped Race objects ordered by round.",
  })
  @ApiQuery({
    name: 'season',
    required: false,
    schema: { type: 'string' },
    description: 'Filter the calendar to a single season (e.g. 2026)',
  })
  @ApiResponse({ status: 200, description: 'Array of races' })
  async getRaces(@Query() query: Request['query']) {
    try {
      const races = await this.raceService.getRacesFromDb(query.season);
      return races;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in getRaces controller:', error.message);
      throw new HttpException({ error: 'Failed to fetch race calendar' }, 500);
    }
  }
}
