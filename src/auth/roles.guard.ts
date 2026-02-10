import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from './roles.enum';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (!requiredRoles) {
            // Si no hay roles requeridos, permite el acceso
            return true;
        }

        const { user } = context.switchToHttp().getRequest();

        if (!user || !user.roles) {
            // Si no hay usuario o no tiene roles, niega el acceso
            return false;
        }

        // Verifica si el usuario tiene al menos uno de los roles requeridos
        return requiredRoles.some((role) => user.roles.includes(role));
    }
}
