import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { StatisticsService } from './statistics.service.js';

@ApiTags('Statistics')
@Controller('statistics')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get('statuses')
  @ApiOperation({
    summary: 'Get all-time Formula 1 race outcome statistics',
    description:
      'Returns the complete categorized finishing-status archive. Data refreshes from every page of Jolpica’s all-time status endpoint every six hours, with stale snapshots available during upstream outages.',
  })
  @ApiResponse({ status: 200, description: 'All-time outcome statistics and category summary' })
  getStatuses() {
    return this.statisticsService.getStatuses();
  }

  @Get('championship/:season')
  @ApiOperation({ summary: 'Get driver and constructor championship progression by round' })
  @ApiParam({ name: 'season', schema: { type: 'string' } })
  getChampionship(@Param('season') season: string) {
    return this.statisticsService.getChampionship(season);
  }

  @Get('qualifying/:season')
  @ApiOperation({ summary: 'Get season-long qualifying deltas by round' })
  @ApiParam({ name: 'season', schema: { type: 'string' } })
  getQualifying(@Param('season') season: string) {
    return this.statisticsService.getQualifyingTrends(season);
  }

  @Get('speed/:season')
  @ApiOperation({ summary: 'Get season fastest-lap and average-speed index' })
  @ApiParam({ name: 'season', schema: { type: 'string' } })
  getSpeed(@Param('season') season: string) {
    return this.statisticsService.getSpeedIndex(season);
  }

  @Get('circuits')
  @ApiOperation({ summary: 'Get the Jolpica circuit directory' })
  getCircuits() {
    return this.statisticsService.getCircuits();
  }

  @Get('circuits/:circuitId')
  @ApiOperation({ summary: 'Get historical intelligence for a circuit' })
  @ApiParam({ name: 'circuitId', schema: { type: 'string' } })
  getCircuit(@Param('circuitId') circuitId: string) {
    return this.statisticsService.getCircuitInsights(circuitId);
  }
}
