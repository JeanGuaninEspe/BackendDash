import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from './jwt.strategy';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
    constructor(
        private jwtService: JwtService,
        private configService: ConfigService,
    ) { }

    private cachedUsers: Array<{
        id: number;
        username: string;
        passwordHash: string;
        roles: number[];
        idPeaje?: number;
        nombre?: string;
        apellido?: string;
        telefono?: string;
        imagen?: string;
        grupo?: number;
        estado?: number;
    }> | null = null;

    async signIn(username: string, pass: string): Promise<{ 
        access_token: string;
        refresh_token: string;
        user: {
            id: number;
            usuario: string;
            nombre: string;
            roles: number[];
        };
    }> {
        const user = this.findUserByUsername(username);
        if (!user) {
            throw new UnauthorizedException('Credenciales incorrectas');
        }

        if (user.estado !== undefined && user.estado !== 1) {
            throw new UnauthorizedException('Usuario inactivo');
        }

        const isPasswordValid = await this.comparePassword(pass, user.passwordHash);

        if (!isPasswordValid) {
            throw new UnauthorizedException('Credenciales incorrectas');
        }

        const userRoles: number[] = user.roles || [];
        const userPeajeId = user.idPeaje ?? null;
        const tokens = await this.signTokens(user.id, user.username, userRoles, userPeajeId);

        return {
            ...(await tokens),
            user: this.buildUserSummary(user, userRoles),
        };
    }

    async refreshTokens(refreshToken: string) {
        const { tokens, userSummary } = await this.verifyAndRotateRefreshToken(refreshToken);
        return {
            ...(await tokens),
            user: userSummary,
        };
    }

    async getProfile(userId: number) {
        const user = this.findUserById(userId);
        if (!user) {
            throw new UnauthorizedException('Usuario no encontrado');
        }
        const userRoles: number[] = user.roles || [];
        return this.buildUserProfile(user, userRoles, user.idPeaje ?? null);
    }

    /**
     * Compara la contraseña proporcionada con la almacenada.
     * Intenta primero con bcrypt, si falla compara en texto plano (para migración gradual).
     */
    private async comparePassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
        return await bcrypt.compare(plainPassword, hashedPassword);
    }

    private async signTokens(userId: number, username: string, roles: number[], idPeaje?: number | null) {
        const payload = {
            sub: userId,
            username,
            roles,
            idPeaje: idPeaje ?? undefined,
        };

        const refreshSecret = this.getRefreshSecret();
        const refreshExpiresIn = (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d') as JwtSignOptions['expiresIn'];

        const accessToken = this.jwtService.sign(payload);
        const refreshToken = this.jwtService.sign(payload, {
            secret: refreshSecret,
            expiresIn: refreshExpiresIn,
        });

        return {
            access_token: accessToken,
            refresh_token: refreshToken,
        };
    }

    async verifyAndRotateRefreshToken(incomingRefreshToken: string) {
        const refreshSecret = this.getRefreshSecret();

        let payload: JwtPayload;
        try {
            payload = await this.jwtService.verifyAsync<JwtPayload>(incomingRefreshToken, {
                secret: refreshSecret,
            });
        } catch (error) {
            throw new UnauthorizedException('Refresh token inválido');
        }

        const user = this.findUserById(payload.sub);
        if (!user) {
            throw new UnauthorizedException('Usuario no encontrado');
        }
        if (user.estado !== undefined && user.estado !== 1) {
            throw new UnauthorizedException('Usuario inactivo');
        }

        const userRoles: number[] = user.roles || [];
        const userPeajeId = user.idPeaje ?? null;
        const tokens = await this.signTokens(user.id, user.username, userRoles, userPeajeId);

        return {
            tokens,
            userSummary: this.buildUserSummary(user, userRoles),
        };
    }

    private getRefreshSecret(): string {
        const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');
        const fallbackSecret = this.configService.get<string>('JWT_SECRET');

        if (refreshSecret) {
            return refreshSecret;
        }

        if (!fallbackSecret) {
            throw new UnauthorizedException('No se ha configurado el secreto para JWT');
        }

        return fallbackSecret;
    }

    getRefreshTtlMs(): number {
        const raw = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d';
        const match = raw.match(/^(\d+)([smhd])?$/);
        if (match) {
            const value = Number(match[1]);
            const unit = match[2] ?? 's';
            const factor: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
            return value * (factor[unit] ?? 1000);
        }
        // fallback: 7 días
        return 7 * 24 * 60 * 60 * 1000;
    }

    private buildUserSummary(user: any, userRoles: number[]) {
        return {
            id: user.id,
            usuario: user.username,
            nombre: user.nombre ?? user.username,
            roles: userRoles,
        };
    }

    private buildUserProfile(user: any, userRoles: number[], idPeaje: number | null) {
        return {
            id: user.id,
            usuario: user.username,
            nombre: user.nombre ?? user.username,
            apellido: user.apellido,
            telefono: user.telefono,
            imagen: user.imagen,
            grupo: user.grupo,
            estado: user.estado,
            roles: userRoles,
            idPeaje: idPeaje ?? undefined,
        };
    }

    private loadUsersFromEnv() {
        if (this.cachedUsers) return this.cachedUsers;
        const raw = this.configService.get<string>('AUTH_USERS') || '[]';
        let parsed: any;
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw new UnauthorizedException('AUTH_USERS no tiene un JSON valido');
        }

        if (!Array.isArray(parsed)) {
            throw new UnauthorizedException('AUTH_USERS debe ser un arreglo de usuarios');
        }

        this.cachedUsers = parsed.map((user, index) => {
            if (!user.username || !user.passwordHash) {
                throw new UnauthorizedException(`AUTH_USERS invalido en indice ${index}`);
            }
            return {
                id: Number(user.id ?? index + 1),
                username: String(user.username),
                passwordHash: String(user.passwordHash),
                roles: Array.isArray(user.roles) ? user.roles.map((r: any) => Number(r)) : [],
                idPeaje: user.idPeaje !== undefined ? Number(user.idPeaje) : undefined,
                nombre: user.nombre ? String(user.nombre) : undefined,
                apellido: user.apellido ? String(user.apellido) : undefined,
                telefono: user.telefono ? String(user.telefono) : undefined,
                imagen: user.imagen ? String(user.imagen) : undefined,
                grupo: user.grupo !== undefined ? Number(user.grupo) : undefined,
                estado: user.estado !== undefined ? Number(user.estado) : undefined,
            };
        });

        return this.cachedUsers;
    }

    private findUserByUsername(username: string) {
        const users = this.loadUsersFromEnv();
        return users.find(u => u.username.toLowerCase() === username.toLowerCase());
    }

    private findUserById(userId: number) {
        const users = this.loadUsersFromEnv();
        return users.find(u => u.id === userId);
    }
}
