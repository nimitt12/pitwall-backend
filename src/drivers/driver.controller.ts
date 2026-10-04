import { Controller, Get, HttpCode, HttpException, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DriverService } from './driver.service.js';

@ApiTags('Drivers')
@Controller('')
export class DriverController {
  constructor(private readonly driverService: DriverService) {}
  @Get(['drivers/get-all-drivers', 'get-all-drivers'])
  @HttpCode(200)
  @ApiOperation({ summary: 'Get all drivers' })
  @ApiResponse({ status: 200, description: 'List of all drivers' })
  async getAllDbDrivers() {
    try {
      const drivers = await this.driverService.getAllDriversFromDb();
      return drivers;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in getAllDbDrivers controller:', error.message);
      throw new HttpException({ error: 'Failed to fetch drivers from database' }, 500);
    }
  }

  @Get('drivers/sync-driver-season')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sync driver season data',
    description: 'Fetch driver data from external F1 API and sync with local database.',
  })
  @ApiResponse({ status: 200, description: 'Sync successful' })
  async syncDriverSeason() {
    try {
      const result = await this.driverService.syncDriverSeason();
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in syncDriverSeason controller:', error.message);
      throw new HttpException({ error: 'Failed to sync driver season data' }, 500);
    }
  }

  @Get('drivers/get-all-drivers-season-rankings')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get driver season rankings' })
  @ApiResponse({ status: 200, description: 'List of driver rankings for the season' })
  async getAllDbDriversSeasonRankings() {
    try {
      const driversSeasonRankings = await this.driverService.getAllDriversSeasonRankingsFromDb();
      return driversSeasonRankings;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in getAllDbDriversSeasonRankings controller:', error.message);
      throw new HttpException(
        { error: 'Failed to fetch driver season rankings from database' },
        500,
      );
    }
  }

  @Get('drivers/compare/:season/:driverId1/:driverId2')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get head-to-head comparison between two drivers for a season' })
  @ApiParam({ name: 'season', schema: { type: 'string' } })
  @ApiParam({ name: 'driverId1', schema: { type: 'string' } })
  @ApiParam({ name: 'driverId2', schema: { type: 'string' } })
  @ApiResponse({
    status: 200,
    description:
      'Season stats, last 5 results, and qualifying/race head-to-head counts for both drivers',
  })
  @ApiResponse({ status: 404, description: 'One or both drivers not found for this season' })
  async getDriverComparison(@Param() params: Record<string, string>) {
    try {
      const { season, driverId1, driverId2 } = params;
      const comparison = await this.driverService.getDriverComparisonFromDb(
        season,
        driverId1,
        driverId2,
      );
      if (!comparison) {
        throw new HttpException({ error: 'One or both drivers not found for this season' }, 404);
      }
      return comparison;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in getDriverComparison controller:', error.message);
      throw new HttpException({ error: 'Failed to fetch driver comparison' }, 500);
    }
  }
}
