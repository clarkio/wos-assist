export async function saveBoard(boardId: string, slots: any[]) {
  // Clean up big word (remove spaces if stored as "W O R D")
  const cleanBoardId = boardId.replace(/\s+/g, "").toUpperCase();
  slots = slots.map(slot => {
    slot.word = slot.letters.join("");
  });
  const isMissingWords = slots.some(slot => slot.letters.includes('.') || slot.letters.includes('.') || slot.word.length === 0);
  const url = '/api';

  if (isMissingWords) {
    console.warn('Cannot save board: some words are incomplete.');
    return;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: cleanBoardId,
        slots: slots,
        created_at: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`Board ${cleanBoardId} saved successfully:`, data);
    return data;
  } catch (error) {
    console.error('Error saving board to Cloudflare Worker:', error);
  }
}
