# Spicetify Track Downloader

A Spicetify extension (JavaScript) paired with a local Python background bridge to download tracks directly from Spotify Desktop via `spotdl`.

## Why this exists

Spotify Desktop runs inside an Electron/CEF sandbox with encrypted DRM streams, meaning browser extensions cannot directly dump or save raw audio streams to disk.

This project solves the limitation cleanly by decoupling the UI from the downloader:
- **Frontend (`trackDownloader.js`)**: Adds download actions to the Spotify context menu, injects an in-app settings UI, resolves metadata via a resilient 5-tier fallback cascade (Spotify Internal GraphQL Pathfinder, Cosmos Web API, Player/Queue state, and DOM scraping), and coordinates download payloads.
- **Backend (`spicetify_server.py`)**: A lightweight, asynchronous Python HTTP daemon that validates requests, opens native OS folder selection dialogs, and queues downloads through `spotdl` without freezing Spotify's UI.

## Development & AI Attribution

This project was built under human architectural direction using a multi-model development pipeline:
- **Frontend Extension (`trackDownloader.js`)**: Implemented by **Gemini 4 Argon** (adhering to strict SemVer, Symbol Immutability, and decoupled SOLID modules).
- **Backend Bridge (`spicetify_server.py`)**: Implemented by **Gemini 3.8 Flash** (featuring asynchronous task queuing, native OS file picker integration, and security controls).

## Features

- **1-Click Download**: Standard click queues the track into your default download folder.
- **Shift + Click ("Save As...")**: Hold `Shift` while clicking to open a folder prompt with a native OS **Browse...** dialog.
- **Native Settings UI**: Integrated into Spotify's Preferences (`/preferences`) and Profile Menu.
- **5-Tier Fallback Metadata Cascade**: Guarantees downloads never fail even for unplayed tracks or when Spotify Web APIs are rate-limited.
- **Asynchronous**: Responds immediately with `202 Accepted` to prevent client timeouts while the background worker handles audio encoding.
- **Configurable Security**: Restrict writes to standard folders or enable downloads to any folder on your machine.

## Prerequisites

- [Spicetify CLI](https://spicetify.app/) installed and working
- [Python 3.9+](https://www.python.org/) with FFmpeg

---

## Installation & Setup

### 1. Run the local backend daemon

Clone the repository and install dependencies:

```bash
git clone https://github.com/YOUR_USERNAME/spicetify-track-downloader.git
cd spicetify-track-downloader
pip install spotdl
spotdl --download-ffmpeg
python spicetify_server.py
```

*Keep this terminal window running in the background.*

> **Configuration (`ALLOW_ANY_PATH`):**  
> By default, `ALLOW_ANY_PATH = True` in `spicetify_server.py` allows saving to any directory (e.g. `D:\`, Desktop, External drives). Set it to `False` if you want to strictly restrict file writes to `~/Music` and `~/Downloads`.

### 2. Install the Spicetify extension

Copy `trackDownloader.js` into your Spicetify `Extensions` folder:
- **Windows**: `%userprofile%\.spicetify\Extensions\`
- **Linux/macOS**: `~/.config/spicetify/Extensions/`

*(Tip: You can open this directory instantly by running `spicetify path -e`)*

Enable and apply the extension:

```bash
spicetify config extensions trackDownloader.js
spicetify apply
```

---

## Usage

1. Right-click any track or click the `...` menu.
2. Select **"Download Track (Shift: Save As...)"**:
   - **Click** → Downloads directly to your configured default directory.
   - **Shift + Click** → Opens the "Save Track As..." dialog with a **Browse...** button to pick a folder via Windows Explorer / Finder.
3. To configure the default folder, preferred audio format (`mp3`, `flac`, `wav`, etc.), or toggle "Always ask path", go to **Profile Menu → Track Downloader Settings** or open Spotify's native **Settings** page.

---

## Disclaimer

This software is provided for personal offline archiving and educational purposes only. Downloading copyrighted content through third-party services may violate Spotify's Terms of Service and local copyright laws. Please support artists by buying their music and streaming on official platforms.

## License

[MIT](LICENSE)