export const NOTIFICATIONS_CHANGED_EVENT = "rq:notifications-changed";

export function announceNotificationsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}
