import { Body, Controller, Get, Post, HttpCode, HttpStatus, Req, Res, UseGuards, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './Dto/login.dto';
import { RefreshTokenDto } from './Dto/refresh-token.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import express from 'express';

@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService) { }

    @HttpCode(HttpStatus.OK)
    @Post('login')
    async signIn(@Body() signInDto: LoginDto, @Res({ passthrough: true }) res: express.Response) {
        const result = await this.authService.signIn(signInDto.username, signInDto.password);
        this.setAccessCookie(res, result.access_token);
        this.setRefreshCookie(res, result.refresh_token);
        return {
            access_token: result.access_token,
        
            user: result.user,
        };
    }

    @HttpCode(HttpStatus.OK)
    @Post('refresh')
    async refresh(@Req() req: any, @Res({ passthrough: true }) res: express.Response, @Body() dto: RefreshTokenDto) {
        const cookieToken = this.extractCookie(req, 'refresh_token');
        const token = cookieToken || dto?.refreshToken;
        if (!token) {
            throw new BadRequestException('Refresh token requerido');
        }

        const result = await this.authService.refreshTokens(token);
        this.setAccessCookie(res, result.access_token);
        this.setRefreshCookie(res, result.refresh_token);
        return {
            access_token: result.access_token,
            user: result.user,
        };
    }

    @UseGuards(JwtAuthGuard)
    @Get('me')
    me(@Req() req: any) {
        return this.authService.getProfile(req.user.userId);
    }

    @HttpCode(HttpStatus.OK)
    @Post('logout')
    logout(@Res({ passthrough: true }) res: express.Response) {
       res.clearCookie("access_token", { path: "/", sameSite: "none", secure: true })
res.clearCookie("refresh_token", { path: "/api/auth/refresh", sameSite: "none", secure: true })
return { ok: true };
    }

    private setRefreshCookie(res: express.Response, refreshToken: string) {
        if (!refreshToken) return;
        const maxAge = this.authService.getRefreshTtlMs();
        res.cookie('refresh_token', refreshToken, {
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            path: '/api/auth/refresh',
            maxAge,
        });
    }

    private setAccessCookie(res: express.Response, accessToken: string) {
        if (!accessToken) return;
        const maxAge = 60 * 60 * 1000;
        res.cookie('access_token', accessToken, {
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            path: '/',
            maxAge,
        });
    }

    private extractCookie(req: any, name: string): string | undefined {
        // Soporte sin cookie-parser: parsea manualmente el header Cookie
        const cookiesHeader: string | undefined = req?.headers?.cookie;
        if (!cookiesHeader) return undefined;
        const cookies = cookiesHeader.split(';').map((c: string) => c.trim());
        const target = cookies.find((c: string) => c.startsWith(`${name}=`));
        if (!target) return undefined;
        const value = target.substring(name.length + 1);
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    }
}
