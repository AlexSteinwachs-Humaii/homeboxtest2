// In-process invalidation bus. Names match backend/internal/core/services/reporting/eventbus.
// The WebSocket payload uses the wire names the Vue client already handles
// (tag.mutation, not the internal tags.mutation). No cloud queue, Kafka, NATS, or RabbitMQ.

export const EventTagMutation = "tags.mutation";
export const EventEntityMutation = "entity.mutation";
export const EventUserMutation = "user.mutation";
export const EventExportMutation = "export.mutation";
export const EventImportMutation = "import.mutation";

export const BUS_EVENTS = [
  EventTagMutation,
  EventEntityMutation,
  EventUserMutation,
  EventExportMutation,
  EventImportMutation,
] as const;

export type BusEvent = (typeof BUS_EVENTS)[number];

export const WIRE_EVENT: Record<BusEvent, string> = {
  [EventTagMutation]: "tag.mutation",
  [EventEntityMutation]: "entity.mutation",
  [EventUserMutation]: "user.mutation",
  [EventExportMutation]: "export.mutation",
  [EventImportMutation]: "import.mutation",
};

type Listener = (groupId: string) => void;

class EventBus {
  private readonly subscribers = new Map<BusEvent, Set<Listener>>();

  constructor() {
    for (const event of BUS_EVENTS) this.subscribers.set(event, new Set());
  }

  publish(event: BusEvent, groupId: string): void {
    const listeners = this.subscribers.get(event);
    if (!listeners) throw new Error(`event not found: ${event}`);
    for (const listener of listeners) listener(groupId);
  }

  subscribe(event: BusEvent, listener: Listener): () => void {
    const listeners = this.subscribers.get(event);
    if (!listeners) throw new Error(`event not found: ${event}`);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
}

export const bus = new EventBus();

export function publishEntityMutation(groupId: string): void {
  bus.publish(EventEntityMutation, groupId);
}

export function publishTagMutation(groupId: string): void {
  bus.publish(EventTagMutation, groupId);
}

export function publishUserMutation(groupId: string): void {
  bus.publish(EventUserMutation, groupId);
}

export function publishExportMutation(groupId: string): void {
  bus.publish(EventExportMutation, groupId);
}

export function publishImportMutation(groupId: string): void {
  bus.publish(EventImportMutation, groupId);
}
