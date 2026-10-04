import { Body, Controller, HttpCode, HttpException, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccountService } from './account.service.js';

@ApiTags('Account')
@Controller('account')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}
  @Post('delete-request')
  @HttpCode(201)
  @ApiOperation({ summary: 'Request deletion of an account and its associated data' })
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      required: ['userId', 'email'],
      properties: {
        userId: { type: 'string' },
        email: { type: 'string' },
        reason: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Deletion request recorded' })
  @ApiResponse({ status: 400, description: 'Missing fields or email mismatch' })
  @ApiResponse({ status: 404, description: 'Account not found' })
  async requestDeletion(@Body() body: { userId: string; email: string; reason?: string }) {
    const { userId, email, reason } = body || {};
    if (!userId || !email) {
      throw new HttpException({ message: 'userId and email are required' }, 400);
    }
    try {
      const request = await this.accountService.createDeletionRequest(userId, { email, reason });
      return request;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const status = error.status || 500;
      if (status >= 500) console.error('requestDeletion error:', error.message);
      throw new HttpException({ message: error.message }, status);
    }
  }
}
