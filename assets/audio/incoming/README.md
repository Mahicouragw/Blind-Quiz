# Music uploads (Pixabay)

Put hand-downloaded Pixabay music here, named `<slot>-<original Pixabay file name>.mp3`.
Slots: `menu`, `game1`, `game2`, `game3`, `results`. Example: `menu-morning-garden-123456.mp3`.

The `audio-assets.yml` workflow encodes each file into `assets/audio/music_<slot>.mp3`, records it in
`assets/audio/manifest.json` and `AUDIO_LICENSES.md`, deletes the original from this folder, and redeploys
the site. This folder is never published.
