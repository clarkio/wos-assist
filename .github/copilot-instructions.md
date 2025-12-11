# WoS+ (Words on Stream Plus) - AI Coding Agent Instructions

## Project Overview

**WoS+** is a real-time game enhancement tool for "Words on Stream" (WoS) on Twitch. It provides two interfaces:

- **Player View**: Track words, letters, and personal records
- **Streamer View**: OBS-ready layout with embedded game board and Twitch chat

Built with Astro + TypeScript, deployed to Cloudflare Pages with Workers for serverless API routes.

## Architecture

### Core Components

1. **Game State Manager** ([../src/scripts/wos-plus-main.ts](../src/scripts/wos-plus-main.ts))

   - `GameSpectator` class orchestrates all game tracking
   - Connects to WoS WebSocket (Socket.IO) and Twitch chat (tmi.js)
   - Uses two Web Workers for message processing to prevent blocking UI
   - Maintains slot-based game state with `currentLevelSlots` tracking words at specific indices

2. **Web Workers**

   - [wos-worker.ts](../src/scripts/wos-worker.ts): Processes WoS game events (12 event types)
   - [twitch-chat-worker.ts](../src/scripts/twitch-chat-worker.ts): Filters chat messages (4-12 letter words only)
   - **Critical**: Both workers use `postMessage` for async communication

3. **Dictionary System** ([../src/scripts/wos-words.ts](../src/scripts/wos-words.ts))

   - Remote dictionary loaded from `https://clarkio.com/wos-dictionary`
   - `findWosWordsByLetters()`: Letter frequency matching algorithm
   - `findAllMissingWords()`: Identifies potentially missed words at level end
   - Words auto-added to dictionary via PATCH endpoint when correctly guessed

4. **View Architecture**
   - Astro components with View Transitions enabled
   - Query parameter-driven configuration (e.g., `?mirrorUrl=...&twitchChannel=...`)
   - Settings stored in localStorage with daily tracking keys

### Key Data Flows

**WoS Event Processing**:

```
Socket.IO Event → wos-worker → GameSpectator.handleCorrectGuess() → UI Update
                                    ↓
                          Update currentLevelSlots[index]
                                    ↓
                          Cross-reference Twitch chat for hidden words
```

**Word Matching** (Level 20+ with hidden letters):

```
WoS sends "????" → Match username + timestamp → Twitch chat message → Reveal actual word
```

**Missing Word Detection**:

```
Level ends → logMissingWords() → findAllMissingWords(knownLetters, minLength) → Mark with *
```

## Development Workflows

### Local Development

```bash
npm run dev         # Astro dev server on http://localhost:4321
npm run build       # Build for Cloudflare Pages
npm run preview     # Test production build with Wrangler
```

### Environment Variables

Required in Cloudflare Pages (not local):

- `SUPABASE_URL`: Database for board storage
- `SUPABASE_KEY`: Auth key for Supabase

### Debugging WoS Events

WoS uses numbered events (see [wos-worker.ts](../src/scripts/wos-worker.ts)):

- **1**: Level Started (provides slots array)
- **3**: Correct Guess (includes `index`, `letters`, `hitMax`)
- **4**: Level Results (stars count, player ranking)
- **5**: Game Ended
- **10**: Hidden/Fake Letters Revealed
- **12**: Game Connected (initial state on spectator join)

## Project Conventions

### TypeScript Patterns

- **No explicit types for simple variables**: Trust inference for `let level = 0`
- **Interface definitions in worker files**: See `WosWorkerMessage`, `TwitchWorkerResult`
- **Type from data shape**: Slots defined inline as `{ letters: string[], user?: string, ... }`

### Astro-Specific

- **Client-side scripts in `<script>` tags**: All game logic runs client-side (no SSR)
- **ViewTransitions enabled globally**: Maintain state during navigation
- **Inline styles per component**: Scoped CSS in `.astro` files
- **API routes use `prerender = false`**: Ensures Cloudflare Workers execution

### State Management

- **No React/Vue state**: Pure DOM manipulation via `document.getElementById()`
- **localStorage keys**: Prefixed with entity, e.g., `pb_${channel}_${date}`
- **Query params for configuration**: Avoid forms; use URL state for streamer settings

### UI Rendering Patterns

```typescript
// Words grouped by length, sorted alphabetically, marked with * if missed
const groupedWords = sortedWords.reduce((map, word) => {
  const key = word.replace("*", "").length;
  // ... group logic
}, new Map<number, string[]>());
```

## Critical Implementation Details

### Slot-Based Missed Words Detection

WoS orders words alphabetically. When slots are filled:

1. Track `originalIndex` for each slot (see [plan-slotBasedMissedWordsDetection.prompt.md](../plan-slotBasedMissedWordsDetection.prompt.md))
2. Group consecutive empty slots
3. Use filled slots as alphabetical bounds to narrow candidate words
4. **Not yet implemented**: See plan file for full task breakdown

### Hidden Letter Detection

Two strategies:

1. **Big Word method**: Compare `currentLevelBigWord` letters vs `currentLevelLetters`
2. **Progressive inference**: Track max frequency of each letter across correct words, compare to known letters

### Twitch Chat Integration

- Uses `@tmi.js/chat` v0.4.1 (modern tmi.js fork)
- Stores last message per username with timestamp
- Matches by username + word length to reveal hidden words
- Regex filter: `/^[a-zA-Z]{4,12}$/` (WoS only uses 4+ letter words)

## Common Tasks

### Adding a New WoS Event Handler

1. Identify event type in [wos-worker.ts](../src/scripts/wos-worker.ts)
2. Add case in worker's `onmessage`
3. Create handler method in `GameSpectator` class
4. Update `startEventProcessors()` to route new event type

### Modifying Word Display

Edit `updateCorrectWordsDisplayed()` in [wos-plus-main.ts](../src/scripts/wos-plus-main.ts):

- Sorting happens before grouping
- Groups rendered as `<div class="word-group">` with length prefix
- Auto-scroll animation via CSS `--scroll-amount` custom property

### Adding Streamer Settings

1. Update form in [streamer.astro](../src/pages/streamer.astro) `<SettingsDialog>`
2. Add query param handling in `<script>` section
3. Save to URL params (triggers page reload to apply)

## External Dependencies

- **Words on Stream API**: WebSocket at `wss://wos2.gartic.es`
- **Dictionary Service**: `https://clarkio.com/wos-dictionary` (GET/PATCH)
- **Twitch Chat**: IRC via tmi.js
- **Supabase**: Board storage (only on 5-star clears)

## Testing Scenarios

See [LIST.todo](../LIST.todo) for active bugs and feature requests. Common edge cases:

- Multiple `?` hidden letters revealed at different times
- Duplicate words appearing in missed word detection
- Chat message timing mismatches for hidden word resolution
- Big word detection with fake letters still present
