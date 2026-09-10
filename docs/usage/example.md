# Collaborative Slideshow Application

> A real-time, multi-user slideshow application built with SharedMap and SharedInteger.

---

## Goal

Build a collaborative, real-time presentation viewer where multiple connected users can navigate slides together, while also dynamically adding, deleting, and reordering slides without leaving presenter mode. Moreover, users should be able to join the session late or reload the web page at any time.

---

## Demo

Screenshot of the running demo:

<p align="center">
  <img src="/images/SharedstateSlideshow.png" alt="SharedState Slideshow Demo" style="width: 80%; max-width: 800px; border-radius: 12px; margin: 1rem auto;" />
</p>


Start the SharedState Python server and open the slideshow HTML example:

```bash
# Start server
poetry run sharedstate-server

# Open example in browser (open across multiple tabs or windows)
http://localhost:9000/files/examples/slides.html
```

---

## State Representation (Data Model)

The collaborative slideshow is modeled by two SharedState abstractions:

1. **`SharedMap` (`/app/items/slides`)**: Represents the collection of slides, where each item is a slide object:
   ```javascript
   {
     id: "x8z",       // 3-character unique identifier
     no: 1,           // Slide sequence number
     title: "Overview", // Slide title
     color: "#38bdf8" // Slide background CSS color
   }
   ```
2. **`SharedInteger` (`/app/items/vars/activeSlideNo`)**: Represents the sequence number (`slide.no`) of the currently active slide.

```javascript
import { SharedStateClient, SharedMap, SharedInteger } from "https://ingararntzen.github.io/shared-state/dist/sharedstate.es.js";

const client = new SharedStateClient("ws://localhost:9000");

// 1. Synchronized Slide Collection
const slidesMap = new SharedMap(client, "/app/items/slides");

// 2. Synchronized Active Slide Selection
const activeSlideNo = new SharedInteger(client, "/app/items/vars", "activeSlideNo", {
  allowUndefined: false,
  defaultValue: 0
});
```

---

## Visual Components

The slideshow user interface consists of three main visual sections:

- **Thumbnail Gallery**: (top) Displays thumbnails for all slides sorted by `slide.no` in ascending order, rendering each slide's background color, 1-based position number (`1`, `2`, ...), and highlighting the thumbnail corresponding to `activeSlideNo`.

- **Active Slide Viewer**: (center) Displays the title of the active slide centered over its background color (`slide.color`), along with a 1-based index badge (`#1`, `#2`, ...) calculated from the sorted gallery sequence.

- **Slideshow Controls**: (bottom) Contains buttons for adding and reordering slides, as well as buttons for navigating to adjacent slides.

---

## Reactive Rendering

UI evaluation and rendering are triggered whenever **either** `slidesMap` or `activeSlideNo` emits a `"change"` event:

```javascript
function render() {
  const slides = Array.from(slidesMap.values());
  slides.sort((a, b) => (a.no || 0) - (b.no || 0));

  const currentActiveNo = activeSlideNo.value;

  // 1. Render Gallery Thumbnails & Highlight Active Slide
  const slots = document.querySelectorAll(".gallery-item");
  slots.forEach((slot, idx) => {
    const slide = slides[idx];
    if (slide) {
      slot.style.backgroundColor = slide.color;
      slot.innerHTML = `<span class="gallery-item-number">${idx + 1}</span>`;
      slot.classList.toggle("active", slide.no === currentActiveNo);
    } else {
      slot.style.backgroundColor = "";
      slot.innerHTML = "";
      slot.classList.remove("active");
    }
  });

  // 2. Render Active Slide Viewer
  const activeSlide = slides.find(s => s && s.no === currentActiveNo);
  const activeFrame = document.querySelector(".active-slide-frame");
  if (activeSlide) {
    const activeIndex = slides.findIndex(s => s && s.id === activeSlide.id) + 1;
    activeFrame.style.backgroundColor = activeSlide.color;
    activeFrame.innerHTML = `
      <div class="active-slide-number">#${activeIndex}</div>
      <h2 class="active-slide-title">${activeSlide.title}</h2>
    `;
  } else {
    activeFrame.style.backgroundColor = "";
    activeFrame.innerHTML = "";
  }
}

// Re-render UI on changes to either SharedMap or SharedInteger
slidesMap.on("change", render, { init: true });
activeSlideNo.on("change", render, { init: true });
```

---

## Controls & Logic

### 1. Slide Navigation (`SharedInteger`)

Navigating to adjacent slides updates `activeSlideNo`. To handle potential sequence gaps gracefully (e.g., if a slide was deleted), `next` and `prev` find the next higher or lower `slide.no`:

```javascript
// Next Slide Selection
nextBtn.onclick = () => {
  const slides = Array.from(slidesMap.values()).sort((a, b) => (a.no || 0) - (b.no || 0));
  const nextSlide = slides.find(s => s && s.no > activeSlideNo.value);
  if (nextSlide) activeSlideNo.set(nextSlide.no);
};

// Previous Slide Selection
prevBtn.onclick = () => {
  const slides = Array.from(slidesMap.values()).sort((a, b) => (a.no || 0) - (b.no || 0));
  const prevSlide = [...slides].reverse().find(s => s && s.no < activeSlideNo.value);
  if (prevSlide) activeSlideNo.set(prevSlide.no);
};
```

### 2. Adding & Deleting Slides (`SharedMap`)

Creating and deleting slides directly mutates `slidesMap`, automatically broadcasting updates to all connected clients:

```javascript
// Add Slide
addBtn.onclick = () => {
  const slides = Array.from(slidesMap.values());
  const maxNo = slides.reduce((max, s) => (s && s.no > max ? s.no : max), 0);
  const nextNo = maxNo + 1;
  const id = generateId();

  slidesMap.set(id, {
    id: id,
    no: nextNo,
    title: TITLES[(nextNo - 1) % TITLES.length],
    color: COLORS[(nextNo - 1) % COLORS.length]
  });
};

// Delete Slide (Right-Click Context Menu)
deleteBtn.onclick = () => {
  if (pendingDeleteSlideId) {
    slidesMap.delete(pendingDeleteSlideId);
  }
};
```

### 3. Reordering Slides (`SharedMap` & `SharedInteger`)

Reordering swaps the `slide.no` attributes of adjacent slides in `slidesMap`, while updating `activeSlideNo` so active selection follows the moved slide:

```javascript
// Move Active Slide Right
moveNextBtn.onclick = () => {
  const slides = Array.from(slidesMap.values()).sort((a, b) => (a.no || 0) - (b.no || 0));
  const currIdx = slides.findIndex(s => s && s.no === activeSlideNo.value);

  if (currIdx !== -1 && currIdx < slides.length - 1) {
    const curr = slides[currIdx];
    const next = slides[currIdx + 1];

    // Swap sequence numbers in SharedMap
    slidesMap.set(curr.id, { ...curr, no: next.no });
    slidesMap.set(next.id, { ...next, no: curr.no });
    
    // Selection follows active slide
    activeSlideNo.set(next.no);
  }
};
```
