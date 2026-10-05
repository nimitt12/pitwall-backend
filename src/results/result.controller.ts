import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../auth/admin-auth.guard.js';
import { ExclusiveWorkInterceptor } from '../security/exclusive-work.interceptor.js';
import { ResultService } from './result.service.js';

@ApiTags('Results')
@Controller('results')
export class ResultController {
  constructor(private readonly resultService: ResultService) {}
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('bearerAuth')
  @UseInterceptors(ExclusiveWorkInterceptor)
  @Get('sync-results')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sync race results' })
  @ApiResponse({ status: 200, description: 'Sync successful' })
  async syncResults() {
    try {
      const result = await this.resultService.syncResults();
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in syncResults controller:', error.message);
      throw new HttpException({ error: 'Failed to sync race results' }, 500);
    }
  }

  @Get('get-all-results/:season/:round')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get results by season and round' })
  @ApiParam({ name: 'season', schema: { type: 'string' } })
  @ApiParam({ name: 'round', schema: { type: 'string' } })
  @ApiResponse({ status: 200, description: 'Race results for the specified season and round' })
  async getResultsBySeasonAndRound(@Param() params: Record<string, string>) {
    try {
      const { season, round } = params;
      const results = await this.resultService.getResultsBySeasonAndRoundFromDb(season, round);
      return results;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in getResultsBySeasonAndRound controller:', error.message);
      throw new HttpException({ error: 'Failed to fetch race results from database' }, 500);
    }
  }

  @Get('get-stats-overall/:season')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get overall statistics for a season' })
  @ApiParam({ name: 'season', schema: { type: 'string' } })
  @ApiResponse({ status: 200, description: 'Overall statistics for the season' })
  async getStatsOverall(@Param() params: Record<string, string>) {
    try {
      const { season } = params;
      const stats = await this.resultService.getStatsOverallFromDb(season);
      return stats;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in getStatsOverall controller:', error.message);
      throw new HttpException({ error: 'Failed to fetch statistics from database' }, 500);
    }
  }

  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('bearerAuth')
  @UseInterceptors(ExclusiveWorkInterceptor)
  @Get('sync-qualifying')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sync qualifying results' })
  @ApiResponse({ status: 200, description: 'Sync successful' })
  async syncQualifying() {
    try {
      const result = await this.resultService.syncQualifying();
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in syncQualifying controller:', error.message);
      throw new HttpException({ error: 'Failed to sync qualifying results' }, 500);
    }
  }

  @Get('get-all-qualifying-results/:season/:round')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get qualifying results by season and round' })
  @ApiParam({ name: 'season', schema: { type: 'string' } })
  @ApiParam({ name: 'round', schema: { type: 'string' } })
  @ApiResponse({
    status: 200,
    description: 'Qualifying results for the specified season and round',
  })
  async getQualifyingBySeasonAndRound(@Param() params: Record<string, string>) {
    try {
      const { season, round } = params;
      const results = await this.resultService.getQualifyingBySeasonAndRoundFromDb(season, round);
      return results;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in getQualifyingBySeasonAndRound controller:', error.message);
      throw new HttpException({ error: 'Failed to fetch qualifying results from database' }, 500);
    }
  }

  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('bearerAuth')
  @UseInterceptors(ExclusiveWorkInterceptor)
  @Get('sync-sprint-results')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sync sprint race results' })
  @ApiResponse({ status: 200, description: 'Sync successful' })
  async syncSprintResults() {
    try {
      const result = await this.resultService.syncSprintResults();
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in syncSprintResults controller:', error.message);
      throw new HttpException({ error: 'Failed to sync sprint results' }, 500);
    }
  }

  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth('bearerAuth')
  @UseInterceptors(ExclusiveWorkInterceptor)
  @Get('sync-sprint-qualifying')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sync sprint qualifying results' })
  @ApiResponse({ status: 200, description: 'Sync successful' })
  async syncSprintQualifying() {
    try {
      const result = await this.resultService.syncSprintQualifying();
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in syncSprintQualifying controller:', error.message);
      throw new HttpException({ error: 'Failed to sync sprint qualifying results' }, 500);
    }
  }

  @Get('get-all-sprint-results/:season/:round')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get sprint results by season and round' })
  @ApiParam({ name: 'season', schema: { type: 'string' } })
  @ApiParam({ name: 'round', schema: { type: 'string' } })
  @ApiResponse({ status: 200, description: 'Sprint results for the specified season and round' })
  async getSprintResultsBySeasonAndRound(@Param() params: Record<string, string>) {
    try {
      const { season, round } = params;
      const results = await this.resultService.getSprintResultsBySeasonAndRoundFromDb(
        season,
        round,
      );
      return results;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in getSprintResultsBySeasonAndRound controller:', error.message);
      throw new HttpException({ error: 'Failed to fetch sprint results from database' }, 500);
    }
  }

  @Get('get-all-sprint-qualifying-results/:season/:round')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get sprint qualifying results by season and round' })
  @ApiParam({ name: 'season', schema: { type: 'string' } })
  @ApiParam({ name: 'round', schema: { type: 'string' } })
  @ApiResponse({
    status: 200,
    description: 'Sprint qualifying results for the specified season and round',
  })
  async getSprintQualifyingBySeasonAndRound(@Param() params: Record<string, string>) {
    try {
      const { season, round } = params;
      const results = await this.resultService.getSprintQualifyingBySeasonAndRoundFromDb(
        season,
        round,
      );
      return results;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in getSprintQualifyingBySeasonAndRound controller:', error.message);
      throw new HttpException(
        { error: 'Failed to fetch sprint qualifying results from database' },
        500,
      );
    }
  }

  @Get('get-lap-positions/:season/:round')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get lap-by-lap positions for a race' })
  @ApiParam({ name: 'season', schema: { type: 'string' } })
  @ApiParam({ name: 'round', schema: { type: 'string' } })
  @ApiResponse({
    status: 200,
    description: 'Per-driver lap-by-lap positions for the specified race',
  })
  async getLapPositions(@Param() params: Record<string, string>) {
    try {
      const { season, round } = params;
      const laps = await this.resultService.getLapPositions(season, round);
      return laps;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in getLapPositions controller:', error.message);
      throw new HttpException({ error: 'Failed to fetch lap positions' }, 500);
    }
  }
}
