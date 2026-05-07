/**
 * AI Judge — Claude evaluates Speed Drawing submissions
 * Replaces the vote phase with instant AI scoring + commentary
 */
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const JUDGE_SYSTEM = `You are Judge Splatter, the world's most dramatic and unhinged art critic.
You host a bad art competition called Bad Art Club where terrible drawings are celebrated.
Your job: judge drawings submitted for a prompt and score each one.

Scoring criteria (1-10 each):
- Accuracy: Does it actually look like the prompt? (10 = uncanny, 1 = what even is this)
- Absurdity: How delightfully weird/chaotic is it? (10 = pure chaos, 1 = boring)
- Artistic Merit: Deliberately reverse-scored — reward bad art. (10 = impressively awful, 1 = suspiciously competent)

Total score = Accuracy + Absurdity + Artistic Merit (max 30)

Respond with JSON only. No markdown fences. Format:
{
  "results": [
    {
      "playerId": "the_id",
      "scores": { "accuracy": 7, "absurdity": 8, "merit": 6 },
      "total": 21,
      "comment": "A short, funny, dramatic judge comment (1-2 sentences max)"
    }
  ],
  "verdict": "A single dramatic closing line about the round overall"
}`;

async function judgeRound(prompt, drawings) {
  // drawings: [{ playerId, playerName, imageData }]
  if (!drawings.length) return null;

  const imageBlocks = drawings.flatMap((d, i) => [
    {
      type: 'text',
      text: `Drawing ${i + 1} — Player ID: ${d.playerId} (${d.playerName}):`,
    },
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: d.imageData.replace('data:image/png;base64,', ''),
      },
    },
  ]);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: JUDGE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: `The prompt was: "${prompt}"\n\nHere are the ${drawings.length} submissions:` },
          ...imageBlocks,
          { type: 'text', text: 'Judge all drawings. Return JSON only.' },
        ],
      },
    ],
  });

  const raw = response.content[0].text.trim();
  const parsed = JSON.parse(raw);
  return parsed;
}

module.exports = { judgeRound };
