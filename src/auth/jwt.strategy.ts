import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

export interface JwtPayload {
    sub: number; // 'sub' (subject) suele ser el ID del usuario
    username: string;
    roles: number[]; // Roles del usuario
    idPeaje?: number; // Peaje asignado (si aplica)
    iat?: number; // Issued At (generado automáticamente por JWT)
    exp?: number; // Expiration (generado automáticamente por JWT)
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(private configService: ConfigService) {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
            throw new Error('JWT_SECRET no está configurado en las variables de entorno');
        }
        
        super({
            jwtFromRequest: ExtractJwt.fromExtractors([
                (req) => {
                    const cookiesHeader: string | undefined = req?.headers?.cookie;
                    if (!cookiesHeader) return null;
                    const cookies = cookiesHeader.split(';').map((c: string) => c.trim());
                    const target = cookies.find((c: string) => c.startsWith('access_token='));
                    if (!target) return null;
                    const value = target.substring('access_token='.length);
                    try {
                        return decodeURIComponent(value);
                    } catch {
                        return value;
                    }
                },
                ExtractJwt.fromAuthHeaderAsBearerToken(),
            ]),
            ignoreExpiration: false,
            secretOrKey: secret,
        });
    }

    /**
     * Passport primero verifica la firma del JWT y decodifica el JSON.
     * Luego invoca este método `validate()` pasando el JSON decodificado
     * como su único parámetro.
     * Lo que retornemos aquí se asignará a `request.user`.
     */
    async validate(payload: JwtPayload) {
        // El token es válido, el payload está extraído.
        // Aquí podrías hacer una consulta a la BD para verificar si el usuario
        // sigue activo, no ha sido baneado, etc.
        if (!payload.sub || !payload.username) {
            throw new UnauthorizedException('Token inválido: faltan datos requeridos en el payload');
        }
        return { 
            userId: payload.sub, 
            username: payload.username,
            roles: payload.roles || [], // Incluir roles en el objeto user
            idPeaje: payload.idPeaje,
        };
    }
}
