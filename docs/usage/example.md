# Example Applications

> Architectural overview of building multi-user, real-time web applications with Application Objects.

---

SharedState empowers developers to build rich, interactive web applications by combining single-valued **Variables** and multi-valued **Collections** into unified real-time application state models.

---

## The Playlist Pattern

A classic real-time application requirement is maintaining a shared list of items while allowing connected users to select or control an active item (such as a shared media player playlist, interactive slideshow, or collaborative queue).

### Data Model Architecture

The Playlist pattern combines two Application Objects over the same resource path:

```
Path: /myapp/store/playlist

├── SharedMap (/myapp/store/playlist)
│   ├── "track-1" => { title: "Song 1", duration: 210 }
│   ├── "track-2" => { title: "Song 2", duration: 185 }
│   └── "track-3" => { title: "Song 3", duration: 240 }
│
└── SharedString (/myapp/store/playlist, "activeTrackId")
    └── value: "track-2"
```

1. **`SharedMap`** manages the dynamic list of playlist tracks (adding, removing, or reordering items).
2. **`SharedString`** (or `SharedInteger`) manages the `activeTrackId` variable representing the currently selected/playing track.

---

## Reactive Component Synchronization

By combining the `{ init: true }` event pattern across both objects, user interface rendering remains completely decoupled from state updates:

```javascript
import { SharedStateClient, SharedMap, SharedString } from "./dist/sharedstate.es.js";

const client = new SharedStateClient("ws://localhost:9000");

// 1. Instantiate Application Objects
const playlist = new SharedMap(client, "/myapp/store/playlist");
const activeTrack = new SharedString(client, "/myapp/store/playlist", "activeTrackId", {
  allowUndefined: true
});

// 2. Render playlist items when items are inserted or removed
playlist.on("change", () => {
  renderPlaylistUI(playlist.entries(), activeTrack.value);
}, { init: true });

// 3. Highlight currently selected track when selection changes
activeTrack.on("change", () => {
  highlightActiveTrackUI(activeTrack.value);
}, { init: true });

// 4. Update selection on user click
function onTrackClicked(trackId) {
  activeTrack.set(trackId);
}
```

---

## Live Interactive Demonstrations

Full runnable code for the Playlist example and other interactive demonstrations are maintained under the `/html/` directory in the project repository (e.g., `html/playlist.html`).
