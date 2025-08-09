// NoDelete+ plugin for Revenge/Vendetta
// - Logs deleted and edited messages (including embeds)
// - Replaces per-message dismiss with Channel long-press "Clear log"

import { storage } from "@vendetta/plugin";
import { after, before } from "@vendetta/patcher";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher, React } from "@vendetta/metro/common";
import { findInReactTree } from "@vendetta/utils";
import { showToast } from "@vendetta/ui/toasts";

// Core Discord stores/actions
const MessageActions = findByProps("sendMessage", "receiveMessage", "editMessage");
const MessageStore = findByStoreName("MessageStore");

// ActionSheet for context-menu injection
const ActionSheet = findByProps("openLazy", "hideActionSheet");
const ASComponents = findByProps("ActionSheetRow", "ActionSheetSection", "ActionSheetTitleHeader");

// Initialize storage shape
if (!storage.logs) storage.logs = {}; // { [channelId: string]: LogEntry[] }
if (!storage.uiMessageIds) storage.uiMessageIds = {}; // { [channelId: string]: string[] }

/**
 * @typedef {Object} LogEntry
 * @property {"delete"|"edit"} type
 * @property {string} messageId
 * @property {string} channelId
 * @property {any} author
 * @property {number} timestamp
 * @property {string=} contentBefore
 * @property {string=} contentAfter
 * @property {any[]=} embedsBefore
 * @property {any[]=} embedsAfter
 */

const patches = [];

function ensureChannelLog(channelId) {
  if (!storage.logs[channelId]) storage.logs[channelId] = [];
  return storage.logs[channelId];
}

function ensureChannelUiIds(channelId) {
  if (!storage.uiMessageIds[channelId]) storage.uiMessageIds[channelId] = [];
  return storage.uiMessageIds[channelId];
}

function safeGetMessage(channelId, messageId, fallback) {
  try {
    return MessageStore?.getMessage?.(channelId, messageId) ?? fallback;
  } catch {
    return fallback;
  }
}

function formatEmbed(embed) {
  if (!embed) return "";
  const segments = [];
  if (embed.title) segments.push(`• ${embed.title}`);
  if (embed.description) segments.push(embed.description);
  if (Array.isArray(embed.fields) && embed.fields.length) {
    for (const field of embed.fields) {
      if (!field) continue;
      const name = field.name ?? "";
      const value = field.value ?? "";
      segments.push(`${name}: ${value}`);
    }
  }
  if (embed.url) segments.push(embed.url);
  return segments.join("\n");
}

function summarizeEmbeds(embeds) {
  if (!Array.isArray(embeds) || embeds.length === 0) return null;
  const parts = embeds.map(formatEmbed).filter(Boolean);
  return parts.length ? parts.join("\n---\n") : null;
}

function injectLocalLogMessage(channelId, content, embedsText) {
  if (!MessageActions?.receiveMessage) return;
  const id = `nodelete_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const message = {
    id,
    type: 0,
    flags: 0,
    channel_id: channelId,
    content,
    author: {
      id: "0",
      username: "NoDelete",
      discriminator: "0000",
      avatar: null,
      bot: true,
    },
  };
  // Append textual representation of embeds under content to avoid RN embed rendering pitfalls
  if (embedsText) {
    message.content += `\n\nEmbeds:\n${embedsText}`;
  }
  try {
    MessageActions.receiveMessage(channelId, message);
  } catch {}
  try {
    ensureChannelUiIds(channelId).push(id);
  } catch {}
}

function onMessageDeleted(payload) {
  const channelId = payload?.channelId ?? payload?.channel_id;
  const messageId = payload?.id;
  if (!channelId || !messageId) return;

  // Ignore plugin-generated entries
  if (String(messageId).startsWith("nodelete_")) return;

  const candidate = payload?.message ?? safeGetMessage(channelId, messageId, null);
  if (!candidate) return;

  const author = candidate.author ?? { id: "unknown", username: "Unknown" };
  const contentBefore = candidate.content || "";
  const embedsBefore = candidate.embeds || [];
  const embedsText = summarizeEmbeds(embedsBefore);

  /** @type {LogEntry} */
  const entry = {
    type: "delete",
    messageId,
    channelId,
    author,
    timestamp: Date.now(),
    contentBefore,
    embedsBefore,
  };
  ensureChannelLog(channelId).push(entry);

  const who = author?.username ?? "Unknown";
  const summary = contentBefore?.length ? contentBefore : "[no content]";
  injectLocalLogMessage(channelId, `deleted message by ${who}:\n${summary}`, embedsText);
}

function onMessageDeletedBulk(payload) {
  const channelId = payload?.channelId ?? payload?.channel_id;
  const ids = payload?.ids;
  if (!channelId || !Array.isArray(ids)) return;
  for (const messageId of ids) {
    if (String(messageId).startsWith("nodelete_")) continue;
    onMessageDeleted({ channelId, id: messageId });
  }
}

// For edits we patch dispatch BEFORE stores update, so we can read the old message content/embeds
function setupMessageUpdateBeforePatch() {
  const unpatch = before("dispatch", FluxDispatcher, ([action]) => {
    if (!action || action.type !== "MESSAGE_UPDATE") return;
    const payload = action;
    const channelId = payload?.channelId ?? payload?.message?.channel_id ?? payload?.message?.channelId;
    const messageId = payload?.message?.id ?? payload?.id;
    if (!channelId || !messageId) return;

    const oldMessage = safeGetMessage(channelId, messageId, null);
    const newMessage = payload?.message ?? null;
    if (!newMessage) return;

    const oldContent = oldMessage?.content ?? "";
    const newContent = newMessage?.content ?? "";
    const oldEmbeds = oldMessage?.embeds ?? [];
    const newEmbeds = newMessage?.embeds ?? [];

    // If nothing changed (rare), do nothing
    const contentChanged = oldContent !== newContent;
    const embedsChanged = JSON.stringify(oldEmbeds) !== JSON.stringify(newEmbeds);
    if (!contentChanged && !embedsChanged) return;

    const author = (newMessage?.author ?? oldMessage?.author) || { id: "unknown", username: "Unknown" };

    /** @type {LogEntry} */
    const entry = {
      type: "edit",
      messageId,
      channelId,
      author,
      timestamp: Date.now(),
      contentBefore: oldContent,
      contentAfter: newContent,
      embedsBefore: oldEmbeds,
      embedsAfter: newEmbeds,
    };
    ensureChannelLog(channelId).push(entry);

    const who = author?.username ?? "Unknown";
    const embedsBeforeText = summarizeEmbeds(oldEmbeds);
    const embedsAfterText = summarizeEmbeds(newEmbeds);
    let content = `edited message by ${who}`;
    if (contentChanged) content += `\nBefore:\n${oldContent || "[no content]"}\nAfter:\n${newContent || "[no content]"}`;
    // Only include embeds if changed or if both are empty but message had embed-only changes
    const embedLines = [];
    if (embedsChanged || embedsBeforeText || embedsAfterText) {
      if (embedsBeforeText) embedLines.push(`Embeds (before):\n${embedsBeforeText}`);
      if (embedsAfterText) embedLines.push(`Embeds (after):\n${embedsAfterText}`);
    }
    injectLocalLogMessage(channelId, content, embedLines.length ? embedLines.join("\n\n") : null);
  });
  patches.push(unpatch);
}

function setupDeleteSubscriptions() {
  const onSingle = onMessageDeleted.bind(null);
  const onBulk = onMessageDeletedBulk.bind(null);
  FluxDispatcher.subscribe("MESSAGE_DELETE", onSingle);
  FluxDispatcher.subscribe("MESSAGE_DELETE_BULK", onBulk);
  patches.push(() => {
    FluxDispatcher.unsubscribe("MESSAGE_DELETE", onSingle);
    FluxDispatcher.unsubscribe("MESSAGE_DELETE_BULK", onBulk);
  });
}

function addChannelClearLogContext() {
  const unpatch = after("openLazy", ActionSheet, (args, ret) => {
    const [factory] = args ?? [];
    if (!factory) return;
    const name = factory.name ?? factory.displayName;
    if (name !== "ChannelLongPressActionSheet") return;

    // ret is a promise resolving to the sheet module
    ret?.then?.((sheet) => {
      const orig = sheet?.default;
      if (!orig) return;

      sheet.default = (props) => {
        const res = orig(props);
        try {
          const rowsContainer = findInReactTree(res, (node) => Array.isArray(node) && node.some((c) => c?.type === ASComponents.ActionSheetRow));
          if (Array.isArray(rowsContainer)) {
            rowsContainer.push(
              React.createElement(ASComponents.ActionSheetRow, {
                key: "nodelete-clear-log",
                label: "Clear log",
                onPress: () => {
                  try {
                    const channelId = props?.channel?.id ?? props?.channelId;
                    if (channelId) {
                      // Clear stored logs
                      if (storage.logs[channelId]) storage.logs[channelId] = [];
                      // Remove previously injected UI log messages
                      const ids = ensureChannelUiIds(channelId);
                      for (const id of ids) {
                        try {
                          FluxDispatcher.dispatch({ type: "MESSAGE_DELETE", channelId, id });
                        } catch {}
                      }
                      storage.uiMessageIds[channelId] = [];
                    }
                    showToast("Cleared NoDelete log", 1);
                  } catch {}
                  ActionSheet.hideActionSheet();
                },
              })
            );
          }
        } catch {}
        return res;
      };
    });
  });
  patches.push(unpatch);
}

export const onLoad = () => {
  setupMessageUpdateBeforePatch();
  setupDeleteSubscriptions();
  addChannelClearLogContext();
};

export const onUnload = () => {
  while (patches.length) {
    try { const un = patches.pop(); un && un(); } catch {}
  }
};


