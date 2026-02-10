import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Crea un decorador de parámetro `@GetUser()` que extrae el objeto `user`
 * inyectado en la request por el `AuthGuard`.
 *
 * @example
 * // Para obtener el objeto user completo:
 * someMethod(@GetUser() user: User)
 *
 * // Para obtener una propiedad específica del usuario:
 * someMethod(@GetUser('username') username: string)
 */
export const GetUser = createParamDecorator(
    (data: string, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        const user = request.user;

        return data ? user?.[data] : user;
    },
);