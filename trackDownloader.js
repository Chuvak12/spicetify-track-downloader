/**
 * @file trackDownloader.js
 * @version v0.1.6
 * @description Modular Spicetify extension for track downloading via ContextMenu.
 */

(function TrackDownloaderExtension() {
    'use strict';

    /**
     * Immutable system constants.
     * @readonly
     */
    const EXTENSION_CONSTANTS = Object.freeze({
        EXTENSION_NAME: 'TrackDownloader',
        VERSION: 'v0.1.6',
        STORAGE_KEY: 'spicetify_track_downloader_config_v1',
        MENU_ITEM_LABEL: 'Download Track',
        MENU_ITEM_ICON: 'download',
        FETCH_TIMEOUT_MS: 15000,
        SELECT_FOLDER_PATH: '/api/v1/select-folder',
        SETTINGS_MENU_LABEL: 'Track Downloader Settings',
        SUPPORTED_FORMATS: Object.freeze(['flac', 'mp3', 'wav', 'ogg', 'opus', 'm4a'])
    });

    /**
     * @typedef {Object} TrackMetadata
     * @property {string} uri - Spotify Track URI (e.g., "spotify:track:...")
     * @property {string} id - Spotify Track ID
     * @property {string} name - Track title
     * @property {string} artist - Primary artist(s) name
     * @property {number} durationMs - Track duration in milliseconds
     */

    /**
     * @typedef {Object} ExtensionConfig
     * @property {string} defaultDownloadPath - Default directory path for primary action
     * @property {string} endpointUrl - Backend/service endpoint URL for processing downloads
     * @property {string} audioFormat - Preferred audio container/codec
     * @property {boolean} alwaysAskPath - Flag to force path selection on primary action
     */

    /**
     * @typedef {Object} DownloadPayload
     * @property {TrackMetadata} metadata - Extracted track metadata
     * @property {string} targetPath - Destination directory path
     * @property {'PRIMARY' | 'SECONDARY'} mode - Execution flow mode
     * @property {number} timestamp - Request creation timestamp
     */

    /**
     * @typedef {Object} DownloadProvider
     * @property {string} id - Unique provider identifier
     * @property {(payload: DownloadPayload, config: Readonly<ExtensionConfig>) => Promise<void>} execute - Provider execution method
     */

    // =========================================================================
    // MODULE: Config
    // =========================================================================

    class ConfigManager {
        constructor() {
            /** @type {Readonly<ExtensionConfig>} */
            this.defaultConfig = Object.freeze({
                defaultDownloadPath: '~/Music/SpotifyDownloads',
                endpointUrl: 'http://127.0.0.1:48915/api/v1/download',
                audioFormat: 'flac',
                alwaysAskPath: false
            });

            /** @type {ExtensionConfig} */
            this.currentConfig = { ...this.defaultConfig };
        }

        /**
         * Validates a configuration key-value pair against expected schema and types.
         * @template {keyof ExtensionConfig} K
         * @param {K} key
         * @param {unknown} value
         * @returns {boolean}
         */
        validateKeyValue(key, value) {
            if (!Object.prototype.hasOwnProperty.call(this.defaultConfig, key)) {
                return false;
            }

            switch (key) {
                case 'defaultDownloadPath':
                case 'audioFormat':
                    return typeof value === 'string' && value.trim().length > 0;
                case 'endpointUrl':
                    if (typeof value !== 'string' || value.trim().length === 0) {
                        return false;
                    }
                    try {
                        const parsed = new URL(value);
                        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
                    } catch {
                        return false;
                    }
                case 'alwaysAskPath':
                    return typeof value === 'boolean';
                default:
                    return false;
            }
        }

        /**
         * Initializes configuration from Spicetify.LocalStorage with schema validation.
         * @returns {Readonly<ExtensionConfig>}
         */
        init() {
            try {
                const rawData = Spicetify.LocalStorage.get(EXTENSION_CONSTANTS.STORAGE_KEY);
                if (rawData) {
                    const parsed = JSON.parse(rawData);
                    const validatedConfig = { ...this.defaultConfig };

                    if (parsed && typeof parsed === 'object') {
                        for (const key of Object.keys(this.defaultConfig)) {
                            const typedKey = /** @type {keyof ExtensionConfig} */ (key);
                            if (this.validateKeyValue(typedKey, parsed[typedKey])) {
                                // @ts-ignore - Dynamic assignment after strict validation
                                validatedConfig[typedKey] = parsed[typedKey];
                            }
                        }
                    }
                    this.currentConfig = validatedConfig;
                } else {
                    this.save();
                }
            } catch (error) {
                console.error(`[${EXTENSION_CONSTANTS.EXTENSION_NAME}] Failed to load config:`, error);
                this.currentConfig = { ...this.defaultConfig };
            }
            return this.getSnapshot();
        }

        /**
         * Retrieves a configuration value by key.
         * @template {keyof ExtensionConfig} K
         * @param {K} key
         * @returns {ExtensionConfig[K]}
         */
        get(key) {
            return this.currentConfig[key];
        }

        /**
         * Returns an immutable snapshot of the active configuration.
         * @returns {Readonly<ExtensionConfig>}
         */
        getSnapshot() {
            return Object.freeze({ ...this.currentConfig });
        }

        /**
         * Updates a configuration value and persists it if valid.
         * @template {keyof ExtensionConfig} K
         * @param {K} key
         * @param {ExtensionConfig[K]} value
         * @returns {void}
         */
        set(key, value) {
            if (!this.validateKeyValue(key, value)) {
                console.warn(
                    `[${EXTENSION_CONSTANTS.EXTENSION_NAME}] Invalid configuration value for "${String(key)}":`,
                    value
                );
                return;
            }
            this.currentConfig[key] = value;
            this.save();
        }

        /**
         * Persists current configuration state to Spicetify.LocalStorage.
         * @returns {void}
         */
        save() {
            try {
                Spicetify.LocalStorage.set(
                    EXTENSION_CONSTANTS.STORAGE_KEY,
                    JSON.stringify(this.currentConfig)
                );
            } catch (error) {
                console.error(`[${EXTENSION_CONSTANTS.EXTENSION_NAME}] Failed to save config:`, error);
            }
        }

        /**
         * Derives the native folder selection endpoint URL (`GET /api/v1/select-folder`)
         * from the configured `endpointUrl` origin.
         * @returns {string}
         */
        resolveSelectFolderUrl() {
            try {
                const parsed = new URL(this.currentConfig.endpointUrl);
                return `${parsed.origin}${EXTENSION_CONSTANTS.SELECT_FOLDER_PATH}`;
            } catch {
                return `http://127.0.0.1:48915${EXTENSION_CONSTANTS.SELECT_FOLDER_PATH}`;
            }
        }

        /**
         * Sends `GET /api/v1/select-folder` to the local backend daemon to trigger
         * the OS native folder selection dialog and returns the selected directory path.
         * @returns {Promise<string | null>}
         */
        async requestNativeFolderSelection() {
            const url = this.resolveSelectFolderUrl();
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    Accept: 'application/json, text/plain;q=0.9'
                }
            });

            if (response.status === 204) {
                return null;
            }

            const rawBody = await response.text();
            if (!response.ok) {
                let errMsg = rawBody;
                try {
                    const parsedErr = JSON.parse(rawBody);
                    errMsg = parsedErr.error || parsedErr.message || parsedErr.detail || rawBody;
                } catch {
                    // Use plain text
                }
                throw new Error(
                    `Status ${response.status}${errMsg ? `: ${String(errMsg).slice(0, 120)}` : ''}`
                );
            }

            if (!rawBody || !rawBody.trim()) {
                return null;
            }

            try {
                const parsed = JSON.parse(rawBody);
                if (parsed && typeof parsed === 'object') {
                    if (parsed.cancelled === true || parsed.canceled === true) {
                        return null;
                    }
                    const candidate =
                        parsed.path ??
                        parsed.folder ??
                        parsed.directory ??
                        parsed.selectedPath ??
                        parsed.targetPath ??
                        null;
                    return typeof candidate === 'string' && candidate.trim().length > 0
                        ? candidate.trim()
                        : null;
                }
                if (typeof parsed === 'string' && parsed.trim().length > 0) {
                    return parsed.trim();
                }
            } catch {
                return rawBody.trim();
            }

            return null;
        }
    }

    // =========================================================================
    // MODULE: MetadataResolver
    // =========================================================================

    class MetadataResolver {
        constructor() {
            /** @private @type {Map<string, TrackMetadata>} */
            this.cache = new Map();
        }

        /**
         * Attempts to resolve track metadata using Spotify's internal GraphQL Pathfinder API.
         * @private
         * @param {string} uri
         * @param {string} trackId
         * @returns {Promise<TrackMetadata | null>}
         */
        async resolveViaGraphQL(uri, trackId) {
            if (!Spicetify.GraphQL || typeof Spicetify.GraphQL.Request !== 'function') {
                return null;
            }

            const definitions = Spicetify.GraphQL.Definitions || {};
            const getTrackDef = definitions.getTrack || definitions.fetchTrack;
            if (!getTrackDef) {
                return null;
            }

            try {
                const res = await Spicetify.GraphQL.Request(getTrackDef, { uri });
                const trackUnion = res?.data?.trackUnion;
                if (trackUnion && trackUnion.name) {
                    const firstArtists =
                        trackUnion.firstArtist?.items ||
                        trackUnion.artists?.items ||
                        [];
                    const otherArtists = trackUnion.otherArtists?.items || [];
                    const allArtists = [...firstArtists, ...otherArtists]
                        .map((a) => a?.profile?.name || a?.name)
                        .filter(Boolean);

                    const durationMs =
                        Number(trackUnion.duration?.totalMilliseconds) ||
                        Number(trackUnion.duration_ms) ||
                        0;

                    return {
                        uri,
                        id: trackId,
                        name: String(trackUnion.name),
                        artist: allArtists.length > 0 ? allArtists.join(', ') : 'Unknown Artist',
                        durationMs
                    };
                }
            } catch (error) {
                console.debug(
                    `[${EXTENSION_CONSTANTS.EXTENSION_NAME}] GraphQL metadata lookup skipped:`,
                    error
                );
            }

            return null;
        }

        /**
         * Attempts to resolve track metadata using Spicetify.CosmosAsync Web API.
         * @private
         * @param {string} uri
         * @param {string} trackId
         * @returns {Promise<TrackMetadata | null>}
         */
        async resolveViaCosmos(uri, trackId) {
            try {
                const response = await Spicetify.CosmosAsync.get(
                    `https://api.spotify.com/v1/tracks/${trackId}`
                );

                if (response && response.name) {
                    const artistNames = Array.isArray(response.artists)
                        ? response.artists.map((a) => a.name).filter(Boolean).join(', ')
                        : 'Unknown Artist';

                    return {
                        uri,
                        id: trackId,
                        name: String(response.name),
                        artist: artistNames || 'Unknown Artist',
                        durationMs: Number(response.duration_ms) || 0
                    };
                }
            } catch (error) {
                console.debug(
                    `[${EXTENSION_CONSTANTS.EXTENSION_NAME}] CosmosAsync lookup skipped:`,
                    error
                );
            }

            return null;
        }

        /**
         * Attempts to resolve track metadata from active Player state or Queue.
         * @private
         * @param {string} uri
         * @param {string} trackId
         * @returns {TrackMetadata | null}
         */
        resolveViaPlayerOrQueue(uri, trackId) {
            const currentTrack = Spicetify.Player?.data?.item || Spicetify.Player?.data?.track;
            if (currentTrack && currentTrack.uri === uri) {
                const artist =
                    currentTrack.artists?.map((a) => a.name).filter(Boolean).join(', ') ||
                    currentTrack.metadata?.artist_name ||
                    'Unknown Artist';

                return {
                    uri,
                    id: trackId,
                    name: currentTrack.name || currentTrack.metadata?.title || 'Unknown Track',
                    artist,
                    durationMs:
                        Number(currentTrack.duration?.milliseconds) ||
                        Number(Spicetify.Player?.getDuration?.()) ||
                        0
                };
            }

            const nextTracks = Spicetify.Queue?.nextTracks || [];
            const prevTracks = Spicetify.Queue?.prevTracks || [];
            const queueMatch = [...nextTracks, ...prevTracks].find(
                (item) => item?.contextTrack?.uri === uri || item?.uri === uri
            );

            if (queueMatch) {
                const t = queueMatch.contextTrack || queueMatch;
                const meta = t.metadata || {};
                if (t.name || meta.title) {
                    return {
                        uri,
                        id: trackId,
                        name: String(t.name || meta.title),
                        artist: String(
                            t.artists?.map((a) => a.name).join(', ') ||
                                meta.artist_name ||
                                'Unknown Artist'
                        ),
                        durationMs: Number(meta.duration) || 0
                    };
                }
            }

            return null;
        }

        /**
         * Attempts to scrape visible track title and artist from the DOM if the track row is rendered.
         * @private
         * @param {string} uri
         * @param {string} trackId
         * @returns {TrackMetadata | null}
         */
        resolveViaDom(uri, trackId) {
            try {
                const internalLinks = document.querySelectorAll(
                    `a[href*="${trackId}"], [data-uri="${uri}"]`
                );

                for (const el of internalLinks) {
                    const row = el.closest('[data-testid="tracklist-row"], [role="row"]');
                    if (row) {
                        const titleEl = row.querySelector(
                            '[data-testid="internal-track-link"] div, .main-trackList-rowTitle'
                        );
                        const artistEls = row.querySelectorAll(
                            'a[href*="/artist/"], .main-trackList-rowSubTitle a'
                        );

                        const name = titleEl?.textContent?.trim();
                        const artists = Array.from(artistEls)
                            .map((a) => a.textContent?.trim())
                            .filter(Boolean);

                        if (name) {
                            return {
                                uri,
                                id: trackId,
                                name,
                                artist: artists.length > 0 ? artists.join(', ') : 'Unknown Artist',
                                durationMs: 0
                            };
                        }
                    }
                }
            } catch {
                // Ignore DOM traversal errors
            }

            return null;
        }

        /**
         * Extracts and normalizes track metadata from a Spotify URI using a 5-stage fallback pipeline.
         * @param {string} uri
         * @returns {Promise<TrackMetadata>}
         */
        async resolve(uri) {
            if (this.cache.has(uri)) {
                return /** @type {TrackMetadata} */ ({ ...this.cache.get(uri) });
            }

            const parsedUri = Spicetify.URI.fromString(uri);
            const trackId = parsedUri?.id || uri.split(':')[2];

            if (!trackId) {
                throw new Error(`Invalid track URI: ${uri}`);
            }

            let metadata = await this.resolveViaGraphQL(uri, trackId);

            if (!metadata) {
                metadata = await this.resolveViaCosmos(uri, trackId);
            }

            if (!metadata) {
                metadata = this.resolveViaPlayerOrQueue(uri, trackId);
            }

            if (!metadata) {
                metadata = this.resolveViaDom(uri, trackId);
            }

            if (!metadata) {
                console.warn(
                    `[${EXTENSION_CONSTANTS.EXTENSION_NAME}] Using minimal URI fallback for ${uri}`
                );
                return {
                    uri,
                    id: trackId,
                    name: `Track ${trackId}`,
                    artist: 'Spotify',
                    durationMs: 0
                };
            }

            this.cache.set(uri, Object.freeze({ ...metadata }));
            return metadata;
        }
    }

    // =========================================================================
    // MODULE: UI / PathPromptDialog
    // =========================================================================

    class PathPromptDialog {
        /**
         * @param {ConfigManager} [configManager]
         */
        constructor(configManager) {
            /** @private @type {ConfigManager | null} */
            this.configManager = configManager || null;
        }

        /**
         * Renders modal dialog for directory selection and guarantees Promise resolution
         * even if the modal is dismissed via backdrop click or close button.
         * Includes a "Browse..." button calling `GET /api/v1/select-folder` if ConfigManager is available.
         * @param {string} initialPath
         * @returns {Promise<string | null>}
         */
        prompt(initialPath) {
            return new Promise((resolve) => {
                if (!Spicetify.PopupModal) {
                    const fallbackPath = window.prompt('Enter destination directory path:', initialPath);
                    resolve(fallbackPath ? fallbackPath.trim() : null);
                    return;
                }

                const container = document.createElement('div');
                container.style.display = 'flex';
                container.style.flexDirection = 'column';
                container.style.gap = '12px';
                container.style.padding = '8px 0';

                const label = document.createElement('label');
                label.textContent = 'Target Directory Path:';
                label.style.fontSize = '14px';
                label.style.fontWeight = '600';

                const inputRow = document.createElement('div');
                inputRow.style.display = 'flex';
                inputRow.style.gap = '8px';
                inputRow.style.alignItems = 'center';

                const input = document.createElement('input');
                input.type = 'text';
                input.value = initialPath;
                input.style.padding = '8px 12px';
                input.style.borderRadius = '4px';
                input.style.border = '1px solid var(--spice-button-disabled)';
                input.style.backgroundColor = 'var(--spice-main)';
                input.style.color = 'var(--spice-text)';
                input.style.flex = '1';

                const browseButton = document.createElement('button');
                browseButton.type = 'button';
                browseButton.textContent = 'Browse...';
                browseButton.style.padding = '8px 14px';
                browseButton.style.borderRadius = '4px';
                browseButton.style.border = '1px solid var(--spice-subtext)';
                browseButton.style.backgroundColor = 'var(--spice-card)';
                browseButton.style.color = 'var(--spice-text)';
                browseButton.style.cursor = 'pointer';
                browseButton.style.whiteSpace = 'nowrap';

                if (this.configManager) {
                    browseButton.addEventListener('click', async () => {
                        browseButton.disabled = true;
                        browseButton.textContent = 'Opening...';
                        try {
                            const selected = await this.configManager.requestNativeFolderSelection();
                            if (selected) {
                                input.value = selected;
                                input.focus();
                            }
                        } catch (error) {
                            Spicetify.showNotification(`Browse failed: ${error.message}`, true);
                        } finally {
                            browseButton.disabled = false;
                            browseButton.textContent = 'Browse...';
                        }
                    });
                }

                inputRow.appendChild(input);
                if (this.configManager) {
                    inputRow.appendChild(browseButton);
                }

                const buttonRow = document.createElement('div');
                buttonRow.style.display = 'flex';
                buttonRow.style.justifyContent = 'flex-end';
                buttonRow.style.gap = '8px';
                buttonRow.style.marginTop = '8px';

                const cancelButton = document.createElement('button');
                cancelButton.textContent = 'Cancel';
                cancelButton.style.padding = '6px 16px';
                cancelButton.style.borderRadius = '500px';
                cancelButton.style.border = '1px solid var(--spice-subtext)';
                cancelButton.style.background = 'transparent';
                cancelButton.style.color = 'var(--spice-text)';
                cancelButton.style.cursor = 'pointer';

                const confirmButton = document.createElement('button');
                confirmButton.textContent = 'Download';
                confirmButton.style.padding = '6px 16px';
                confirmButton.style.borderRadius = '500px';
                confirmButton.style.border = 'none';
                confirmButton.style.backgroundColor = 'var(--spice-button)';
                confirmButton.style.color = 'var(--spice-main)';
                confirmButton.style.fontWeight = '700';
                confirmButton.style.cursor = 'pointer';

                let isResolved = false;
                let wasMounted = false;

                const observer = new MutationObserver(() => {
                    if (document.body.contains(container)) {
                        wasMounted = true;
                    } else if (wasMounted && !isResolved) {
                        isResolved = true;
                        observer.disconnect();
                        resolve(null);
                    }
                });

                const finish = (val) => {
                    if (!isResolved) {
                        isResolved = true;
                        observer.disconnect();
                        Spicetify.PopupModal.hide();
                        resolve(val);
                    }
                };

                cancelButton.addEventListener('click', () => finish(null));
                confirmButton.addEventListener('click', () => {
                    const trimmed = input.value.trim();
                    finish(trimmed.length > 0 ? trimmed : null);
                });

                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        confirmButton.click();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelButton.click();
                    }
                });

                buttonRow.appendChild(cancelButton);
                buttonRow.appendChild(confirmButton);
                container.appendChild(label);
                container.appendChild(inputRow);
                container.appendChild(buttonRow);

                observer.observe(document.body, { childList: true, subtree: true });

                Spicetify.PopupModal.display({
                    title: 'Save Track As...',
                    content: container,
                    isLarge: false
                });

                setTimeout(() => {
                    if (document.body.contains(container)) {
                        wasMounted = true;
                        input.focus();
                        input.select();
                    }
                }, 50);
            });
        }
    }

    // =========================================================================
    // MODULE: UI / SettingsSection
    // =========================================================================

    class SettingsSection {
        /**
         * @param {ConfigManager} configManager
         */
        constructor(configManager) {
            /** @private */
            this.configManager = configManager;
            /** @private @type {Spicetify.Menu.Item | null} */
            this.profileMenuItem = null;
            /** @private @type {(() => void) | null} */
            this.historyUnlisten = null;
            /** @private @type {MutationObserver | null} */
            this.domObserver = null;
            /** @private */
            this.sectionElementId = 'spicetify-track-downloader-settings-section';
        }

        /**
         * Registers the settings entry in Spicetify's Profile Menu (`Spicetify.Menu.Item`)
         * and hooks into Spotify's `/preferences` page to inject an inline settings section.
         * @returns {void}
         */
        register() {
            if (Spicetify.Menu && typeof Spicetify.Menu.Item === 'function') {
                this.profileMenuItem = new Spicetify.Menu.Item(
                    EXTENSION_CONSTANTS.SETTINGS_MENU_LABEL,
                    false,
                    () => this.openSettingsModal(),
                    EXTENSION_CONSTANTS.MENU_ITEM_ICON
                );
                this.profileMenuItem.register();
            }

            const history = Spicetify.Platform?.History;
            if (history && typeof history.listen === 'function') {
                const unlisten = history.listen((location) => {
                    if (location?.pathname === '/preferences') {
                        setTimeout(() => this.tryInjectPreferencesSection(), 150);
                    }
                });
                if (typeof unlisten === 'function') {
                    this.historyUnlisten = unlisten;
                }
            }

            this.domObserver = new MutationObserver(() => {
                if (Spicetify.Platform?.History?.location?.pathname === '/preferences') {
                    this.tryInjectPreferencesSection();
                }
            });

            this.domObserver.observe(document.body, {
                childList: true,
                subtree: true
            });

            if (Spicetify.Platform?.History?.location?.pathname === '/preferences') {
                setTimeout(() => this.tryInjectPreferencesSection(), 150);
            }
        }

        /**
         * Cleans up the profile menu item, router listener, and injected DOM section.
         * @returns {void}
         */
        dispose() {
            if (this.profileMenuItem && typeof this.profileMenuItem.deregister === 'function') {
                this.profileMenuItem.deregister();
            }
            this.profileMenuItem = null;

            if (typeof this.historyUnlisten === 'function') {
                this.historyUnlisten();
                this.historyUnlisten = null;
            }

            if (this.domObserver) {
                this.domObserver.disconnect();
                this.domObserver = null;
            }

            const existingSection = document.getElementById(this.sectionElementId);
            if (existingSection) {
                existingSection.remove();
            }
        }

        /**
         * Builds a reusable DOM form containing all extension settings:
         * - Default Download Path + "Browse..." (`GET /api/v1/select-folder`)
         * - Audio Format (`audioFormat`: flac, mp3, etc.)
         * - "Always ask path" toggle (`alwaysAskPath`)
         * @param {() => void} [onSavedCallback]
         * @returns {HTMLElement}
         */
        buildSettingsForm(onSavedCallback) {
            const wrapper = document.createElement('div');
            wrapper.style.display = 'flex';
            wrapper.style.flexDirection = 'column';
            wrapper.style.gap = '14px';
            wrapper.style.padding = '8px 0';
            wrapper.style.color = 'var(--spice-text)';

            // 1. Default Download Path + Browse...
            const pathGroup = document.createElement('div');
            pathGroup.style.display = 'flex';
            pathGroup.style.flexDirection = 'column';
            pathGroup.style.gap = '6px';

            const pathLabel = document.createElement('label');
            pathLabel.textContent = 'Default Download Path';
            pathLabel.style.fontSize = '14px';
            pathLabel.style.fontWeight = '600';

            const pathRow = document.createElement('div');
            pathRow.style.display = 'flex';
            pathRow.style.gap = '8px';
            pathRow.style.alignItems = 'center';

            const pathInput = document.createElement('input');
            pathInput.type = 'text';
            pathInput.value = this.configManager.get('defaultDownloadPath');
            pathInput.style.flex = '1';
            pathInput.style.padding = '8px 12px';
            pathInput.style.borderRadius = '4px';
            pathInput.style.border = '1px solid var(--spice-button-disabled)';
            pathInput.style.backgroundColor = 'var(--spice-main)';
            pathInput.style.color = 'var(--spice-text)';

            const browseBtn = document.createElement('button');
            browseBtn.type = 'button';
            browseBtn.textContent = 'Browse...';
            browseBtn.style.padding = '8px 14px';
            browseBtn.style.borderRadius = '4px';
            browseBtn.style.border = '1px solid var(--spice-subtext)';
            browseBtn.style.backgroundColor = 'var(--spice-card)';
            browseBtn.style.color = 'var(--spice-text)';
            browseBtn.style.cursor = 'pointer';
            browseBtn.style.fontWeight = '600';

            browseBtn.addEventListener('click', async () => {
                browseBtn.disabled = true;
                browseBtn.textContent = 'Opening...';
                try {
                    const selectedFolder = await this.configManager.requestNativeFolderSelection();
                    if (selectedFolder) {
                        pathInput.value = selectedFolder;
                        this.configManager.set('defaultDownloadPath', selectedFolder);
                        Spicetify.showNotification(`Default path updated: ${selectedFolder}`, false);
                    }
                } catch (error) {
                    Spicetify.showNotification(`Browse failed: ${error.message}`, true);
                } finally {
                    browseBtn.disabled = false;
                    browseBtn.textContent = 'Browse...';
                }
            });

            pathInput.addEventListener('change', () => {
                const trimmed = pathInput.value.trim();
                if (trimmed) {
                    this.configManager.set('defaultDownloadPath', trimmed);
                }
            });

            pathRow.appendChild(pathInput);
            pathRow.appendChild(browseBtn);
            pathGroup.appendChild(pathLabel);
            pathGroup.appendChild(pathRow);

            // 2. Audio Format (mp3, flac, etc.)
            const formatRow = document.createElement('div');
            formatRow.style.display = 'flex';
            formatRow.style.justifyContent = 'space-between';
            formatRow.style.alignItems = 'center';
            formatRow.style.gap = '12px';

            const formatLabel = document.createElement('label');
            formatLabel.textContent = 'Audio Format (audioFormat)';
            formatLabel.style.fontSize = '14px';
            formatLabel.style.fontWeight = '600';

            const formatSelect = document.createElement('select');
            formatSelect.style.padding = '8px 12px';
            formatSelect.style.borderRadius = '4px';
            formatSelect.style.border = '1px solid var(--spice-button-disabled)';
            formatSelect.style.backgroundColor = 'var(--spice-main)';
            formatSelect.style.color = 'var(--spice-text)';
            formatSelect.style.minWidth = '140px';

            const currentFormat = this.configManager.get('audioFormat');
            const formats = EXTENSION_CONSTANTS.SUPPORTED_FORMATS.includes(currentFormat)
                ? EXTENSION_CONSTANTS.SUPPORTED_FORMATS
                : [...EXTENSION_CONSTANTS.SUPPORTED_FORMATS, currentFormat];

            for (const fmt of formats) {
                const option = document.createElement('option');
                option.value = fmt;
                option.textContent = fmt.toUpperCase();
                if (fmt === currentFormat) {
                    option.selected = true;
                }
                formatSelect.appendChild(option);
            }

            formatSelect.addEventListener('change', () => {
                this.configManager.set('audioFormat', formatSelect.value);
            });

            formatRow.appendChild(formatLabel);
            formatRow.appendChild(formatSelect);

            // 3. Toggle: "Always ask path"
            const askRow = document.createElement('div');
            askRow.style.display = 'flex';
            askRow.style.justifyContent = 'space-between';
            askRow.style.alignItems = 'center';
            askRow.style.gap = '12px';

            const askLabel = document.createElement('label');
            askLabel.textContent = 'Always ask path';
            askLabel.style.fontSize = '14px';
            askLabel.style.fontWeight = '600';
            askLabel.style.cursor = 'pointer';

            const askCheckbox = document.createElement('input');
            askCheckbox.type = 'checkbox';
            askCheckbox.checked = Boolean(this.configManager.get('alwaysAskPath'));
            askCheckbox.style.width = '18px';
            askCheckbox.style.height = '18px';
            askCheckbox.style.cursor = 'pointer';
            askCheckbox.style.accentColor = 'var(--spice-button)';

            askLabel.addEventListener('click', () => {
                askCheckbox.checked = !askCheckbox.checked;
                this.configManager.set('alwaysAskPath', askCheckbox.checked);
            });

            askCheckbox.addEventListener('change', () => {
                this.configManager.set('alwaysAskPath', askCheckbox.checked);
            });

            askRow.appendChild(askLabel);
            askRow.appendChild(askCheckbox);

            // 4. Save Button Row
            const actionsRow = document.createElement('div');
            actionsRow.style.display = 'flex';
            actionsRow.style.justifyContent = 'flex-end';
            actionsRow.style.marginTop = '6px';

            const saveButton = document.createElement('button');
            saveButton.type = 'button';
            saveButton.textContent = 'Save Settings';
            saveButton.style.padding = '8px 20px';
            saveButton.style.borderRadius = '500px';
            saveButton.style.border = 'none';
            saveButton.style.backgroundColor = 'var(--spice-button)';
            saveButton.style.color = 'var(--spice-main)';
            saveButton.style.fontWeight = '700';
            saveButton.style.cursor = 'pointer';

            saveButton.addEventListener('click', () => {
                const newPath = pathInput.value.trim();
                if (newPath) {
                    this.configManager.set('defaultDownloadPath', newPath);
                }
                this.configManager.set('audioFormat', formatSelect.value);
                this.configManager.set('alwaysAskPath', askCheckbox.checked);

                Spicetify.showNotification('Track Downloader settings saved.', false);
                if (typeof onSavedCallback === 'function') {
                    onSavedCallback();
                }
            });

            actionsRow.appendChild(saveButton);

            wrapper.appendChild(pathGroup);
            wrapper.appendChild(formatRow);
            wrapper.appendChild(askRow);
            wrapper.appendChild(actionsRow);

            return wrapper;
        }

        /**
         * Opens the extension configuration inside Spicetify.PopupModal.
         * @returns {void}
         */
        openSettingsModal() {
            if (!Spicetify.PopupModal) {
                Spicetify.showNotification('PopupModal API is not available.', true);
                return;
            }

            const form = this.buildSettingsForm(() => {
                Spicetify.PopupModal.hide();
            });

            Spicetify.PopupModal.display({
                title: EXTENSION_CONSTANTS.SETTINGS_MENU_LABEL,
                content: form,
                isLarge: false
            });
        }

        /**
         * Injects the Track Downloader settings section directly into Spotify's `/preferences` DOM
         * if the user is viewing the Settings page and the section is not yet mounted.
         * @returns {void}
         */
        tryInjectPreferencesSection() {
            if (document.getElementById(this.sectionElementId)) {
                return;
            }

            const settingsContainer = document.querySelector(
                '[data-testid="settings-page"], .x-settings-container, main .contentSpacing'
            );
            if (!settingsContainer) {
                return;
            }

            const section = document.createElement('div');
            section.id = this.sectionElementId;
            section.className = 'x-settings-section';
            section.style.marginTop = '24px';
            section.style.padding = '16px';
            section.style.borderRadius = '8px';
            section.style.backgroundColor = 'var(--spice-card)';

            const heading = document.createElement('h2');
            heading.textContent = 'Track Downloader';
            heading.style.fontSize = '18px';
            heading.style.fontWeight = '700';
            heading.style.marginBottom = '12px';
            heading.style.color = 'var(--spice-text)';

            const form = this.buildSettingsForm();

            section.appendChild(heading);
            section.appendChild(form);
            settingsContainer.appendChild(section);
        }
    }

    // =========================================================================
    // MODULE: DownloadService
    // =========================================================================

    class DownloadService {
        /**
         * @param {ConfigManager} configManager
         * @param {MetadataResolver} metadataResolver
         * @param {PathPromptDialog} [pathPromptDialog]
         */
        constructor(configManager, metadataResolver, pathPromptDialog) {
            /** @private */
            this.configManager = configManager;
            /** @private */
            this.metadataResolver = metadataResolver;
            /** @private */
            this.pathPromptDialog = pathPromptDialog || new PathPromptDialog(configManager);
            /** @private @type {Map<string, DownloadProvider>} */
            this.providers = new Map();
            /** @private @type {string | null} */
            this.activeProviderId = null;
            /** @private @type {Set<string>} */
            this.inFlightUris = new Set();

            /**
             * Extension Hooks for pre/post download processing.
             * @private
             */
            this.hooks = {
                /** @type {Array<(payload: DownloadPayload) => Promise<DownloadPayload>>} */
                preDownload: [],
                /** @type {Array<(payload: DownloadPayload, error?: Error) => Promise<void>>} */
                postDownload: []
            };

            this.registerDefaultProvider();
        }

        /**
         * Registers default transport provider (HTTP/JSON bridge) with AbortController timeout
         * and detailed backend error message extraction.
         * @private
         */
        registerDefaultProvider() {
            this.registerProvider({
                id: 'default-http-bridge',
                execute: async (payload, config) => {
                    const controller = new AbortController();
                    const timer = setTimeout(
                        () => controller.abort(),
                        EXTENSION_CONSTANTS.FETCH_TIMEOUT_MS
                    );

                    try {
                        const response = await fetch(config.endpointUrl, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                track: payload.metadata,
                                targetPath: payload.targetPath,
                                format: config.audioFormat,
                                mode: payload.mode,
                                timestamp: payload.timestamp
                            }),
                            signal: controller.signal
                        });

                        if (!response.ok) {
                            let serverMessage = '';
                            try {
                                const errBody = await response.text();
                                if (errBody) {
                                    try {
                                        const parsedErr = JSON.parse(errBody);
                                        serverMessage =
                                            parsedErr.error ||
                                            parsedErr.message ||
                                            parsedErr.detail ||
                                            errBody;
                                    } catch {
                                        serverMessage = errBody;
                                    }
                                }
                            } catch {
                                // Ignore body read errors
                            }

                            const suffix = serverMessage
                                ? `: ${String(serverMessage).slice(0, 120)}`
                                : '';
                            throw new Error(`Endpoint returned status ${response.status}${suffix}`);
                        }
                    } catch (error) {
                        if (error && error.name === 'AbortError') {
                            throw new Error(
                                `Request timed out after ${EXTENSION_CONSTANTS.FETCH_TIMEOUT_MS}ms`
                            );
                        }
                        throw error;
                    } finally {
                        clearTimeout(timer);
                    }
                }
            });
            this.activeProviderId = 'default-http-bridge';
        }

        /**
         * EXTENSIBILITY POINT: Registers a new download backend provider.
         * @param {DownloadProvider} provider
         * @param {boolean} [setActive=false]
         * @returns {void}
         */
        registerProvider(provider, setActive = false) {
            if (!provider || !provider.id || typeof provider.execute !== 'function') {
                throw new Error('Invalid DownloadProvider signature.');
            }
            this.providers.set(provider.id, provider);
            if (setActive || !this.activeProviderId) {
                this.activeProviderId = provider.id;
            }
        }

        /**
         * EXTENSIBILITY POINT: Adds a pre-download lifecycle hook.
         * @param {(payload: DownloadPayload) => Promise<DownloadPayload>} hookFn
         * @returns {void}
         */
        addPreHook(hookFn) {
            if (typeof hookFn === 'function') {
                this.hooks.preDownload.push(hookFn);
            }
        }

        /**
         * EXTENSIBILITY POINT: Adds a post-download lifecycle hook.
         * @param {(payload: DownloadPayload, error?: Error) => Promise<void>} hookFn
         * @returns {void}
         */
        addPostHook(hookFn) {
            if (typeof hookFn === 'function') {
                this.hooks.postDownload.push(hookFn);
            }
        }

        /**
         * Safely executes all registered postDownload hooks without throwing or re-entering.
         * @param {DownloadPayload} payload
         * @param {Error} [error]
         * @returns {Promise<void>}
         */
        async runPostHooks(payload, error) {
            for (const hook of this.hooks.postDownload) {
                try {
                    await hook(payload, error);
                } catch (hookError) {
                    console.error(
                        `[${EXTENSION_CONSTANTS.EXTENSION_NAME}] postHook failed:`,
                        hookError
                    );
                }
            }
        }

        /**
         * Primary Flow (Click): Downloads using default configured path.
         * @param {string} uri
         * @returns {Promise<void>}
         */
        async handlePrimaryDownload(uri) {
            if (this.configManager.get('alwaysAskPath')) {
                return this.handleSecondaryDownload(uri);
            }

            const targetPath = this.configManager.get('defaultDownloadPath');
            await this.dispatchDownload(uri, targetPath, 'PRIMARY');
        }

        /**
         * Secondary Flow (Shift+Click): Prompts for target directory ("Save As...").
         * @param {string} uri
         * @returns {Promise<void>}
         */
        async handleSecondaryDownload(uri) {
            try {
                const selectedPath = await this.promptTargetDirectory(
                    this.configManager.get('defaultDownloadPath')
                );
                if (!selectedPath) {
                    return; // User cancelled modal
                }
                await this.dispatchDownload(uri, selectedPath, 'SECONDARY');
            } catch (error) {
                Spicetify.showNotification(`Path selection failed: ${error.message}`, true);
            }
        }

        /**
         * Delegates directory selection modal rendering to PathPromptDialog.
         * Preserved on DownloadService for symbol backward compatibility.
         * @param {string} initialPath
         * @returns {Promise<string | null>}
         */
        promptTargetDirectory(initialPath) {
            return this.pathPromptDialog.prompt(initialPath);
        }

        /**
         * Core pipeline execution for track download with in-flight deduplication and isolated post-hooks.
         * @private
         * @param {string} uri
         * @param {string} targetPath
         * @param {'PRIMARY' | 'SECONDARY'} mode
         * @returns {Promise<void>}
         */
        async dispatchDownload(uri, targetPath, mode) {
            if (this.inFlightUris.has(uri)) {
                Spicetify.showNotification('Track is already being processed.', false);
                return;
            }

            this.inFlightUris.add(uri);

            /** @type {DownloadPayload | null} */
            let payload = null;
            /** @type {Error | undefined} */
            let providerError;

            try {
                const metadata = await this.metadataResolver.resolve(uri);

                payload = {
                    metadata,
                    targetPath,
                    mode,
                    timestamp: Date.now()
                };

                for (const preHook of this.hooks.preDownload) {
                    payload = await preHook(payload);
                }

                const modeHint =
                    mode === 'PRIMARY' ? ' (Tip: Hold Shift + Click for Save As...)' : '';
                Spicetify.showNotification(
                    `Queued: ${payload.metadata.artist} - ${payload.metadata.name} [${payload.targetPath}]${modeHint}`,
                    false
                );

                const provider = this.providers.get(this.activeProviderId);
                if (!provider) {
                    throw new Error(`Active provider "${this.activeProviderId}" not found.`);
                }

                await provider.execute(payload, this.configManager.getSnapshot());

                Spicetify.showNotification(
                    `Sent to downloader: ${payload.metadata.artist} - ${payload.metadata.name}`,
                    false
                );
            } catch (error) {
                providerError = error instanceof Error ? error : new Error(String(error));
                console.error(`[${EXTENSION_CONSTANTS.EXTENSION_NAME}] Download failed:`, providerError);
                Spicetify.showNotification(`Download error: ${providerError.message}`, true);
            } finally {
                this.inFlightUris.delete(uri);
                if (payload) {
                    await this.runPostHooks(payload, providerError);
                }
            }
        }
    }

    // =========================================================================
    // MODULE: ContextMenu
    // =========================================================================

    class ContextMenuIntegration {
        /**
         * @param {DownloadService} downloadService
         */
        constructor(downloadService) {
            /** @private */
            this.downloadService = downloadService;
            /** @private @type {Spicetify.ContextMenu.Item | null} */
            this.menuItem = null;
            /** @private @type {string[]} */
            this.lastActiveUris = [];
            /** @private @type {number} */
            this.lastSecondaryTriggerTs = 0;
            /** @private @type {boolean} */
            this.isShiftPressed = false;

            /** @private */
            this.boundKeyDownHandler = (/** @type {KeyboardEvent} */ event) => {
                if (event.key === 'Shift' || event.shiftKey) {
                    this.isShiftPressed = true;
                }
            };

            /** @private */
            this.boundKeyUpHandler = (/** @type {KeyboardEvent} */ event) => {
                if (event.key === 'Shift' || !event.shiftKey) {
                    this.isShiftPressed = false;
                }
            };

            /** @private */
            this.boundWindowBlurHandler = () => {
                this.isShiftPressed = false;
            };

            /** @private */
            this.boundPointerClickCaptureHandler = (/** @type {MouseEvent | PointerEvent} */ event) => {
                this.isShiftPressed = Boolean(event.shiftKey);
            };
        }

        /**
         * Validates if the context menu item should be displayed for current selection.
         * @param {string[]} uris
         * @returns {boolean}
         */
        shouldAddContextMenu(uris) {
            if (!Array.isArray(uris) || uris.length !== 1) {
                return false;
            }

            const candidateUri = uris[0];
            let isTrack = false;

            if (Spicetify.URI && typeof Spicetify.URI.isTrack === 'function') {
                isTrack = Spicetify.URI.isTrack(candidateUri);
            } else {
                const parsed = Spicetify.URI.fromString(candidateUri);
                isTrack = Boolean(parsed && parsed.type === Spicetify.URI.Type.TRACK);
            }

            if (isTrack) {
                this.lastActiveUris = [candidateUri];
            }

            return isTrack;
        }

        /**
         * Registers the item into Spicetify.ContextMenu and attaches Shift-modifier tracking listeners.
         * @returns {void}
         */
        register() {
            this.menuItem = new Spicetify.ContextMenu.Item(
                `${EXTENSION_CONSTANTS.MENU_ITEM_LABEL} (Shift: Save As...)`,
                (uris) => this.handleMenuItemClick(uris),
                (uris) => this.shouldAddContextMenu(uris),
                EXTENSION_CONSTANTS.MENU_ITEM_ICON
            );

            this.menuItem.register();

            window.addEventListener('keydown', this.boundKeyDownHandler, true);
            window.addEventListener('keyup', this.boundKeyUpHandler, true);
            window.addEventListener('blur', this.boundWindowBlurHandler, true);
            window.addEventListener('pointerdown', this.boundPointerClickCaptureHandler, true);
            window.addEventListener('mousedown', this.boundPointerClickCaptureHandler, true);
            window.addEventListener('click', this.boundPointerClickCaptureHandler, true);
        }

        /**
         * Deregisters the context menu item and cleans up modifier key listeners.
         * @returns {void}
         */
        dispose() {
            window.removeEventListener('keydown', this.boundKeyDownHandler, true);
            window.removeEventListener('keyup', this.boundKeyUpHandler, true);
            window.removeEventListener('blur', this.boundWindowBlurHandler, true);
            window.removeEventListener('pointerdown', this.boundPointerClickCaptureHandler, true);
            window.removeEventListener('mousedown', this.boundPointerClickCaptureHandler, true);
            window.removeEventListener('click', this.boundPointerClickCaptureHandler, true);

            if (this.menuItem && typeof this.menuItem.deregister === 'function') {
                this.menuItem.deregister();
            }
            this.menuItem = null;
            this.lastActiveUris = [];
            this.isShiftPressed = false;
        }

        /**
         * Routes menu item activation to Primary (default path) or Secondary ("Save As..." modal)
         * based on whether the Shift modifier key is held during click.
         * @private
         * @param {string[]} uris
         * @returns {void}
         */
        handleMenuItemClick(uris) {
            const targetUri =
                Array.isArray(uris) && uris.length > 0 ? uris[0] : this.lastActiveUris[0];

            if (!targetUri) {
                return;
            }

            const useSecondaryFlow = this.isShiftPressed;
            this.isShiftPressed = false;

            if (useSecondaryFlow) {
                this.triggerSecondaryFlow(targetUri);
            } else {
                this.downloadService.handlePrimaryDownload(targetUri);
            }
        }

        /**
         * Executes the secondary download flow ("Save As..." modal) with deduplication guard.
         * @private
         * @param {string} targetUri
         * @returns {void}
         */
        triggerSecondaryFlow(targetUri) {
            const now = Date.now();
            if (now - this.lastSecondaryTriggerTs < 300) {
                return;
            }
            this.lastSecondaryTriggerTs = now;

            this.downloadService.handleSecondaryDownload(targetUri);
        }
    }

    // =========================================================================
    // MODULE: Core/Lifecycle
    // =========================================================================

    class CoreLifecycle {
        constructor() {
            /** @type {ConfigManager | null} */
            this.configManager = null;
            /** @type {MetadataResolver | null} */
            this.metadataResolver = null;
            /** @type {PathPromptDialog | null} */
            this.pathPromptDialog = null;
            /** @type {DownloadService | null} */
            this.downloadService = null;
            /** @type {ContextMenuIntegration | null} */
            this.contextMenu = null;
            /** @type {SettingsSection | null} */
            this.settingsSection = null;
            /** @private */
            this.retryIntervalMs = 100;
            /** @private */
            this.maxRetries = 150;
            /** @private */
            this.retryCount = 0;
        }

        /**
         * Verifies that all required Spicetify APIs are initialized and ready.
         * @returns {boolean}
         */
        isSpicetifyReady() {
            return Boolean(
                typeof Spicetify !== 'undefined' &&
                Spicetify.ContextMenu &&
                Spicetify.ContextMenu.Item &&
                Spicetify.Platform &&
                Spicetify.CosmosAsync &&
                Spicetify.LocalStorage &&
                Spicetify.URI &&
                typeof Spicetify.showNotification === 'function'
            );
        }

        /**
         * Bootstraps the extension lifecycle with backoff polling.
         * @returns {void}
         */
        bootstrap() {
            if (!this.isSpicetifyReady()) {
                this.retryCount += 1;
                if (this.retryCount <= this.maxRetries) {
                    setTimeout(() => this.bootstrap(), this.retryIntervalMs);
                } else {
                    console.error(
                        `[${EXTENSION_CONSTANTS.EXTENSION_NAME}] Initialization aborted: Spicetify APIs timed out.`
                    );
                }
                return;
            }

            this.initializeModules();
        }

        /**
         * Instantiates and wires all core modules.
         * @private
         * @returns {void}
         */
        initializeModules() {
            this.configManager = new ConfigManager();
            this.configManager.init();

            this.metadataResolver = new MetadataResolver();
            this.pathPromptDialog = new PathPromptDialog(this.configManager);
            this.downloadService = new DownloadService(
                this.configManager,
                this.metadataResolver,
                this.pathPromptDialog
            );
            this.contextMenu = new ContextMenuIntegration(this.downloadService);
            this.settingsSection = new SettingsSection(this.configManager);

            this.contextMenu.register();
            this.settingsSection.register();

            // Expose public API namespace for external extensions/plugins
            window.SpicetifyTrackDownloader = Object.freeze({
                version: EXTENSION_CONSTANTS.VERSION,
                config: this.configManager,
                downloadService: this.downloadService,
                metadataResolver: this.metadataResolver,
                settings: this.settingsSection,
                dispose: () => this.dispose()
            });

            console.info(
                `[${EXTENSION_CONSTANTS.EXTENSION_NAME}] ${EXTENSION_CONSTANTS.VERSION} initialized.`
            );
        }

        /**
         * Tears down the extension and releases registered listeners/menu items.
         * @returns {void}
         */
        dispose() {
            if (this.contextMenu) {
                this.contextMenu.dispose();
            }
            if (this.settingsSection) {
                this.settingsSection.dispose();
            }
            console.info(
                `[${EXTENSION_CONSTANTS.EXTENSION_NAME}] ${EXTENSION_CONSTANTS.VERSION} disposed.`
            );
        }
    }

    // Start lifecycle
    const lifecycle = new CoreLifecycle();
    lifecycle.bootstrap();
})();