export enum Role {
    ADMINISTRADOR = 1,
    SUPERVISOR = 2,
    CAJERO = 3,
    SECRETARIA = 4,
    ANALISTAS = 5,
    JEFE_OPERATIVO = 6,
}

export const RoleDescriptions: Record<Role, string> = {
    [Role.ADMINISTRADOR]: 'Encargada de venta y recargas de Tag',
    [Role.SUPERVISOR]: 'Encargado de entrega y recuado de aperturas, canjes y retiros parciales',
    [Role.CAJERO]: 'Encargado de la recoleccion del dinero',
    [Role.SECRETARIA]: 'Encargada de venta y recargas de Tag',
    [Role.ANALISTAS]: 'Encargado de analisis de reportes financieros',
    [Role.JEFE_OPERATIVO]: 'Encargado de la Liquidacion de turno',
};
