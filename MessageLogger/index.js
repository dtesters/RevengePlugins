// NoDelete Plugin (Simplified & Fixed for Revenge/Vendetta)
// Original by meqativ, modified by Lumin to be self-contained and fix loading errors.

// --- Vendetta/Revenge API Setup ---
// Get APIs from the global scope for maximum compatibility.
// The original plugin used `import` statements which don't work when loaded remotely.
const { metro, plugin, patcher, ui } = globalThis.vendetta;
const { FluxDispatcher, moment } = metro.common;
const { storage } = plugin;
const { before } = patcher;
const { findByStoreName } = metro;
const { showToast } = ui.toasts;

// --- Helper Functions (Recreated from missing files) ---

/**
 * The original plugin imported this from a file at "../../common".
 * Since that file can't be loaded, this is a simple replacement for it.
 * It ensures default values are set in the plugin's storage.
 * @param {object} storageObj The storage object to modify.
 * @param {object} defaults The default settings to apply.
 */
function makeDefaults(storageObj, defaults) {
  for (const key in defaults) {
    if (typeof storageObj[key] !== "object" || storageObj[key] === null) {
      if (storageObj[key] === undefined) storageObj[key] = defaults[key];
    } else {
      makeDefaults(storageObj[key], defaults[key]);
    }
  }
}

/**
 * A placeholder for the translation function.
 * For a full fix, the logic from `translations.js` would need to be pasted here.
 * For now, it just returns a basic string.
 * @param {string} find The translation key.
 * @returns {string} The translated (or placeholder) string.
 */
const getTranslation = (find) => {
    const translations = {
        thisMessageWasDeleted: "This message was deleted"
    };
    return translations[find] || find.split(".").pop();
};


// --- Plugin Logic ---

// Set default settings for the plugin on first load.
makeDefaults(storage, {
	ignore: {
		users: [],
		channels: [],
		bots: false,
	},
	timestamps: false,
	ew: false, // 12-hour format for timestamps
});

let MessageStore;
const deleteable = []; // Tracks messages deleted by the user to avoid logging them.
const patches = []; // Holds all our patches so we can easily remove them later.

const NoDeletePlugin = {
    /**
     * This function runs when the plugin is loaded.
     * It sets up the patch to intercept message deletions.
     */
    onLoad() {
        try {
            // This is the core patch. It runs *before* Discord's internal dispatcher
            // processes an action, allowing us to modify it.
            const dispatcherPatch = before("dispatch", FluxDispatcher, (args) => {
                try {
                    // Lazily get the MessageStore once.
                    if (!MessageStore) MessageStore = findByStoreName("MessageStore");
                    
                    const event = args[0];

                    // We only care about single message deletions.
                    if (event?.type !== "MESSAGE_DELETE" || !event?.id || !event?.channelId) {
                        return; // Do nothing for other events.
                    }

                    // Get the full message object from the store before it's deleted.
                    const message = MessageStore.getMessage(event.channelId, event.id);

                    // Check if the message author or type is in our ignore list.
                    if (storage.ignore.users.includes(message?.author?.id)) return;
                    if (storage.ignore.bots && message?.author?.bot) return;

                    // If we just deleted this message ourselves, let it go through.
                    if (deleteable.includes(event.id)) {
                        deleteable.splice(deleteable.indexOf(event.id), 1);
                        return args;
                    }
                    deleteable.push(event.id); // Mark for potential self-delete loop.

                    // Create the "deleted message" text.
                    let automodMessage = getTranslation("thisMessageWasDeleted");
                    if (storage.timestamps) {
                        const timeFormat = storage.ew ? "hh:mm:ss.SS a" : "HH:mm:ss.SS";
                        automodMessage += ` (${moment().format(timeFormat)})`;
                    }

                    // Here's the magic: we swap the "MESSAGE_DELETE" event with a
                    // "MESSAGE_EDIT_FAILED_AUTOMOD" event. This makes Discord display
                    // a small red message under the original message content.
                    args[0] = {
                        type: "MESSAGE_EDIT_FAILED_AUTOMOD",
                        messageData: {
                            type: 1,
                            message: { channelId: event.channelId, messageId: event.id },
                        },
                        errorResponseBody: {
                            code: 200000, // A fake error code.
                            message: automodMessage,
                        },
                    };
                    return args; // Return the modified event.
                } catch (e) {
                    console.error("Error in NoDelete dispatcher patch:", e);
                }
            });
            patches.push(dispatcherPatch); // Save the unpatch function.

        } catch (e) {
            console.error("Failed to load NoDelete plugin:", e);
            showToast("NoDelete plugin failed to load.");
        }
    },

    /**
     * This function runs when the plugin is unloaded.
     * It cleans up by removing all the patches we applied.
     */
    onUnload() {
        for (const unpatch of patches) {
            try {
                unpatch();
            } catch (e) {
                console.error("Failed to unpatch NoDelete:", e);
            }
        }
        patches.length = 0; // Clear the array for safety.
    },
    
    /**
     * The settings UI is not included in this fix. To make it work, the code 
     * from `settings.jsx` would need to be completely rewritten using 
     * `React.createElement` instead of JSX, and all its dependencies would
     * need to be integrated into this file.
     */
    settings: undefined 
};

// Export the main plugin object using `module.exports`, which is the format
// that Vendetta/Revenge's plugin loader expects.
module.exports = NoDeletePlugin;
