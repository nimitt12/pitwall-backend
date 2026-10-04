import { Body, Controller, HttpCode, HttpException, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}
  @Post('register')
  @HttpCode(201)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      required: ['email', 'password'],
      properties: {
        email: { type: 'string' },
        password: { type: 'string' },
        fullName: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async register(@Body() body: Parameters<AuthService['register']>[0]) {
    try {
      const { email, password, fullName } = body;
      if (!email || !password) {
        throw new HttpException({ message: 'Email and password are required' }, 400);
      }
      const result = await this.authService.register({ email, password, fullName });
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException({ message: error.message }, 400);
    }
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      required: ['email', 'password'],
      properties: { email: { type: 'string' }, password: { type: 'string' } },
    },
  })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() body: { email: string; password: string }) {
    try {
      const { email, password } = body;
      if (!email || !password) {
        throw new HttpException({ message: 'Email and password are required' }, 400);
      }
      const result = await this.authService.login(email, password);
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException({ message: error.message }, 401);
    }
  }

  @Post('google')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login with Google' })
  @ApiBody({
    required: true,
    schema: { type: 'object', required: ['idToken'], properties: { idToken: { type: 'string' } } },
  })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid Google token' })
  async googleLogin(@Body() body: { idToken: string }) {
    try {
      const { idToken } = body;
      if (!idToken) {
        throw new HttpException({ message: 'Google idToken is required' }, 400);
      }
      const result = await this.authService.googleLogin(idToken);
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException({ message: error.message }, 401);
    }
  }
}
