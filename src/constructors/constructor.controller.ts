import { Controller, Get, HttpCode, HttpException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConstructorService } from './constructor.service.js';

@ApiTags('Constructors')
@Controller('constructors')
export class ConstructorController {
  constructor(private readonly constructorService: ConstructorService) {}
  @Get('')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get constructors from external API' })
  @ApiResponse({ status: 200, description: 'List of constructors' })
  async getConstructors() {
    try {
      const data = await this.constructorService.getConstructorStandings();
      return data;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in getConstructors controller:', error.message);
      throw new HttpException({ error: 'Failed to fetch constructor standings' }, 500);
    }
  }

  @Get('get-all-constructors')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get all constructors from DB' })
  @ApiResponse({ status: 200, description: 'List of all constructors in database' })
  async getAllDbConstructors() {
    try {
      const constructors = await this.constructorService.getAllConstructorsFromDb();
      return constructors;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in getAllDbConstructors controller:', error.message);
      throw new HttpException({ error: 'Failed to fetch constructors from database' }, 500);
    }
  }

  @Get('sync-constructor-season')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sync constructor season data' })
  @ApiResponse({ status: 200, description: 'Sync successful' })
  async syncConstructorSeason() {
    try {
      const data = await this.constructorService.syncConstructorSeason();
      return data;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in syncConstructorSeason controller:', error.message);
      throw new HttpException({ error: 'Failed to sync constructor season' }, 500);
    }
  }

  @Get('get-all-constructors-season-rankings')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get constructor season rankings' })
  @ApiResponse({ status: 200, description: 'List of constructor rankings' })
  async getAllDbConstructorsSeasonRankings() {
    try {
      const constructorsSeasonRankings =
        await this.constructorService.getAllConstructorsSeasonRankingsFromDb();
      return constructorsSeasonRankings;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in getAllDbConstructorsSeasonRankings controller:', error.message);
      throw new HttpException(
        { error: 'Failed to fetch constructors season rankings from database' },
        500,
      );
    }
  }
}
