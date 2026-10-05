import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { ValidateBody, schemas } from '../security/input-validation.js';
import { ProfileService } from './profile.service.js';

@ApiTags('Profile')
@UseGuards(AuthGuard)
@ApiBearerAuth('bearerAuth')
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}
  @Get(':id')
  @HttpCode(200)
  @ApiOperation({ summary: "Get a user's profile and preferences" })
  @ApiParam({ name: 'id', schema: { type: 'string' } })
  @ApiResponse({ status: 200, description: 'Profile found' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async getProfile(@Param() params: Record<string, string>) {
    try {
      const profile = await this.profileService.getProfile(params.id);
      if (!profile) {
        throw new HttpException({ message: 'Profile not found' }, 404);
      }
      return profile;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('getProfile error:', error.message);
      throw new HttpException({ message: error.message }, 500);
    }
  }

  @ValidateBody(schemas.profile)
  @Put(':id')
  @HttpCode(200)
  @ApiOperation({ summary: "Update a user's favorite constructor and drivers" })
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      properties: {
        fav_constructor: { type: 'string' },
        fav_drivers: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  @ApiParam({ name: 'id', schema: { type: 'string' } })
  @ApiResponse({ status: 200, description: 'Preferences saved' })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async updateProfile(
    @Param() params: Record<string, string>,
    @Body() body: Parameters<ProfileService['updateProfile']>[1],
  ) {
    try {
      const updated = await this.profileService.updateProfile(params.id, body);
      if (!updated) {
        throw new HttpException({ message: 'Profile not found' }, 404);
      }
      return updated;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      console.error('updateProfile error:', error.message);
      throw new HttpException({ message: error.message }, 500);
    }
  }
}
