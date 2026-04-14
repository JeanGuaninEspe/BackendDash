import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Namespace, Server, Socket } from 'socket.io';
import { REstadisticoService } from './r-estadistico.service';
import { REstadisticoQueryDto } from './dto/r-estadistico-query.dto';

interface LiveTransitSubscription {
  idPeaje?: number;
  nombrePeaje?: string;
  formaPago?: string;
}

@WebSocketGateway({
  namespace: '/r-estadistico-live',
  path: '/v1/socket.io',
  cors: {
    origin: [
      'http://localhost:4321',
      'http://192.168.80.39:4321',
      'http://192.168.80.39:3001',
      'https://vial25dash.pages.dev',
      'https://0q44x1tx-4321.use2.devtunnels.ms',
      'https://app.vial25.dpdns.org',
    ],
    credentials: true,
  },
})
export class REstadisticoLiveGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer()
  server!: Server | Namespace;

  private readonly logger = new Logger(REstadisticoLiveGateway.name);
  private readonly pollIntervalMs = 15000;
  private readonly subscriptions = new Map<string, Map<string, LiveTransitSubscription>>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly rEstadisticoService: REstadisticoService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.broadcastLiveUpdates();
    }, this.pollIntervalMs);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  handleConnection(client: Socket) {
    client.emit('connected', {
      namespace: '/r-estadistico-live',
      path: '/v1/socket.io',
      message: 'Conectado. Puedes suscribirte varias veces con evento subscribe-transito-hoy.',
      intervalMs: this.pollIntervalMs,
    });
  }

  handleDisconnect(client: Socket) {
    this.subscriptions.delete(client.id);
  }

  @SubscribeMessage('subscribe-transito-hoy')
  async subscribeTransitoHoy(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: LiveTransitSubscription,
  ) {
    const subscription = this.normalizeSubscription(payload);
    const key = this.getSubscriptionKey(subscription);
    const current = this.subscriptions.get(client.id) ?? new Map<string, LiveTransitSubscription>();
    current.set(key, subscription);
    this.subscriptions.set(client.id, current);

    const result = await this.rEstadisticoService.getTodayTransitLive(this.toQueryDto(subscription));

    client.emit('transito-hoy-update', {
      ...result,
      subscription,
    });

    return {
      ok: true,
      event: 'subscribe-transito-hoy',
      intervalMs: this.pollIntervalMs,
      subscription,
      totalSubscriptions: current.size,
    };
  }

  @SubscribeMessage('unsubscribe-transito-hoy')
  unsubscribeTransitoHoy(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload?: LiveTransitSubscription,
  ) {
    const current = this.subscriptions.get(client.id);
    if (!current) {
      return {
        ok: true,
        event: 'unsubscribe-transito-hoy',
        totalSubscriptions: 0,
      };
    }

    if (payload && Object.keys(this.normalizeSubscription(payload)).length > 0) {
      const key = this.getSubscriptionKey(this.normalizeSubscription(payload));
      current.delete(key);
      if (current.size === 0) {
        this.subscriptions.delete(client.id);
      } else {
        this.subscriptions.set(client.id, current);
      }
    } else {
      this.subscriptions.delete(client.id);
    }

    return {
      ok: true,
      event: 'unsubscribe-transito-hoy',
      totalSubscriptions: this.subscriptions.get(client.id)?.size ?? 0,
    };
  }

  private normalizeSubscription(payload: LiveTransitSubscription | undefined): LiveTransitSubscription {
    if (!payload) return {};

    const normalized: LiveTransitSubscription = {};

    if (typeof payload.idPeaje === 'number' && Number.isFinite(payload.idPeaje)) {
      normalized.idPeaje = payload.idPeaje;
    }

    if (typeof payload.nombrePeaje === 'string' && payload.nombrePeaje.trim().length > 0) {
      normalized.nombrePeaje = payload.nombrePeaje.trim();
    }

    if (typeof payload.formaPago === 'string' && payload.formaPago.trim().length > 0) {
      normalized.formaPago = payload.formaPago.trim();
    }

    return normalized;
  }

  private toQueryDto(subscription: LiveTransitSubscription): REstadisticoQueryDto {
    return {
      idPeaje: subscription.idPeaje,
      nombrePeaje: subscription.nombrePeaje,
      formaPago: subscription.formaPago,
      formaDePago: subscription.formaPago,
    };
  }

  private getSubscriptionKey(subscription: LiveTransitSubscription) {
    return JSON.stringify({
      idPeaje: subscription.idPeaje ?? null,
      nombrePeaje: subscription.nombrePeaje ?? null,
      formaPago: subscription.formaPago ?? null,
    });
  }

  private findSocketById(socketId: string) {
    const host = this.server as unknown as {
      sockets?: Map<string, Socket> | { sockets?: Map<string, Socket> };
    };

    const directMap = host.sockets;
    if (directMap instanceof Map) {
      return directMap.get(socketId);
    }

    const nestedMap = directMap?.sockets;
    if (nestedMap instanceof Map) {
      return nestedMap.get(socketId);
    }

    return undefined;
  }

  private async broadcastLiveUpdates() {
    if (this.subscriptions.size === 0) return;

    const grouped = new Map<string, { sub: LiveTransitSubscription; socketIds: string[] }>();

    this.subscriptions.forEach((subsByKey, socketId) => {
      subsByKey.forEach((sub, key) => {
        const current = grouped.get(key);
        if (current) {
          current.socketIds.push(socketId);
        } else {
          grouped.set(key, { sub, socketIds: [socketId] });
        }
      });
    });

    for (const { sub, socketIds } of grouped.values()) {
      try {
        const result = await this.rEstadisticoService.getTodayTransitLive(this.toQueryDto(sub));
        socketIds.forEach((socketId) => {
          const socket = this.findSocketById(socketId);
          if (!socket) {
            this.subscriptions.delete(socketId);
            return;
          }

          socket.emit('transito-hoy-update', {
            ...result,
            subscription: sub,
          });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido al actualizar transito en vivo.';
        this.logger.error(message);
      }
    }
  }
}
