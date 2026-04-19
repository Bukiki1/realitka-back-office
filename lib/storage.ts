import type { UIMessage } from "@/components/ChatMessage";
import type { Conversation } from "@/components/Sidebar";

const KEY_CONVERSATIONS = "realitka.conversations.v1";
const KEY_MESSAGES = (id: string) => `realitka.messages.${id}`;

export function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY_CONVERSATIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveConversations(list: Conversation[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY_CONVERSATIONS, JSON.stringify(list));
}

export function loadMessages(id: string): UIMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY_MESSAGES(id));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveMessages(id: string, msgs: UIMessage[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY_MESSAGES(id), JSON.stringify(msgs));
}

export function deleteConversationStorage(id: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY_MESSAGES(id));
}
