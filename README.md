# Spicetify Track Downloader

<p align="center">
  <a href="#english"><b>English</b></a> •
  <a href="#русский"><b>Русский</b></a>
</p>

<p align="center">
  <a href="https://deepmind.google/technologies/gemini/"><img src="https://img.shields.io/badge/Frontend-Gemini%204%20Argon-8E75C2?style=flat-square&logo=googlegemini&logoColor=white" alt="Frontend: Gemini 4 Argon"></a>
  <a href="https://deepmind.google/technologies/gemini/"><img src="https://img.shields.io/badge/Backend-Gemini%203.8%20Flash-4285F4?style=flat-square&logo=googlegemini&logoColor=white" alt="Backend: Gemini 3.8 Flash"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg?style=flat-square" alt="License: MIT"></a>
</p>

---

<a name="english"></a>
## 🇬🇧 English

A Spicetify extension (JavaScript) paired with a local Python background bridge to download tracks directly from Spotify Desktop via `spotdl`.

### Why this exists

Spotify Desktop runs inside an Electron/CEF sandbox with encrypted DRM streams, meaning browser extensions cannot directly dump or save raw audio streams to disk.

This project solves the limitation cleanly by decoupling the UI from the downloader:
- **Frontend (`trackDownloader.js`)**: Adds download actions to the Spotify context menu, injects an in-app settings UI, resolves metadata via a resilient 5-tier fallback cascade (Spotify Internal GraphQL Pathfinder, Cosmos Web API, Player/Queue state, and DOM scraping), and coordinates download payloads.
- **Backend (`spicetify_server.py`)**: A lightweight, asynchronous Python HTTP daemon that validates requests, opens native OS folder selection dialogs, and queues downloads through `spotdl` without freezing Spotify's UI.

### Development & AI Attribution

This project was built under human architectural direction using Google DeepMind's Gemini models:
- **Frontend Extension (`trackDownloader.js`)**: Implemented by **Gemini 4 Argon** (adhering to strict SemVer, Symbol Immutability, and decoupled SOLID modules).
- **Backend Bridge (`spicetify_server.py`)**: Implemented by **Gemini 3.8 Flash** (featuring asynchronous task queuing, native OS file picker integration, and security controls).

### Features

- **1-Click Download**: Standard click queues the track into your default download folder.
- **Shift + Click ("Save As...")**: Hold `Shift` while clicking to open a folder prompt with a native OS **Browse...** dialog.
- **Native Settings UI**: Integrated into Spotify's Preferences (`/preferences`) and Profile Menu.
- **5-Tier Fallback Metadata Cascade**: Guarantees downloads never fail even for unplayed tracks or when Spotify Web APIs are rate-limited.
- **Asynchronous**: Responds immediately with `202 Accepted` to prevent client timeouts while the background worker handles audio encoding.
- **Configurable Security**: Restrict writes to standard folders or enable downloads to any folder on your machine.

### Prerequisites

- [Spicetify CLI](https://spicetify.app/) installed and working
- [Python 3.9+](https://www.python.org/) with FFmpeg

---

### Installation & Setup

#### 1. Run the local backend daemon

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

#### 2. Install the Spicetify extension

Copy `trackDownloader.js` into your Spicetify `Extensions` folder:
- **Windows**: `%userprofile%\.spicetify\Extensions\`
- **Linux/macOS**: `~/.config/spicetify/Extensions/`

*(Tip: You can open this directory instantly by running `spicetify path -e`)*

Enable and apply the extension:

```bash
spicetify config extensions trackDownloader.js
spicetify apply
```

### Usage

1. Right-click any track or click the `...` menu.
2. Select **"Download Track (Shift: Save As...)"**:
   - **Click** → Downloads directly to your configured default directory.
   - **Shift + Click** → Opens the "Save Track As..." dialog with a **Browse...** button to pick a folder via Windows Explorer / Finder.
3. To configure the default folder, preferred audio format (`mp3`, `flac`, `wav`, etc.), or toggle "Always ask path", go to **Profile Menu → Track Downloader Settings** or open Spotify's native **Settings** page.

---

<a name="русский"></a>
## 🇷🇺 Русский

Расширение для Spicetify (JavaScript) в связке с локальным Python-сервером для скачивания треков напрямую из Spotify Desktop с помощью `spotdl`.

### Зачем это нужно

Десктопный клиент Spotify работает внутри контейнера Electron/CEF, а аудиопотоки защищены DRM-шифрованием. Браузерные скрипты не имеют прямого доступа к файловой системе для сохранения треков на диск.

Проект решает эту проблему разделением обязанностей:
- **Фронтенд (`trackDownloader.js`)**: Встраивает кнопку в меню трека Spotify, добавляет окно настроек, достает метаданные трека через 5-уровневый каскад (внутренний GraphQL Pathfinder, Cosmos API, плеер, DOM-разметка) и отправляет задачу на сервер.
- **Бэкенд (`spicetify_server.py`)**: Легковесный асинхронный сервер на Python, который принимает задачи, открывает системный проводник для выбора папки и скачивает треки через `spotdl` в фоновом потоке без зависания Spotify.

### Разработка и ИИ

Проект спроектирован под архитектурным контролем человека с использованием моделей Gemini:
- **Расширение для Spicetify (`trackDownloader.js`)**: Написано **Gemini 4 Argon** (строгий SemVer, неизменяемость символов, SOLID).
- **Локальный сервер (`spicetify_server.py`)**: Написан **Gemini 3.8 Flash** (асинхронная очередь задач, нативное окно выбора папки, валидация путей).

### Возможности

- **Скачивание в 1 клик**: Обычный клик отправляет трек в папку по умолчанию (`~/Music/SpotifyDownloads`).
- **Shift + Клик («Сохранить как...»)**: Зажатый Shift открывает окно с кнопкой **«Browse...»** для выбора любой папки через проводник.
- **Настройки внутри Spotify**: Раздел в общих настройках Spotify (`/preferences`) и отдельный пункт в меню профиля.
- **5-уровневый каскад метаданных**: Скачивание никогда не падает с ошибкой, даже если трек не запущен или API Spotify временно недоступен.
- **Асинхронность**: Сервер сразу отвечает кодом `202 Accepted` — интерфейс Spotify не виснет, пока идет загрузка.
- **Настройка безопасности**: Возможность сохранять файлы в абсолютно любые папки на диске (`ALLOW_ANY_PATH = True`).

### Требования

- Установленный и рабочий [Spicetify CLI](https://spicetify.app/)
- [Python 3.9+](https://www.python.org/) с FFmpeg

---

### Установка и настройка

#### 1. Запуск локального сервера

Склонируйте репозиторий и установите зависимости:

```bash
git clone https://github.com/ВАШ_НИК/spicetify-track-downloader.git
cd spicetify-track-downloader
pip install spotdl
spotdl --download-ffmpeg
python spicetify_server.py
```

*Окно сервера должно оставаться открытым во время работы.*

> **Настройка любых папок (`ALLOW_ANY_PATH`):**  
> По умолчанию в `spicetify_server.py` включен параметр `ALLOW_ANY_PATH = True`, разрешающий сохранять музыку в любую папку (диск `D:\`, рабочий стол и т.д.).

#### 2. Установка расширения в Spicetify

Скопируйте `trackDownloader.js` в папку расширений Spicetify:
- **Windows**: `%userprofile%\.spicetify\Extensions\`
- **Linux/macOS**: `~/.config/spicetify/Extensions/`

*(Папку можно быстро открыть командой в терминале: `spicetify path -e`)*

Активируйте расширение:

```bash
spicetify config extensions trackDownloader.js
spicetify apply
```

### Как пользоваться

1. Кликните правой кнопкой мыши по треку (или на 3 точки).
2. Выберите пункт **«Download Track (Shift: Save As...)»**:
   - **Обычный клик** → Трек мгновенно скачивается в папку по умолчанию.
   - **Shift + Клик** → Открывает окно с кнопкой **«Browse...»** для выбора папки через проводник.
3. Чтобы изменить папку по умолчанию или формат аудио (`mp3`, `flac` и т.д.), откройте **Меню профиля → Track Downloader Settings** или страницу настроек Spotify.

---

## Disclaimer / Предупреждение

This software is provided for personal offline archiving and educational purposes only. Downloading copyrighted content through third-party services may violate Spotify's Terms of Service. Please support artists by buying their music and streaming on official platforms.

## License

[MIT](LICENSE)
