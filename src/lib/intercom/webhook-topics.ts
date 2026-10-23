/**
 * One topic map for the one Intercom receiver POST /api/intercom/webhook
 * (a-intercom-into-n2n3-1021: a-intercom-telegram-bridge's map plus
 * a-intercom-suppression-sync's topics). Each topic carries its own
 * default-off flag; the route answers 404 while no topic is on.
 *
 * prepare() runs before the response:
 *   "retry"                 503 so Intercom resends
 *   { status, body }        that exact answer (the unsubscribe path does its
 *                           whole durable write here, never after the 200)
 *   () => Promise<unknown>  a 200 now, the function runs after the response
 *   null                    a 200, nothing to do
 */
import { intercomWebhookEnabled } from "@/lib/intercom/api";
import {
  isTelegramIntercomBridgeEnabled,
  prepareAdminReply,
  type IntercomNotification as BridgeNotification,
} from "@/lib/intercom/telegram-bridge";
import { handleUnsubscribeNotification, type WebhookAnswer } from "@/lib/intercom/unsubscribe-webhook";

export type TopicPreparation = "retry" | null | WebhookAnswer | (() => Promise<unknown>);

export interface IntercomTopicHandler {
  enabled: () => boolean;
  prepare: (notification: unknown) => Promise<TopicPreparation>;
}

const unsubscribe: IntercomTopicHandler = {
  enabled: intercomWebhookEnabled,
  prepare: (notification) => handleUnsubscribeNotification(notification),
};

export const INTERCOM_WEBHOOK_TOPICS: Record<string, IntercomTopicHandler> = {
  "conversation.admin.replied": {
    enabled: isTelegramIntercomBridgeEnabled,
    prepare: async (notification) => {
      const prepared = await prepareAdminReply(notification as BridgeNotification);
      if (prepared.status === "store_unavailable") return "retry";
      return prepared.status === "ready" ? prepared.run : null;
    },
  },
  "contact.unsubscribed": unsubscribe,
  "granular.unsubscribe": unsubscribe,
};

export function anyIntercomTopicEnabled(): boolean {
  return Object.values(INTERCOM_WEBHOOK_TOPICS).some((t) => t.enabled());
}
