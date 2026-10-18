# 🎲 AniPick — Intelligent Anime Randomizer & Discovery Engine

A sleek, responsive anime discovery web app powered directly by the official [AniList GraphQL API](https://anilist.co).


## ✨ Features

- **Direct AniList GraphQL API Integration**: Live real-time querying without any API key requirement.
- **19 Official AniList Genres**:
  - Dynamic loading from AniList `GenreCollection` with emojis and color indicators.
  - **3-State Genre Filters**: Include (✓), Exclude (✕), or Neutral.
  - **Match Modes**: Match *Any* (OR) vs. Match *All* (AND) selected genres.
- **Curated Quick Presets**:
  - ⚔️ *Shonen Hype* (Action, Adventure, Fantasy)
  - 🌸 *Sweet Romance* (Romance, Drama, Slice of Life)
  - 🧠 *Mind Games & Thriller* (Psychological, Mystery, Thriller)
  - ☕ *Cozy Slice of Life* (Slice of Life, Comedy)
  - 🚀 *Sci-Fi & Mecha* (Sci-Fi, Mecha, Action)
  - 🔮 *Magic & Fantasy* (Fantasy, Supernatural, Adventure)
  - 😂 *Pure Comedy* (Comedy, Slice of Life)
- **Deep Discovery Pool Options**:
  - 🎲 **Deep Cut Wildcard**: Uniform discovery across thousands of catalog pages.
  - 🌟 **Popular All-Stars**: Highest popularity titles.
  - 🏆 **Critically Acclaimed**: Top rated anime.
  - 💎 **Hidden Gems**: High scores (75%+) with lower mainstream hype.
  - ⚡ **Currently Airing**: Next episode countdown and release schedules.
- **Rich Anime Showcase Card**:
  - Dynamic banner backdrop tinted with anime's theme color.
  - 3D perspective tilt on hover.
  - SVG animated radial score gauge (e.g. `86%`).
  - Native Japanese, Romaji, and English titles.
  - Studio, format, episodes, duration, and status pills.
  - Expandable synopsis without spoiler clutter.
  - 🎬 **Trailer Player**: Embedded responsive YouTube trailer player.
  - 🔗 **Direct AniList Link**: Quick hop to the official AniList community page.
  - 🔄 **Similar Anime**: Quick re-roll using the current anime's genres.
- **Session History & Watchlist**:
  - Save favorites to `localStorage` watchlist with search and remove actions.
  - "Recent Rolls This Session" horizontal reel to instantly re-view past spins.
- **Web Audio API Synthesizer**:
  - Real-time roulette ticker sounds and celebratory fanfare chord with zero external audio assets.
  - Quick mute/unmute toggle.
- **Keyboard Shortcuts**:
  - <kbd>Space</kbd> or <kbd>Enter</kbd>: Roll Random Anime!
  - <kbd>Esc</kbd>: Close open modals.


