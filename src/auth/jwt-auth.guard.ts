import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard personalizado para autenticación JWT.
 * Simplifica el uso del guard JWT en los controladores.
 * 
 * @example
 * @UseGuards(JwtAuthGuard)
 * @Get('protected')
 * getProtectedData() {
 *   return 'This is protected data';
 * }
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

