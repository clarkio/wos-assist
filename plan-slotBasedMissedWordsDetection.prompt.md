# Plan: Slot-Based Missed Words Detection

Improve missed word accuracy at level end by tracking slot indices and using Words on Stream's alphabetical word ordering to match potential missed words to specific empty slots, with special handling for consecutive empty slots and edge positions.

## Context

Words on Stream sorts words for a level alphabetically. When a level starts, the game provides "slots" for words:

```json
[
  { "letters": [".", ".", ".", "."], "user": null, "hitMax": false },
  { "letters": [".", ".", ".", "."], "user": null, "hitMax": false },
  ...
]
```

When a player correctly guesses a word, the event includes the slot `index`:

```json
{
  "user": { "id": "clarkio", "name": "Clarkio" },
  "index": 8,
  "letters": ["s", "u", "r", "v", "e", "y"],
  "totalPoints": 12,
  "hitMax": true,
  "expired": false
}
```

By tracking which slots are filled and their words, we can use alphabetical ordering to narrow down which dictionary words could fit in empty slots.

## Tasks

### Task 1: Enhance slot data model

**File:** `src/scripts/wos-plus-main.ts`

Update the slot type definition to include `originalIndex` to preserve position through filtering and sorting operations.

**Current type (around line 43):**

```typescript
currentLevelSlots: { letters: string[], user?: string, hitMax: boolean; }[] = [];
```

**Change to:**

```typescript
currentLevelSlots: { letters: string[], user?: string, hitMax: boolean, originalIndex: number }[] = [];
```

**Update `handleGameInitialization`** to set `originalIndex` when slots are received:

```typescript
this.currentLevelSlots = slots.map((slot, index) => ({
  ...slot,
  originalIndex: index,
}));
```

**Update `updateCurrentLevelSlots`** to preserve `originalIndex` when updating a slot.

---

### Task 2: Create `getFilledWordAtIndex` helper

**File:** `src/scripts/wos-plus-main.ts`

Add a helper method to the `WosPlusMain` class that retrieves the word string from a filled slot at a given index:

```typescript
private getFilledWordAtIndex(index: number): string | null {
  if (index < 0 || index >= this.currentLevelSlots.length) {
    return null;
  }
  const slot = this.currentLevelSlots[index];
  if (!slot.user) {
    return null; // Slot is empty
  }
  return slot.letters.join('');
}
```

---

### Task 3: Add `groupConsecutiveEmptySlots` function

**File:** `src/scripts/wos-words.ts`

Create a function that groups consecutive empty slot indices together and identifies boundary information:

```typescript
export interface EmptySlotGroup {
  slots: { originalIndex: number; length: number }[];
  lowerBoundIndex: number | null; // Index of nearest filled slot before this group
  upperBoundIndex: number | null; // Index of nearest filled slot after this group
}

export function groupConsecutiveEmptySlots(
  slots: {
    letters: string[];
    user?: string;
    hitMax: boolean;
    originalIndex: number;
  }[]
): EmptySlotGroup[] {
  // Filter to empty slots only, maintaining original indices
  const emptySlots = slots
    .filter((slot) => !slot.user)
    .map((slot) => ({
      originalIndex: slot.originalIndex,
      length: slot.letters.length,
    }));

  if (emptySlots.length === 0) return [];

  const groups: EmptySlotGroup[] = [];
  let currentGroup: { originalIndex: number; length: number }[] = [
    emptySlots[0],
  ];

  for (let i = 1; i < emptySlots.length; i++) {
    if (emptySlots[i].originalIndex === emptySlots[i - 1].originalIndex + 1) {
      // Consecutive, add to current group
      currentGroup.push(emptySlots[i]);
    } else {
      // Not consecutive, finalize current group and start new one
      groups.push(createGroupWithBounds(currentGroup, slots));
      currentGroup = [emptySlots[i]];
    }
  }
  // Don't forget the last group
  groups.push(createGroupWithBounds(currentGroup, slots));

  return groups;
}

function createGroupWithBounds(
  groupSlots: { originalIndex: number; length: number }[],
  allSlots: {
    letters: string[];
    user?: string;
    hitMax: boolean;
    originalIndex: number;
  }[]
): EmptySlotGroup {
  const firstIndex = groupSlots[0].originalIndex;
  const lastIndex = groupSlots[groupSlots.length - 1].originalIndex;

  // Find lower bound: nearest filled slot before this group
  let lowerBoundIndex: number | null = null;
  for (let i = firstIndex - 1; i >= 0; i--) {
    if (allSlots[i].user) {
      lowerBoundIndex = i;
      break;
    }
  }

  // Find upper bound: nearest filled slot after this group
  let upperBoundIndex: number | null = null;
  for (let i = lastIndex + 1; i < allSlots.length; i++) {
    if (allSlots[i].user) {
      upperBoundIndex = i;
      break;
    }
  }

  return {
    slots: groupSlots,
    lowerBoundIndex,
    upperBoundIndex,
  };
}
```

---

### Task 4: Add `wordFitsAlphabetically` helper

**File:** `src/scripts/wos-words.ts`

Create a utility function that checks if a word fits alphabetically between two boundary words:

```typescript
export function wordFitsAlphabetically(
  word: string,
  lowerBound: string | null,
  upperBound: string | null
): boolean {
  const wordLower = word.toLowerCase();

  // Check lower bound (word must come after lowerBound alphabetically)
  if (lowerBound !== null) {
    if (wordLower.localeCompare(lowerBound.toLowerCase()) <= 0) {
      return false;
    }
  }

  // Check upper bound (word must come before upperBound alphabetically)
  if (upperBound !== null) {
    if (wordLower.localeCompare(upperBound.toLowerCase()) >= 0) {
      return false;
    }
  }

  return true;
}
```

---

### Task 5: Create `findSlotMatchedMissedWords` function

**File:** `src/scripts/wos-words.ts`

Create the core function that finds missed word candidates for an empty slot group:

```typescript
export function findSlotMatchedMissedWords(
  group: EmptySlotGroup,
  lowerBoundWord: string | null,
  upperBoundWord: string | null,
  availableLetters: string,
  correctlyGuessedWords: string[]
): { slotLength: number; candidates: string[] }[] {
  // Get unique lengths in this group
  const lengthsInGroup = [...new Set(group.slots.map((s) => s.length))];

  const results: { slotLength: number; candidates: string[] }[] = [];

  for (const length of lengthsInGroup) {
    // Get possible words from dictionary matching this length
    const possibleWords = findWosWordsByLetters(
      availableLetters,
      length
    ).filter((word) => word.length === length);

    // Filter out already guessed words
    const unguessedWords = possibleWords.filter(
      (word) =>
        !correctlyGuessedWords.some(
          (guessed) => guessed.toLowerCase() === word.toLowerCase()
        )
    );

    // Filter by alphabetical bounds
    const candidates = unguessedWords.filter((word) =>
      wordFitsAlphabetically(word, lowerBoundWord, upperBoundWord)
    );

    // Count how many slots of this length exist in the group
    const slotCount = group.slots.filter((s) => s.length === length).length;

    results.push({
      slotLength: length,
      candidates: candidates,
      // Additional info for display: slotCount tells how many of these candidates could fit
    });
  }

  return results;
}
```

---

### Task 6: Refactor `logMissingWords`

**File:** `src/scripts/wos-plus-main.ts`

Replace the current dictionary-only approach with slot-aware logic:

```typescript
private logMissingWords() {
  const knownLetters = this.currentLevelBigWord !== ''
    ? this.currentLevelBigWord
    : this.currentLevelLetters.join('').replace('?', '');

  // Group consecutive empty slots
  const emptyGroups = groupConsecutiveEmptySlots(this.currentLevelSlots);

  if (emptyGroups.length === 0) {
    return; // No empty slots, nothing to do
  }

  const allMissedWords: string[] = [];

  for (const group of emptyGroups) {
    // Get boundary words
    const lowerBoundWord = this.getFilledWordAtIndex(group.lowerBoundIndex);
    const upperBoundWord = this.getFilledWordAtIndex(group.upperBoundIndex);

    // Find candidates for this group
    const results = findSlotMatchedMissedWords(
      group,
      lowerBoundWord,
      upperBoundWord,
      knownLetters,
      this.currentLevelCorrectWords
    );

    // Collect all candidates
    for (const result of results) {
      allMissedWords.push(...result.candidates);
    }
  }

  // Remove duplicates and display
  const uniqueMissedWords = [...new Set(allMissedWords)];

  if (uniqueMissedWords.length > 0) {
    uniqueMissedWords.forEach(word => {
      this.updateCorrectWordsDisplayed(word + "*");
    });
  }
}
```

**Required imports at top of file:**

```typescript
import {
  groupConsecutiveEmptySlots,
  findSlotMatchedMissedWords,
} from "./wos-words";
```

---

## Edge Cases to Handle

1. **First slot empty**: `lowerBoundIndex` will be `null`, so `lowerBoundWord` is `null`. `wordFitsAlphabetically` should only check upper bound.

2. **Last slot empty**: `upperBoundIndex` will be `null`, so `upperBoundWord` is `null`. `wordFitsAlphabetically` should only check lower bound.

3. **All slots empty**: Both bounds are `null` for the single group. Fall back to dictionary-only approach (all possible words are candidates).

4. **Multiple consecutive same-length slots**: Cannot determine exact word-to-slot mapping. Display all candidates that fit within the outer bounds with indication of how many slots they could fill.

5. **Mixed-length consecutive slots**: Each length gets filtered separately by the same alphabetical bounds, allowing different candidate sets per length.

## Testing Scenarios

1. Single empty slot in the middle with filled slots on both sides
2. First slot empty (no lower bound)
3. Last slot empty (no upper bound)
4. Three consecutive empty slots of same length
5. Two consecutive empty slots of different lengths
6. All slots empty except one
7. Level with hidden/fake letters revealed mid-level
