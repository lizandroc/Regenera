# Regenera, example 2

A second take on the Regenera site: an interactive landing arch that opens into the full home page.
Plain HTML, CSS and JS in a single `index.html`, with no build step.

## What's in it

- **Landing:** a white field of dots. Moving the pointer spotlights the dots around it and dims the rest.
  Releasing a press snaps every dot back to full and sends a wave outward. Dragging leaves ripples.
- **Logo:** racks into focus on load, goes briefly fuzzy once per hover, and pulses out of focus on each press.
- **Entry:** pressing the arch zooms the camera through the doorway into the home page.
- **Home page:** film-style hero, then How We Work and Ways to Collaborate as pinned sections that
  slide right to left while you scroll down. Platform, What We Believe, the six-dimension wellness wheel,
  and the inquiry form follow.

## Files

- `index.html`: the page
- `fonts/`: place for the Daikon font files (not committed; see `fonts/README.md`). Without them the page uses Quicksand.
- `img/`: hero and section photography

## Run locally

```bash
npx serve example-2
# or
cd example-2 && python3 -m http.server
```

The inquiry form is not connected to an inbox yet. On submit it prepares the message and offers to copy it.
