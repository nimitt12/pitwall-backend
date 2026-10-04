import { Controller, Get, HttpException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from './database/database.service.js';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly db: DatabaseService) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check' })
  health() {
    return { status: 'UP', timestamp: new Date().toISOString() };
  }

  @Get('db-test')
  @ApiOperation({ summary: 'Test database connection' })
  async databaseHealth() {
    try {
      const result = await this.db.query('SELECT NOW()');
      return {
        status: 'Connected',
        message: 'Database connection is healthy',
        serverTime: result.rows[0].now,
      };
    } catch (error) {
      throw new HttpException(
        {
          status: 'Error',
          message: 'Failed to connect to the database',
          error: (error as Error).message,
        },
        500,
      );
    }
  }
}
