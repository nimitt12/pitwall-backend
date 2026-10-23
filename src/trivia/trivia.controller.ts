import { Controller, Get, HttpCode, HttpException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TriviaService } from './trivia.service.js';

@ApiTags('Trivia')
@Controller('trivia')
export class TriviaController {
  constructor(private readonly triviaService: TriviaService) {}
  @Get('')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get the homepage ticker trivia lines',
    description:
      "Public read of the short trivia sentences scrolled in the homepage ticker (managed via the admin portal's `trivia` table), ordered by sort_order.",
  })
  @ApiResponse({ status: 200, description: 'Array of trivia lines' })
  async getTrivia() {
    try {
      const trivia = await this.triviaService.getTriviaFromDb();
      return trivia;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('Error in getTrivia controller:', error.message);
      throw new HttpException({ error: 'Failed to fetch trivia' }, 500);
    }
  }
}
