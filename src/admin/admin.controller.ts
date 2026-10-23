import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminAuthGuard, type AdminRequest } from '../auth/admin-auth.guard.js';
import { AdminService } from './admin.service.js';

@ApiTags('Admin')
@UseGuards(AdminAuthGuard)
@ApiBearerAuth('bearerAuth')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}
  @Get('verify')
  @ApiOperation({ summary: 'Verify admin access' })
  verify(@Req() req: AdminRequest) {
    return { ok: true, user: req.adminUser };
  }

  private handleError(error: Error & { status?: number }, fallback: string): never {
    const status = error.status || 500;
    if (status >= 500) {
      console.error('Error in admin controller:', error.message);
    }
    throw new HttpException({ error: status >= 500 ? fallback : error.message }, status);
  }

  @Get('tables')
  @HttpCode(200)
  @ApiOperation({
    summary: 'List manageable tables and their column metadata',
    description:
      'Returns each whitelisted table with its primary key and editable columns. Used by the admin portal to render generic tables and forms.',
  })
  @ApiResponse({ status: 200, description: 'Table metadata' })
  async getTables() {
    try {
      return this.adminService.listTables();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.handleError(error, 'Failed to list tables');
    }
  }

  @Get(':table')
  @HttpCode(200)
  @ApiOperation({ summary: 'List rows of a table (paginated)' })
  @ApiQuery({ name: 'page', schema: { type: 'integer', default: 1 } })
  @ApiQuery({ name: 'limit', schema: { type: 'integer', default: 50 } })
  @ApiQuery({
    name: 'search',
    schema: { type: 'string' },
    description: 'Case-insensitive filter across all visible columns',
  })
  @ApiParam({ name: 'table', schema: { type: 'string' } })
  @ApiResponse({ status: 200, description: 'Paginated result { data, total, page, limit }' })
  @ApiResponse({ status: 400, description: 'Unknown table' })
  async listRows(@Param() params: Record<string, string>, @Query() query: Request['query']) {
    try {
      // page/limit/search are reserved; any other query param is an exact-match filter.
      const { page, limit, search, ...filters } = query;
      const result = await this.adminService.list(params.table, { page, limit, search, filters });
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.handleError(error, 'Failed to fetch records');
    }
  }

  @Get(':table/distinct/:column')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Distinct values of a column (for filter dropdowns)',
    description:
      "Returns sorted distinct non-null values of a column. Extra query params act as exact-match filters (e.g. ?season=2026 to list that season's rounds).",
  })
  @ApiParam({ name: 'table', schema: { type: 'string' } })
  @ApiParam({ name: 'column', schema: { type: 'string' } })
  @ApiResponse({ status: 200, description: 'Array of distinct values' })
  @ApiResponse({ status: 400, description: 'Unknown table or column' })
  async getDistinctValues(
    @Param() params: Record<string, string>,
    @Query() query: Request['query'],
  ) {
    try {
      const { table, column } = params;
      const values = await this.adminService.distinct(table, column, query);
      return values;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.handleError(error, 'Failed to fetch values');
    }
  }

  @Get(':table/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Fetch a single row by primary key' })
  @ApiParam({ name: 'table', schema: { type: 'string' } })
  @ApiParam({ name: 'id', schema: { type: 'string' } })
  @ApiResponse({ status: 200, description: 'Record' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getRow(@Param() params: Record<string, string>) {
    try {
      const row = await this.adminService.getOne(params.table, params.id);
      if (!row) throw new HttpException({ error: 'Record not found' }, 404);
      return row;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.handleError(error, 'Failed to fetch record');
    }
  }

  @Post(':table')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a row' })
  @ApiBody({ required: true, schema: { type: 'object' } })
  @ApiParam({ name: 'table', schema: { type: 'string' } })
  @ApiResponse({ status: 201, description: 'Created record' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'Conflict (duplicate key or constraint)' })
  async createRow(@Param() params: Record<string, string>, @Body() body: Record<string, unknown>) {
    try {
      const row = await this.adminService.create(params.table, body || {});
      return row;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.handleError(error, 'Failed to create record');
    }
  }

  @Put(':table/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update a row by primary key' })
  @ApiBody({ required: true, schema: { type: 'object' } })
  @ApiParam({ name: 'table', schema: { type: 'string' } })
  @ApiParam({ name: 'id', schema: { type: 'string' } })
  @ApiResponse({ status: 200, description: 'Updated record' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async updateRow(@Param() params: Record<string, string>, @Body() body: Record<string, unknown>) {
    try {
      const row = await this.adminService.update(params.table, params.id, body || {});
      return row;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.handleError(error, 'Failed to update record');
    }
  }

  @Delete(':table/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a row by primary key' })
  @ApiParam({ name: 'table', schema: { type: 'string' } })
  @ApiParam({ name: 'id', schema: { type: 'string' } })
  @ApiResponse({ status: 200, description: 'Deletion result' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async deleteRow(@Param() params: Record<string, string>) {
    try {
      const result = await this.adminService.remove(params.table, params.id);
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.handleError(error, 'Failed to delete record');
    }
  }
}
