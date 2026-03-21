/**
 * Speed Drawing Mode Handler
 * Players draw visual responses to prompts, others vote on drawings
 */

const DRAWING_PROMPTS = [
  // Objects
  "Draw a pizza",
  "Draw a car",
  "Draw a house",
  "Draw a tree",
  "Draw a cup of coffee",
  "Draw a phone",
  "Draw a shoe",
  "Draw a hat",
  "Draw a book",
  "Draw a flower",

  // Emotions / States
  "Draw happiness",
  "Draw confusion",
  "Draw excitement",
  "Draw sadness",
  "Draw anger",
  "Draw surprise",
  "Draw boredom",
  "Draw sleepiness",

  // Abstract / Creative
  "Draw music",
  "Draw friendship",
  "Draw chaos",
  "Draw a dream",
  "Draw the internet",
  "Draw your mood",
  "Draw Monday morning",
  "Draw your future",

  // Animals
  "Draw a cat",
  "Draw a dog",
  "Draw a penguin",
  "Draw a dinosaur",
  "Draw a dragon",
  "Draw an alien",
  "Draw a unicorn",
  "Draw a fish",

  // School / Life
  "Draw a test you're failing",
  "Draw your ideal vacation",
  "Draw your bed",
  "Draw your crush",
  "Draw your biggest fear",
  "Draw what you want to eat",
  "Draw your best friend",
  "Draw your nemesis",

  // Silly / Weird
  "Draw a potato with a mustache",
  "Draw a dancing spaghetti",
  "Draw a cloud having a bad day",
  "Draw what goes wrong in group projects",
  "Draw your WiFi router as a villain",
  "Draw your homework rebelling",
  "Draw Monday",
  "Draw your brain during a test",

  // Expanded: Food
  "Draw a donut",
  "Draw sushi",
  "Draw a taco",
  "Draw a burger",
  "Draw ice cream",
  "Draw a cake",
  "Draw pasta",

  // Expanded: Animals
  "Draw a lion",
  "Draw a bear",
  "Draw a monkey",
  "Draw a snake",
  "Draw an octopus",
  "Draw a butterfly",
  "Draw a parrot",
  "Draw a shark",

  // Expanded: Technology
  "Draw a computer",
  "Draw a laptop",
  "Draw a tablet",
  "Draw a robot",
  "Draw a UFO",
  "Draw a rocket ship",
  "Draw social media",

  // Expanded: Nature
  "Draw the ocean",
  "Draw a mountain",
  "Draw a volcano",
  "Draw a waterfall",
  "Draw lightning",
  "Draw a rainbow",
  "Draw a forest",

  // Expanded: School
  "Draw a classroom",
  "Draw a locker",
  "Draw a desk",
  "Draw a whiteboard",
  "Draw a pencil",
  "Draw a calculator",

  // Expanded: Sports
  "Draw basketball",
  "Draw soccer",
  "Draw a skateboard",
  "Draw skiing",
  "Draw swimming",
  "Draw a surfboard",

  // Expanded: Emotions & Concepts
  "Draw lazy",
  "Draw sick",
  "Draw confused",
  "Draw proud",
  "Draw jealous",
  "Draw embarrassed",
  "Draw love",
  "Draw stress",

  // Expanded: Silly / Unhinged
  "Draw your screen time",
  "Draw a red flag",
  "Draw what it's like waking up late",
  "Draw your crush noticing you",
  "Draw yourself failing a test",
  "Draw your group chat vibes",
  "Draw zooming into class",
  "Draw your WiFi dying at 1% battery",
  "Draw your last brain cell working",
  "Draw procrastination",

  // Family / Home Life
  "Draw bath time chaos",
  "Draw a family road trip",
  "Draw bedtime negotiations",
  "Draw someone who can't find the remote",
  "Draw Sunday morning",
  "Draw a family dinner",
  "Draw someone trying to be quiet at night",
  "Draw the backseat on a long drive",
  "Draw a broken appliance",
  "Draw someone hogging the blanket",

  // Food Cravings
  "Draw a midnight snack",
  "Draw cereal at 2am",
  "Draw the last slice of pizza",
  "Draw a burnt grilled cheese",
  "Draw a bowl of cereal with no milk",
  "Draw a snack you're not supposed to eat",
  "Draw leftovers nobody wants",
  "Draw eating in secret",
  "Draw the good snacks hidden from the kids",
  "Draw a drive-through order",

  // Funny Situations
  "Draw someone stepping on a Lego",
  "Draw autocorrect gone wrong",
  "Draw a Zoom call disaster",
  "Draw forgetting your password",
  "Draw walking into the wrong room",
  "Draw sending a text to the wrong person",
  "Draw being on hold for an hour",
  "Draw a printer that won't work",
  "Draw someone explaining something nobody asked about",
  "Draw running late in slow motion",

  // Relatable Feelings
  "Draw FOMO",
  "Draw nostalgia",
  "Draw the Sunday scaries",
  "Draw a decision you regret",
  "Draw overthinking",
  "Draw that feeling when the food arrives",
  "Draw wanting to cancel plans",
  "Draw realizing you forgot something important",
  "Draw that 3pm slump",
  "Draw waking up five minutes before your alarm",

  // Animals Doing Human Things
  "Draw a dog at a job interview",
  "Draw a cat judging you",
  "Draw a bear eating fast food",
  "Draw a penguin commuting",
  "Draw a raccoon in a trench coat",
  "Draw a goose with a grievance",
  "Draw a golden retriever giving a presentation",
  "Draw a crab working from home",
  "Draw a crow stealing your lunch",
  "Draw a frog having an existential crisis",

  // Tech & Modern Life
  "Draw inbox zero",
  "Draw a loading screen",
  "Draw Bluetooth not connecting",
  "Draw a notification you're ignoring",
  "Draw a dead laptop charger",
  "Draw autocomplete finishing your sentence wrong",
  "Draw the algorithm deciding what you see",
  "Draw a password reset email",
  "Draw someone filming instead of enjoying the moment",
  "Draw the group chat going off at midnight",

  // Movement / Action
  "Draw a dramatic exit",
  "Draw slow motion",
  "Draw an awkward hug",
  "Draw tripping in public",
  "Draw someone pretending to wave back at you",
  "Draw a wrong turn",
  "Draw sliding into home plate",
  "Draw jumping into a pool",
  "Draw sneaking downstairs on Christmas Eve",
  "Draw doing the worm at a wedding",

  // Abstract / Big Ideas
  "Draw time",
  "Draw a bad idea",
  "Draw your comfort zone",
  "Draw a missed opportunity",
  "Draw getting older",
  "Draw a plot twist",
  "Draw the main character",
  "Draw a villain origin story",
  "Draw the final boss",
  "Draw rock bottom (but make it funny)",
];

/**
 * Pick a drawing prompt
 */
function pickPrompt(game, customPrompts = []) {
  const allPrompts = [...DRAWING_PROMPTS, ...customPrompts];
  const available = allPrompts.filter(p => !game.usedPrompts.includes(p));

  if (available.length === 0) {
    game.usedPrompts = [];
  }

  const pool = available.length > 0 ? available : allPrompts;
  const prompt = pool[Math.floor(Math.random() * pool.length)];
  game.usedPrompts.push(prompt);
  return prompt;
}

/**
 * Validate drawing data (base64 image)
 */
function validateDrawing(imageData) {
  if (!imageData || typeof imageData !== 'string') return null;

  // Check if it's valid base64 (rough check)
  if (!imageData.startsWith('data:image/png;base64,')) return null;

  // Max size: 2MB
  const sizeInBytes = (imageData.length * 3) / 4;
  if (sizeInBytes > 2 * 1024 * 1024) return null;

  return imageData;
}

module.exports = {
  DRAWING_PROMPTS,
  pickPrompt,
  validateDrawing,
};
